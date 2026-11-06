/**
 * M7-T1 验收：两个独立 CLI 进程并发写同一工作区。
 *
 * 锁的价值不在于「不报错」，而在于并发下索引仍然可解析、账本与副本一致、
 * 且冲突判定不被同时通过的检查绕过。因此这里用真实子进程，而不是同进程并发。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../kernel/entry/cli.ts';
import { loadIndex } from '../../kernel/core/index/index.ts';
import { workspaceLockFile } from '../../kernel/store/locking/index.ts';
import { indexPath, sourceSkill, workspace } from '../helpers/cli.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../kernel/entry/cli.ts', import.meta.url));

function runCliAsync(argv: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    child.on('exit', (code) => resolve({ code: code ?? -1, out: chunks.join('') }));
  });
}

test('M7-T1 验收：两个进程并发安装不同 Skill，索引与中心库保持一致', async () => {
  const root = workspace();
  assert.equal(await run(['init', '--workspace', root]), 0);
  const [first, second] = await Promise.all([
    runCliAsync(['install', sourceSkill('alpha'), '--workspace', root, '--yes']),
    runCliAsync(['install', sourceSkill('beta'), '--workspace', root, '--yes']),
  ]);
  assert.equal(first.code, 0, `alpha 安装应成功：${first.out}`);
  assert.equal(second.code, 0, `beta 安装应成功：${second.out}`);

  const loaded = loadIndex(indexPath(root));
  assert.notEqual(loaded.index, null, '并发写后索引必须仍可解析');
  assert.deepEqual(loaded.findings, [], '并发写后索引不应出现解析问题');
  const ids = (loaded.index as { skills: Array<{ id: string }> }).skills.map((item) => item.id);
  assert.deepEqual([...ids].sort(), ['alpha', 'beta'], '两条记录都要在索引里，且不重复');
  for (const id of ['alpha', 'beta']) {
    assert.ok(existsSync(join(root, 'skills', id, 'SKILL.md')), `${id} 的中心库副本应完整`);
    assert.ok(
      existsSync(join(root, '.claude', 'skills', id, 'SKILL.md')),
      `${id} 的宿主副本应完整`,
    );
  }
  assert.equal(existsSync(workspaceLockFile(root)), false, '结束后不得残留锁文件');
});

test('M7-T1 验收：两个进程并发安装同一 Skill，只有一个成功且只登记一次', async () => {
  const root = workspace();
  assert.equal(await run(['init', '--workspace', root]), 0);
  const sourceA = sourceSkill('dup');
  const sourceB = sourceSkill('dup');
  const [first, second] = await Promise.all([
    runCliAsync(['install', sourceA, '--workspace', root, '--yes']),
    runCliAsync(['install', sourceB, '--workspace', root, '--yes']),
  ]);
  const codes = [first.code, second.code].sort();
  assert.deepEqual(codes, [0, 1], '一个成功、一个冲突，不能两个都成功');

  const loaded = loadIndex(indexPath(root));
  assert.notEqual(loaded.index, null);
  const ids = (loaded.index as { skills: Array<{ id: string }> }).skills.map((item) => item.id);
  assert.deepEqual(ids, ['dup'], '索引里只能有一条 dup 记录');
  assert.match(readFileSync(indexPath(root), 'utf8'), /id: dup/);
});

test('M7-T1 验收：并发安装与卸载串行化，落位账本与索引一致', async () => {
  const root = workspace();
  assert.equal(await run(['init', '--workspace', root]), 0);
  assert.equal(await run(['install', sourceSkill('gamma'), '--workspace', root, '--yes']), 0);
  const [removed, installed] = await Promise.all([
    runCliAsync(['uninstall', 'gamma', '--workspace', root, '--yes']),
    runCliAsync(['install', sourceSkill('delta'), '--workspace', root, '--yes']),
  ]);
  assert.equal(removed.code, 0, `卸载应成功：${removed.out}`);
  assert.equal(installed.code, 0, `安装应成功：${installed.out}`);

  const loaded = loadIndex(indexPath(root));
  assert.notEqual(loaded.index, null);
  const ids = (loaded.index as { skills: Array<{ id: string }> }).skills.map((item) => item.id);
  assert.deepEqual(ids, ['delta'], '卸载与安装都应生效，且只留下 delta');
  assert.equal(existsSync(join(root, '.claude', 'skills', 'gamma')), false, 'gamma 副本应已移除');
  assert.ok(existsSync(join(root, '.claude', 'skills', 'delta', 'SKILL.md')));
});
