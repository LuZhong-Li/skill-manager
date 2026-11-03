/**
 * 证据探查端到端测试：`pipeline run --probe-root` 把仓库定位结果写进文档与经验。
 *
 * 这些用例跑真实 CLI 入口（run），用隔离工作区与临时仓库，不触碰本仓库。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../kernel/entry/cli.ts';
import { layoutOf } from '../../kernel/store/workspace/index.ts';
import { listExperiences } from '../../kernel/core/experience/store.ts';
import { makeTempDir } from '../helpers/temp.ts';

/** 用隔离工作区跑一条命令，返回解析后的 JSON。 */
async function runJson(args: string[]): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run(['--json', ...args], {
      read: async () => '',
      write: () => {},
      confirm: async () => true,
    });
    const out = lines.join('');
    assert.equal(code, 0, `命令失败退出码 ${code}: ${out}`);
    const match = out.match(/\{[\s\S]*\}/);
    assert.ok(match !== null, `未找到 JSON 输出: ${out}`);
    const envelope = JSON.parse(match[0]) as Record<string, unknown>;
    // 结果封装：{ ok, data, findings, changes }，载荷在 data 下
    const data = envelope['data'];
    return (data !== null && typeof data === 'object' ? data : envelope) as Record<string, unknown>;
  } finally {
    process.stdout.write = original;
  }
}

/** 建一个临时工作区 + 一个可被探查的迷你仓库。 */
function makeFixture(): { workspace: string; repo: string } {
  const workspace = makeTempDir('probe-ws-');
  const repo = makeTempDir('probe-repo-');
  for (const [path, content] of Object.entries({
    'src/install.ts': 'export function install() {\n  throw new Error("boom");\n}\n',
    'src/unrelated.ts': 'export const value = 1;\n',
    'tests/install.test.ts': "import { install } from '../src/install.ts';\n",
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
  })) {
    const absolute = join(repo, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return { workspace, repo };
}

test('pipeline run --probe-root：文档包写入定位到的文件与命令', async () => {
  const { workspace, repo } = makeFixture();
  const result = await runJson([
    'pipeline',
    'run',
    '--problem',
    '安装时崩溃并报错',
    '--output-dir',
    join(workspace, 'out'),
    '--workspace',
    workspace,
    '--probe-root',
    repo,
  ]);
  const evidence = result['evidence'] as Record<string, unknown>;
  assert.equal(evidence['probed'], true);
  assert.equal(evidence['root'], repo);
  assert.ok((evidence['suspects'] as string[]).includes('src/install.ts'));

  const requirements = readFileSync(join(workspace, 'out', 'requirements.md'), 'utf8');
  assert.ok(requirements.includes('src/install.ts'), '需求文档必须写出定位到的文件');
  assert.ok(requirements.includes('npm run test'), '需求文档必须写出可执行命令');
});

test('pipeline run 不给 --probe-root：不探查，文档标注为推断', async () => {
  const { workspace } = makeFixture();
  const result = await runJson([
    'pipeline',
    'run',
    '--problem',
    '安装时崩溃并报错',
    '--output-dir',
    join(workspace, 'out'),
    '--workspace',
    workspace,
  ]);
  const evidence = result['evidence'] as Record<string, unknown>;
  assert.equal(evidence['probed'], false);
  const requirements = readFileSync(join(workspace, 'out', 'requirements.md'), 'utf8');
  assert.ok(requirements.includes('未探查仓库'));
});

test('探查结果记入经验，且经验仍写在工作区而非被探查的仓库里', async () => {
  const { workspace, repo } = makeFixture();
  await runJson([
    'pipeline',
    'run',
    '--problem',
    '安装时崩溃并报错',
    '--output-dir',
    join(workspace, 'out'),
    '--workspace',
    workspace,
    '--probe-root',
    repo,
  ]);
  const layout = layoutOf(workspace);
  const records = listExperiences(layout.experiencesDir);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.evidence?.root, repo);
  assert.ok(records[0]?.evidence?.suspects.includes('src/install.ts'));
  // 不得污染被探查的仓库
  assert.equal(existsSync(join(repo, 'experiences')), false, '被探查的仓库不应写入经验目录');
});

test('--dry-run 也带证据，但不写任何文件', async () => {
  const { workspace, repo } = makeFixture();
  const result = await runJson([
    'pipeline',
    'run',
    '--problem',
    '安装时崩溃并报错',
    '--output-dir',
    join(workspace, 'out'),
    '--workspace',
    workspace,
    '--probe-root',
    repo,
    '--dry-run',
  ]);
  assert.equal(result['dry_run'], true);
  const evidence = result['evidence'] as Record<string, unknown>;
  assert.equal(evidence['probed'], true);
  assert.equal(existsSync(join(workspace, 'out')), false);
  assert.equal(listExperiences(layoutOf(workspace).experiencesDir).length, 0);
});
