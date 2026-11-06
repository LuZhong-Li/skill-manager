/** 把审计 source 纯投影为 skill × target × scope 的行与汇总。 */
import { resolve } from 'node:path';
import type {
  HostRootRole,
  InventoryAuditData,
  InventoryAuditLedgerState,
  InventoryAuditRow,
  InventoryAuditStatus,
  ReconciliationEvidence,
  ReconciliationVisibility,
} from '@skill-manager/contract';
import { inventoryPhysicalKey } from '../../core/inventory/discover.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import type { SkillTarget } from '../../core/metadata/types.ts';
import type {
  AuditCopy,
  AuditLedgerRecord,
  AuditSkill,
  InventoryAuditSource,
} from './audit-types.ts';
import { summaryOf, withGroupComparisons } from './audit-comparison.ts';

type Scope = 'global' | 'project';
type ObservedScope = Scope | 'ambiguous';

const INSUFFICIENT_EVIDENCE: ReconciliationEvidence = {
  managed: 'insufficient',
  content: 'insufficient',
  source: 'insufficient',
};

function scopeOfRoles(roles: readonly HostRootRole[]): ObservedScope {
  if (roles.length === 0) return 'global';
  if (roles.every((role) => role === 'project')) return 'project';
  if (roles.includes('project')) return 'ambiguous';
  return 'global';
}

function copyScope(copy: AuditCopy | InventoryAuditSource['missing'][number]): ObservedScope {
  if (!('sources' in copy)) return copy.root_role === 'project' ? 'project' : 'global';
  return scopeOfRoles([copy.root_role, ...copy.sources.map((source) => source.root_role)]);
}

function pathMatches(targetPath: string, rootPath: string): boolean {
  return isPhysicallyWithin(rootPath, targetPath);
}

function ledgerScope(
  record: AuditLedgerRecord,
  roots: InventoryAuditSource['roots'],
): ObservedScope {
  const roles = roots
    .filter((root) => root.host_id === record.host_id && pathMatches(record.target_path, root.path))
    .map((root) => root.role);
  return scopeOfRoles(roles);
}

function scopeMatches(scope: Scope, observed: ObservedScope): boolean {
  return observed === 'ambiguous' || scope === observed;
}

function hostOfCopy(copy: AuditCopy | InventoryAuditSource['missing'][number], hostId: string) {
  return copy.host_id === hostId || copy.consumed_by.includes(hostId);
}

function ledgerGroup(hostId: string): 'host_landings' | 'plugin_landings' {
  return hostId.startsWith('x-') ? 'plugin_landings' : 'host_landings';
}

function ledgerStateFor(
  hostId: string,
  records: readonly AuditLedgerRecord[],
  states: InventoryAuditSource['ledger_states'],
): InventoryAuditLedgerState {
  if (states[ledgerGroup(hostId)] === 'unreadable') return 'unreadable';
  if (records.some((record) => record.state === 'active')) return 'active';
  if (records.some((record) => record.state === 'orphaned')) return 'orphaned';
  return 'none';
}

function baseRow(input: {
  source: InventoryAuditSource;
  skill: AuditSkill;
  target: string;
  scope: Scope;
  expectedEnabled: boolean;
  hostId?: string;
}): InventoryAuditRow {
  return {
    skill_id: input.skill.skill_id,
    target: input.target,
    scope: input.scope,
    ...(input.hostId === undefined ? {} : { host_id: input.hostId }),
    expected_enabled: input.expectedEnabled,
    ledger_state: 'none',
    status: 'insufficient',
    evidence: INSUFFICIENT_EVIDENCE,
    reasons: [],
    observed_at: input.source.observed_at,
  };
}

function insufficientRow(
  row: InventoryAuditRow,
  reason: string,
  ledgerState: InventoryAuditLedgerState = row.ledger_state,
): InventoryAuditRow {
  return { ...row, ledger_state: ledgerState, status: 'insufficient', reasons: [reason] };
}

function workspaceOnlyRow(
  source: InventoryAuditSource,
  skill: AuditSkill,
  target: SkillTarget,
): InventoryAuditRow {
  return {
    ...baseRow({
      source,
      skill,
      target: target.target,
      scope: target.scope,
      expectedEnabled: target.enabled,
    }),
    target_path: target.path,
    status: 'workspace_only',
    reasons: ['workspace_target_not_host'],
  };
}

function recordsOf(input: {
  source: InventoryAuditSource;
  skillId: string;
  hostId: string;
  scope: Scope;
}): AuditLedgerRecord[] {
  return input.source.ledger_records.filter(
    (record) =>
      record.skill_id === input.skillId &&
      record.host_id === input.hostId &&
      scopeMatches(input.scope, ledgerScope(record, input.source.roots)),
  );
}

function copiesOf(input: {
  source: InventoryAuditSource;
  skillId: string;
  hostId: string;
  scope: Scope;
}): AuditCopy[] {
  return input.source.copies.filter(
    (copy) =>
      copy.audit_skill_id === input.skillId &&
      hostOfCopy(copy, input.hostId) &&
      scopeMatches(input.scope, copyScope(copy)),
  );
}

function missingCopyOf(input: {
  source: InventoryAuditSource;
  skillId: string;
  hostId: string;
  scope: Scope;
}): InventoryAuditSource['missing'][number] | undefined {
  return input.source.missing.find(
    (copy) =>
      copy.skill_id === input.skillId &&
      hostOfCopy(copy, input.hostId) &&
      scopeMatches(input.scope, copyScope(copy)),
  );
}

function expectedVisible(target: SkillTarget): ReconciliationVisibility {
  return target.enabled ? 'visible' : 'disabled';
}

function visibilityMatches(copy: AuditCopy, ledger: AuditLedgerRecord, target: SkillTarget) {
  const expected = expectedVisible(target);
  return (
    copy.visibility === expected &&
    (ledger.visibility === undefined || ledger.visibility === expected)
  );
}

function copyStatus(copy: AuditCopy, ledger: AuditLedgerRecord, target: SkillTarget) {
  if (!visibilityMatches(copy, ledger, target)) return 'visibility_mismatch';
  if (copy.reconciliation.classification === 'drift') return 'drift';
  if (copy.reconciliation.classification === 'inferred_drift') return 'drift';
  return 'distributed';
}

function rowWithCopy(
  row: InventoryAuditRow,
  copy: AuditCopy,
  ledger: AuditLedgerRecord,
  target: SkillTarget,
): InventoryAuditRow {
  const status: InventoryAuditStatus = copyStatus(copy, ledger, target);
  return {
    ...row,
    host_id: copy.host_id,
    ledger_state: 'active',
    target_path: ledger.target_path,
    copy_path: copy.path,
    ...(copy.version === undefined ? {} : { copy_version: copy.version }),
    ...(ledger.source_checksum === undefined ? {} : { source_checksum: ledger.source_checksum }),
    ...(ledger.source_version === undefined ? {} : { source_version: ledger.source_version }),
    ...(copy.content_digest === undefined ? {} : { content_digest: copy.content_digest }),
    status,
    classification: copy.reconciliation.classification,
    evidence: copy.reconciliation.evidence,
    reasons: [
      ...(status === 'visibility_mismatch' ? ['visibility_mismatch'] : []),
      ...(status === 'drift' ? copy.reconciliation.drift_reasons : []),
    ],
  };
}

function missingLedgerRow(
  row: InventoryAuditRow,
  ledgerState: InventoryAuditLedgerState,
  targetPath: string,
): InventoryAuditRow {
  return {
    ...row,
    ...(targetPath === '' ? {} : { target_path: targetPath }),
    status: 'missing',
    ledger_state: ledgerState,
    reasons: ['ledger_missing'],
  };
}

function missingCopyRow(input: {
  row: InventoryAuditRow;
  source: InventoryAuditSource;
  skill: AuditSkill;
  target: SkillTarget;
  ledger: AuditLedgerRecord;
}): InventoryAuditRow {
  const missing = missingCopyOf({
    source: input.source,
    skillId: input.skill.skill_id,
    hostId: input.target.target,
    scope: input.target.scope,
  });
  return {
    ...input.row,
    ledger_state: 'active',
    target_path: missing?.target_path ?? input.ledger.target_path,
    status: 'missing',
    reasons: ['copy_missing'],
  };
}

function activeRow(input: {
  source: InventoryAuditSource;
  skill: AuditSkill;
  target: SkillTarget;
  ledger: AuditLedgerRecord;
  row: InventoryAuditRow;
}): InventoryAuditRow {
  const copies = copiesOf({
    source: input.source,
    skillId: input.skill.skill_id,
    hostId: input.target.target,
    scope: input.target.scope,
  });
  if (copies.length > 1) return insufficientRow(input.row, 'ambiguous_copy', 'active');
  const copy = copies[0];
  if (copy === undefined) {
    return missingCopyRow({
      row: input.row,
      source: input.source,
      skill: input.skill,
      target: input.target,
      ledger: input.ledger,
    });
  }
  if (!copy.readable) return insufficientRow(input.row, 'copy_unreadable', 'active');
  return rowWithCopy(input.row, copy, input.ledger, input.target);
}

function declaredLedgerRow(input: {
  source: InventoryAuditSource;
  skill: AuditSkill;
  target: SkillTarget;
  row: InventoryAuditRow;
  records: AuditLedgerRecord[];
  ledgerState: InventoryAuditLedgerState;
}): InventoryAuditRow {
  const active = input.records.filter((record) => record.state === 'active');
  if (active.length > 1) {
    return insufficientRow(input.row, 'ambiguous_ledger', input.ledgerState);
  }
  const ledger = active[0];
  if (ledger === undefined) {
    return missingLedgerRow(input.row, input.ledgerState, input.target.path);
  }
  return activeRow({
    source: input.source,
    skill: input.skill,
    target: input.target,
    ledger,
    row: { ...input.row, ledger_state: 'active' },
  });
}

function declaredRow(
  source: InventoryAuditSource,
  skill: AuditSkill,
  target: SkillTarget,
): InventoryAuditRow {
  const row = baseRow({
    source,
    skill,
    target: target.target,
    scope: target.scope,
    expectedEnabled: target.enabled,
    hostId: target.target,
  });
  if (!source.known_hosts.includes(target.target)) {
    return workspaceOnlyRow(source, skill, target);
  }
  const records = recordsOf({
    source,
    skillId: skill.skill_id,
    hostId: target.target,
    scope: target.scope,
  });
  const ledgerState = ledgerStateFor(target.target, records, source.ledger_states);
  if (ledgerState === 'unreadable') return insufficientRow(row, 'ledger_unreadable', ledgerState);
  return declaredLedgerRow({ source, skill, target, row, records, ledgerState });
}

function declaredRowsOf(source: InventoryAuditSource): InventoryAuditRow[] {
  return source.skills.flatMap((skill) =>
    skill.targets.map((target) => declaredRow(source, skill, target)),
  );
}

function declarationMatches(input: {
  source: InventoryAuditSource;
  skill: AuditSkill;
  hostId: string;
  scope: Scope;
  copyPath?: string;
}): boolean {
  return input.skill.targets.some((target) => {
    if (target.target !== input.hostId) return false;
    if (target.scope === input.scope) return true;
    if (input.copyPath === undefined) return false;
    return (
      inventoryPhysicalKey(resolve(input.source.workspace_root, target.path)) ===
      inventoryPhysicalKey(input.copyPath)
    );
  });
}

function undeclaredRow(input: {
  source: InventoryAuditSource;
  skill: AuditSkill;
  hostId: string;
  scope: Scope;
  copy?: AuditCopy;
  ledger?: AuditLedgerRecord;
}): InventoryAuditRow {
  const row = baseRow({
    source: input.source,
    skill: input.skill,
    target: input.hostId,
    scope: input.scope,
    expectedEnabled: false,
    hostId: input.hostId,
  });
  const records = input.ledger === undefined ? [] : [input.ledger];
  return {
    ...row,
    ledger_state: ledgerStateFor(input.hostId, records, input.source.ledger_states),
    ...(input.copy === undefined ? {} : { copy_path: input.copy.path }),
    ...(input.ledger === undefined ? {} : { target_path: input.ledger.target_path }),
    ...(input.copy?.content_digest === undefined
      ? {}
      : { content_digest: input.copy.content_digest }),
    status: 'undeclared',
    ...(input.copy === undefined
      ? {}
      : {
          classification: input.copy.reconciliation.classification,
          evidence: input.copy.reconciliation.evidence,
        }),
    reasons: ['target_undeclared'],
  };
}

function declaredPathsOf(rows: readonly InventoryAuditRow[]): Set<string> {
  return new Set(
    rows.flatMap((row) =>
      [row.copy_path, row.target_path]
        .filter((path): path is string => path !== undefined)
        .map(inventoryPhysicalKey),
    ),
  );
}

function addCopyUndeclared(input: {
  source: InventoryAuditSource;
  rows: Map<string, InventoryAuditRow>;
  declaredPaths: ReadonlySet<string>;
  bySkill: ReadonlyMap<string, AuditSkill>;
}): void {
  for (const copy of input.source.copies) {
    if (input.declaredPaths.has(inventoryPhysicalKey(copy.path))) continue;
    const skill = input.bySkill.get(copy.audit_skill_id);
    if (skill === undefined) continue;
    const scope = copyScope(copy);
    if (scope === 'ambiguous') continue;
    for (const hostId of [copy.host_id, ...copy.consumed_by]) {
      const declared = declarationMatches({
        source: input.source,
        skill,
        hostId,
        scope,
        copyPath: copy.path,
      });
      if (declared) continue;
      input.rows.set(
        `${skill.skill_id}\0${hostId}\0${scope}`,
        undeclaredRow({ source: input.source, skill, hostId, scope, copy }),
      );
    }
  }
}

function addLedgerUndeclared(input: {
  source: InventoryAuditSource;
  rows: Map<string, InventoryAuditRow>;
  declaredPaths: ReadonlySet<string>;
  bySkill: ReadonlyMap<string, AuditSkill>;
}): void {
  for (const ledger of input.source.ledger_records) {
    if (input.declaredPaths.has(inventoryPhysicalKey(ledger.target_path))) continue;
    const skill = input.bySkill.get(ledger.skill_id);
    if (skill === undefined) continue;
    const scope = ledgerScope(ledger, input.source.roots);
    if (scope === 'ambiguous') continue;
    const declared = declarationMatches({
      source: input.source,
      skill,
      hostId: ledger.host_id,
      scope,
    });
    if (declared) continue;
    const key = `${skill.skill_id}\0${ledger.host_id}\0${scope}`;
    if (!input.rows.has(key)) {
      input.rows.set(
        key,
        undeclaredRow({ source: input.source, skill, hostId: ledger.host_id, scope, ledger }),
      );
    }
  }
}

function undeclaredRowsOf(
  source: InventoryAuditSource,
  declared: readonly InventoryAuditRow[],
): InventoryAuditRow[] {
  const rows = new Map<string, InventoryAuditRow>();
  const input = {
    source,
    rows,
    declaredPaths: declaredPathsOf(declared),
    bySkill: new Map(source.skills.map((skill) => [skill.skill_id, skill])),
  };
  addCopyUndeclared(input);
  addLedgerUndeclared(input);
  return [...rows.values()];
}

export function buildInventoryAudit(source: InventoryAuditSource): InventoryAuditData {
  const declared = declaredRowsOf(source);
  const rows = withGroupComparisons(source, [...declared, ...undeclaredRowsOf(source, declared)]);
  return {
    observed_at: source.observed_at,
    summary: summaryOf(source, rows),
    rows,
  };
}
