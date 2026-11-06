/**
 * K-15 适配器层：落位执行器（**本层唯一的写盘路径**）。
 *
 * 依据：T5 前置裁决——落位目标为宿主真实根；工作区外写安全沿用既有防线
 * （原子写 + 备份先行 + 确认机制由指令层承担）；启用/禁用按 Q-06 在宿主根内改名。
 *
 * 写盘纪律：
 * 一、只经本模块执行写盘，且只调用存储层的原子写与备份原语，不新增旁路；
 * 二、目录类落位（技能形态）写前先备份既有宿主副本目录，备份失败即中止，不改动环境；
 * 三、同一目标路径只写一次（重叠消费不重复产出，M5-R8）；
 * 四、`landable = false` 的落位项（指令文件载体）只登记不落盘；
 * 五、`dryRun` 只产出将执行的变更清单，不触碰磁盘。
 */
import { copyFileSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CODES, type Change, type Finding } from '@skill-manager/contract';
import { finding } from '../../store/findings.ts';
import { KernelError } from '../../store/errors.ts';
import { atomicWriteFile, renameWithRetry } from '../../store/atomic/index.ts';
import { createBackup } from '../../store/backup-fs/index.ts';
import {
  copyTreeRecursive,
  deliverFiles,
  isCopyDisabled,
  isDirectory,
  listTreeFiles,
  pathExists,
  replaceTree,
  setCopyVisibility,
  type DeliveryPlanEntry,
} from '../../store/library-fs/index.ts';
import { computeChecksum } from '../integrity/index.ts';
import type { WorkspaceLayout } from '../../store/workspace/index.ts';
import type { PlacementEntry, PlacementPlan } from './types.ts';
import type { ArtifactKind } from '../render/types.ts';

const SOURCE = 'land';

/** 落位请求：计划 + 工作区 + 时间戳；可选给出中心库原件目录用于资产落位 */
export interface LandRequest {
  plan: PlacementPlan;
  workspace: WorkspaceLayout;
  /** 协调世界时秒级时间戳，用于备份命名（同秒重复备份自动扩展毫秒） */
  now: string;
  /** 中心库原件目录：给出时按逐文件映射把资产落到宿主副本目录 */
  sourceDir?: string;
  /** 逐文件落位计划（元文件 file_map）；空数组或缺省表示整目录复制 */
  fileMap?: DeliveryPlanEntry[];
  /** 预演：只产出变更清单，不写盘 */
  dryRun?: boolean;
  /** 事务标识；缺省由本次落位自行生成 */
  transactionId?: string;
}

/** 落位结果 */
export interface LandResult {
  host_id: string;
  target_id: string;
  skill_id: string;
  dry_run: boolean;
  changes: Change[];
  skipped: Array<{ target_path: string; reason: string }>;
  /** 本次产生的备份目录（可移植路径） */
  backups: string[];
  /** 本次实际写入的落位；供账本写入失败时精确回滚 */
  writes: LandWrite[];
  findings: Finding[];
}

export interface LandWrite {
  target_path: string;
  root_path: string;
  artifact_kind: ArtifactKind;
  existed_before: boolean;
  root_existed_before: boolean;
  parent_existed_before: boolean;
  backup_dir: string | undefined;
  /** 产生该落位的事务标识；回滚只处理本次事务拥有的文件 */
  transaction_id: string;
  /** 本次事务写入该落位的条目（相对根目录，正斜杠分隔）；无备份时回滚只删这些 */
  owned_entries: string[];
  /** 本次事务为目标文件新建的父目录；回滚按逆序清理空目录 */
  created_dirs: string[];
}

/**
 * 写前备份（备份先行）。
 *
 * 目录类落位备份既有宿主副本目录；文件类落位（规则路径）以父目录为单位备份——
 * 备份存储以目录为载体，规则目录通常只含少量规则文件。
 */
function backupBeforeWrite(input: {
  workspace: WorkspaceLayout;
  skillId: string;
  /** 被备份的既有内容：技能形态为宿主副本目录，规则形态为规则文件所在目录 */
  backupSource: string;
  now: string;
}): ReturnType<typeof createBackup> | undefined {
  const existingSource = input.backupSource;
  if (!pathExists(existingSource)) return undefined;
  if (!isDirectory(existingSource)) {
    throw new KernelError({
      code: CODES.BACKUP_FAILED,
      source: SOURCE,
      target: existingSource,
      message: '既有落位内容不是目录，无法按备份载体处理；已中止写盘',
      remedy: '先处理该路径上的文件，或在配置中改指到其他宿主根',
    });
  }
  const result = createBackup({
    workspaceRoot: input.workspace.root,
    backupsDir: input.workspace.backupsDir,
    id: input.skillId,
    sourceDir: existingSource,
    now: input.now,
    checksum: computeChecksum(existingSource),
  });
  return result;
}

/**
 * 执行落位计划。
 *
 * 失败时抛出 KernelError（写盘失败为 E-IO-002，备份失败为 E-BAK-*）；
 * 备份先于写入，因此备份失败不会留下任何改动。
 */
export function landPlan(request: LandRequest): LandResult {
  const { plan, workspace, now } = request;
  const dryRun = request.dryRun === true;
  const transactionId = request.transactionId ?? randomUUID();
  const changes: Change[] = [];
  const skipped: Array<{ target_path: string; reason: string }> = [];
  const backups: string[] = [];
  const writes: LandWrite[] = [];
  const findings: Finding[] = [];
  const written = new Set<string>();

  for (const entry of plan.entries) {
    if (!entry.landable) {
      skipped.push({
        target_path: entry.target_path,
        reason: entry.hold_reason ?? '该落位项标记为不可落盘',
      });
      continue;
    }
    if (written.has(entry.target_path)) {
      findings.push(
        finding(CODES.CONFLICT_OCCUPIED, {
          source: SOURCE,
          target: entry.target_path,
          message: '同一目标路径在同一计划中出现多次，已按一次落位处理',
          remedy: '重叠消费按「单次写盘、多宿主读取」处理，不重复产出副本（M5-R8）',
        }),
      );
      continue;
    }
    written.add(entry.target_path);

    const directoryTarget = entry.artifact_kind === 'skill_md';
    const existedBefore = pathExists(entry.target_path);
    const rootExistedBefore = pathExists(entry.root_path);
    const parentExistedBefore = pathExists(dirname(entry.target_path));
    let backup: ReturnType<typeof createBackup> | undefined;
    const ownedEntries: string[] = [];
    const createdDirs: string[] = [];
    if (!dryRun) {
      backup = backupBeforeWrite({
        workspace,
        skillId: plan.skill_id,
        backupSource: directoryTarget ? entry.root_path : dirname(entry.target_path),
        now,
      });
      if (backup !== undefined) backups.push(backup.portableDir);

      if (directoryTarget) {
        // 先在兄弟目录组装，再整体原子切换：宿主可见路径要么是旧内容，要么是新内容
        ownedEntries.push(
          ...installDirectoryTarget({ entry, request, rootExistedBefore, transactionId }),
        );
      } else {
        createdDirs.push(...ensureParentDirs(entry.target_path));
        atomicWriteFile(entry.target_path, entry.content);
      }
    }

    changes.push({
      action: existedBefore ? 'modify' : 'add',
      kind: entry.artifact_kind,
      path: entry.target_path,
      detail: dryRun
        ? '预演：将写入该目标'
        : directoryTarget
          ? `技能形态落位（消费宿主：${entry.consumed_by.join('、') || '自身'}）`
          : '规则文件落位',
    });
    recordWrite(writes, dryRun, {
      target_path: entry.target_path,
      root_path: entry.root_path,
      artifact_kind: entry.artifact_kind,
      existed_before: existedBefore,
      root_existed_before: rootExistedBefore,
      parent_existed_before: parentExistedBefore,
      backup_dir: backupDirOf(backup),
      transaction_id: transactionId,
      owned_entries: ownedEntries,
      created_dirs: createdDirs,
    });
  }

  return {
    host_id: plan.host_id,
    target_id: plan.target_id,
    skill_id: plan.skill_id,
    dry_run: dryRun,
    changes,
    skipped,
    backups,
    writes,
    findings,
  };
}

function recordWrite(writes: LandWrite[], dryRun: boolean, write: LandWrite): void {
  if (!dryRun) writes.push(write);
}

function backupDirOf(backup: ReturnType<typeof createBackup> | undefined): string | undefined {
  return backup === undefined ? undefined : backup.dir;
}

/** 目录类落位：在兄弟目录组装完整副本，确认目标未被他人改变后再整体原子切换 */
function installDirectoryTarget(input: {
  entry: PlacementEntry;
  request: LandRequest;
  rootExistedBefore: boolean;
  transactionId: string;
}): string[] {
  const { entry, request, rootExistedBefore, transactionId } = input;
  const staging = join(
    dirname(entry.root_path),
    `.${basename(entry.root_path)}.staging-${transactionId.slice(0, 8)}`,
  );
  resetDir(staging);
  try {
    // 保留既有副本中未被本次落位覆盖的文件（落位是合并而非清空）
    if (rootExistedBefore) copyTreeRecursive(entry.root_path, staging);
    if (request.sourceDir !== undefined) {
      // 资产按逐文件映射（缺省整目录复制）；随后以渲染产物覆盖技能元数据文件
      deliverFiles(request.sourceDir, staging, request.fileMap ?? []);
    }
    atomicWriteFile(join(staging, basename(entry.target_path)), entry.content);
    // 切换前再次确认目标状态：检查之后若被其他参与方创建或删除，拒绝覆盖
    if (pathExists(entry.root_path) !== rootExistedBefore) {
      throw new KernelError({
        code: CODES.CONFLICT_OCCUPIED,
        source: SOURCE,
        target: entry.root_path,
        message: '落位目标在检查后被其他进程改变，已中止写入并保留对方改动',
        remedy: '请确认是否有其他程序或另一个 skill-manager 实例在写同一宿主目录，然后重试',
      });
    }
    switchIn(staging, entry.root_path);
    return listTreeFiles(entry.root_path);
  } catch (error) {
    discardDir(staging);
    throw error;
  }
}

/** 原子切换：目标已存在时先移到同父临时名，新内容就位后再清理旧内容 */
function switchIn(staging: string, target: string): void {
  if (!pathExists(target)) {
    renameWithRetry(staging, target);
    return;
  }
  const previous = `${staging}.previous`;
  renameWithRetry(target, previous);
  try {
    renameWithRetry(staging, target);
  } catch (error) {
    renameWithRetry(previous, target);
    throw error;
  }
  discardDir(previous);
}

/** 逐级创建父目录，并记录本次新建的层级；回滚按逆序清理这些空目录 */
function ensureParentDirs(target: string): string[] {
  const missing: string[] = [];
  let current = dirname(target);
  while (!pathExists(current)) {
    missing.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  mkdirSync(dirname(target), { recursive: true });
  return missing;
}

function resetDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** 清理临时目录；清理失败不掩盖原始错误 */
function discardDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 残留的临时目录以 .staging-/.previous 命名，不会被当作副本内容读取
  }
}

/**
 * 把一次落位回滚到写前状态。
 *
 * 账本写入失败时由调用方触发；按写入逆序恢复。
 * 恢复依据是本次事务显式记录的归属信息，而不是「当前路径是否存在」：
 * 有完整备份时整体恢复；无备份时只删除本事务写过的条目，绝不递归删除他人内容。
 */
export function rollbackLandWrites(writes: readonly LandWrite[]): void {
  for (const write of [...writes].reverse()) {
    if (write.artifact_kind === 'skill_md') {
      restoreSkillWrite(write);
    } else {
      restoreFileWrite(write);
    }
  }
}

function restoreSkillWrite(write: LandWrite): void {
  if (write.backup_dir !== undefined) {
    replaceTree(join(write.backup_dir, 'content'), write.root_path);
    return;
  }
  for (const relative of [...write.owned_entries].reverse()) {
    rmSync(join(write.root_path, ...relative.split('/')), { force: true });
  }
  pruneEmptyDirs(write.root_path);
}

function restoreFileWrite(write: LandWrite): void {
  const saved =
    write.backup_dir === undefined
      ? undefined
      : join(write.backup_dir, 'content', basename(write.target_path));
  if (saved !== undefined && write.existed_before) {
    copyFileSync(saved, write.target_path);
    return;
  }
  // 只有写前不存在时才可确认该文件归本事务所有
  if (!write.existed_before) rmSync(write.target_path, { force: true });
  for (const dir of [...write.created_dirs].reverse()) {
    try {
      rmdirSync(dir);
    } catch {
      // 目录非空说明写入期间还有其他文件，保留目录，不扩大回滚范围。
    }
  }
}

/** 自底向上删除空目录；遇到非空即停止，不扩大回滚范围 */
function pruneEmptyDirs(root: string): void {
  for (const dir of collectDirsPostOrder(root)) {
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
  }
}

/** 后序收集目录：子目录先于父目录，便于自底向上清理 */
function collectDirsPostOrder(root: string, collected: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return collected;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) collectDirsPostOrder(join(root, entry.name), collected);
  }
  collected.push(root);
  return collected;
}

/**
 * 在宿主真实根内切换技能副本的可见性（启用 / 禁用）。
 *
 * 沿用受控副本原语：只把副本内的技能元数据文件改名为带禁用后缀的名称，
 * 不移动、不重命名、不删除任何目录（Q-06 的三端结论）。
 */
export function setHostSkillVisibility(input: {
  rootPath: string;
  skillId: string;
  enabled: boolean;
}): 'changed' | 'unchanged' {
  const copyDir = join(input.rootPath, input.skillId);
  return setCopyVisibility(copyDir, input.enabled);
}

/** 宿主副本当前是否处于禁用态 */
export function isHostSkillDisabled(input: { rootPath: string; skillId: string }): boolean {
  return isCopyDisabled(join(input.rootPath, input.skillId));
}
