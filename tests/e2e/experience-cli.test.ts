/** 经验回归端到端测试：pipeline run 自动累计 + experience 命令查询。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../kernel/entry/cli.ts';
import { layoutOf } from '../../kernel/store/workspace/index.ts';
import { listExperiences, loadExperience } from '../../kernel/core/experience/store.ts';
import { makeTempDir } from '../helpers/temp.ts';

function tempDir(prefix: string): string {
  return makeTempDir(prefix);
}

/** 用隔离工作区跑一条命令，返回 JSON 结果。 */
async function runJson(workspace: string, args: string[]): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    process.env.SKILL_MANAGER_HOME = workspace;
    const code = await run(['--json', ...args], {
      read: async () => '',
      write: () => {},
      confirm: async () => true,
    });
    assert.equal(code, 0, `命令失败退出码 ${code}: ${lines.join('')}`);
  } finally {
    process.stdout.write = original;
    delete process.env.SKILL_MANAGER_HOME;
  }
  const out = lines.join('');
  const match = out.match(/\{[\s\S]*\}/);
  assert.ok(match !== null, `未找到 JSON 输出: ${out}`);
  return JSON.parse(match[0]);
}

/** 不设环境变量，仅靠 --workspace 定位工作区跑一条命令（验证选项真正生效）。 */
async function runJsonExplicit(args: string[]): Promise<Record<string, unknown>> {
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
    assert.equal(code, 0, `命令失败退出码 ${code}: ${lines.join('')}`);
  } finally {
    process.stdout.write = original;
  }
  const out = lines.join('');
  const match = out.match(/\{[\s\S]*\}/);
  assert.ok(match !== null, `未找到 JSON 输出: ${out}`);
  return JSON.parse(match[0]);
}

test('experience 查询命令遵循 --workspace（不依赖环境变量）', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJsonExplicit(['init', '--workspace', ws]);
  await runJsonExplicit([
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
    '--workspace',
    ws,
    '--host',
    'claude',
  ]);

  const list = await runJsonExplicit(['experience', 'list', '--workspace', ws]);
  const listData = list['data'] as Record<string, unknown>;
  assert.equal(listData['count'], 1, '默认工作区不应成为唯一查找位置');
  const first = (listData['experiences'] as Array<Record<string, unknown>>)[0];
  assert.equal(first['host'], 'claude');

  const id = String(first['id']);
  const search = await runJsonExplicit([
    'experience',
    'search',
    '--query',
    '数据看板',
    '--workspace',
    ws,
  ]);
  assert.equal((search['data'] as Record<string, unknown>)['count'], 1);

  const show = await runJsonExplicit(['experience', 'show', id, '--workspace', ws]);
  const showData = show['data'] as Record<string, unknown>;
  assert.equal(showData['id'], id);
  assert.equal(showData['host'], 'claude');
});

test('pipeline run 完成后自动累计一条经验', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJson(ws, ['init']);

  const result = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个内部工具',
    '--output-dir',
    outDir,
    '--answers',
    'q1=内部用户',
    '--answers',
    'q2=流程自动化',
    '--answers',
    'q3=无硬约束',
  ]);

  const data = result['data'] as Record<string, unknown>;
  assert.ok(data['experience_id'] !== undefined, '返回 experience_id');
  const id = String(data['experience_id']);

  const layout = layoutOf(ws);
  assert.ok(existsSync(join(layout.experiencesDir, `${id}.yaml`)), '经验文件已写入');
  const record = loadExperience(layout.experiencesDir, id);
  assert.ok(record !== null);
  assert.equal(record.problem, '做一个内部工具');
  assert.equal(record.kind, 'new-feature');
  assert.ok(record.decisions.length >= 3);
  assert.ok(record.stages.includes('requirements'));
});

test('experience list 列出累计的经验', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJson(ws, ['init']);
  await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
    '--answers',
    'q1=运营',
    '--answers',
    'q2=实时刷新',
    '--answers',
    'q3=兼容旧接口',
  ]);

  const result = await runJson(ws, ['experience', 'list']);
  const data = result['data'] as Record<string, unknown>;
  assert.equal(data['count'], 1);
  const list = data['experiences'] as Array<{ problem: string }>;
  assert.equal(list[0].problem, '做一个数据看板');
});

test('experience search 按关键词命中累计经验', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJson(ws, ['init']);
  await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
    '--answers',
    'q1=运营',
    '--answers',
    'q2=实时刷新',
    '--answers',
    'q3=兼容旧接口',
  ]);

  const hit = await runJson(ws, ['experience', 'search', '--query', '数据看板']);
  const hitData = hit['data'] as Record<string, unknown>;
  assert.equal(hitData['count'], 1);

  const miss = await runJson(ws, ['experience', 'search', '--query', '不存在的词']);
  const missData = miss['data'] as Record<string, unknown>;
  assert.equal(missData['count'], 0);
});

test('pipeline run --experience 预填相似经验问答', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJson(ws, ['init']);
  // 第一次处理，累计经验
  await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
    '--answers',
    'q1=运营',
    '--answers',
    'q2=实时刷新',
    '--answers',
    'q3=兼容旧接口',
  ]);

  // 第二次相似问题，用 --experience 预填（不带 --answers）
  const secondOut = tempDir('sm-exp-out2-');
  const result = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个运营数据看板',
    '--output-dir',
    secondOut,
    '--experience',
    '数据看板',
  ]);
  const data = result['data'] as Record<string, unknown>;
  assert.equal(data['experience_applied'], true, '经验应已应用');
  // 第二次也累计了新经验
  const layout = layoutOf(ws);
  assert.equal(listExperiences(layout.experiencesDir).length, 2);
});

test('宿主画像：同宿主重复处理自动预填，换宿主不串味', async () => {
  const ws = tempDir('sm-exp-ws-');
  await runJson(ws, ['init']);
  // 第一次：在 claude 宿主上带回答处理，累计带宿主的经验
  await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    tempDir('sm-exp-out1-'),
    '--host',
    'claude',
    '--answers',
    'q1=运营',
    '--answers',
    'q2=实时刷新',
    '--answers',
    'q3=兼容旧接口',
  ]);

  // 第二次：同宿主、不带回答 -> 由画像自动预填
  const second = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '再做一个月度报表看板',
    '--output-dir',
    tempDir('sm-exp-out2-'),
    '--host',
    'claude',
  ]);
  const secondData = second['data'] as Record<string, unknown>;
  const adapted = secondData['experience_adapted'] as Record<string, unknown>;
  assert.equal(adapted['host'], 'claude');
  assert.equal(adapted['sample_size'], 1);
  assert.deepEqual(adapted['prefilled_questions'], ['q1', 'q2', 'q3']);
  assert.equal(secondData['experience_applied'], true);

  // 第三次：换一个宿主 -> 不应读取 claude 的经验
  const third = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '再做一个月度报表看板',
    '--output-dir',
    tempDir('sm-exp-out3-'),
    '--host',
    'cursor',
  ]);
  const thirdAdapted = (third['data'] as Record<string, unknown>)['experience_adapted'] as Record<
    string,
    unknown
  >;
  assert.deepEqual(thirdAdapted['prefilled_questions'], []);
  assert.equal(thirdAdapted['sample_size'], 0);
});

test('pipeline run --dry-run 零写入（不产出文件、不记经验）', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = join(tempDir('sm-exp-dry-'), 'out');
  await runJson(ws, ['init']);
  const result = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
    '--dry-run',
  ]);
  const data = result['data'] as Record<string, unknown>;
  assert.equal(data['dry_run'], true);
  assert.equal(data['applied'], false);
  assert.equal(data['experience_id'], null);
  assert.equal(existsSync(outDir), false, '--dry-run 不应创建输出目录');
  assert.equal(listExperiences(layoutOf(ws).experiencesDir).length, 0, '--dry-run 不应写经验');
});

test('损坏经验文件不阻塞 pipeline run 与 experience list', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJson(ws, ['init']);
  const experiencesDir = layoutOf(ws).experiencesDir;
  mkdirSync(experiencesDir, { recursive: true });
  writeFileSync(join(experiencesDir, 'exp-broken.yaml'), 'kind: [unclosed\n  bad: : :\n', 'utf8');

  const run = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
  ]);
  const runData = run['data'] as Record<string, unknown>;
  assert.equal(runData['unreadable_experiences'], 1, '结果中报告不可读经验数量');

  const list = await runJson(ws, ['experience', 'list']);
  const listData = list['data'] as Record<string, unknown>;
  assert.equal(listData['count'], 1, '损坏文件被跳过，正常记录仍可见');
});

test('输出目录非法时返回可读问题码而不是崩溃栈', async () => {
  const ws = tempDir('sm-exp-ws-');
  const pathAsFile = join(tempDir('sm-exp-file-'), 'out.txt');
  writeFileSync(pathAsFile, 'x');

  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let code = 0;
  try {
    code = await run(
      [
        '--json',
        'pipeline',
        'run',
        '--problem',
        '做一个报表',
        '--output-dir',
        pathAsFile,
        '--workspace',
        ws,
      ],
      { read: async () => '', write: () => {}, confirm: async () => true },
    );
  } finally {
    process.stdout.write = original;
  }
  const match = lines.join('').match(/\{[\s\S]*\}/);
  assert.ok(match !== null, '失败时也应返回结构化结果');
  const result = JSON.parse(match[0]) as Record<string, unknown>;
  assert.notEqual(code, 0);
  assert.equal(result['ok'], false);
  const findings = result['findings'] as Array<Record<string, unknown>>;
  assert.ok(findings.length > 0, '写盘失败应转为问题码');
  assert.equal(typeof findings[0]['code'], 'string');
});

test('experience show 查看单条经验详情', async () => {
  const ws = tempDir('sm-exp-ws-');
  const outDir = tempDir('sm-exp-out-');
  await runJson(ws, ['init']);
  const result = await runJson(ws, [
    'pipeline',
    'run',
    '--problem',
    '做一个数据看板',
    '--output-dir',
    outDir,
    '--answers',
    'q1=运营',
    '--answers',
    'q2=实时刷新',
    '--answers',
    'q3=兼容旧接口',
  ]);
  const id = String((result['data'] as Record<string, unknown>)['experience_id']);

  const show = await runJson(ws, ['experience', 'show', id]);
  const data = show['data'] as Record<string, unknown>;
  assert.equal(data['id'], id);
  assert.equal(data['problem'], '做一个数据看板');
  assert.ok(Array.isArray(data['decisions']));
  assert.equal(readdirSync(layoutOf(ws).experiencesDir).length, 1);
});
