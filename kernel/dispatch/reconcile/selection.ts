/** reconcile batch 选择器的纯展开与分布统计；不读盘、不写盘。 */
import type {
  InventoryClassificationKey,
  InventoryRootView,
  ReconcileSelection,
  ReconcileSelectionSummary,
} from '@skill-manager/contract';
import { inventoryPhysicalKey } from '../../core/inventory/discover.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import type { Candidate } from './candidates.ts';

type ClassificationOf = (candidate: Candidate) => InventoryClassificationKey;

function hostMatches(candidate: Candidate, host: string | undefined): boolean {
  return host === undefined || host === 'all' || candidate.host_ids.includes(host);
}

function rootPathMatches(targetPath: string, root: Pick<InventoryRootView, 'path'>): boolean {
  return isPhysicallyWithin(root.path, targetPath);
}

export function rootMatches(
  candidate: Candidate,
  selectedRoots: readonly string[],
  roots: readonly InventoryRootView[],
): boolean {
  if (selectedRoots.length === 0) return true;
  return (
    roots.some(
      (root) =>
        (selectedRoots.includes(root.root_id) ||
          selectedRoots.some(
            (value) => inventoryPhysicalKey(value) === inventoryPhysicalKey(root.path),
          )) &&
        (candidate.root_ids.includes(root.root_id) || rootPathMatches(candidate.target_path, root)),
    ) ||
    selectedRoots.some(
      (value) =>
        candidate.root_ids.includes(value) ||
        rootPathMatches(candidate.target_path, { path: value }),
    )
  );
}

function selectedIds(selection: ReconcileSelection): string[] {
  return [
    ...new Set([...(selection.ids ?? []), selection.id].filter((id): id is string => Boolean(id))),
  ];
}

function matchesId(candidate: Candidate, selection: ReconcileSelection): boolean {
  const ids = selectedIds(selection);
  return (
    ids.length > 0 &&
    candidate.skill_id !== undefined &&
    ids.includes(candidate.skill_id) &&
    hostMatches(candidate, selection.host)
  );
}

function matchesRoot(
  candidate: Candidate,
  roots: readonly InventoryRootView[],
  selection: ReconcileSelection,
): boolean {
  return (
    selection.roots.length > 0 &&
    rootMatches(candidate, selection.roots, roots) &&
    hostMatches(candidate, selection.host)
  );
}

function matchesRole(
  candidate: Candidate,
  roots: readonly InventoryRootView[],
  selection: ReconcileSelection,
): boolean {
  const roles = selection.roles ?? [];
  return (
    roles.length > 0 &&
    candidate.root_roles.some((role) => roles.includes(role)) &&
    hostMatches(candidate, selection.host)
  );
}

function matchesClassification(
  candidate: Candidate,
  roots: readonly InventoryRootView[],
  selection: ReconcileSelection,
  classificationOf: ClassificationOf,
): boolean {
  return (
    selection.classification !== undefined &&
    classificationOf(candidate) === selection.classification &&
    rootMatches(candidate, selection.roots, roots) &&
    hostMatches(candidate, selection.host)
  );
}

function matchesBatch(
  candidate: Candidate,
  roots: readonly InventoryRootView[],
  selection: ReconcileSelection,
  classificationOf: ClassificationOf,
): boolean {
  return (
    matchesId(candidate, selection) ||
    matchesRoot(candidate, roots, selection) ||
    matchesRole(candidate, roots, selection) ||
    matchesClassification(candidate, roots, selection, classificationOf)
  );
}

export function selectBatchCandidates(
  candidates: readonly Candidate[],
  roots: readonly InventoryRootView[],
  selection: ReconcileSelection,
  classificationOf: ClassificationOf,
): Candidate[] {
  return candidates.filter((candidate) =>
    matchesBatch(candidate, roots, selection, classificationOf),
  );
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function selectionSummaryOf(
  candidates: readonly Candidate[],
  classificationOf: ClassificationOf,
): ReconcileSelectionSummary {
  const summary: ReconcileSelectionSummary = {
    total: candidates.length,
    by_skill: {},
    by_root: {},
    by_role: {},
    by_host: {},
    by_classification: {},
  };
  for (const candidate of candidates) {
    increment(summary.by_skill, candidate.skill_id ?? 'unknown');
    for (const rootId of candidate.root_ids.length > 0 ? candidate.root_ids : ['unknown']) {
      increment(summary.by_root, rootId);
    }
    for (const role of candidate.root_roles) {
      summary.by_role[role] = (summary.by_role[role] ?? 0) + 1;
    }
    for (const hostId of candidate.host_ids) increment(summary.by_host, hostId);
    const key = classificationOf(candidate);
    summary.by_classification[key] = (summary.by_classification[key] ?? 0) + 1;
  }
  return summary;
}
