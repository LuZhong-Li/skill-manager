/** M4c-2 只读宿主目录发现：根状态、有效副本、损坏副本与物理去重。 */
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYamlText } from 'yaml';
import { physicalKey } from '../../store/paths/index.ts';
import {
  DISABLED_SUFFIX,
  SKILL_MD_NAME,
  type InventoryCopyObservation,
  type InventoryCopySource,
  type InventoryCorruptCopy,
  type InventoryDiscoveryResult,
  type InventoryRootObservation,
  type InventoryRootView,
} from '@skill-manager/contract';
import { computeLandingChecksum } from '../integrity/index.ts';
import { hostById } from '../hosts/index.ts';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);

interface RootScan {
  copies: InventoryCopyObservation[];
  corrupt: InventoryCorruptCopy[];
  state: InventoryRootObservation['state'];
  readable: boolean;
  reason?: string;
}

export interface SkillFrontmatterRead {
  raw: Record<string, unknown> | null;
  reason?: string;
}

interface CopyContext {
  root: InventoryRootView;
  source: InventoryCopySource;
  path: string;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].filter((value) => value !== '');
}

/**
 * 物理去重键：realpath + Windows casefold；M4c-3 反向 matched 也复用。
 * 委托共享路径助手，保证审计、reconcile 与落位用同一套规范化语义。
 */
export function inventoryPhysicalKey(path: string): string {
  return physicalKey(path);
}

function sourceOf(root: InventoryRootView): InventoryCopySource {
  return {
    host_id: root.host_id,
    host_group: root.host_group,
    root_id: root.root_id,
    root_role: root.role,
    recursive: root.depth === 'recursive',
  };
}

function consumedByOf(root: InventoryRootView): string[] {
  return unique([root.host_id, ...root.consumed_by]);
}

function baseCopy(
  context: CopyContext,
  format: 'skill' | 'rules',
  visibility: 'visible' | 'disabled',
): InventoryCopyObservation {
  return {
    physical_key: inventoryPhysicalKey(context.path),
    path: context.path,
    host_id: context.root.host_id,
    host_group: context.root.host_group,
    root_id: context.root.root_id,
    root_role: context.root.role,
    format,
    visibility,
    recursive: context.root.depth === 'recursive',
    readable: true,
    exists: true,
    consumed_by: consumedByOf(context.root),
    root_ids: [context.root.root_id],
    sources: [context.source],
  };
}

function corruptCopy(
  context: CopyContext,
  format: 'skill' | 'rules' | 'unknown',
  visibility: 'visible' | 'disabled' | 'unknown',
  reason: string,
  extra: Partial<InventoryCorruptCopy> = {},
): InventoryCorruptCopy {
  return {
    physical_key: inventoryPhysicalKey(context.path),
    path: context.path,
    host_id: context.root.host_id,
    host_group: context.root.host_group,
    root_id: context.root.root_id,
    root_role: context.root.role,
    format,
    visibility,
    recursive: context.root.depth === 'recursive',
    readable: false,
    exists: true,
    consumed_by: consumedByOf(context.root),
    root_ids: [context.root.root_id],
    sources: [context.source],
    reason,
    ...extra,
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function frontmatterOf(path: string): SkillFrontmatterRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { raw: null, reason: 'unreadable' };
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match === null) return { raw: null, reason: 'missing_frontmatter' };
  try {
    const raw = parseYamlText(match[1] ?? '') as unknown;
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? { raw: raw as Record<string, unknown> }
      : { raw: null, reason: 'frontmatter_not_mapping' };
  } catch {
    return { raw: null, reason: 'bad_yaml' };
  }
}

/** 读取 SKILL.md / SKILL.md.disabled 的 frontmatter；adopt 复用同一解析口径。 */
export function readSkillFrontmatter(path: string): SkillFrontmatterRead {
  return frontmatterOf(path);
}

function digestOf(path: string, format: 'skill' | 'rules'): string | undefined {
  try {
    return computeLandingChecksum({ targetPath: path, format });
  } catch {
    return undefined;
  }
}

function skillCopyOf(
  root: InventoryRootView,
  dir: string,
  visibility: 'visible' | 'disabled',
  marker: string,
): InventoryCopyObservation | InventoryCorruptCopy {
  const context: CopyContext = { root, source: sourceOf(root), path: dir };
  const digest = digestOf(dir, 'skill');
  const fields = skillFieldsOf(frontmatterOf(marker));
  if ('reason' in fields) {
    return corruptCopy(context, 'skill', visibility, fields.reason, {
      ...(digest === undefined ? {} : { content_digest: digest }),
    });
  }
  if (digest === undefined) {
    return corruptCopy(context, 'skill', visibility, 'digest_failed');
  }
  return {
    ...baseCopy(context, 'skill', visibility),
    ...fields,
    content_digest: digest,
  };
}

function skillFieldsOf(
  front: SkillFrontmatterRead,
): { skill_id: string; version?: string } | { reason: string } {
  if (front.raw === null) return { reason: front.reason ?? 'unreadable' };
  const name = front.raw['name'];
  if (typeof name !== 'string' || name.trim() === '') return { reason: 'missing_name' };
  const description = front.raw['description'];
  if (typeof description !== 'string' || description.trim() === '') {
    return { reason: 'missing_description' };
  }
  const version = front.raw['version'];
  return {
    skill_id: name.trim(),
    ...(typeof version === 'string' && version.trim() !== '' ? { version: version.trim() } : {}),
  };
}

function ruleCopyOf(
  root: InventoryRootView,
  file: string,
): InventoryCopyObservation | InventoryCorruptCopy {
  const context: CopyContext = { root, source: sourceOf(root), path: file };
  const digest = digestOf(file, 'rules');
  try {
    readFileSync(file);
  } catch {
    return corruptCopy(context, 'rules', 'visible', 'unreadable', {
      ...(digest === undefined ? {} : { content_digest: digest }),
    });
  }
  if (digest === undefined) {
    return corruptCopy(context, 'rules', 'visible', 'digest_failed');
  }
  return {
    ...baseCopy(context, 'rules', 'visible'),
    skill_id: basename(file).replace(/\.mdc?$/i, ''),
    content_digest: digest,
  };
}

function addSkillDir(
  result: { copies: InventoryCopyObservation[]; corrupt: InventoryCorruptCopy[] },
  root: InventoryRootView,
  dir: string,
): void {
  const visible = join(dir, SKILL_MD_NAME);
  const disabled = join(dir, `${SKILL_MD_NAME}${DISABLED_SUFFIX}`);
  const hasVisible = isFile(visible);
  const hasDisabled = isFile(disabled);
  if (!hasVisible && !hasDisabled) return;
  if (hasVisible && hasDisabled) {
    result.corrupt.push(
      corruptCopy(
        { root, source: sourceOf(root), path: dir },
        'skill',
        'unknown',
        'visibility_conflict',
      ),
    );
    return;
  }
  const found = hasVisible
    ? skillCopyOf(root, dir, 'visible', visible)
    : skillCopyOf(root, dir, 'disabled', disabled);
  if ('reason' in found) result.corrupt.push(found);
  else result.copies.push(found);
}

function walkSkillDirs(
  result: { copies: InventoryCopyObservation[]; corrupt: InventoryCorruptCopy[] },
  root: InventoryRootView,
  dir: string,
  recursive: boolean,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || EXCLUDED_DIRS.has(entry.name)) continue;
    const child = join(dir, entry.name);
    addSkillDir(result, root, child);
    if (recursive) walkSkillDirs(result, root, child, true);
  }
}

function walkRuleFiles(
  result: { copies: InventoryCopyObservation[]; corrupt: InventoryCorruptCopy[] },
  root: InventoryRootView,
  dir: string,
  recursive: boolean,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !EXCLUDED_DIRS.has(entry.name)) walkRuleFiles(result, root, child, true);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const builtinRule = lower.endsWith('.mdc');
    const pluginRule = root.host_group === 'plugin' && lower.endsWith('.md');
    if (!builtinRule && !pluginRule) continue;
    const found = ruleCopyOf(root, child);
    if ('reason' in found) result.corrupt.push(found);
    else result.copies.push(found);
  }
}

function applicable(root: InventoryRootView): boolean {
  if (root.host_group === 'plugin') return root.kind === 'skill' || root.kind === 'rules';
  const forms = hostById(root.host_id)?.adapter_forms ?? [];
  return root.kind === 'rules' ? forms.includes('rules') : forms.includes('skill');
}

function rootFailure(root: InventoryRootView): RootScan | null {
  if (!root.configured || root.path === '') {
    return {
      copies: [],
      corrupt: [],
      state: 'unconfigured',
      readable: false,
      ...(root.reason === undefined ? {} : { reason: root.reason }),
    };
  }
  if (!applicable(root)) {
    return {
      copies: [],
      corrupt: [],
      state: 'not_applicable',
      readable: false,
      reason: 'entry_or_non_skill_root',
    };
  }
  if (!exists(root.path)) {
    return {
      copies: [],
      corrupt: [],
      state: 'missing',
      readable: false,
      reason: 'root_missing',
    };
  }
  if (!isDirectory(root.path)) {
    return {
      copies: [],
      corrupt: [],
      state: 'unreadable',
      readable: false,
      reason: 'not_directory',
    };
  }
  try {
    readdirSync(root.path);
  } catch {
    return {
      copies: [],
      corrupt: [],
      state: 'unreadable',
      readable: false,
      reason: 'unreadable',
    };
  }
  return null;
}

function scanRoot(root: InventoryRootView): RootScan {
  const failure = rootFailure(root);
  if (failure !== null) return failure;
  const result = {
    copies: [] as InventoryCopyObservation[],
    corrupt: [] as InventoryCorruptCopy[],
  };
  if (root.kind === 'rules') walkRuleFiles(result, root, root.path, root.depth === 'recursive');
  else walkSkillDirs(result, root, root.path, root.depth === 'recursive');
  return {
    ...result,
    state: result.copies.length === 0 && result.corrupt.length === 0 ? 'empty' : 'ok',
    readable: true,
  };
}

function mergeSources(left: readonly InventoryCopySource[], right: readonly InventoryCopySource[]) {
  const map = new Map<string, InventoryCopySource>();
  for (const source of [...left, ...right]) map.set(`${source.host_id}\0${source.root_id}`, source);
  return [...map.values()];
}

function mergeCopy(
  left: InventoryCopyObservation,
  right: InventoryCopyObservation,
): InventoryCopyObservation {
  return {
    ...left,
    consumed_by: unique([...left.consumed_by, ...right.consumed_by]),
    root_ids: unique([...left.root_ids, ...right.root_ids]),
    sources: mergeSources(left.sources, right.sources),
  };
}

function mergeCorrupt(
  left: InventoryCorruptCopy,
  right: InventoryCorruptCopy,
): InventoryCorruptCopy {
  return {
    ...left,
    consumed_by: unique([...left.consumed_by, ...right.consumed_by]),
    root_ids: unique([...left.root_ids, ...right.root_ids]),
    sources: mergeSources(left.sources, right.sources),
  };
}

function dedup<T extends { physical_key: string }>(
  items: T[],
  merge: (left: T, right: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const previous = map.get(item.physical_key);
    map.set(item.physical_key, previous === undefined ? item : merge(previous, item));
  }
  return [...map.values()].sort((left, right) =>
    left.physical_key.localeCompare(right.physical_key),
  );
}

function countState(
  roots: readonly InventoryRootObservation[],
  state: InventoryRootObservation['state'],
) {
  return roots.filter((root) => root.state === state).length;
}

/** 枚举根并返回物理副本；只读，不调用任何写盘函数。 */
export function discoverInventoryCopies(
  roots: readonly InventoryRootView[],
): InventoryDiscoveryResult {
  const observations: InventoryRootObservation[] = [];
  const rawCopies: InventoryCopyObservation[] = [];
  const rawCorrupt: InventoryCorruptCopy[] = [];
  for (const root of roots) {
    const scan = scanRoot(root);
    observations.push({
      root_id: root.root_id,
      host_id: root.host_id,
      host_group: root.host_group,
      root_role: root.role,
      kind: root.kind,
      path: root.path,
      recursive: root.depth === 'recursive',
      origin: root.origin,
      is_x_host: root.host_group === 'plugin',
      consumed_by: [...root.consumed_by],
      configured: root.configured,
      state: scan.state,
      readable: scan.readable,
      copy_count: scan.copies.length,
      corrupt_count: scan.corrupt.length,
      ...(scan.reason === undefined ? {} : { reason: scan.reason }),
      ...(root.platform_notes === undefined ? {} : { platform_notes: root.platform_notes }),
      ...(root.pending_verification === undefined
        ? {}
        : { pending_verification: root.pending_verification }),
    });
    rawCopies.push(...scan.copies);
    rawCorrupt.push(...scan.corrupt);
  }
  const copies = dedup(rawCopies, mergeCopy);
  const corrupt = dedup(rawCorrupt, mergeCorrupt);
  return {
    roots: observations.sort((left, right) => left.root_id.localeCompare(right.root_id)),
    copies,
    corrupt,
    summary: {
      roots_total: observations.length,
      roots_ok: countState(observations, 'ok'),
      roots_empty: countState(observations, 'empty'),
      roots_missing: countState(observations, 'missing'),
      roots_unconfigured: countState(observations, 'unconfigured'),
      roots_unreadable: countState(observations, 'unreadable'),
      roots_not_applicable: countState(observations, 'not_applicable'),
      copies_before_dedup: rawCopies.length,
      copies_after_dedup: copies.length,
      corrupt_before_dedup: rawCorrupt.length,
      corrupt_after_dedup: corrupt.length,
      duplicates_removed: rawCopies.length - copies.length,
      dedup_key: 'realpath+casefold',
    },
  };
}
