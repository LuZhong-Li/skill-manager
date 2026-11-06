import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../kernel/entry/cli.ts';
import { isolateHostEnvironment } from '../helpers/env.ts';
import { makeSkillSource } from '../helpers/skill.ts';
import { makeTempDir } from '../helpers/temp.ts';

interface FindingLike {
  code: string;
  severity: string;
  target: string;
  message: string;
  remedy: string;
}

async function capture(argv: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await run(argv), out: chunks.join('') };
  } finally {
    process.stdout.write = original;
  }
}

async function json(
  argv: string[],
): Promise<{ code: number; result: Record<string, unknown>; out: string }> {
  const captured = await capture([...argv, '--json']);
  return {
    code: captured.code,
    result: JSON.parse(captured.out) as Record<string, unknown>,
    out: captured.out,
  };
}

function findingsOf(result: Record<string, unknown>): FindingLike[] {
  return (result['findings'] ?? []) as FindingLike[];
}

function driftsOf(result: Record<string, unknown>): FindingLike[] {
  return findingsOf(result).filter((item) => item.code === 'W-DRIFT-001');
}

async function workspace(): Promise<string> {
  const root = makeTempDir('sm-update-sem-');
  assert.equal((await capture(['init', '--workspace', root])).code, 0);
  const source = makeSkillSource('drift-sem', {
    description: 'drift semantics fixture',
    content: '---\nname: drift-sem\ndescription: baseline content\n---\n\n# baseline\n',
  });
  assert.equal((await capture(['install', source, '--workspace', root, '--yes'])).code, 0);
  return root;
}

function editLibrary(root: string, description: string): void {
  writeFileSync(
    join(root, 'skills', 'drift-sem', 'SKILL.md'),
    `---\nname: drift-sem\ndescription: ${description}\n---\n\n# ${description}\n`,
  );
}

test('本地 update --check：中心库被改动时按真实漂移报告并给出两条出路', async (t) => {
  const root = await workspace();
  t.after(isolateHostEnvironment(root));
  editLibrary(root, 'local edit');

  const checked = await json(['update', 'drift-sem', '--check', '--workspace', root]);
  assert.equal(checked.code, 0, checked.out);
  const drifts = driftsOf(checked.result);
  assert.equal(drifts.length, 1, checked.out);
  const [drift] = drifts;
  assert.equal(drift?.target, 'drift-sem');

  assert.match(drift?.message ?? '', /中心库/, '必须说明差异来自中心库磁盘内容');
  assert.doesNotMatch(drift?.message ?? '', /本地内容与记录不一致/, '不得再用旧版泛化文案');
  assert.match(drift?.remedy ?? '', /scan/);
  assert.match(drift?.remedy ?? '', /update/);
});

test('本地 update --check：未改动中心库时不产生漂移', async (t) => {
  const root = await workspace();
  t.after(isolateHostEnvironment(root));

  const checked = await json(['update', 'drift-sem', '--check', '--workspace', root]);
  assert.equal(checked.code, 0, checked.out);
  assert.deepEqual(driftsOf(checked.result), [], checked.out);
});

test('update --check 只读：不写索引、不改动中心库', async (t) => {
  const root = await workspace();
  t.after(isolateHostEnvironment(root));
  editLibrary(root, 'local edit');

  const checked = await json(['update', 'drift-sem', '--check', '--workspace', root]);
  assert.equal(checked.code, 0, checked.out);

  const validated = await json(['validate', '--workspace', root]);
  const drifts = driftsOf(validated.result);
  assert.equal(drifts.length > 0, true, '基线未被 --check 刷新，真实漂移必须仍然存在');
  assert.ok(
    drifts.some((item) => item.target === 'drift-sem/SKILL.md'),
    '文件级漂移必须能定位到具体文件',
  );
});

test('成功 update：不携带更新前旧快照的 W-DRIFT-001，随后 validate 也无漂移', async (t) => {
  const root = await workspace();
  t.after(isolateHostEnvironment(root));
  editLibrary(root, 'refreshed before update');

  const updated = await json(['update', 'drift-sem', '--workspace', root, '--yes']);
  assert.equal(updated.code, 0, updated.out);
  assert.deepEqual(driftsOf(updated.result), [], updated.out);

  const validated = await json(['validate', '--workspace', root]);
  assert.equal(validated.code, 0, validated.out);
  assert.deepEqual(driftsOf(validated.result), [], '刷新后基线必须与磁盘重新对齐');
});

test('更新后篡改：validate 报告文件级真实漂移，而不是更新期旧快照告警', async (t) => {
  const root = await workspace();
  t.after(isolateHostEnvironment(root));
  editLibrary(root, 'refreshed before update');
  assert.equal((await capture(['update', 'drift-sem', '--workspace', root, '--yes'])).code, 0);

  editLibrary(root, 'tampered after update');
  const validated = await json(['validate', '--workspace', root]);
  assert.equal(validated.code, 0, validated.out);
  const drifts = driftsOf(validated.result);
  assert.ok(
    drifts.some((item) => item.target === 'drift-sem/SKILL.md'),
    validated.out,
  );
  const located = drifts.find((item) => item.target === 'drift-sem/SKILL.md');
  assert.match(located?.remedy ?? '', /重新扫描|恢复|备份/, '真实漂移必须给出可执行建议');
});
