/** K-04 刷新命令。 */
import { join } from 'node:path';
import { META_FILE_NAME } from '../metadata/constants.ts';
import type { SkillIndex, SkillMeta } from '../metadata/types.ts';
import { validateMetaRecord, type MetaContext } from '../metadata/validate.ts';
import { readMetaFile } from '../metadata/read.ts';
import { computeChecksum } from '../integrity/index.ts';
import { createBackup } from '../../store/backup-fs/index.ts';
import { libraryPathOf, resolveTargets, type ResolvedTarget } from '../targets/resolver/index.ts';
import {
  deliverFiles,
  isDirectory,
  isCopyDisabled,
  pathExists,
  replaceTree,
  setCopyVisibility,
} from '../../store/library-fs/index.ts';
import {
  acquireSource,
  looksRemote,
  readDeclaredSource,
  releaseSource,
  type AcquiredSource,
} from './source.ts';
import { CODES, type Change, type Finding } from '@skill-manager/contract';
import { finding } from '../../store/findings.ts';
import { toKernelError } from '../../store/errors.ts';
import type { LifecycleOutcome, UpdateInput } from './types.ts';
import {
  notRegistered,
  persistDeclaredRef,
  planOf,
  projectRecord,
  safeDigests,
  toFinding,
  uniqueCodes,
} from './shared.ts';
export async function updateSkill(input: UpdateInput): Promise<LifecycleOutcome> {
  const libraryDir = libraryPathOf(input.layout.root, input.id);
  const declared = readDeclaredSource(join(libraryDir, META_FILE_NAME));
  if (input.ref !== undefined) {
    if (
      declared === null ||
      declared.type !== 'git' ||
      declared.location === undefined ||
      !looksRemote(declared.location)
    ) {
      return {
        index: input.index,
        findings: [
          finding(CODES.INPUT_INVALID_ARG, {
            source: 'input',
            target: '--ref',
            message: '--ref 只适用于远端 git 来源',
            remedy: '本地来源请省略 --ref；如需查看本地漂移，请使用 update --check',
          }),
        ],
        changes: [],
        data: { rejected: 'ref_requires_remote_git' },
      };
    }
  }
  const refetchable =
    declared !== null &&
    (declared.type === 'git' || declared.type === 'archive') &&
    (declared.location ?? '') !== '';
  if (!refetchable) {
    return updateFromSource(input, null);
  }

  let acquired: AcquiredSource;
  try {
    acquired = await acquireSource({
      type: declared.type,
      location: declared.location as string,
      ref: input.ref ?? declared.ref,
    });
  } catch (error) {
    return {
      index: input.index,
      findings: [toFinding(toKernelError(error, CODES.SRC_UNRESOLVED))],
      changes: [],
      data: { rejected: 'source_unavailable' },
    };
  }
  try {
    return updateFromSource(input, acquired.dir);
  } finally {
    releaseSource(acquired);
  }
}

function updateFromSource(input: UpdateInput, fetchedDir: string | null): LifecycleOutcome {
  const { layout, index, id, now, check, target } = input;
  const record = index.skills.find((item) => item.id === id);
  if (record === undefined) return notRegistered(id, index);

  let backupData: Record<string, unknown> = {};

  // 一、按声明重新获取内容时，先备份并替换中心库原件；此时尚未改动索引，失败不会刷新记录
  if (fetchedDir !== null) {
    const libraryDir = libraryPathOf(layout.root, id);
    if (!check) {
      if (isDirectory(libraryDir)) {
        try {
          const backup = createBackup({
            workspaceRoot: layout.root,
            backupsDir: layout.backupsDir,
            id,
            sourceDir: libraryDir,
            now,
            checksum: record.checksum,
          });
          backupData = {
            backup_path: backup.portableDir,
            backup_timestamp: backup.timestamp,
            backup_file_count: backup.fileCount,
            backup_digest: backup.digest,
          };
        } catch (error) {
          return {
            index,
            findings: [toFinding(toKernelError(error, CODES.BACKUP_FAILED))],
            changes: [],
            data: { rejected: 'backup_failed' },
          };
        }
      } else {
        backupData = { backup_reason: '中心库原件不存在，没有可备份的内容' };
      }
      try {
        replaceTree(fetchedDir, libraryDir);
        if (input.ref !== undefined) persistDeclaredRef(libraryDir, input.ref);
      } catch (error) {
        const kernelError = toKernelError(error, CODES.IO_FAILED);
        return {
          index,
          findings: [toFinding(kernelError)],
          changes: [],
          data: { rejected: 'library_refresh_failed' },
        };
      }
    }
  }

  const libraryDir = libraryPathOf(layout.root, id);
  const readDir = check && fetchedDir !== null ? fetchedDir : libraryDir;
  const read = readMetaFile(readDir, id);
  if (read.raw === null) {
    return {
      index,
      findings: read.findings,
      changes: [],
      data: { rejected: 'meta_unreadable' },
    };
  }
  const context: MetaContext = { dirName: id, dirPath: libraryDir };
  const metaFindings = validateMetaRecord(read.raw, context);
  if (metaFindings.some((item) => item.severity === 'error')) {
    return {
      index,
      findings: metaFindings,
      changes: [],
      data: { rejected: 'invalid_metadata', problem_codes: uniqueCodes(metaFindings) },
    };
  }

  const checksum = computeChecksum(readDir);
  const raw = read.raw;
  const meta = raw as unknown as SkillMeta;
  const findings: Finding[] = [
    ...metaFindings,
    ...checkDriftOf({ record, checksum, check, fetchedDir, id }),
  ];

  let targets: ResolvedTarget[];
  try {
    targets = resolveTargets(layout.root, meta);
  } catch (error) {
    const kernelError = toKernelError(error, CODES.PATH_INVALID);
    return { index, findings: [toFinding(kernelError)], changes: [], data: {} };
  }

  const versionBefore = record.version ?? null;
  const versionAfter = meta.version ?? null;
  const summary = {
    id,
    version_before: versionBefore,
    version_after: versionAfter,
    version_changed: versionBefore !== versionAfter,
    checksum_before: record.checksum,
    checksum_after: checksum,
    updated_at: now,
    created_at: record.created_at,
    targets: targets.map((item) => ({
      target: item.target,
      scope: item.scope,
      path: item.declaredPath,
    })),
    backup: backupData,
    notes: ['刷新会按落位计划把副本内容一并更新；任一处落位失败则整体不生效'],
  };

  if (check === true) {
    const previewChanges: Change[] =
      fetchedDir === null
        ? []
        : [
            { action: 'modify', kind: 'library', path: record.path },
            ...targets
              .filter(
                (item) =>
                  (target === undefined || item.target === target) && pathExists(item.absolutePath),
              )
              .map((item): Change => ({
                action: 'modify',
                kind: 'target_copy',
                path: item.declaredPath,
              })),
          ];
    return {
      index,
      findings,
      changes: previewChanges,
      preview: true,
      data: { ...summary, checked: true },
    };
  }

  // 先重分发副本，再写索引：顺序反过来会留下「记录已刷新、副本仍是旧内容」的中间态。
  // 只刷新已存在的副本，不新建副本——分发是安装与启用的职责。
  const copied: Array<Record<string, unknown>> = [];
  const refreshable = targets.filter(
    (item) => (target === undefined || item.target === target) && pathExists(item.absolutePath),
  );
  for (const item of refreshable) {
    const wasEnabled = !isCopyDisabled(item.absolutePath);
    try {
      const files = deliverFiles(libraryDir, item.absolutePath, planOf(item.fileMap));
      // 落位会带回技能元数据文件，按该副本原有可见性恢复状态，避免刷新把禁用态改成启用态
      setCopyVisibility(item.absolutePath, wasEnabled);
      copied.push({
        target: item.target,
        scope: item.scope,
        path: item.declaredPath,
        file_count: files.length,
        files: files.map((rel) => `${item.declaredPath}/${rel}`),
      });
    } catch (error) {
      const kernelError = toKernelError(error, CODES.IO_FAILED);
      return {
        index,
        findings: [
          ...findings,
          toFinding(kernelError),
          // 失败后索引基线仍是刷新前的旧状态：说明真实差异在哪，避免用户以为「已更新」
          finding(CODES.DRIFT, {
            source: 'meta',
            target: id,
            message:
              `刷新未生效：副本重分发失败，索引基线仍为 ${record.checksum}，` +
              `中心库磁盘内容已按来源变为 ${checksum}`,
            remedy:
              '请解除副本占用后重新执行 update；在下一次成功刷新前，该 Skill 会持续报告真实漂移',
          }),
        ],
        changes: [],
        data: { rejected: 'redistribute_failed', rolled_back: true },
      };
    }
  }

  const next: SkillIndex = {
    ...index,
    generated_at: now,
    skills: index.skills.map((item) =>
      item.id === id
        ? projectRecord(item, raw, targets, checksum, safeDigests(libraryDir), now)
        : item,
    ),
  };
  return {
    index: next,
    findings,
    changes: [
      ...copied.map((item): Change => ({
        action: 'modify',
        kind: 'target_copy',
        path: String(item['path']),
      })),
      { action: 'modify', kind: 'index_record', path: record.path },
    ],
    data: { ...summary, copies: copied },
  };
}

/**
 * `update --check` 的漂移提示。
 *
 * 触发条件固定为「当前内容基线」与磁盘实际内容不一致（`result-and-exit-codes` 规范）：
 * - 成功刷新（`fetchedDir !== null`）时索引尚未基于新内容重算，此时的旧基线差异不是用户
 *   造成的漂移，必须抑制；真实漂移由刷新后的 `validate` 按文件级摘要报告。
 * - 本地来源 `--check` 只读，报告的差异确实来自中心库磁盘内容，按真实漂移报告并给出
 *   可执行的两条出路：以磁盘现状刷新基线，或从来源重新获取覆盖本地改动。
 * - 远端来源 `--check` 不落盘、不重新获取，「远端有新提交」与「本地被改动」是两件事，
 *   不能用漂移码冒充；这里只说明预览结果的语义。
 */
function checkDriftOf(input: {
  record: SkillIndex['skills'][number];
  checksum: string;
  check: boolean | undefined;
  fetchedDir: string | null;
  id: string;
}): Finding[] {
  // 非预览模式没有只读语义，这里的差异留给后续摘要与 validate 报告
  if (input.check !== true) return [];
  // 成功刷新后索引尚未基于新内容重算，旧基线差异不是用户改动，必须抑制
  if (input.fetchedDir !== null) return [];
  if (input.record.checksum === input.checksum) return [];
  return [
    finding(CODES.DRIFT, {
      source: 'meta',
      target: input.id,
      message: `中心库内容已被改动：记录基线指纹 ${input.record.checksum}，磁盘重算指纹 ${input.checksum}`,
      remedy:
        '如为有意修改，请执行 scan 以刷新内容基线；如需以声明来源为准，请去掉 --check 后执行 update 覆盖本地改动',
    }),
  ];
}
