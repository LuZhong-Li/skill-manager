import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import * as tar from 'tar';
import { CODES } from '@skill-manager/contract';
import {
  extractTar,
  extractZip,
  type ArchiveLimits,
} from '../../kernel/core/lifecycle/source-archive.ts';
import { makeTempDir } from '../helpers/temp.ts';

const SMALL_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 1024 * 1024,
  maxEntries: 2,
  maxEntryBytes: 8,
  maxTotalBytes: 12,
  maxCompressionRatio: 100,
};

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** 最小存储式 ZIP 写入器：只生产受控安全测试夹具。 */
function writeZip(archive: string, entries: Array<{ name: string; data: Buffer }>): void {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  writeFileSync(archive, Buffer.concat([localPart, centralPart, end]));
}

async function rejectsTooLarge(task: () => Promise<void>): Promise<void> {
  await assert.rejects(
    task,
    (error: unknown) => (error as { code?: string }).code === CODES.SRC_TOO_LARGE,
  );
}

/** 造一条 deflate 压缩条目：用于验证压缩比防线（存储式夹具的压缩比恒为 1）。 */
function writeDeflatedZip(archive: string, name: string, raw: Buffer): void {
  const compressed = deflateRawSync(raw);
  const crc = crc32(raw);
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  nameBuf.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  writeFileSync(archive, Buffer.concat([local, compressed, central, end]));
}

function outputDir(root: string): string {
  const out = join(root, 'out');
  mkdirSync(out);
  return out;
}

test('M7-T0：ZIP 条目数超过预算时，在解压前拒绝', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const archive = join(root, 'many.zip');
  writeZip(archive, [
    { name: 'a.txt', data: Buffer.from('a') },
    { name: 'b.txt', data: Buffer.from('b') },
    { name: 'c.txt', data: Buffer.from('c') },
  ]);
  await rejectsTooLarge(() => extractZip(archive, outputDir(root), SMALL_LIMITS));
});

test('M7-T0：ZIP 单条解压大小超过预算时拒绝', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const archive = join(root, 'entry.zip');
  writeZip(archive, [{ name: 'large.txt', data: Buffer.alloc(9) }]);
  await rejectsTooLarge(() => extractZip(archive, outputDir(root), SMALL_LIMITS));
});

test('M7-T0：ZIP 累计解压大小超过预算时拒绝', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const archive = join(root, 'total.zip');
  writeZip(archive, [
    { name: 'a.txt', data: Buffer.alloc(7) },
    { name: 'b.txt', data: Buffer.alloc(7) },
  ]);
  await rejectsTooLarge(() => extractZip(archive, outputDir(root), SMALL_LIMITS));
});

test('M7-T0：TAR 单条解压大小超过预算时拒绝', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const stage = join(root, 'stage');
  mkdirSync(stage);
  writeFileSync(join(stage, 'large.txt'), Buffer.alloc(9));
  const archive = join(root, 'large.tar');
  await tar.c({ file: archive, cwd: stage }, ['large.txt']);
  await rejectsTooLarge(() => extractTar(archive, outputDir(root), SMALL_LIMITS));
});

test('M7-T0：预算内 ZIP 可流式解压，内容完整', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const archive = join(root, 'safe.zip');
  writeZip(archive, [{ name: 'safe.txt', data: Buffer.from('safe') }]);
  await extractZip(archive, outputDir(root), SMALL_LIMITS);
  assert.equal(readFileSync(join(root, 'out', 'safe.txt'), 'utf8'), 'safe');
});

test('M7-T0：ZIP 压缩比超过上限时按压缩炸弹拒绝', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const archive = join(root, 'bomb.zip');
  // 8 字节可压缩内容：未压缩大小在单条预算内，但压缩比远超上限
  writeDeflatedZip(archive, 'bomb.txt', Buffer.alloc(8));
  const limits: ArchiveLimits = { ...SMALL_LIMITS, maxCompressionRatio: 1 };
  await rejectsTooLarge(() => extractZip(archive, outputDir(root), limits));
});

test('M7-T0：伪造声明的 ZIP 在实际字节越界时中止并清理半截文件', async () => {
  const root = makeTempDir('sm-archive-limit-');
  const archive = join(root, 'liar.zip');
  // 声明 3 字节、实际写入 200 字节：只有按实际流出字节计数才能拦住
  writeDeflatedZip(archive, 'liar.txt', Buffer.from('x'.repeat(200)));
  const out = outputDir(root);
  const limits: ArchiveLimits = {
    maxArchiveBytes: 1024 * 1024,
    maxEntries: 10,
    maxEntryBytes: 50,
    maxTotalBytes: 100,
    maxCompressionRatio: 10000,
  };
  await assert.rejects(
    () => extractZip(archive, out, limits),
    (error: unknown) => (error as { code?: string }).code === CODES.SRC_TOO_LARGE,
  );
  assert.equal(existsSync(join(out, 'liar.txt')), false, '越界条目不得留下半截文件');
});
