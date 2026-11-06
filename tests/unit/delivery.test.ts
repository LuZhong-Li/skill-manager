import { makeTempDir } from '../helpers/temp.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installSkill, uninstallSkill, updateSkill } from '../../kernel/core/lifecycle/index.ts';
import { createInitialIndex } from '../../kernel/core/index/index.ts';
import { layoutOf, ensureWorkspaceDirs } from '../../kernel/store/workspace/index.ts';
import { CODES } from '@skill-manager/contract';
import { copyPathOf } from '../../kernel/core/metadata/targets.ts';

const NOW = '2026-10-15T00:00:00Z';
const LATER = '2026-10-15T04:00:00Z';

function workspace(): string {
  const root = makeTempDir('sm-delivery-');
  ensureWorkspaceDirs(layoutOf(root));
  return root;
}

/** 造一份带 targets 声明的来源目录；targets 由调用方给出，便于覆盖各种落位场景 */
function sourceSkill(id: string, targets: string[], files: Record<string, string> = {}): string {
  const dir = makeTempDir('sm-delivery-src-');
  writeFileSync(join(dir, 'SKILL.md'), '# skill');
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  writeFileSync(
    join(dir, 'skill_meta.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      'status: enabled',
      `path: ./skills/${id}`,
      'source:',
      '  type: local',
      'targets:',
      ...targets.flatMap((target) => [
        `  - target: ${target}`,
        '    scope: global',
        `    path: ${copyPathOf(target, id)}`,
        '    mode: copy',
        '    enabled: true',
      ]),
      '',
    ].join('\n'),
  );
  return dir;
}

async function install(root: string, source: string, extra: Record<string, unknown> = {}) {
  return await installSkill({
    layout: layoutOf(root),
    index: createInitialIndex(NOW),
    sourcePath: source,
    now: NOW,
    ...extra,
  });
}

test('N-02：install 只向 --target 指定的目标分发', async () => {
  const root = workspace();
  const outcome = await install(root, sourceSkill('multi', ['claude', 'codex']), {
    target: 'codex',
  });
  assert.deepEqual(outcome.findings, []);
  assert.ok(!existsSync(join(root, '.claude', 'skills', 'multi')), '未指定的目标不分发');
  assert.ok(existsSync(join(root, '.codex', 'skills', 'multi', 'SKILL.md')), '指定的目标被分发');
  assert.deepEqual(outcome.data['selected_targets'], ['codex']);
});

test('N-02：--target 指定未声明的目标时按参数类问题拒绝', async () => {
  const root = workspace();
  const outcome = await install(root, sourceSkill('multi', ['claude']), { target: 'cursor' });
  assert.deepEqual(
    outcome.findings.map((item) => item.code),
    [CODES.INPUT_INVALID_ARG],
  );
  assert.match(String(outcome.findings[0]?.remedy), /claude/);
});

test('N-02：--scope 过滤目标，缺省时全部分发', async () => {
  const root = workspace();
  const source = sourceSkill('scoped', ['claude']);
  const outcome = await install(root, source, { scope: 'project' });
  assert.deepEqual(
    outcome.findings.map((item) => item.code),
    [CODES.INPUT_INVALID_ARG],
    '声明中没有 project 作用域的目标',
  );

  const all = await install(root, source);
  assert.deepEqual(all.findings, []);
  assert.ok(existsSync(join(root, '.claude', 'skills', 'scoped', 'SKILL.md')));
});

test('N-03：提供 file_map 时只落位映射表列出的文件', async () => {
  const root = workspace();
  const source = makeTempDir('sm-delivery-map-');
  writeFileSync(join(source, 'SKILL.md'), '# skill');
  writeFileSync(join(source, 'extra.md'), '# extra');
  writeFileSync(
    join(source, 'skill_meta.yaml'),
    [
      'id: mapped',
      'name: mapped',
      'status: enabled',
      'path: ./skills/mapped',
      'source:',
      '  type: local',
      'targets:',
      '  - target: claude',
      '    scope: global',
      `    path: ${copyPathOf('claude', 'mapped')}`,
      '    mode: copy',
      '    enabled: true',
      '    file_map:',
      '      SKILL.md: SKILL.md',
      '      extra.md: docs/extra.md',
      '',
    ].join('\n'),
  );

  const outcome = await install(root, source);
  assert.deepEqual(outcome.findings, []);
  const copy = join(root, '.claude', 'skills', 'mapped');
  assert.ok(existsSync(join(copy, 'SKILL.md')), '映射内的文件被落位');
  assert.ok(existsSync(join(copy, 'docs', 'extra.md')), '映射支持目标子目录');
  assert.ok(!existsSync(join(copy, 'skill_meta.yaml')), '映射外的文件不落位');
  assert.deepEqual(outcome.data['delivery'], [
    {
      target: 'claude',
      scope: 'global',
      path: copyPathOf('claude', 'mapped'),
      file_count: 2,
      files: [
        `${copyPathOf('claude', 'mapped')}/SKILL.md`,
        `${copyPathOf('claude', 'mapped')}/docs/extra.md`,
      ],
    },
  ]);
});

test('N-03：缺省 file_map 时整目录复制', async () => {
  const root = workspace();
  const source = makeTempDir('sm-delivery-plain-');
  writeFileSync(join(source, 'SKILL.md'), '# skill');
  writeFileSync(join(source, 'reference.md'), '# ref');
  writeFileSync(
    join(source, 'skill_meta.yaml'),
    [
      'id: plain',
      'name: plain',
      'status: enabled',
      'path: ./skills/plain',
      'source:',
      '  type: local',
      'targets:',
      '  - target: claude',
      '    scope: global',
      `    path: ${copyPathOf('claude', 'plain')}`,
      '    mode: copy',
      '    enabled: true',
      '',
    ].join('\n'),
  );
  const outcome = await install(root, source);
  assert.deepEqual(outcome.findings, []);
  const copy = join(root, '.claude', 'skills', 'plain');
  assert.ok(existsSync(join(copy, 'SKILL.md')));
  assert.ok(existsSync(join(copy, 'reference.md')), '整目录复制时附属文件一并落位');
  assert.ok(existsSync(join(copy, 'skill_meta.yaml')), '整目录复制时连元文件一并落位');
});

test('N-09：原件缺失时副本仍按约定被回收，且有逐文件清单', async () => {
  const root = workspace();
  const installed = await install(root, sourceSkill('gone', ['claude']));
  assert.deepEqual(installed.findings, []);
  const copy = join(root, '.claude', 'skills', 'gone');
  writeFileSync(join(copy, 'extra.md'), '# extra');
  // 原件整体消失：这是 N-09 描述的场景
  rmSync(join(root, 'skills', 'gone'), { recursive: true, force: true });

  const outcome = uninstallSkill({
    layout: layoutOf(root),
    index: installed.index,
    id: 'gone',
    now: LATER,
  });
  assert.deepEqual(outcome.findings, []);
  assert.deepEqual(outcome.data['removed_copies'], [copyPathOf('claude', 'gone')]);
  assert.deepEqual(outcome.data['removed_files'], [
    `${copyPathOf('claude', 'gone')}/SKILL.md`,
    `${copyPathOf('claude', 'gone')}/extra.md`,
    `${copyPathOf('claude', 'gone')}/skill_meta.yaml`,
  ]);
  assert.equal(outcome.data['removed_file_count'], 3, '缺省映射时副本是整目录复制');
  assert.ok(!existsSync(copy), '副本已被回收');
});

test('N-11：刷新会把副本内容一并更新，且保持副本原有可见性', async () => {
  const root = workspace();
  const source = sourceSkill('refresh', ['claude']);
  const installed = await install(root, source);
  assert.deepEqual(installed.findings, []);
  const copy = join(root, '.claude', 'skills', 'refresh');
  writeFileSync(join(copy, 'SKILL.md'), '# 旧的副本内容');

  const outcome = await updateSkill({
    layout: layoutOf(root),
    index: installed.index,
    id: 'refresh',
    now: LATER,
  });
  assert.deepEqual(outcome.findings, []);
  assert.equal(readFileSync(join(copy, 'SKILL.md'), 'utf8'), '# skill', '副本内容被重分发覆盖');
  assert.equal(outcome.data['copies'] instanceof Array, true);
  assert.equal((outcome.data['copies'] as unknown[]).length, 1);
});

test('N-11：重分发失败时刷新整体失败，不写索引', async () => {
  const root = workspace();
  const installed = await install(root, sourceSkill('locked', ['claude']));
  assert.deepEqual(installed.findings, []);
  // 把副本目录换成一个同名文件：重分发必然失败
  const copy = join(root, '.claude', 'skills', 'locked');
  rmSync(copy, { recursive: true, force: true });
  writeFileSync(copy, 'occupied');

  const outcome = await updateSkill({
    layout: layoutOf(root),
    index: installed.index,
    id: 'locked',
    now: LATER,
  });
  assert.equal(outcome.index, installed.index, '失败时索引原样返回，调用方不得写入');
  assert.equal(outcome.data['rejected'], 'redistribute_failed');
  assert.ok(outcome.findings.some((item) => item.severity === 'error'));
  const drift = outcome.findings.find((item) => item.code === CODES.DRIFT);
  assert.ok(drift !== undefined, '失败后必须说明索引基线仍是旧状态');
  assert.match(drift.message, /刷新未生效|索引基线仍为/);
  assert.match(drift.remedy, /重新执行 update/);
});

test('N-11：--target 只刷新指定目标的副本', async () => {
  const root = workspace();
  const installed = await install(root, sourceSkill('partial', ['claude', 'codex']));
  assert.deepEqual(installed.findings, []);
  writeFileSync(join(root, '.claude', 'skills', 'partial', 'SKILL.md'), '# 旧');
  writeFileSync(join(root, '.codex', 'skills', 'partial', 'SKILL.md'), '# 旧');

  const outcome = await updateSkill({
    layout: layoutOf(root),
    index: installed.index,
    id: 'partial',
    now: LATER,
    target: 'codex',
  });
  assert.deepEqual(outcome.findings, []);
  assert.equal(
    readFileSync(join(root, '.codex', 'skills', 'partial', 'SKILL.md'), 'utf8'),
    '# skill',
  );
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', 'partial', 'SKILL.md'), 'utf8'),
    '# 旧',
  );
});

test('落位根约定：任一目标标识都能推导出副本位置', async () => {
  const root = workspace();
  const outcome = await install(root, sourceSkill('derived', ['cursor']));
  assert.deepEqual(outcome.findings, []);
  assert.ok(existsSync(join(root, '.cursor', 'skills', 'derived', 'SKILL.md')));
});
