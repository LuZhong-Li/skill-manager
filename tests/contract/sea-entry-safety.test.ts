/**
 * 契约：内核以 CJS 单文件可执行（SEA）形态交付，模块顶层不得依赖 import.meta。
 *
 * v0.8.0 缺陷：kernel/core/bootstrap/builtin-skills.ts 在模块顶层用
 * `new URL(..., import.meta.url)` 求值，打包成 CJS 后 import.meta 为空对象，
 * 可执行文件在任何命令执行前就抛 ERR_INVALID_URL，发布版界面因此完全不可用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBuiltinSkillsDir } from '../../kernel/core/bootstrap/builtin-skills.ts';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('契约：内置技能模块不使用 import.meta，改由运行期候选目录探测', () => {
  const source = read('kernel/core/bootstrap/builtin-skills.ts');
  const codeOnly = source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    })
    .join('\n');
  assert.equal(
    codeOnly.includes('import.meta'),
    false,
    '内置技能模块（模块顶层求值）不得使用 import.meta：CJS/SEA 形态下为空会启动即崩溃',
  );
  // 源码入口的「是否被直接执行」判定允许使用 import.meta，但必须惰性且包在 try 内。
  const cli = read('kernel/entry/cli.ts');
  assert.equal(
    cli.split('import.meta').length - 1,
    1,
    'kernel/entry/cli.ts 只允许一处 import.meta（源码入口判定）',
  );
  assert.match(cli, /try \{[\s\S]*import\.meta\.url[\s\S]*\} catch \{/);
});

test('契约：构建脚本把 import.meta 警告当失败，并自检产物可启动', () => {
  const build = read('scripts/build-kernel.mjs');
  assert.match(build, /empty-import-meta/, '构建必须拦截 CJS 形态的 import.meta 警告');
  assert.match(build, /join\(ROOT, 'kernel', 'builtin-skills'\)/, '构建须复制内置技能随产物分发');
  assert.match(
    build,
    /spawnSync\(EXECUTABLE, \['--version'\]/,
    '构建须对可执行文件做 --version 自检',
  );
  const yml = read('gui/packaging/electron-builder.yml');
  assert.match(yml, /from: \.\.\/build\/kernel/, '打包须把整个 kernel 目录带入 resources');
});

test('契约：发布物探针覆盖内置技能随产物安装', () => {
  const probe = read('scripts/probe-production-kernel.mjs');
  assert.match(probe, /checkBuiltinSkills\(\)/, '发布物探针须验证内置技能安装');
  assert.match(probe, /内置示范 Skill 随产物安装（5 个）/);
  assert.match(probe, /run\(\['init'\]\)/, '探针须在默认工作区做一次首次运行');
});

test('契约：内置示范技能资产完整（5 个，各含 SKILL.md 与 skill_meta.yaml）', () => {
  const dir = join(ROOT, 'kernel', 'builtin-skills');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(names, [
    'code-review-checklist',
    'doc-design',
    'doc-plan',
    'doc-requirements',
    'git-commit-conventional',
  ]);
  for (const name of names) {
    assert.ok(existsSync(join(dir, name, 'SKILL.md')), `${name} 缺少 SKILL.md`);
    assert.ok(existsSync(join(dir, name, 'skill_meta.yaml')), `${name} 缺少 skill_meta.yaml`);
  }
  assert.equal(
    resolveBuiltinSkillsDir({
      execPath: join(ROOT, 'node.exe'),
      entryPath: join(ROOT, 'kernel', 'entry', 'cli.ts'),
      env: {},
    }),
    dir,
    '源码形态必须解析到 kernel/builtin-skills',
  );
});
