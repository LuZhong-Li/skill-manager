/**
 * M7-T2：落位事务归属与原子切换。
 *
 * 关注点不是「回滚能恢复」，而是「回滚只动自己写的东西」：
 * 账本写入失败时，若第三方在这段时间往同一副本目录放了文件，
 * 递归删除会把别人的数据一起抹掉。此类失败因此必须按归属清理。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor } from '../../kernel/core/adapters/index.ts';
import { rebasePlan } from '../../kernel/core/adapters/plan.ts';
import { landPlan, rollbackLandWrites } from '../../kernel/core/adapters/land.ts';
import { ensureWorkspaceDirs, layoutOf } from '../../kernel/store/workspace/index.ts';
import type { RenderSource } from '../../kernel/core/render/types.ts';
import { makeHostRoot } from '../helpers/host.ts';
import { makeTempDir } from '../helpers/temp.ts';

const NOW = '2026-10-18T00:00:00Z';

function source(id = 'txn-skill'): RenderSource {
  return { id, description: '事务测试', body: '# 新内容\n' };
}

function workspace(): string {
  const dir = makeTempDir('sm-txn-ws-');
  ensureWorkspaceDirs(layoutOf(dir));
  return dir;
}

function sourceDir(id = 'txn-skill'): string {
  const dir = makeTempDir('sm-txn-src-');
  writeFileSync(join(dir, 'SKILL.md'), '# 新内容\n');
  writeFileSync(join(dir, 'asset.txt'), 'new asset\n');
  writeFileSync(join(dir, 'skill_meta.yaml'), `id: ${id}\n`);
  return dir;
}

function stagingLeftovers(hostRoot: string): string[] {
  return readdirSync(hostRoot).filter(
    (name) => name.includes('.staging-') || name.endsWith('.previous'),
  );
}

test('M7-T2 回滚：无备份时只删本事务写入的条目，第三方文件保留', () => {
  const ws = workspace();
  const hostRoot = makeHostRoot('sm-txn-host-');
  const copyDir = join(hostRoot, 'txn-skill');
  const plan = rebasePlan(adapterFor('claude')!.plan(source()), hostRoot, true);
  const landed = landPlan({ plan, workspace: layoutOf(ws), now: NOW, sourceDir: sourceDir() });
  assert.equal(existsSync(join(copyDir, 'SKILL.md')), true);

  // 模拟另一个参与方在落位之后、账本写入之前往副本目录放了文件
  writeFileSync(join(copyDir, 'foreign.txt'), '别人的数据\n');

  rollbackLandWrites(landed.writes);
  assert.equal(existsSync(join(copyDir, 'SKILL.md')), false, '本事务写入的文件应被移除');
  assert.equal(existsSync(join(copyDir, 'asset.txt')), false, '本事务写入的资产应被移除');
  assert.equal(
    readFileSync(join(copyDir, 'foreign.txt'), 'utf8'),
    '别人的数据\n',
    '第三方文件不得被回滚删除',
  );
  assert.equal(existsSync(copyDir), true, '目录因他人文件非空，不得被整体删除');
});

test('M7-T2 落位：组装失败时不暴露半成品，也不残留临时目录', () => {
  const ws = workspace();
  const hostRoot = makeHostRoot('sm-txn-host-');
  const copyDir = join(hostRoot, 'txn-skill');
  const plan = rebasePlan(adapterFor('claude')!.plan(source()), hostRoot, true);
  assert.throws(() =>
    landPlan({
      plan,
      workspace: layoutOf(ws),
      now: NOW,
      sourceDir: sourceDir(),
      // 映射到不存在的源文件：落位必须在组装阶段失败
      fileMap: [{ source: 'missing.txt', destination: 'missing.txt' }],
    }),
  );
  assert.equal(existsSync(copyDir), false, '失败不得留下可见副本');
  assert.deepEqual(stagingLeftovers(hostRoot), [], '失败后必须清理组装目录');
});

test('M7-T2 落位：原子切换后既有副本中未被映射的文件保留', () => {
  const ws = workspace();
  const hostRoot = makeHostRoot('sm-txn-host-');
  const copyDir = join(hostRoot, 'txn-skill');
  mkdirSync(copyDir, { recursive: true });
  writeFileSync(join(copyDir, 'SKILL.md'), '# 旧内容\n');
  writeFileSync(join(copyDir, 'old.txt'), 'old asset\n');

  const plan = rebasePlan(adapterFor('claude')!.plan(source()), hostRoot, true);
  landPlan({
    plan,
    workspace: layoutOf(ws),
    now: NOW,
    sourceDir: sourceDir(),
    fileMap: [{ source: 'SKILL.md', destination: 'SKILL.md' }],
  });
  assert.match(readFileSync(join(copyDir, 'SKILL.md'), 'utf8'), /# 新内容/);
  assert.equal(readFileSync(join(copyDir, 'old.txt'), 'utf8'), 'old asset\n', '落位是合并而非清空');
  assert.equal(existsSync(join(copyDir, 'asset.txt')), false, '未映射的资产不进入副本');
  assert.deepEqual(stagingLeftovers(hostRoot), [], '切换完成后不得残留临时目录');
});

test('M7-T2 落位：每次落位带事务标识，写入记录归属同一事务', () => {
  const ws = workspace();
  const hostRoot = makeHostRoot('sm-txn-host-');
  const plan = rebasePlan(adapterFor('claude')!.plan(source()), hostRoot, true);
  const explicit = landPlan({
    plan,
    workspace: layoutOf(ws),
    now: NOW,
    sourceDir: sourceDir(),
    transactionId: 'txn-fixed-0001',
  });
  assert.equal(explicit.writes.length, 1);
  assert.equal(explicit.writes[0]!.transaction_id, 'txn-fixed-0001', '显式事务标识应被沿用');
  assert.ok(explicit.writes[0]!.owned_entries.includes('SKILL.md'), '应记录归属条目');

  const auto = landPlan({
    plan: rebasePlan(adapterFor('claude')!.plan(source('txn-skill-2')), hostRoot, true),
    workspace: layoutOf(ws),
    now: NOW,
    sourceDir: sourceDir('txn-skill-2'),
  });
  assert.match(auto.writes[0]!.transaction_id, /^[0-9a-f-]{36}$/, '缺省应生成事务标识');
});

test('M7-T2 回滚：规则文件失败时只清理本事务新建的目录层级', () => {
  const ws = workspace();
  const rulesRoot = makeHostRoot('sm-txn-rules-');
  // 把落位根指到新建的子目录：落位会逐级创建，回滚应只清理这些空层级
  const nestedRoot = join(rulesRoot, 'nested', 'deeper');
  const target = join(nestedRoot, 'txn-skill.mdc');
  const plan = rebasePlan(adapterFor('cursor')!.plan(source(), 'rules'), nestedRoot, true);
  const landed = landPlan({ plan, workspace: layoutOf(ws), now: NOW, sourceDir: sourceDir() });
  const ruleWrite = landed.writes.find((write) => write.artifact_kind !== 'skill_md');
  assert.ok(ruleWrite !== undefined, '应存在规则文件写入记录');
  assert.ok(ruleWrite.created_dirs.length > 0, '应记录本事务新建的父目录');
  assert.equal(existsSync(target), true);

  // 第三方在回滚前往上层目录放入文件，回滚不得删除该目录
  writeFileSync(join(rulesRoot, 'nested', 'foreign.txt'), '别人的数据\n');
  rollbackLandWrites(landed.writes);
  assert.equal(existsSync(target), false, '本事务写入的规则文件应被移除');
  assert.equal(existsSync(join(nestedRoot)), false, '本事务新建的空目录应被清理');
  assert.equal(
    readFileSync(join(rulesRoot, 'nested', 'foreign.txt'), 'utf8'),
    '别人的数据\n',
    '第三方文件不得被回滚删除',
  );
  assert.equal(existsSync(join(rulesRoot, 'nested')), true, '含第三方文件的目录必须保留');
});
