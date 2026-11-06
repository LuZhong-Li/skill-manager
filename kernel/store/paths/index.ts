/**
 * S-05 路径解析与越界防护。
 *
 * 契约要求：所有路径必须落在工作区之内；拒绝上级目录穿越与绝对路径注入。
 * 判定基于解析后的绝对路径前缀比较，而不是字符串前缀，以避免
 * /workspace-evil 被误判为落在 /workspace 之内。
 */
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { KernelError } from '../errors.ts';
import { CODES } from '@skill-manager/contract';

/** relative() 结果是否越出根目录；精确识别 `..` 与 `../`，不误伤名为 `..foo` 的子项 */
function escapes(rel: string): boolean {
  if (rel === '') return false;
  if (isAbsolute(rel)) return true;
  return rel === '..' || rel.startsWith(`..${sep}`);
}

/** 判断 target 解析后是否落在 root 之内（含 root 自身） */
export function isWithin(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, target);
  if (resolvedTarget === resolvedRoot) return true;
  return !escapes(relative(resolvedRoot, resolvedTarget));
}

/**
 * 把 target 解析为工作区内的绝对路径。
 * 越界或非法输入时抛出 E-PATH-001，调用方负责转换为结果封装。
 */
export function resolveWithin(root: string, target: string, rootLabel = '工作区'): string {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: '路径为空',
      source: 'paths',
      target,
      remedy: '请提供非空路径',
    });
  }
  if (target.includes('\0')) {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: '路径包含空字节',
      source: 'paths',
      target,
      remedy: '请检查输入路径',
    });
  }
  if (!isWithin(root, target)) {
    throw new KernelError({
      code: CODES.PATH_INVALID,
      message: `路径越出${rootLabel}：${target}`,
      source: 'paths',
      target,
      remedy: `请把路径限定在${rootLabel}之内，禁止使用上级目录穿越或工作区之外的绝对路径`,
    });
  }
  return resolve(resolve(root), target);
}

/** 把绝对路径表达为相对于工作区的可移植路径，统一使用正斜杠 */
export function toPortablePath(root: string, target: string): string {
  const rel = relative(resolve(root), resolve(target));
  return rel.split(sep).join('/');
}

/**
 * 物理等价键：用于「这两个路径是不是同一个对象」的比较。
 *
 * 已存在的路径取 `realpath`（解析符号链接与磁盘大小写）；尚不存在的路径
 * 从最近的存在祖先规范化后拼接剩余段——计划中的目标通常还没落盘，
 * 若直接 `realpath` 会失败并退化成字符串比较，正是误判 external / shared-root 的来源。
 * Windows 文件系统大小写不敏感，统一折叠小写后才能等价比较。
 */
export function physicalKey(target: string): string {
  const absolute = resolve(target);
  const canonical = canonicalizeNearest(absolute);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/** 从最近存在祖先取 realpath，再拼回尚未创建的剩余段 */
function canonicalizeNearest(absolute: string): string {
  let current = absolute;
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return suffix.length === 0 ? real : join(real, ...suffix.reverse());
    } catch {
      const parent = dirname(current);
      // 连根都不存在（或不可访问）：退回纯词法解析结果，仍保证是绝对路径
      if (parent === current) return absolute;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

/**
 * 判断 target 在物理意义上是否落在 root 之内（含 root 自身）。
 *
 * 与 `isWithin` 的分工：`isWithin` 用于拒绝含 `..` 的用户输入，纯词法、不碰磁盘；
 * 本函数用于归属判定，按 realpath + 大小写折叠比较，避免同一目录的不同写法
 * （盘符大小写、分隔符、符号链接、8.3 短名）得出不同结论。
 */
export function isPhysicallyWithin(root: string, target: string): boolean {
  const keyRoot = physicalKey(root);
  const keyTarget = physicalKey(target);
  if (keyTarget === keyRoot) return true;
  return !escapes(relative(keyRoot, keyTarget));
}
