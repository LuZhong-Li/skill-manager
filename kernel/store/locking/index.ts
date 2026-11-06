/**
 * S-04 文件锁。
 *
 * 两层防线：
 *   进程内 `withLock` 以 key 为粒度串行，避免同进程并发任务互相抢占；
 *   进程间 `withProcessLock` 以锁文件实现独占，覆盖 GUI、CLI 与多个 CLI 并发写同一工作区。
 *
 * 跨进程锁的安全约束：
 *   - 获取靠 `open(..., 'wx')` 的原子创建，不靠「先查再建」；
 *   - 释放前校验 owner token，绝不删除不是自己持有的锁；
 *   - 只有持有者进程已不存在（或锁文件已不可解析）才回收，禁止盲删活锁；
 *   - 等待超时给出持有者信息，不无限挂起。
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { KernelError } from '../errors.ts';
import { CODES } from '@skill-manager/contract';
import type { WorkspaceLayout } from '../workspace/index.ts';

const chains = new Map<string, Promise<unknown>>();

/**
 * 以 key 为粒度的进程内互斥执行。
 * 同一 key 的调用串行执行，不同 key 互不阻塞。
 */
export async function withLock<T>(key: string, task: () => Promise<T> | T): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(
    () => task(),
    () => task(),
  );
  // 记录链尾，且不因前序失败而中断后续排队
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  try {
    return await run;
  } finally {
    if (chains.get(key) === settled) chains.delete(key);
  }
}

/** 进程间锁文件所在目录名（位于系统临时目录，不在工作区内） */
export const LOCK_DIR_NAME = 'skill-manager-locks';

/**
 * 工作区写锁的锁文件路径。
 *
 * 锁文件刻意放在工作区**之外**：预览、盘点与只读指令承诺「不写工作区」，
 * 若把锁文件建在工作区内，连一次只读调用也会改动目录 mtime、留下痕迹。
 * 用工作区绝对路径的哈希作为稳定键，保证同一工作区在不同进程间映射到同一把锁。
 */
export function workspaceLockFile(root: string): string {
  const absolute = resolve(root);
  // Windows 文件系统大小写不敏感，统一小写以免同一目录派生两把锁
  const normalized = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const key = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return join(tmpdir(), LOCK_DIR_NAME, `${key}.lock`);
}

const DEFAULT_TIMEOUT_MS = Number(process.env['SKILL_MANAGER_LOCK_TIMEOUT_MS'] ?? '') || 60_000;
const POLL_MS = 50;

export interface ProcessLockOptions {
  /** 锁文件绝对路径 */
  lockFile: string;
  /** 等待上限；超时抛 LOCK_FAILED，不会静默继续写 */
  timeoutMs?: number;
  /** 轮询间隔，便于测试收紧 */
  pollMs?: number;
}

interface LockRecord {
  pid: number;
  token: string;
  created_at: string;
}

function lockError(target: string, message: string, remedy: string): KernelError {
  return new KernelError({
    code: CODES.LOCK_FAILED,
    message,
    source: 'locking',
    target,
    remedy,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 持有者是否仍在运行；EPERM 表示进程存在但无权发信号，同样算活着 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

/** 读取锁记录；文件不存在或内容不可解析时返回 null */
function readLock(lockFile: string): LockRecord | null {
  let text: string;
  try {
    text = readFileSync(lockFile, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<LockRecord>;
    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') return null;
    return {
      pid: parsed.pid,
      token: parsed.token,
      created_at: typeof parsed.created_at === 'string' ? parsed.created_at : '',
    };
  } catch {
    return null;
  }
}

/** 持有者可读描述，用于超时诊断 */
function describeHolder(lockFile: string): string {
  const holder = readLock(lockFile);
  if (holder === null) return '无法解析的锁文件（可能由崩溃残留）';
  const since = holder.created_at === '' ? '' : `，自 ${holder.created_at} 起`;
  return `进程 ${String(holder.pid)}${since}`;
}

/** 原子创建锁文件；已存在返回 false */
function tryCreateLock(lockFile: string, token: string): boolean {
  try {
    mkdirSync(dirname(lockFile), { recursive: true });
  } catch (error) {
    throw lockError(
      lockFile,
      `无法创建锁目录：${error instanceof Error ? error.message : String(error)}`,
      '请检查工作区目录是否可写',
    );
  }
  let handle: number;
  try {
    handle = openSync(lockFile, 'wx');
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') return false;
    throw lockError(
      lockFile,
      `无法创建锁文件：${error instanceof Error ? error.message : String(error)}`,
      '请检查工作区目录是否可写，或先处理残留的锁文件',
    );
  }
  const record: LockRecord = {
    pid: process.pid,
    token,
    created_at: new Date().toISOString(),
  };
  try {
    writeSync(handle, JSON.stringify(record));
  } finally {
    closeSync(handle);
  }
  return true;
}

/** 回收持有者已不存在的锁；token 二次校验，避免误删他人刚重建的锁 */
function reclaimDead(lockFile: string, observed: LockRecord): boolean {
  if (isProcessAlive(observed.pid)) return false;
  const confirm = readLock(lockFile);
  if (confirm === null || confirm.token !== observed.token) return false;
  rmSync(lockFile, { force: true });
  return true;
}

/** 锁文件不可解析：可能是写入中途崩溃，也可能只是别的进程刚建好还没写完 */
async function reclaimUnreadable(lockFile: string, pollMs: number): Promise<boolean> {
  await sleep(pollMs);
  const retry = readLock(lockFile);
  if (retry !== null) return reclaimDead(lockFile, retry);
  if (!existsSync(lockFile)) return true;
  rmSync(lockFile, { force: true });
  return true;
}

/** 回收陈旧锁：只有确认无人持有才删除 */
async function reclaimStale(lockFile: string, pollMs: number): Promise<boolean> {
  const observed = readLock(lockFile);
  if (observed === null) return reclaimUnreadable(lockFile, pollMs);
  return reclaimDead(lockFile, observed);
}

/** 等待获取锁；返回本次持有的 token */
async function acquire(options: ProcessLockOptions): Promise<string> {
  const { lockFile } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = randomUUID();
    if (tryCreateLock(lockFile, token)) return token;
    if (await reclaimStale(lockFile, pollMs)) continue;
    if (Date.now() >= deadline) {
      throw lockError(
        lockFile,
        `等待工作区写锁超时（${String(timeoutMs)} ms），当前持有者：${describeHolder(lockFile)}`,
        '可能已有另一个 skill-manager 进程在写同一工作区，请等待其完成后重试',
      );
    }
    await sleep(pollMs);
  }
}

/** 释放锁：只删除仍由本次持有的锁文件 */
function release(lockFile: string, token: string): void {
  const holder = readLock(lockFile);
  if (holder === null || holder.token !== token) return;
  rmSync(lockFile, { force: true });
}

/** 跨进程独占执行；超时或无法建锁时抛 LOCK_FAILED，不静默降级 */
export async function withProcessLock<T>(
  options: ProcessLockOptions,
  task: () => Promise<T> | T,
): Promise<T> {
  const token = await acquire(options);
  try {
    return await task();
  } finally {
    release(options.lockFile, token);
  }
}

/** 本进程当前持有的工作区写锁（用于重入，避免同一调用链内自锁） */
let heldLock: { lockFile: string; token: string; depth: number } | null = null;

/**
 * 工作区写锁：所有会写工作区索引、中心库、宿主副本或账本的路径都应经由它。
 *
 * 同一进程内的嵌套调用直接复用已持有的锁（重入），不重复争抢锁文件；
 * 跨进程仍互斥。锁文件位于系统临时目录，因此调用本身不改变工作区内容——
 * 预览与只读路径不会因此留下痕迹。工作区根不存在时无需加锁：
 * 没有任何内容可被并发破坏。
 */
export async function withWriterLock<T>(
  layout: WorkspaceLayout,
  task: () => Promise<T> | T,
): Promise<T> {
  if (!existsSync(layout.root)) return task();
  const lockFile = workspaceLockFile(layout.root);
  if (heldLock !== null && heldLock.lockFile === lockFile) {
    heldLock.depth += 1;
    try {
      return await task();
    } finally {
      heldLock.depth -= 1;
    }
  }
  const token = await acquire({ lockFile });
  heldLock = { lockFile, token, depth: 0 };
  try {
    return await task();
  } finally {
    heldLock = null;
    release(lockFile, token);
  }
}

/** 仅供测试使用：清空锁链 */
export function resetLocks(): void {
  chains.clear();
}
