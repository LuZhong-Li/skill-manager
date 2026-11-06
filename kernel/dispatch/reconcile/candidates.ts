/** reconcile 的物理副本候选与 not_distributed 合成项；只读。 */
import { basename, join } from 'node:path';
import type {
  HostRootRole,
  InventoryRootView,
  MissingInventoryCopy,
  ReconciledInventoryCopy,
  ReconciledInventoryCorruptCopy,
  ReconcileSelection,
} from '@skill-manager/contract';
import { inventoryPhysicalKey } from '../../core/inventory/discover.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import { reconcileHostCopy } from '../../core/host-landings/reconcile.ts';
import { readMetaFile } from '../../core/metadata/read.ts';
import { loadHostLandings } from '../../store/host-landings/index.ts';
import type { InventorySnapshot } from '../scan/inventory.ts';
import { hostChannelOf } from '../host/index.ts';
import { pluginOrphanCandidates } from './plugin-candidates.ts';
import { unique, type Candidate } from './candidate-model.ts';

export { unique, type Candidate } from './candidate-model.ts';

function uniqueRoles(values: readonly HostRootRole[]): HostRootRole[] {
  return [...new Set(values)];
}

function candidateOfCopy(
  copy: ReconciledInventoryCopy | ReconciledInventoryCorruptCopy,
): Candidate {
  const inferredSkillId =
    copy.skill_id ?? (copy.format === 'skill' ? basename(copy.path) : undefined);
  return {
    physical_key: copy.physical_key,
    target_path: copy.path,
    host_ids: unique([copy.host_id, ...copy.sources.map((item) => item.host_id)]),
    consumed_by: unique(copy.consumed_by),
    format: copy.format,
    ...(copy.visibility === 'unknown' ? {} : { visibility: copy.visibility }),
    ...(inferredSkillId === undefined ? {} : { skill_id: inferredSkillId }),
    ...(copy.content_digest === undefined ? {} : { content_digest: copy.content_digest }),
    exists: true,
    root_ids: unique([copy.root_id, ...copy.root_ids]),
    root_roles: uniqueRoles([copy.root_role, ...copy.sources.map((item) => item.root_role)]),
    reconciliation: copy.reconciliation,
    is_plugin: copy.host_group === 'plugin',
    format_conflict: false,
    ledger_conflict: false,
  };
}

function candidateOfMissing(copy: MissingInventoryCopy): Candidate {
  return {
    physical_key: inventoryPhysicalKey(copy.target_path),
    target_path: copy.target_path,
    host_ids: [copy.host_id],
    consumed_by: unique(copy.consumed_by),
    format: copy.format ?? 'unknown',
    ...(copy.visibility === undefined ? {} : { visibility: copy.visibility }),
    ...(copy.skill_id === undefined ? {} : { skill_id: copy.skill_id }),
    exists: false,
    root_ids: unique([copy.root_id]),
    root_roles: [copy.root_role ?? 'user'],
    reconciliation: copy,
    is_plugin: copy.host_group === 'plugin',
    format_conflict: false,
    ledger_conflict: false,
  };
}

function mergeCandidate(left: Candidate | undefined, right: Candidate): Candidate {
  if (left === undefined) return right;
  return {
    ...left,
    host_ids: unique([...left.host_ids, ...right.host_ids]),
    consumed_by: unique([...left.consumed_by, ...right.consumed_by]),
    root_ids: unique([...left.root_ids, ...right.root_ids]),
    root_roles: uniqueRoles([...left.root_roles, ...right.root_roles]),
    format_conflict: left.format_conflict || right.format_conflict || left.format !== right.format,
    ledger_conflict:
      left.ledger_conflict || right.ledger_conflict || left.is_plugin !== right.is_plugin,
  };
}

export function allCandidates(snapshot: InventorySnapshot): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const copy of snapshot.reconciled.copies) {
    const candidate = candidateOfCopy(copy);
    map.set(candidate.physical_key, mergeCandidate(map.get(candidate.physical_key), candidate));
  }
  for (const copy of snapshot.reconciled.corrupt) {
    const candidate = candidateOfCopy(copy);
    map.set(candidate.physical_key, mergeCandidate(map.get(candidate.physical_key), candidate));
  }
  for (const copy of snapshot.reconciled.missing) {
    const candidate = candidateOfMissing(copy);
    map.set(candidate.physical_key, mergeCandidate(map.get(candidate.physical_key), candidate));
  }
  for (const candidate of pluginOrphanCandidates(snapshot)) {
    if (!map.has(candidate.physical_key)) map.set(candidate.physical_key, candidate);
  }
  return [...map.values()];
}

export function notDistributedCandidates(
  snapshot: InventorySnapshot,
  selection: ReconcileSelection,
  observed: readonly Candidate[],
): Candidate[] {
  const index = snapshot.workspace.index;
  if (index === null) return [];
  const explicitIds = unique([...(selection.ids ?? []), selection.id]);
  if (!notDistributedSelectionEnabled(selection, explicitIds)) return [];
  const ids = notDistributedIds(snapshot, selection, explicitIds);
  const result: Candidate[] = [];
  for (const id of ids) {
    const record = index.skills.find((item) => item.id === id);
    if (record === undefined) continue;
    const countBefore = result.length;
    for (const target of record.targets) {
      if (!targetSelected(target.target, target.scope, selection)) continue;
      const candidate = targetCandidate(snapshot, record, target, selection, observed, result);
      if (candidate !== undefined) result.push(candidate);
    }
    if (result.length === countBefore) {
      result.push(...guardedRootCandidates(snapshot, record.id, selection, observed, result));
    }
  }
  return result;
}

function targetSelected(
  target: string,
  scope: 'global' | 'project',
  selection: ReconcileSelection,
): boolean {
  if (selection.host !== undefined && selection.host !== 'all' && selection.host !== target) {
    return false;
  }
  const role: HostRootRole = scope === 'project' ? 'project' : 'user';
  return selection.roles === undefined || selection.roles.length === 0
    ? true
    : selection.roles.includes(role);
}

function targetCandidate(
  snapshot: InventorySnapshot,
  record: NonNullable<InventorySnapshot['workspace']['index']>['skills'][number],
  target: { target: string; scope: 'global' | 'project'; enabled: boolean },
  selection: ReconcileSelection,
  observed: readonly Candidate[],
  result: readonly Candidate[],
): Candidate | undefined {
  const index = snapshot.workspace.index;
  if (index === null) return undefined;
  const planned = plannedTargetOf(snapshot, index, record, target.target);
  if (!planned.ok) return unavailableTargetCandidate(record.id, target, planned.reason);
  const { channel, entry, targetPath } = planned;
  const physicalKey = inventoryPhysicalKey(targetPath);
  if (candidateObserved(physicalKey, observed, result)) return undefined;
  const matchingRoots = snapshot.roots.filter((root) =>
    distributionPathMatches(targetPath, root.path),
  );
  if (!distributionRootSelected(matchingRoots, selection.roots)) return undefined;
  const rootRoles = rootRolesOf(matchingRoots, target.scope);
  const visibility = target.enabled ? 'visible' : 'disabled';
  return {
    physical_key: physicalKey,
    target_path: targetPath,
    host_ids: [channel.hostId],
    consumed_by: unique([channel.hostId, ...entry.consumed_by]),
    format: channel.form === 'rules' ? 'rules' : 'skill',
    visibility,
    skill_id: record.id,
    exists: false,
    root_ids: unique(matchingRoots.map((root) => root.root_id)),
    root_roles: rootRoles,
    reconciliation: distributionReconciliation(
      snapshot,
      record,
      channel.hostId,
      targetPath,
      visibility,
    ),
    is_plugin: channel.plugin !== undefined,
    format_conflict: false,
    ledger_conflict: false,
  };
}

type PlannedTarget =
  | {
      ok: true;
      channel: NonNullable<ReturnType<typeof hostChannelOf>['channel']>;
      entry: NonNullable<ReturnType<typeof hostChannelOf>['channel']>['plan']['entries'][number];
      targetPath: string;
    }
  | { ok: false; reason: string };

function plannedTargetOf(
  snapshot: InventorySnapshot,
  index: NonNullable<InventorySnapshot['workspace']['index']>,
  record: NonNullable<InventorySnapshot['workspace']['index']>['skills'][number],
  hostValue: string,
): PlannedTarget {
  const skillDir = join(snapshot.layout.root, record.path);
  const meta = readMetaFile(skillDir, record.id);
  if (meta.raw === null) return { ok: false, reason: 'skill_meta_unreadable' };
  const channel = hostChannelOf({
    hostValue,
    layout: snapshot.layout,
    index,
    skillDir,
    raw: meta.raw,
  }).channel;
  const entry = channel?.plan.entries.find((item) => item.landable);
  if (channel === undefined || entry === undefined) {
    return {
      ok: false,
      reason: hostValue.startsWith('x-')
        ? 'plugin_host_unavailable'
        : 'host_distribution_unavailable',
    };
  }
  return {
    ok: true,
    channel,
    entry,
    targetPath: channel.form === 'rules' ? entry.target_path : entry.root_path,
  };
}

function candidateObserved(
  physicalKey: string,
  observed: readonly Candidate[],
  result: readonly Candidate[],
): boolean {
  return [...observed, ...result].some((item) => item.physical_key === physicalKey);
}

function distributionRootSelected(
  roots: readonly InventoryRootView[],
  selectedRoots: readonly string[],
): boolean {
  return selectedRoots.length === 0 || roots.some((root) => rootSelected(root, selectedRoots));
}

function rootRolesOf(
  roots: readonly InventoryRootView[],
  scope: 'global' | 'project',
): HostRootRole[] {
  if (roots.length > 0) return uniqueRoles(roots.map((root) => root.role));
  return [scope === 'project' ? 'project' : 'user'];
}

function rootSelected(root: InventoryRootView, selectedRoots: readonly string[]): boolean {
  if (selectedRoots.includes(root.root_id)) return true;
  const rootKey = inventoryPhysicalKey(root.path);
  return selectedRoots.some((value) => inventoryPhysicalKey(value) === rootKey);
}

function guardedRootCandidates(
  snapshot: InventorySnapshot,
  skillId: string,
  selection: ReconcileSelection,
  observed: readonly Candidate[],
  result: readonly Candidate[],
): Candidate[] {
  if (selection.roots.length === 0 || selection.host === 'all') return [];
  return snapshot.roots.flatMap((root): Candidate[] => {
    if (root.role === 'user' || root.kind === 'rules' || !rootSelected(root, selection.roots))
      return [];
    if (selection.host !== undefined && root.host_id !== selection.host) return [];
    const targetPath = join(root.path, skillId);
    const key = inventoryPhysicalKey(targetPath);
    if (
      observed.some((item) => item.physical_key === key) ||
      result.some((item) => item.physical_key === key)
    ) {
      return [];
    }
    return [
      {
        physical_key: key,
        target_path: targetPath,
        host_ids: [root.host_id],
        consumed_by: unique([root.host_id, ...root.consumed_by]),
        format: 'skill',
        visibility: 'visible',
        skill_id: skillId,
        exists: false,
        root_ids: [root.root_id],
        root_roles: [root.role],
        reconciliation: {
          classification: 'undetermined',
          ledger_source: 'none',
          authority: 'insufficient',
          evidence: {
            managed: 'insufficient',
            content: 'insufficient',
            source: 'insufficient',
          },
          reasons: ['non_user_role_read_only'],
          drift_reasons: [],
          untracked_candidate: false,
        },
        is_plugin: false,
        format_conflict: false,
        ledger_conflict: false,
        unavailable_reason: 'non_user_role_read_only',
      },
    ];
  });
}

function distributionPathMatches(targetPath: string, rootPath: string): boolean {
  return isPhysicallyWithin(rootPath, targetPath);
}

function distributionReconciliation(
  snapshot: InventorySnapshot,
  record: NonNullable<InventorySnapshot['workspace']['index']>['skills'][number],
  hostId: string,
  targetPath: string,
  visibility: 'visible' | 'disabled',
) {
  const ledgerRecord = loadHostLandings(snapshot.layout.hostLandingsFile).index?.landings.find(
    (item) => item.skill_id === record.id && item.host_id === hostId,
  );
  return reconcileHostCopy({
    observed: {
      host_id: hostId,
      target_path: targetPath,
      exists: false,
      readable: false,
      format: 'skill',
      visibility,
    },
    ...(ledgerRecord === undefined
      ? { ledger_state: 'missing' as const }
      : {
          ledger: {
            source: 'host_landings' as const,
            state: ledgerRecord.state,
            target_path: ledgerRecord.target_path,
            content_digest: ledgerRecord.content_digest,
            source_checksum: ledgerRecord.source_checksum,
            visibility: ledgerRecord.visibility,
            format: ledgerRecord.format,
          },
          ledger_state: 'ok' as const,
        }),
    workspace: {
      state: 'ok',
      record: {
        skill_id: record.id,
        ...(record.version === undefined ? {} : { version: record.version }),
        checksum: record.checksum,
      },
    },
    root_readable: true,
  });
}

function unavailableTargetCandidate(
  skillId: string,
  target: { target: string; scope: 'global' | 'project'; enabled: boolean },
  reason: string,
): Candidate {
  return {
    physical_key: `${skillId}:${target.target}`,
    target_path: target.target,
    host_ids: [target.target],
    consumed_by: [target.target],
    format: 'skill',
    visibility: target.enabled ? 'visible' : 'disabled',
    skill_id: skillId,
    exists: false,
    root_ids: [],
    root_roles: [target.scope === 'project' ? 'project' : 'user'],
    reconciliation: {
      classification: 'undetermined',
      ledger_source: 'none',
      authority: 'insufficient',
      evidence: {
        managed: 'insufficient',
        content: 'insufficient',
        source: 'insufficient',
      },
      reasons: [reason],
      drift_reasons: [],
      untracked_candidate: false,
    },
    is_plugin: target.target.startsWith('x-'),
    format_conflict: false,
    ledger_conflict: false,
    unavailable_reason: reason,
  };
}

function notDistributedSelectionEnabled(
  selection: ReconcileSelection,
  explicitIds: readonly string[],
): boolean {
  if (selection.classification === 'not_distributed') return true;
  if (selection.mode !== 'id-host' && selection.mode !== 'batch') return false;
  return explicitIds.length > 0;
}

function notDistributedIds(
  snapshot: InventorySnapshot,
  selection: ReconcileSelection,
  explicitIds: readonly string[],
): string[] {
  if (explicitIds.length > 0) return [...explicitIds];
  if (selection.classification !== 'not_distributed') return [];
  return snapshot.workspace.index?.skills.map((item) => item.id) ?? [];
}
