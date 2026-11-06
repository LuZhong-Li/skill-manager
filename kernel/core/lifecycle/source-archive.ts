/** 归档与本地仓库解包的安全读取。 */
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import * as tar from 'tar';
import StreamZip from 'node-stream-zip';
import { CODES } from '@skill-manager/contract';
import { KernelError } from '../../store/errors.ts';
import { META_FILE_NAME } from '../metadata/constants.ts';
import {
  ArchiveBudget,
  assertArchiveFileSize,
  budgetExceeded,
  DEFAULT_ARCHIVE_LIMITS,
  type ArchiveLimits,
} from './source-archive-budget.ts';
import { sourceError } from './source-shared.ts';

function assertEntrySafe(name: string, archive: string): void {
  const normalized = name.replace(/\\/g, '/');
  if (
    normalized === '' ||
    isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    throw sourceError(
      CODES.SRC_INSECURE_ARCHIVE,
      `归档条目路径不安全：${name}`,
      archive,
      '该归档含绝对路径或上级目录跳转，已拒绝解压；请重新打包后再试',
    );
  }
}

/** 拒绝链接类条目：归档与仓库内容都不接受符号链接与硬链接 */
function assertEntryTypeSafe(entry: unknown, path: string, target: string): void {
  const type = (entry as { type?: string }).type;
  if (type === 'SymbolicLink' || type === 'Link') {
    throw sourceError(
      CODES.SRC_INSECURE_ARCHIVE,
      `来源内容含链接条目：${path}`,
      target,
      '链接条目不受支持，已拒绝该来源',
    );
  }
}

/** 逐级确认父目录都是真实目录，避免借已存在的符号链接写到别处 */
function ensureRealPath(root: string, target: string): void {
  const resolved = join(root, target);
  const segments = relative(root, dirname(resolved))
    .split(/[\\/]/)
    .filter((segment) => segment !== '');
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) {
      mkdirSync(current);
      continue;
    }
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw sourceError(
        CODES.SRC_INSECURE_ARCHIVE,
        `归档解压路径的父级不是目录：${current}`,
        current,
        '该归档疑似借符号链接写出目标目录，已拒绝解压',
      );
    }
  }
}

/** 解压后复核：内容根内不得存在符号链接 */
export function assertNoSymlinks(root: string, base = ''): void {
  const entries = readdirSync(join(root, base), { withFileTypes: true });
  for (const entry of entries) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw sourceError(
        CODES.SRC_INSECURE_ARCHIVE,
        `归档解出符号链接：${rel}`,
        root,
        '归档中的符号链接不受支持，已拒绝该来源',
      );
    }
    if (entry.isDirectory()) assertNoSymlinks(root, rel);
  }
}

async function assertTarSafe(file: string, target: string, budget?: ArchiveBudget): Promise<void> {
  let failure: unknown = null;
  await tar.t({
    file,
    onReadEntry: (entry) => {
      if (failure !== null) return;
      try {
        assertEntrySafe(entry.path, target);
        assertEntryTypeSafe(entry, entry.path, target);
        // TAR 的头部大小即实际读取长度，提前计入预算就是准确的字节数检查
        budget?.admitEntry(entry.size ?? 0, entry.size ?? 0);
      } catch (error) {
        failure = error;
      }
    },
  });
  if (failure !== null) throw failure;
}

/** 解压 tar 归档；条目在过滤器里逐条校验，大小按头部声明预先计入预算 */
export async function extractTar(
  archive: string,
  dest: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<void> {
  assertArchiveFileSize(archive, limits);
  await assertTarSafe(archive, archive, new ArchiveBudget(limits, archive));
  await tar.x({
    file: archive,
    cwd: dest,
    preservePaths: false,
    filter: (path, entry) => {
      assertEntrySafe(path, archive);
      assertEntryTypeSafe(entry, path, archive);
      ensureRealPath(dest, path);
      return true;
    },
  });
}

/**
 * 把解压过程中的异常归类成来源类问题。
 * 解压库自身也会拦下恶意条目，且它抛出的异常可能被包装或替换，
 * 因此两层 catch 都走这一个分类函数，保证同一个原因永远得到同一个问题码。
 */
export function classifyArchiveError(error: unknown, archive: string): KernelError {
  if (error instanceof KernelError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/malicious entry/i.test(message)) {
    return sourceError(
      CODES.SRC_INSECURE_ARCHIVE,
      `归档条目路径不安全：${message.replace(/^.*malicious entry:\s*/i, '')}`,
      archive,
      '该归档含绝对路径或上级目录跳转条目，已拒绝解压；请重新打包后再试',
    );
  }
  return sourceError(
    CODES.SRC_FETCH_FAILED,
    `归档无法解析：${message}`,
    archive,
    '请确认该文件是完整的归档，或改为使用本地目录来源',
  );
}

/**
 * 解压 zip 归档：逐条目校验后用节点流写出，不调用库的批量解压。
 *
 * 不信任中心目录声明的未压缩大小（可被伪造），因此采用流式写出并
 * 按实际流出字节计数：一旦越过单条或累计预算立即中止并删除半截文件。
 */
export async function extractZip(
  archive: string,
  dest: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<void> {
  assertArchiveFileSize(archive, limits);
  const budget = new ArchiveBudget(limits, archive);
  const zip = new StreamZip.async({ file: archive });
  try {
    const entries = await zip.entries();
    for (const entry of Object.values(entries)) {
      assertEntrySafe(entry.name, archive);
    }
    for (const entry of Object.values(entries)) {
      const target = entry.name.replace(/\\/g, '/');
      if (entry.isDirectory) {
        ensureRealPath(dest, `${target}/x`);
        budget.admitEntry(entry.compressedSize, 0);
        continue;
      }
      ensureRealPath(dest, target);
      budget.admitEntry(entry.compressedSize, entry.size);
      await writeZipEntry(zip, entry, join(dest, ...target.split('/')), budget, limits);
    }
  } catch (error) {
    throw classifyArchiveError(error, archive);
  } finally {
    await zip.close();
  }
}

/** 写出单个 zip 条目；实际字节数越过预算则中止并清理半截文件 */
async function writeZipEntry(
  zip: StreamZip.StreamZipAsync,
  entry: StreamZip.ZipEntry,
  target: string,
  budget: ArchiveBudget,
  limits: ArchiveLimits,
): Promise<void> {
  let written = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      try {
        if (written > limits.maxEntryBytes) {
          throw budgetExceeded(
            target,
            `归档单条解压大小超过上限：${String(written)} 字节，上限 ${String(limits.maxEntryBytes)} 字节`,
            '该归档含超大条目，已中止解压；请确认内容是否符合预期',
          );
        }
        budget.charge(chunk.length);
      } catch (error) {
        callback(error as Error);
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(await zip.stream(entry), guard, createWriteStream(target));
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }
}

/** 用 git 读出仓库在给定引用下的内容：不含版本控制目录，也不含未提交改动 */
export async function extractGit(
  repo: string,
  ref: string | undefined,
  dest: string,
): Promise<void> {
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    throw sourceError(
      CODES.SRC_UNRESOLVED,
      `本地仓库路径不可用：${repo}`,
      repo,
      '请确认该路径存在且是一个目录',
    );
  }
  const child = spawn('git', ['-C', repo, 'archive', '--format=tar', ref ?? 'HEAD'], {
    shell: false,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const failed = new Promise<never>((_resolve, reject) => {
    child.on('error', (error: Error) => {
      const missing = (error as { code?: string }).code === 'ENOENT';
      reject(
        sourceError(
          missing ? CODES.SRC_COMMAND_UNAVAILABLE : CODES.SRC_FETCH_FAILED,
          missing ? '未找到 git 命令' : `无法启动 git：${error.message}`,
          repo,
          missing ? '请先安装 git 并确保它在 PATH 中，或改用本地目录与归档来源' : '请检查运行环境',
        ),
      );
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(
          sourceError(
            CODES.SRC_FETCH_FAILED,
            `git archive 退出码 ${String(code)}：${stderr.trim() || '无诊断输出'}`,
            repo,
            '请确认该路径是一个 git 仓库，且引用标识存在',
          ),
        );
      }
    });
  });

  try {
    await Promise.race([
      pipeline(
        child.stdout,
        tar.x({
          cwd: dest,
          preservePaths: false,
          filter: (path, entry) => {
            assertEntrySafe(path, repo);
            assertEntryTypeSafe(entry, path, repo);
            ensureRealPath(dest, path);
            return true;
          },
        }),
      ),
      failed,
    ]);
  } catch (error) {
    if (error instanceof KernelError) throw error;
    throw sourceError(
      CODES.SRC_FETCH_FAILED,
      `仓库内容无法读取：${error instanceof Error ? error.message : String(error)}`,
      repo,
      '请确认该路径是一个 git 仓库，且引用标识存在',
    );
  }
}

/** 取出来源内容；调用方负责在完成后调用 releaseSource */
export function assertEntrySafeRoot(
  dir: string,
  target: string,
  rootFile: string = META_FILE_NAME,
): string {
  if (existsSync(join(dir, rootFile))) return dir;
  const children = readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
  );
  if (children.length === 1) {
    const inner = join(dir, children[0]!.name);
    if (existsSync(join(inner, rootFile))) return inner;
  }
  throw sourceError(
    CODES.SRC_FETCH_FAILED,
    `无法确定唯一内容目录：内容根下没有 ${rootFile}`,
    target,
    children.length === 1
      ? `请让 ${children[0]!.name}/ 目录内直接包含 ${rootFile}`
      : `请让归档的内容根直接包含 ${rootFile}，或只在外层保留一个目录`,
  );
}

/**
 * 按命令行给出的位置取出来源：文件按归档处理，目录先看元文件声明的来源类型，
 * 声明为本地仓库时按仓库读取（读的是已提交内容，不含版本控制目录与未提交改动）。
 */
