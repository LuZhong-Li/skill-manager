/** 插件账本反查出的 orphaned 候选；与普通盘点候选分开以控制文件规模。 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HostRootRole, PluginLanding } from '@skill-manager/contract';
import { inventoryPhysicalKey } from '../../core/inventory/discover.ts';
import { computeLandingChecksum } from '../../core/integrity/index.ts';
import { collectUnifiedLandings } from '../../core/host-landings/uninstall.ts';
import { loadPluginIndex } from '../../store/plugin-registry/index.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import type { InventorySnapshot } from '../scan/inventory.ts';
import type { Candidate } from './candidate-model.ts';

export function pluginOrphanCandidates(snapshot: InventorySnapshot): Candidate[] {
  const loaded = loadPluginIndex(snapshot.layout.pluginIndexFile);
  if (loaded.index === null) return [];
  return loaded.index.landings.flatMap((record): Candidate[] => {
    if (record.state !== 'orphaned') return [];
    const unified = collectUnifiedLandings(null, loaded.index, record.skill_id).find(
      (item) => item.record === record,
    );
    if (unified === undefined) return [];
    const candidate = pluginOrphanCandidate(snapshot, record, unified);
    return candidate === undefined ? [] : [candidate];
  });
}

function pluginOrphanCandidate(
  snapshot: InventorySnapshot,
  record: PluginLanding,
  unified: ReturnType<typeof collectUnifiedLandings>[number],
): Candidate | undefined {
  if (!existsSync(unified.physical_path)) return undefined;
  const format = unified.format;
  const workspaceRecord = snapshot.workspace.index?.skills.find(
    (item) => item.id === record.skill_id,
  );
  const digest =
    format === 'skill' || format === 'rules'
      ? computeLandingChecksum({ targetPath: unified.physical_path, format })
      : undefined;
  return {
    physical_key: inventoryPhysicalKey(unified.physical_path),
    target_path: unified.physical_path,
    host_ids: [record.host_id],
    consumed_by: [record.host_id],
    format,
    ...(format === 'skill'
      ? {
          visibility: existsSync(join(unified.physical_path, 'SKILL.md.disabled'))
            ? ('disabled' as const)
            : ('visible' as const),
        }
      : {}),
    skill_id: record.skill_id,
    ...(digest === undefined ? {} : { content_digest: digest }),
    exists: true,
    root_ids: [],
    root_roles: [pluginRootRole(snapshot, record.host_id, unified.physical_path)],
    reconciliation: {
      classification: 'orphaned',
      ledger_source: 'plugin_landings',
      authority: 'authoritative',
      evidence: {
        managed: 'authoritative',
        content: 'insufficient',
        source: 'insufficient',
      },
      reasons: ['orphaned_plugin_ledger'],
      drift_reasons: [],
      untracked_candidate: false,
      orphaned: {
        copy_present: true,
        workspace_record_present: workspaceRecord !== undefined,
      },
    },
    is_plugin: true,
    format_conflict: false,
    ledger_conflict: false,
  };
}

function pluginRootRole(
  snapshot: InventorySnapshot,
  hostId: string,
  targetPath: string,
): HostRootRole {
  const root = snapshot.roots
    .filter((item) => item.host_id === hostId && isPhysicallyWithin(item.path, targetPath))
    .sort((left, right) => right.path.length - left.path.length)[0];
  return root?.role ?? 'user';
}
