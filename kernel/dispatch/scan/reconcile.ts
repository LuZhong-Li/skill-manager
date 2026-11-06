/** M4c-3：把 M4c-2 物理观察接入 L-4 对账，并反向枚举账本缺失副本。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DISABLED_SUFFIX, SKILL_MD_NAME } from '@skill-manager/contract';
import type {
  InventoryCopyObservation,
  InventoryCorruptCopy,
  InventoryDiscoveryResult,
  InventoryRootObservation,
  MissingInventoryCopy,
  ReconciliationFormat,
  ReconciliationLedgerRecord,
  ReconciliationLedgerState,
  ReconciliationOutput,
  ReconciliationVisibility,
  ReconciledInventoryCopy,
  ReconciledInventoryCorruptCopy,
} from '@skill-manager/contract';
import { adapterFor } from '../../core/adapters/index.ts';
import { inventoryPhysicalKey } from '../../core/inventory/discover.ts';
import { collectHashEntries } from '../../core/integrity/index.ts';
import { loadHostLandings } from '../../store/host-landings/index.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import { loadPluginIndex } from '../../store/plugin-registry/index.ts';
import { TOOL_VERSION } from '../../core/index/index.ts';
import { loadHostRegistry } from '../../core/hosts/index.ts';
import { loadPluginCatalog, type LoadedPluginCatalog } from '../../core/plugins/host.ts';
import { readMetaFile } from '../../core/metadata/read.ts';
import type { SkillIndex, IndexRecord } from '../../core/metadata/types.ts';
import type { WorkspaceLayout } from '../../store/workspace/index.ts';
import { reconcileHostCopy } from '../../core/host-landings/reconcile.ts';
import { buildHostChannel, renderSourceOf } from '../host/index.ts';
import type { AdapterForm } from '../../core/adapters/types.ts';

export interface ReconcileWorkspace {
  state: 'ok' | 'uninitialized' | 'unreadable';
  index: SkillIndex | null;
}

interface OwnedLedger {
  host_id: string;
  skill_id: string;
  record: ReconciliationLedgerRecord;
}

interface Ledgers {
  hostState: ReconciliationLedgerState;
  pluginState: ReconciliationLedgerState;
  host: OwnedLedger[];
  plugin: OwnedLedger[];
}

export interface ReconciliationSummary {
  host_landings: ReconciliationLedgerState;
  plugin_landings: ReconciliationLedgerState;
}

export interface ReconciledInventory {
  copies: ReconciledInventoryCopy[];
  corrupt: ReconciledInventoryCorruptCopy[];
  missing: MissingInventoryCopy[];
  degradation: ReconciliationSummary;
}

function ledgerState(loaded: { exists: boolean; index: unknown }): ReconciliationLedgerState {
  if (!loaded.exists) return 'missing';
  return loaded.index === null ? 'unreadable' : 'ok';
}

function loadLedgers(layout: WorkspaceLayout): Ledgers {
  const hostLoad = loadHostLandings(layout.hostLandingsFile);
  const pluginLoad = loadPluginIndex(layout.pluginIndexFile);
  const host: OwnedLedger[] = (hostLoad.index?.landings ?? []).map((item) => ({
    host_id: item.host_id,
    skill_id: item.skill_id,
    record: {
      source: 'host_landings',
      state: item.state,
      target_path: item.target_path,
      content_digest: item.content_digest,
      source_checksum: item.source_checksum,
      ...(item.source_version === undefined ? {} : { source_version: item.source_version }),
      ...(item.source_ref === undefined ? {} : { source_ref: item.source_ref }),
      visibility: item.visibility,
      format: item.format,
      adapter_ref: item.adapter_ref,
      registry_version: item.registry_version,
    },
  }));
  const plugin: OwnedLedger[] = (pluginLoad.index?.landings ?? []).map((item) => ({
    host_id: item.host_id,
    skill_id: item.skill_id,
    record: {
      source: 'plugin_landings',
      state: item.state,
      target_path: item.target_path,
    },
  }));
  return {
    hostState: ledgerState(hostLoad),
    pluginState: ledgerState(pluginLoad),
    host,
    plugin,
  };
}

function recordOfIndex(
  index: SkillIndex | null,
  skillId: string | undefined,
): IndexRecord | undefined {
  if (index === null || skillId === undefined) return undefined;
  return index.skills.find((item) => item.id === skillId);
}

function sourceRefOf(raw: Record<string, unknown> | null): string | undefined {
  const source = raw?.['source'];
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const ref = (source as Record<string, unknown>)['ref'];
  return typeof ref === 'string' && ref.trim() !== '' ? ref : undefined;
}

function virtualDigest(files: Map<string, Buffer>): string {
  const hash = createHash('sha256');
  const paths = [...files.keys()].sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
  );
  for (const path of paths) {
    hash.update(Buffer.from(path, 'utf8'));
    hash.update(Buffer.from([0]));
    hash.update(files.get(path) as Buffer);
  }
  return `sha256:${hash.digest('hex')}`;
}

function expectedDigestOf(
  sourceDir: string,
  targetPath: string,
  content: string,
  format: 'skill' | 'rules',
): string | undefined {
  const artifactPath = basename(targetPath);
  if (format === 'rules') {
    return virtualDigest(new Map([[artifactPath, Buffer.from(content, 'utf8')]]));
  }
  const files = new Map<string, Buffer>();
  try {
    for (const relative of collectHashEntries(sourceDir)) {
      files.set(relative, readFileSync(join(sourceDir, relative)));
    }
  } catch {
    return undefined;
  }
  files.set(artifactPath, Buffer.from(content, 'utf8'));
  return virtualDigest(files);
}

function expectedPlanOf(input: {
  copy: InventoryCopyObservation | InventoryCorruptCopy;
  source: ReturnType<typeof renderSourceOf>;
  layout: WorkspaceLayout;
  index: SkillIndex;
  catalog?: LoadedPluginCatalog;
}): { target_path: string; content: string } | undefined {
  if (input.copy.host_group === 'plugin') {
    if (input.catalog === undefined) return undefined;
    const built = buildHostChannel({
      value: input.copy.host_id,
      layout: input.layout,
      index: input.index,
      source: input.source,
      pluginCatalog: input.catalog,
    });
    return built.channel?.plan.entries.find((entry) => entry.landable);
  }
  const adapter = adapterFor(input.copy.host_id);
  if (input.copy.format === 'unknown') return undefined;
  const plan = adapter?.plan(input.source, input.copy.format as AdapterForm);
  return plan?.entries.find((entry) => entry.landable);
}

function expectedDigestForCopy(input: {
  copy: InventoryCopyObservation | InventoryCorruptCopy;
  record: IndexRecord;
  layout: WorkspaceLayout;
  index: SkillIndex;
  catalog?: LoadedPluginCatalog;
}): string | undefined {
  const sourceDir = resolve(input.layout.root, input.record.path);
  const meta = readMetaFile(sourceDir, input.record.id);
  if (meta.raw === null) return undefined;
  const source = renderSourceOf(sourceDir, meta.raw);
  const entry = expectedPlanOf({
    copy: input.copy,
    source,
    layout: input.layout,
    index: input.index,
    ...(input.catalog === undefined ? {} : { catalog: input.catalog }),
  });
  if (entry === undefined) return undefined;
  if (input.copy.format === 'unknown') return undefined;
  return expectedDigestOf(sourceDir, entry.target_path, entry.content, input.copy.format);
}

function workspaceEvidenceFor(input: {
  copy: InventoryCopyObservation | InventoryCorruptCopy;
  workspace: ReconcileWorkspace;
  layout: WorkspaceLayout;
  catalog?: LoadedPluginCatalog;
}): {
  state: 'ok' | 'missing' | 'unreadable';
  record?: import('@skill-manager/contract').ReconciliationWorkspaceRecord;
} {
  if (input.workspace.state !== 'ok' || input.workspace.index === null) {
    return { state: workspaceStateOf(input.workspace.state) };
  }
  const record = workspaceRecordFor(input);
  return record === undefined ? { state: 'ok' } : { state: 'ok', record };
}

function workspaceStateOf(state: ReconcileWorkspace['state']): 'ok' | 'missing' | 'unreadable' {
  return state === 'unreadable' ? 'unreadable' : state === 'ok' ? 'ok' : 'missing';
}

function workspaceRecordFor(input: {
  copy: InventoryCopyObservation | InventoryCorruptCopy;
  workspace: ReconcileWorkspace;
  layout: WorkspaceLayout;
  catalog?: LoadedPluginCatalog;
}): import('@skill-manager/contract').ReconciliationWorkspaceRecord | undefined {
  if (input.workspace.index === null) return undefined;
  const record = recordOfIndex(input.workspace.index, input.copy.skill_id);
  if (record === undefined) return undefined;
  const sourceDir = resolve(input.layout.root, record.path);
  const meta = readMetaFile(sourceDir, record.id);
  const sourceRef = sourceRefOf(meta.raw);
  const expected = expectedDigestForCopy({
    copy: input.copy,
    record,
    layout: input.layout,
    index: input.workspace.index,
    ...(input.catalog === undefined ? {} : { catalog: input.catalog }),
  });
  return {
    skill_id: record.id,
    ...(record.version === undefined ? {} : { version: record.version }),
    ...(sourceRef === undefined ? {} : { source_ref: sourceRef }),
    checksum: record.checksum,
    ...(expected === undefined ? {} : { expected_content_digest: expected }),
    expected_visibility: record.status === 'disabled' ? 'disabled' : 'visible',
  };
}

function ownedMatch(
  copy: InventoryCopyObservation | InventoryCorruptCopy,
  ledgers: OwnedLedger[],
): OwnedLedger | undefined {
  return ledgers.find(
    (item) =>
      sameCopyPath(copy, item.record.target_path) &&
      (item.host_id === copy.host_id || copy.consumed_by.includes(item.host_id)),
  );
}

function sameCopyPath(
  copy: InventoryCopyObservation | InventoryCorruptCopy,
  ledgerPath: string,
): boolean {
  const copyKey = inventoryPhysicalKey(copy.path);
  const ledgerKey = inventoryPhysicalKey(ledgerPath);
  return (
    ledgerKey === copyKey ||
    (copy.format === 'skill' && inventoryPhysicalKey(dirname(ledgerPath)) === copyKey)
  );
}

function reconcileCopy(input: {
  copy: InventoryCopyObservation | InventoryCorruptCopy;
  ledgers: Ledgers;
  workspace: ReconcileWorkspace;
  layout: WorkspaceLayout;
  roots: readonly InventoryRootObservation[];
  catalog?: LoadedPluginCatalog;
}): ReconciliationOutput {
  const list = input.copy.host_group === 'plugin' ? input.ledgers.plugin : input.ledgers.host;
  const matched = ownedMatch(input.copy, list);
  const state =
    input.copy.host_group === 'plugin' ? input.ledgers.pluginState : input.ledgers.hostState;
  const root = input.roots.find((item) => item.root_id === input.copy.root_id);
  return reconcileHostCopy({
    observed: observedOf(input.copy),
    ...(matched === undefined ? {} : { ledger: matched.record }),
    ledger_state: matched === undefined ? state : 'ok',
    workspace: workspaceEvidenceFor({
      copy: input.copy,
      workspace: input.workspace,
      layout: input.layout,
      ...(input.catalog === undefined ? {} : { catalog: input.catalog }),
    }),
    root_readable: root?.readable ?? true,
  });
}

function observedOf(
  copy: InventoryCopyObservation | InventoryCorruptCopy,
): import('@skill-manager/contract').ObservedHostCopy {
  return {
    host_id: copy.host_id,
    target_path: copy.path,
    exists: copy.exists,
    readable: copy.readable,
    format: copy.format,
    visibility: copy.visibility,
    ...(copy.content_digest === undefined ? {} : { content_digest: copy.content_digest }),
    ...(copy.skill_id === undefined ? {} : { skill_id: copy.skill_id }),
    ...(copy.version === undefined ? {} : { version: copy.version }),
    ...(!copy.readable && 'reason' in copy ? { unreadable_reason: copy.reason } : {}),
  };
}

function rootOfLedger(
  item: OwnedLedger,
  roots: readonly InventoryRootObservation[],
): InventoryRootObservation | undefined {
  const target = item.record.target_path;
  return roots
    .filter((root) => root.host_id === item.host_id && isPhysicallyWithin(root.path, target))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function rootReadable(root: InventoryRootObservation | undefined): boolean {
  return root?.state !== 'unreadable' && root?.state !== 'unconfigured';
}

function missingObservation(
  item: OwnedLedger,
  root: InventoryRootObservation | undefined,
): InventoryCorruptCopy {
  return {
    physical_key: inventoryPhysicalKey(item.record.target_path),
    path: item.record.target_path,
    host_id: item.host_id,
    host_group: ledgerHostGroup(item),
    root_id: rootIdOf(root),
    root_role: rootRoleOf(root),
    format: ledgerFormatOf(item),
    visibility: ledgerVisibilityOf(item),
    recursive: rootRecursiveOf(root),
    skill_id: item.skill_id,
    readable: false,
    exists: false,
    consumed_by: rootConsumersOf(root, item.host_id),
    root_ids: rootIdsOf(root),
    sources: [],
    reason: 'ledger_active_copy_absent',
  };
}

function ledgerHostGroup(item: OwnedLedger): 'builtin' | 'plugin' {
  return item.record.source === 'plugin_landings' ? 'plugin' : 'builtin';
}

function rootIdOf(root: InventoryRootObservation | undefined): string {
  return root?.root_id ?? '';
}

function rootRoleOf(
  root: InventoryRootObservation | undefined,
): InventoryRootObservation['root_role'] {
  return root?.root_role ?? 'user';
}

function ledgerFormatOf(item: OwnedLedger): ReconciliationFormat {
  return item.record.format ?? 'unknown';
}

function ledgerVisibilityOf(item: OwnedLedger): ReconciliationVisibility {
  return item.record.visibility ?? 'unknown';
}

function rootRecursiveOf(root: InventoryRootObservation | undefined): boolean {
  return root?.recursive ?? false;
}

function rootConsumersOf(root: InventoryRootObservation | undefined, hostId: string): string[] {
  return root?.consumed_by ?? [hostId];
}

function rootIdsOf(root: InventoryRootObservation | undefined): string[] {
  return root === undefined ? [] : [root.root_id];
}

function missingResult(
  item: OwnedLedger,
  observed: InventoryCorruptCopy,
  root: InventoryRootObservation | undefined,
  result: ReconciliationOutput,
): MissingInventoryCopy {
  return {
    ...result,
    host_id: item.host_id,
    host_group: observed.host_group,
    ...(root === undefined ? {} : { root_id: root.root_id, root_role: root.root_role }),
    target_path: item.record.target_path,
    ...(item.record.format === 'skill' || item.record.format === 'rules'
      ? { format: item.record.format }
      : {}),
    ...(item.record.visibility === 'visible' || item.record.visibility === 'disabled'
      ? { visibility: item.record.visibility }
      : {}),
    skill_id: item.skill_id,
    consumed_by: observed.consumed_by,
    is_x_host: observed.host_group === 'plugin',
  };
}

function activeMissing(input: {
  item: OwnedLedger;
  observed: Set<string>;
  roots: readonly InventoryRootObservation[];
  workspace: ReconcileWorkspace;
  layout: WorkspaceLayout;
  catalog?: LoadedPluginCatalog;
}): MissingInventoryCopy | undefined {
  if (input.item.record.state !== 'active') return undefined;
  if (input.observed.has(inventoryPhysicalKey(input.item.record.target_path))) return undefined;
  const root = rootOfLedger(input.item, input.roots);
  const observed = missingObservation(input.item, root);
  const result = reconcileHostCopy({
    observed: observedOf(observed),
    ledger: input.item.record,
    ledger_state: 'ok',
    workspace: workspaceEvidenceFor({
      copy: observed,
      workspace: input.workspace,
      layout: input.layout,
      ...(input.catalog === undefined ? {} : { catalog: input.catalog }),
    }),
    root_readable: rootReadable(root),
  });
  return missingResult(input.item, observed, root, result);
}

/** 正向分类全部磁盘观察；反向只从 active 账本记录生成 missing。 */
export function reconcileInventory(input: {
  discovery: InventoryDiscoveryResult;
  workspace: ReconcileWorkspace;
  layout: WorkspaceLayout;
}): ReconciledInventory {
  const ledgers = loadLedgers(input.layout);
  const catalog = loadPluginCatalog({
    layout: input.layout,
    builtins: loadHostRegistry().hosts,
    toolVersion: TOOL_VERSION,
  });
  const copies = input.discovery.copies.map((copy) => ({
    ...copy,
    reconciliation: reconcileCopy({
      copy,
      ledgers,
      workspace: input.workspace,
      layout: input.layout,
      roots: input.discovery.roots,
      catalog,
    }),
  }));
  const corrupt = input.discovery.corrupt.map((copy) => ({
    ...copy,
    reconciliation: reconcileCopy({
      copy,
      ledgers,
      workspace: input.workspace,
      layout: input.layout,
      roots: input.discovery.roots,
      catalog,
    }),
  }));
  const observed = new Set(
    [...input.discovery.copies, ...input.discovery.corrupt].flatMap((item) => {
      const keys = [inventoryPhysicalKey(item.path)];
      if (item.format === 'skill') {
        keys.push(inventoryPhysicalKey(join(item.path, SKILL_MD_NAME)));
        keys.push(inventoryPhysicalKey(join(item.path, `${SKILL_MD_NAME}${DISABLED_SUFFIX}`)));
      }
      return keys;
    }),
  );
  const missing = [...ledgers.host, ...ledgers.plugin]
    .map((item) =>
      activeMissing({
        item,
        observed,
        roots: input.discovery.roots,
        workspace: input.workspace,
        layout: input.layout,
        catalog,
      }),
    )
    .filter((item): item is MissingInventoryCopy => item !== undefined);
  return {
    copies,
    corrupt,
    missing,
    degradation: {
      host_landings: ledgers.hostState,
      plugin_landings: ledgers.pluginState,
    },
  };
}
