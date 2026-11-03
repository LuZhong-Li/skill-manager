/**
 * 仓库巡览的底层动作：有界遍历目录、读取文件开头、识别测试文件。
 *
 * 单独成文件，是为了把「怎么在磁盘上走」和「怎么判断哪个文件可疑」分开：
 * 前者是纯粹的 IO 约束（只读、有上限、跳过依赖与产物），后者才是诊断逻辑。
 *
 * 这里没有任何写操作，也不执行命令；任何一步失败都只返回空结果，不抛异常。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

/** 探查预算：超出即停，保证在任意仓库上都能快速收敛。 */
export const PROBE_LIMITS = {
  /** 最多访问的目录数。 */
  maxDirs: 400,
  /** 最多读取的文件数。 */
  maxFiles: 3000,
  /** 单文件最多读取的字节数（只看开头，够判断角色）。 */
  maxBytesPerFile: 64 * 1024,
  /** 最多记录的可疑文件数。 */
  maxSuspects: 8,
  /** 最多记录的测试文件数。 */
  maxRelatedTests: 12,
  /** observations 的最大条数。 */
  maxObservations: 12,
} as const;

/** 不进入的目录：依赖、版本库、构建产物与缓存。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'vendor',
  'Pods',
  '.gradle',
  'bin',
  'obj',
  '.idea',
  '.vscode',
]);

/** 参与关键词匹配的源文件扩展名。 */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.ps1',
  '.sql',
]);

/** 测试文件识别（路径或文件名层）。 */
const TEST_PATH_PATTERN =
  /(^|[/\\])(tests?|__tests__|spec|e2e|integration)[/\\]|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$|Test\.(java|kt|cs)$/i;

/** 一次文件遍历的结果。 */
export interface WalkResult {
  files: string[];
  truncated: boolean;
}

/** Windows 分隔符统一成正斜杠，报告里只出现一种写法。 */
export function toPosix(value: string): string {
  return value.split(sep).join('/');
}

/** 路径是否像测试文件。 */
export function isTestPath(path: string): boolean {
  return TEST_PATH_PATTERN.test(path);
}

/** 扫描单个目录：子目录入队，返回本层的源文件。 */
function scanDir(root: string, rel: string, queue: string[]): string[] {
  const absolute = rel === '' ? root : join(root, rel);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    // 无权限或中途被删的目录直接跳过：探查不能因为一个目录失败就整体失败
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) queue.push(child);
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      files.push(child);
  }
  return files;
}

/** 有界遍历：返回相对仓库根的 posix 路径。 */
export function walkSources(root: string, limits = PROBE_LIMITS): WalkResult {
  const files: string[] = [];
  const queue: string[] = [''];
  let visitedDirs = 0;
  while (queue.length > 0) {
    if (visitedDirs >= limits.maxDirs) return { files, truncated: true };
    const rel = queue.shift();
    if (rel === undefined) break;
    visitedDirs += 1;
    for (const file of scanDir(root, rel, queue)) {
      files.push(file);
      if (files.length >= limits.maxFiles) return { files, truncated: true };
    }
  }
  return { files, truncated: false };
}

/** 读取文件开头若干字节；读不到返回 null。 */
export function readHead(
  absolute: string,
  maxBytes: number = PROBE_LIMITS.maxBytesPerFile,
): string | null {
  try {
    if (!statSync(absolute).isFile()) return null;
    return readFileSync(absolute, 'utf8').slice(0, maxBytes);
  } catch {
    return null;
  }
}
