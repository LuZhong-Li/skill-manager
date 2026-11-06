/** M6 批量 adopt 的候选选择、冲突解析与计划预览；不执行写操作。 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AdoptConflictPolicy,
  AdoptPreview,
  BulkAdoptPolicy,
  BulkAdoptSummary,
  HostRootRole,
  InventoryClassificationKey,
  ReconcilePlanItem,
  ReconcileSelection,
} from '@skill-manager/contract';
import { computeLandingChecksum } from '../../core/integrity/index.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import { readSkillFrontmatter } from '../../core/inventory/discover.ts';
import type { SkillIndex } from '../../core/metadata/types.ts';
import { resolveTargetById } from '../../core/targets/resolver/index.ts';
import type { InventorySnapshot } from '../scan/inventory.ts';
import type { Candidate } from './candidate-model.ts';
import { normalizeAdoptFrontmatter } from './adopt-frontmatter.ts';

const ADOPTABLE = new Set<InventoryClassificationKey>([
  'untracked',
  'inferred_consistent',
  'inferred_drift',
  'orphaned_without_workspace',
]);
const SKILL_MARKER = 'SKILL.md';
const DISABLED_MARKER = 'SKILL.md.disabled';

function classificationOf(candidate: Candidate): InventoryClassificationKey {
  const output = candidate.reconciliation;
  if (output.classification === 'orphaned') {
    return output.orphaned?.workspace_record_present
      ? 'orphaned_with_workspace'
      : 'orphaned_without_workspace';
  }
  return output.classification === 'undetermined' && output.untracked_candidate
    ? 'untracked'
    : output.classification;
}

function requestedRoles(policy: BulkAdoptPolicy): HostRootRole[] {
  return policy.roles === undefined || policy.roles.length === 0 ? ['user'] : policy.roles;
}

function eligibleAdoptCandidates(
  candidates: readonly Candidate[],
  policy: BulkAdoptPolicy,
): Candidate[] {
  const seen = new Set<string>();
  const roles = new Set(requestedRoles(policy));
  return candidates.filter((candidate) => {
    if (seen.has(candidate.physical_key)) return false;
    seen.add(candidate.physical_key);
    if (candidate.is_plugin || candidate.format !== 'skill' || candidate.skill_id === undefined) {
      return false;
    }
    if (!ADOPTABLE.has(classificationOf(candidate))) return false;
    return candidate.root_roles.some((role) => roles.has(role));
  });
}

function candidateSortKey(candidate: Candidate): string {
  return [
    candidate.skill_id ?? '',
    [...candidate.host_ids].sort().join(','),
    [...candidate.root_roles].sort().join(','),
    candidate.physical_key,
  ].join('\0');
}

/** 可采纳候选的稳定排序池；在 limit 之前保留全集供 bulk summary 使用。 */
export function bulkAdoptPool(
  candidates: readonly Candidate[],
  policy: BulkAdoptPolicy,
): Candidate[] {
  if (!policy.enabled) return [];
  return eligibleAdoptCandidates(candidates, policy).sort((left, right) =>
    candidateSortKey(left).localeCompare(candidateSortKey(right)),
  );
}

export function bulkAdoptCandidates(
  candidates: readonly Candidate[],
  policy: BulkAdoptPolicy,
): Candidate[] {
  const pool = bulkAdoptPool(candidates, policy);
  return policy.limit === undefined ? pool : pool.slice(0, policy.limit);
}

export function validateBulkAdoptFlags(input: {
  rename: boolean;
  force: boolean;
}): 'rename_force_mutually_exclusive' | undefined {
  return input.rename && input.force ? 'rename_force_mutually_exclusive' : undefined;
}

function nextAvailableId(
  requestedId: string,
  taken: ReadonlySet<string>,
  reservedIds: ReadonlySet<string>,
): string {
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const tail = `-${String(suffix)}`;
    const candidate = `${requestedId.slice(0, 64 - tail.length)}${tail}`;
    if (!taken.has(candidate) && !reservedIds.has(candidate)) return candidate;
  }
  throw new Error(`no available rename suffix for ${requestedId}`);
}

export function resolveAdoptConflict(input: {
  requestedId: string;
  sourceDigest: string;
  index: SkillIndex;
  reservedIds: Set<string>;
  policy: AdoptConflictPolicy;
}): { targetId: string; conflict: AdoptPreview['conflict'] } {
  const record = input.index.skills.find((item) => item.id === input.requestedId);
  const reserved = input.reservedIds.has(input.requestedId);
  if (record === undefined && !reserved) {
    return { targetId: input.requestedId, conflict: 'none' };
  }
  if (record?.checksum === input.sourceDigest || (reserved && input.policy === 'skip')) {
    return { targetId: input.requestedId, conflict: 'same_content' };
  }
  if (input.policy === 'rename') {
    const taken = new Set(input.index.skills.map((item) => item.id));
    return {
      targetId: nextAvailableId(input.requestedId, taken, input.reservedIds),
      conflict: 'different_content',
    };
  }
  return { targetId: input.requestedId, conflict: 'different_content' };
}

function policyOf(selection: ReconcileSelection): BulkAdoptPolicy {
  return {
    enabled: selection.bulk === true,
    ...(selection.roles === undefined ? {} : { roles: selection.roles }),
    ...(selection.limit === undefined ? {} : { limit: selection.limit }),
    conflict: selection.conflict ?? 'skip',
    dry_run: !selection.apply,
  };
}

function markerOf(item: ReconcilePlanItem): string {
  return join(item.target_path, item.visibility === 'disabled' ? DISABLED_MARKER : SKILL_MARKER);
}

function previewMetadata(item: ReconcilePlanItem):
  | {
      requestedId: string;
      description: string;
      version: string | null;
    }
  | undefined {
  const front = readSkillFrontmatter(markerOf(item));
  if (front.raw === null) return undefined;
  const normalized = normalizeAdoptFrontmatter(front.raw, markerOf(item));
  if (normalized.skillId === undefined) return undefined;
  return {
    requestedId: normalized.skillId,
    description: normalized.description ?? '',
    version: normalized.version ?? null,
  };
}

function targetIdOf(index: SkillIndex, selection: ReconcileSelection): string {
  return selection.target ?? (index.config.default_target || 'claude');
}

function targetPathOf(input: {
  snapshot: InventorySnapshot;
  selection: ReconcileSelection;
  skillId: string;
  enabled: boolean;
}): string {
  return resolveTargetById(
    input.snapshot.layout.root,
    targetIdOf(input.snapshot.workspace.index as SkillIndex, input.selection),
    input.skillId,
    'global',
    input.enabled,
  ).absolutePath;
}

function occupiedByOther(path: string, skillId: string): boolean {
  if (!existsSync(path)) return false;
  const visible = join(path, SKILL_MARKER);
  const disabled = join(path, DISABLED_MARKER);
  const front = readSkillFrontmatter(existsSync(visible) ? visible : disabled);
  return front.raw?.['name'] !== skillId;
}

function nextAvailablePlanId(input: {
  snapshot: InventorySnapshot;
  selection: ReconcileSelection;
  requestedId: string;
  index: SkillIndex;
  reservedIds: Set<string>;
  enabled: boolean;
}): string {
  const taken = new Set(input.index.skills.map((item) => item.id));
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const tail = `-${String(suffix)}`;
    const candidate = `${input.requestedId.slice(0, 64 - tail.length)}${tail}`;
    if (taken.has(candidate) || input.reservedIds.has(candidate)) continue;
    const targetPath = targetPathOf({
      snapshot: input.snapshot,
      selection: input.selection,
      skillId: candidate,
      enabled: input.enabled,
    });
    if (!occupiedByOther(targetPath, candidate)) return candidate;
  }
  throw new Error(`no available rename suffix for ${input.requestedId}`);
}

type ConflictInput = {
  snapshot: InventorySnapshot;
  selection: ReconcileSelection;
  item: ReconcilePlanItem;
  metadata: NonNullable<ReturnType<typeof previewMetadata>>;
  policy: BulkAdoptPolicy;
  index: SkillIndex;
  reserved: ReadonlyMap<string, string>;
};

interface PlannedConflict {
  targetId: string;
  conflict: AdoptPreview['conflict'];
  reason?: string;
}

function renamedConflict(input: ConflictInput): {
  targetId: string;
  conflict: AdoptPreview['conflict'];
} {
  return {
    targetId: nextAvailablePlanId({
      snapshot: input.snapshot,
      selection: input.selection,
      requestedId: input.metadata.requestedId,
      index: input.index,
      reservedIds: new Set(input.reserved.keys()),
      enabled: input.item.visibility !== 'disabled',
    }),
    conflict: 'different_content',
  };
}

function reservedConflict(input: ConflictInput, digest: string): PlannedConflict | undefined {
  const priorDigest = input.reserved.get(input.metadata.requestedId);
  if (priorDigest === undefined) return undefined;
  if (priorDigest === digest) {
    return {
      targetId: input.metadata.requestedId,
      conflict: 'same_content',
      reason: 'duplicate_skill_id',
    };
  }
  if (input.policy.conflict === 'skip') {
    return {
      targetId: input.metadata.requestedId,
      conflict: 'different_content',
      reason: 'duplicate_skill_id',
    };
  }
  if (input.policy.conflict === 'force') {
    return { targetId: input.metadata.requestedId, conflict: 'different_content' };
  }
  return renamedConflict(input);
}

function conflictOf(input: {
  snapshot: InventorySnapshot;
  selection: ReconcileSelection;
  item: ReconcilePlanItem;
  metadata: NonNullable<ReturnType<typeof previewMetadata>>;
  policy: BulkAdoptPolicy;
  index: SkillIndex;
  reserved: ReadonlyMap<string, string>;
}): PlannedConflict {
  const digest = computeLandingChecksum({ targetPath: input.item.target_path, format: 'skill' });
  const reserved = reservedConflict(input, digest);
  if (reserved !== undefined) return reserved;
  const resolved = resolveAdoptConflict({
    requestedId: input.metadata.requestedId,
    sourceDigest: digest,
    index: input.index,
    reservedIds: new Set(input.reserved.keys()),
    policy: input.policy.conflict,
  });
  if (resolved.conflict === 'same_content') {
    return { ...resolved, reason: 'same_content_existing_skill' };
  }
  if (resolved.conflict === 'different_content' && input.policy.conflict === 'skip') {
    return { ...resolved, reason: 'different_content_existing_skill' };
  }
  if (resolved.conflict === 'different_content' && input.policy.conflict === 'rename') {
    return renamedConflict(input);
  }
  return resolved;
}

function rewriteAdoptWrites(
  snapshot: InventorySnapshot,
  item: ReconcilePlanItem,
  requestedId: string,
  targetId: string,
): ReconcilePlanItem['writes'] {
  if (requestedId === targetId) return item.writes;
  const oldRoot = join(snapshot.layout.skillsDir, requestedId);
  const newRoot = join(snapshot.layout.skillsDir, targetId);
  return item.writes.map((write) =>
    isPhysicallyWithin(oldRoot, write.path)
      ? { ...write, path: write.path.replace(oldRoot, newRoot) }
      : write,
  );
}

function previewOf(input: {
  item: ReconcilePlanItem;
  metadata: NonNullable<ReturnType<typeof previewMetadata>>;
  targetId: string;
  conflict: AdoptPreview['conflict'];
  policy: AdoptConflictPolicy;
}): AdoptPreview {
  return {
    source_path: input.item.target_path,
    requested_skill_id: input.metadata.requestedId,
    target_skill_id: input.targetId,
    description: input.metadata.description,
    version: input.metadata.version,
    conflict: input.conflict,
    conflict_policy: input.policy,
  };
}

function applyOne(input: {
  snapshot: InventorySnapshot;
  selection: ReconcileSelection;
  item: ReconcilePlanItem;
  index: SkillIndex;
  policy: BulkAdoptPolicy;
  reserved: Map<string, string>;
}): ReconcilePlanItem {
  if (input.item.status !== 'planned') return input.item;
  const metadata = previewMetadata(input.item);
  if (metadata === undefined) return input.item;
  const conflict = conflictOf({
    snapshot: input.snapshot,
    selection: input.selection,
    item: input.item,
    metadata,
    policy: input.policy,
    index: input.index,
    reserved: input.reserved,
  });
  const targetPath = targetPathOf({
    snapshot: input.snapshot,
    selection: input.selection,
    skillId: conflict.targetId,
    enabled: input.item.visibility !== 'disabled',
  });
  const occupied = occupiedByOther(targetPath, conflict.targetId);
  const preview = previewOf({
    item: input.item,
    metadata,
    targetId: conflict.targetId,
    conflict: occupied ? 'target_occupied' : conflict.conflict,
    policy: input.policy.conflict,
  });
  if (conflict.reason !== undefined) {
    return {
      ...input.item,
      status: 'skipped',
      reason: conflict.reason,
      writes: [],
      ledger_changes: [],
      adopt_preview: preview,
    };
  }
  input.reserved.set(
    conflict.targetId,
    computeLandingChecksum({
      targetPath: input.item.target_path,
      format: 'skill',
    }),
  );
  return {
    ...input.item,
    writes: rewriteAdoptWrites(input.snapshot, input.item, metadata.requestedId, conflict.targetId),
    adopt_preview: preview,
    warnings: occupied
      ? [...new Set([...input.item.warnings, 'target_occupied_other_skill'])]
      : input.item.warnings,
  };
}

export function applyAdoptPlanning(
  snapshot: InventorySnapshot,
  selection: ReconcileSelection,
  items: ReconcilePlanItem[],
): { items: ReconcilePlanItem[]; summary?: BulkAdoptSummary } {
  const index = snapshot.workspace.index;
  if (selection.action !== 'adopt' || index === null) return { items };
  const policy = policyOf(selection);
  const reserved = new Map<string, string>();
  const plannedItems = items.map((item) =>
    applyOne({ snapshot, selection, item, index, policy, reserved }),
  );
  if (!selection.bulk) return { items: plannedItems };
  const selected = plannedItems.filter((item) => item.adopt_preview !== undefined);
  return {
    items: plannedItems,
    summary: {
      candidates: selected.length,
      limited: selected.length,
      conflict_skipped: plannedItems.filter(
        (item) =>
          item.status === 'skipped' &&
          [
            'duplicate_skill_id',
            'same_content_existing_skill',
            'different_content_existing_skill',
          ].includes(item.reason ?? ''),
      ).length,
      renamed: selected.filter(
        (item) => item.adopt_preview?.requested_skill_id !== item.adopt_preview?.target_skill_id,
      ).length,
      forced: selected.filter(
        (item) =>
          item.status === 'planned' &&
          item.adopt_preview?.conflict_policy === 'force' &&
          item.adopt_preview.conflict === 'different_content',
      ).length,
    },
  };
}
