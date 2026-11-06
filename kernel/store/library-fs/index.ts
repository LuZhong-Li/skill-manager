/**
 * S-07 中心库与受控副本。
 *
 * AMB-01 的裁决：启用与禁用只作用于目标位置的受控副本，
 * 通过把副本内的技能元数据文件改名为带禁用后缀的名称实现；
 * 不移动、不重命名、不删除任何目录，也不改动中心库原件与用户源文件。
 *
 * 本体只提供副本层面的可见性切换原语，不负责决定哪个目录是副本——
 * 该判断由调用方依据索引中的落位目标给出。
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { KernelError } from '../errors.ts';
import { CODES } from '@skill-manager/contract';
import { DISABLED_SUFFIX, SKILL_MD_NAME } from '@skill-manager/contract';
import { renameWithRetry } from '../atomic/index.ts';

/** 副本内被改名的文件：技能元数据文件本身 */
export function copyMarkerName(): string {
  return SKILL_MD_NAME;
}

/** 副本内禁用态的文件名 */
export function disabledMarkerName(): string {
  return SKILL_MD_NAME + DISABLED_SUFFIX;
}

/** 副本当前是否处于禁用态 */
export function isCopyDisabled(copyDir: string): boolean {
  return (
    existsSync(join(copyDir, disabledMarkerName())) && !existsSync(join(copyDir, copyMarkerName()))
  );
}

/** 切换副本的可见性；已是目标状态时不产生变更，天然幂等 */
export function setCopyVisibility(copyDir: string, enabled: boolean): 'changed' | 'unchanged' {
  const active = join(copyDir, copyMarkerName());
  const disabled = join(copyDir, disabledMarkerName());

  if (enabled) {
    if (existsSync(active)) return 'unchanged';
    if (!existsSync(disabled)) {
      throw new KernelError({
        code: CODES.PATH_INVALID,
        message: `副本缺少技能元数据文件：${copyDir}`,
        source: 'library-fs',
        target: copyDir,
        remedy: '请重新安装该 Skill，或检查副本是否完整',
      });
    }
    renameWithRetry(disabled, active);
    return 'changed';
  }

  if (existsSync(disabled) && !existsSync(active)) return 'unchanged';
  if (!existsSync(active)) {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: `副本缺少技能元数据文件：${copyDir}`,
      source: 'library-fs',
      target: copyDir,
      remedy: '请重新安装该 Skill，或检查副本是否完整',
    });
  }
  renameWithRetry(active, disabled);
  return 'changed';
}

/** 目录是否存在 */
export function pathExists(target: string): boolean {
  return existsSync(target);
}

/** 目标是否为目录 */
export function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 统计目录内的普通文件数量，用于影响范围说明。
 * 只统计普通文件，不跟随符号链接，不进入符号链接目录。
 */
export function countTreeFiles(target: string): number {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      count += countTreeFiles(join(target, entry.name));
      continue;
    }
    if (entry.isFile()) count += 1;
  }
  return count;
}

/**
 * 逐文件递归复制目录（绕过 Windows Node v24 cpSync 中文路径崩溃 bug）。
 * 根因：fs.cpSync({recursive:true}) 在源路径含非 ASCII 字符时触发 STATUS_STACK_BUFFER_OVERRUN，
 * 应用层 try/catch 无法捕获。改用 readdirSync + copyFileSync 逐文件复制。
 */
export function copyTreeRecursive(sourceDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(sourceDir, entry.name);
    const dstPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, dstPath);
    }
    // 符号链接跳过（与原 cpSync 默认行为一致）
  }
}

/**
 * 把一份内容整体复制为副本。
 * 调用方必须保证传入的路径已经过路径防护校验。
 */
export function copyTree(sourceDir: string, destDir: string): void {
  try {
    copyTreeRecursive(sourceDir, destDir);
  } catch (error) {
    throw new KernelError({
      code: CODES.IO_FAILED,
      message: `复制失败：${error instanceof Error ? error.message : String(error)}`,
      source: 'library-fs',
      target: destDir,
      remedy: '请检查目标位置是否可写',
      cause: error,
    });
  }
}

/**
 * 移除一个目录。
 * 调用方必须保证传入的路径已经过路径防护校验，且确实是本工具管理的副本目录。
 */
export function removeTree(target: string): void {
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    throw new KernelError({
      code: CODES.IO_FAILED,
      message: `移除失败：${error instanceof Error ? error.message : String(error)}`,
      source: 'library-fs',
      target,
      remedy: '请检查该目录是否被占用，或手工处理后再试',
      cause: error,
    });
  }
}

export interface DeliveryPlanEntry {
  /** 原件内的相对路径 */
  source: string;
  /** 副本目录下的相对路径 */
  destination: string;
}

/**
 * 把一次落位计划写进副本目录。
 *
 * 计划为空表示整目录复制（元文件未提供 `file_map` 的缺省行为）：保持相对路径不变整体复制。
 * 计划非空表示逐文件映射：只落位列出的文件。
 * 返回实际落位的副本内相对路径列表，供载荷逐文件呈现。
 *
 * 调用方必须已用 K-07 的冲突检测检查过计划；本函数只负责执行，并在源文件缺失或读写失败时抛错。
 */
/**
 * 校验 file_map 条目的相对路径必须留在指定根目录内。
 * 拒绝绝对路径、`..` 段、反斜杠（跨平台路径注入）。
 */
function assertWithinRoot(root: string, relative: string, field: string): void {
  if (!relative || relative.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relative)) {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: `file_map ${field} 不能是绝对路径：${relative}`,
      source: 'library-fs',
      target: relative,
      remedy: '请使用相对于原件目录的相对路径',
    });
  }
  const segments = relative.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.')) {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: `file_map ${field} 不能包含 .. 段：${relative}`,
      source: 'library-fs',
      target: relative,
      remedy: '请使用扁平相对路径，不要向上跳级',
    });
  }
  const resolved = join(root, ...segments);
  const normalizedRoot = resolve(root);
  if (
    !resolved.startsWith(normalizedRoot + (resolved.includes('\\') ? '\\' : '/')) &&
    resolved !== normalizedRoot
  ) {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: `file_map ${field} 越界：${relative}`,
      source: 'library-fs',
      target: relative,
      remedy: '请修正 file_map，所有路径必须留在副本目录内',
    });
  }
}

export function deliverFiles(
  sourceDir: string,
  destDir: string,
  plan: DeliveryPlanEntry[],
): string[] {
  if (plan.length === 0) {
    copyTree(sourceDir, destDir);
    return listTreeFiles(destDir);
  }

  const delivered: string[] = [];
  for (const entry of plan) {
    assertWithinRoot(sourceDir, entry.source, 'source');
    assertWithinRoot(destDir, entry.destination, 'destination');
    const from = join(sourceDir, ...entry.source.split('/'));
    const to = join(destDir, ...entry.destination.split('/'));
    try {
      if (!statSync(from).isFile()) {
        throw new KernelError({
          code: CODES.PATH_INVALID,
          message: `落位计划中的源文件不存在或不是文件：${entry.source}`,
          source: 'library-fs',
          target: entry.source,
          remedy: '请修正 file_map 中的源路径，或把该文件放回原件目录',
        });
      }
      mkdirSync(join(to, '..'), { recursive: true });
      cpSync(from, to, { force: true });
      delivered.push(entry.destination);
    } catch (error) {
      if (error instanceof KernelError) throw error;
      throw new KernelError({
        code: CODES.IO_FAILED,
        message: `落位失败：${entry.source} → ${entry.destination}：${error instanceof Error ? error.message : String(error)}`,
        source: 'library-fs',
        target: entry.destination,
        remedy: '请检查副本目录是否可写，并确认源文件存在',
        cause: error,
      });
    }
  }
  return delivered.sort();
}

/** 列出目录内的全部普通文件，返回相对路径（正斜杠分隔）并排序 */
export function listTreeFiles(root: string, base = '', collected: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(join(root, base), { withFileTypes: true });
  } catch {
    return collected.sort();
  }
  for (const entry of entries) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      listTreeFiles(root, rel, collected);
      continue;
    }
    if (entry.isFile()) collected.push(rel);
  }
  return collected.sort();
}

/**
 * 用来源内容整体替换一个内核管理的目录（中心库原件）。
 * 调用方必须先把内容取到本地并校验完毕——本函数不做任何获取与判断，
 * 只负责「先清空再放新内容」，因此不会出现新旧内容混在一起的状态。
 */
export function replaceTree(sourceDir: string, destDir: string): void {
  try {
    rmSync(destDir, { recursive: true, force: true });
    copyTreeRecursive(sourceDir, destDir);
  } catch (error) {
    throw new KernelError({
      code: CODES.IO_FAILED,
      message: `替换目录失败：${error instanceof Error ? error.message : String(error)}`,
      source: 'library-fs',
      target: destDir,
      remedy: '请检查目标目录是否可写；必要时重新安装该 Skill',
      cause: error,
    });
  }
}
