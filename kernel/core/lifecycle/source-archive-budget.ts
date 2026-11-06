/**
 * 归档解压资源预算。
 *
 * 归档体积小不等于解压后体积小：ZIP 条目头里声明的未压缩大小可以是任意值，
 * 一条小压缩包就能声明并写出数 GB 内容（zip bomb）。因此解压必须同时受
 * 条目数、单条大小、累计大小与压缩比四道约束，并且：
 *   - 声明值只用于「解压前」提前拒绝；
 *   - 真正的字节数以实际流出的数据为准（charge），不信任声明值。
 *
 * TAR 的头部大小即实际读取长度，因此头部检查就是字节数检查；
 * ZIP 的中心目录可被伪造，必须靠流式计数兜底。
 */
import { statSync } from 'node:fs';
import { CODES } from '@skill-manager/contract';
import { KernelError } from '../../store/errors.ts';
import { sourceError } from './source-shared.ts';

export interface ArchiveLimits {
  /** 归档文件自身的大小上限（解压前的第一道闸） */
  maxArchiveBytes: number;
  /** 条目数上限 */
  maxEntries: number;
  /** 单条解压后大小上限 */
  maxEntryBytes: number;
  /** 全部条目解压后的累计大小上限 */
  maxTotalBytes: number;
  /** 单条未压缩 / 压缩后 的比值上限 */
  maxCompressionRatio: number;
  /** 单次归档解析与解压的单调时间上限（毫秒；不含远端下载时间） */
  maxExtractMs: number;
}

/** 可注入单调时钟：生产使用 hrtime，测试无需真实 sleep。 */
export type ArchiveNow = () => number;

export function monotonicArchiveMs(): number {
  return Number(process.hrtime.bigint() / 1000000n);
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** 默认预算：可用环境变量按需收紧，便于不同部署与测试注入。 */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: envNumber('SKILL_MANAGER_ARCHIVE_MAX_BYTES', 128 * 1024 * 1024),
  maxEntries: envNumber('SKILL_MANAGER_ARCHIVE_MAX_ENTRIES', 5000),
  maxEntryBytes: envNumber('SKILL_MANAGER_ARCHIVE_MAX_ENTRY_BYTES', 32 * 1024 * 1024),
  maxTotalBytes: envNumber('SKILL_MANAGER_ARCHIVE_MAX_TOTAL_BYTES', 256 * 1024 * 1024),
  maxCompressionRatio: envNumber('SKILL_MANAGER_ARCHIVE_MAX_RATIO', 200),
  maxExtractMs: envNumber('SKILL_MANAGER_ARCHIVE_MAX_EXTRACT_MS', 60_000),
};

/** 统一的超限错误：一律归入来源体积类，并点名命中的预算与实际值。 */
export function budgetExceeded(archive: string, message: string, remedy: string): KernelError {
  return sourceError(CODES.SRC_TOO_LARGE, message, archive, remedy);
}

function describeBytes(value: number): string {
  return `${String(value)} 字节`;
}

/** 解压前检查归档文件自身大小。 */
export function assertArchiveFileSize(
  archive: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): void {
  let size: number;
  try {
    size = statSync(archive).size;
  } catch {
    // 读不到大小交给后续解析给出更准确的错误，这里不覆盖真实原因
    return;
  }
  if (size > limits.maxArchiveBytes) {
    throw budgetExceeded(
      archive,
      `归档文件体积超过上限：${describeBytes(size)}，上限 ${describeBytes(limits.maxArchiveBytes)}`,
      '该归档过大，已拒绝解压；请拆分内容后重新打包，或改用本地目录来源',
    );
  }
}

/**
 * 单次解压的预算账本。
 *
 * admitEntry 在解压前按声明值校验条目数与压缩比；
 * charge 在解压过程中按实际流出字节累加，兜住伪造的声明值。
 */
export class ArchiveBudget {
  private entries = 0;
  private total = 0;
  private readonly limits: ArchiveLimits;
  private readonly archive: string;
  private readonly now: ArchiveNow;
  private readonly startedAt: number;

  constructor(limits: ArchiveLimits, archive: string, now: ArchiveNow = monotonicArchiveMs) {
    this.limits = limits;
    this.archive = archive;
    this.now = now;
    this.startedAt = now();
  }

  /** 在可能阻塞的解压边界检查累计时间；超时与其他预算统一使用 E-SRC-008。 */
  assertTime(): void {
    const elapsed = this.now() - this.startedAt;
    if (elapsed > this.limits.maxExtractMs) {
      throw budgetExceeded(
        this.archive,
        `归档解压耗时超过上限：已用 ${String(Math.ceil(elapsed))} ms，上限 ${String(this.limits.maxExtractMs)} ms`,
        '该归档解压耗时过长，已中止；请拆分内容、检查压缩算法，或从可信来源重新获取',
      );
    }
  }

  /** 解压前登记一条条目：条目数、单条大小与压缩比。 */
  admitEntry(compressedSize: number, uncompressedSize: number): void {
    this.assertTime();
    this.entries += 1;
    if (this.entries > this.limits.maxEntries) {
      throw budgetExceeded(
        this.archive,
        `归档条目数超过上限：已出现第 ${String(this.entries)} 条，上限 ${String(this.limits.maxEntries)} 条`,
        '该归档条目过多，已拒绝解压；请拆分内容后重新打包',
      );
    }
    if (uncompressedSize > this.limits.maxEntryBytes) {
      throw budgetExceeded(
        this.archive,
        `归档单条解压大小超过上限：${describeBytes(uncompressedSize)}，上限 ${describeBytes(this.limits.maxEntryBytes)}`,
        '该归档含超大条目，已拒绝解压；请确认内容是否符合预期',
      );
    }
    this.assertRatio(compressedSize, uncompressedSize);
  }

  private assertRatio(compressedSize: number, uncompressedSize: number): void {
    if (uncompressedSize <= 0) return;
    // 压缩后为 0 而有内容，等同于无穷压缩比，直接按超限拒绝
    if (compressedSize <= 0) {
      throw budgetExceeded(
        this.archive,
        `归档条目压缩比异常：未压缩 ${describeBytes(uncompressedSize)}，压缩后 0 字节`,
        '该归档疑似压缩炸弹，已拒绝解压；请从可信来源重新获取',
      );
    }
    const ratio = uncompressedSize / compressedSize;
    if (ratio > this.limits.maxCompressionRatio) {
      throw budgetExceeded(
        this.archive,
        `归档条目压缩比超过上限：${String(Math.round(ratio))}:1，上限 ${String(this.limits.maxCompressionRatio)}:1`,
        '该归档疑似压缩炸弹，已拒绝解压；请从可信来源重新获取',
      );
    }
  }

  /** 解压过程中按实际写出字节累计，超出累计预算立即中止。 */
  charge(bytes: number): void {
    this.assertTime();
    this.total += bytes;
    if (this.total > this.limits.maxTotalBytes) {
      throw budgetExceeded(
        this.archive,
        `归档累计解压大小超过上限：已写出 ${describeBytes(this.total)}，上限 ${describeBytes(this.limits.maxTotalBytes)}`,
        '该归档解压后体积过大，已中止；请拆分内容后重新打包',
      );
    }
  }
}
