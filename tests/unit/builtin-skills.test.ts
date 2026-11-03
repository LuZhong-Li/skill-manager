/** 内置示范 Skill 安装：目录探测、复制语义与首次运行判定。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../helpers/temp.ts';
import {
  BUILTIN_SKILLS_DIR_ENV,
  builtinSkillsDirCandidates,
  ensureBuiltinSkills,
  resolveBuiltinSkillsDir,
  shouldInstallBuiltinSkills,
} from '../../kernel/core/bootstrap/builtin-skills.ts';

/** 造一个最小的内置技能目录（含嵌套文件，用于验证递归复制）。 */
function writeSkill(root: string, id: string): string {
  const dir = join(root, id);
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `# ${id}\n`);
  writeFileSync(join(dir, 'skill_meta.yaml'), `id: ${id}\n`);
  writeFileSync(join(dir, 'nested', 'notes.md'), `${id}-notes\n`);
  return dir;
}

function decisionOf(overrides: Partial<Parameters<typeof shouldInstallBuiltinSkills>[0]>) {
  return shouldInstallBuiltinSkills({
    workspaceRoot: '/ws/default',
    defaultWorkspaceRoot: '/ws/default',
    command: 'init',
    inventory: false,
    dryRun: false,
    ...overrides,
  });
}

test('内置技能目录：候选顺序为 环境变量 → 可执行文件同级 → 源码入口上一级', () => {
  const root = makeTempDir('sm-builtin-candidates-');
  const execDir = join(root, 'app');
  const envDir = join(root, 'custom');
  const entryPath = join(root, 'repo', 'kernel', 'entry', 'cli.ts');

  assert.deepEqual(
    builtinSkillsDirCandidates({
      execPath: join(execDir, 'skill-manager.exe'),
      entryPath,
      env: { [BUILTIN_SKILLS_DIR_ENV]: envDir },
    }),
    [envDir, join(execDir, 'builtin-skills'), join(root, 'repo', 'kernel', 'builtin-skills')],
  );
});

test('内置技能目录：可执行形态解析到可执行文件同级 builtin-skills', () => {
  const root = makeTempDir('sm-builtin-exec-');
  const execDir = join(root, 'app');
  writeSkill(join(execDir, 'builtin-skills'), 'from-exec');

  assert.equal(
    resolveBuiltinSkillsDir({
      execPath: join(execDir, 'skill-manager.exe'),
      entryPath: undefined,
      env: {},
    }),
    join(execDir, 'builtin-skills'),
  );
});

test('内置技能目录：源码形态解析到源码入口上一级 builtin-skills', () => {
  const root = makeTempDir('sm-builtin-source-');
  const repo = join(root, 'repo');
  writeSkill(join(repo, 'kernel', 'builtin-skills'), 'from-source');

  assert.equal(
    resolveBuiltinSkillsDir({
      execPath: join(root, 'node.exe'),
      entryPath: join(repo, 'kernel', 'entry', 'cli.ts'),
      env: {},
    }),
    join(repo, 'kernel', 'builtin-skills'),
  );
});

test('内置技能目录：环境变量覆盖优先，且跳过不存在的候选', () => {
  const root = makeTempDir('sm-builtin-env-');
  const execDir = join(root, 'app');
  const envDir = join(root, 'custom');
  writeSkill(join(execDir, 'builtin-skills'), 'from-exec');
  writeSkill(envDir, 'from-env');
  const entryPath = join(root, 'repo', 'kernel', 'entry', 'cli.ts');

  assert.equal(
    resolveBuiltinSkillsDir({
      execPath: join(execDir, 'skill-manager.exe'),
      entryPath,
      env: { [BUILTIN_SKILLS_DIR_ENV]: envDir },
    }),
    envDir,
  );
  assert.equal(
    resolveBuiltinSkillsDir({
      execPath: join(execDir, 'skill-manager.exe'),
      entryPath,
      env: { [BUILTIN_SKILLS_DIR_ENV]: join(root, 'missing') },
    }),
    join(execDir, 'builtin-skills'),
  );
  assert.equal(
    resolveBuiltinSkillsDir({
      execPath: join(root, 'node.exe'),
      entryPath,
      env: {},
    }),
    null,
  );
});

test('内置技能安装：递归复制、已存在不覆盖、只装新增目录', () => {
  const root = makeTempDir('sm-builtin-install-');
  const source = join(root, 'builtin-skills');
  writeSkill(source, 'alpha');
  writeSkill(source, 'beta');
  const skillsDir = join(root, 'workspace', 'skills');

  assert.deepEqual(ensureBuiltinSkills(skillsDir, source), ['alpha', 'beta']);
  assert.equal(
    readFileSync(join(skillsDir, 'alpha', 'nested', 'notes.md'), 'utf8'),
    'alpha-notes\n',
  );
  assert.ok(existsSync(join(skillsDir, 'beta', 'skill_meta.yaml')));

  // 用户改过或删过的技能不被覆盖，也不重新出现
  writeFileSync(join(skillsDir, 'alpha', 'SKILL.md'), 'user-edited\n');
  assert.deepEqual(ensureBuiltinSkills(skillsDir, source), []);
  assert.equal(readFileSync(join(skillsDir, 'alpha', 'SKILL.md'), 'utf8'), 'user-edited\n');

  // 新增的内置技能会补装
  writeSkill(source, 'gamma');
  assert.deepEqual(ensureBuiltinSkills(skillsDir, source), ['gamma']);
});

test('内置技能安装：源目录缺失时安全返回空列表', () => {
  const root = makeTempDir('sm-builtin-missing-');
  assert.deepEqual(ensureBuiltinSkills(join(root, 'skills'), join(root, 'missing')), []);
  assert.equal(existsSync(join(root, 'skills')), false, '源目录缺失时不应创建目标目录');
});

test('首次运行判定：只对默认工作区生效，且只读命令不写入', () => {
  assert.equal(decisionOf({}), true, '默认工作区 + init 应安装');
  assert.equal(decisionOf({ command: 'list' }), true, '默认工作区上的普通指令应安装');
  assert.equal(
    decisionOf({ workspaceRoot: '/ws/other' }),
    false,
    '显式指定其他工作区不应写入演示技能',
  );
  assert.equal(decisionOf({ inventory: true }), false, '全机盘点必须只读');
  assert.equal(decisionOf({ dryRun: true }), false, 'dry-run 预演不写入');
  assert.equal(decisionOf({ command: '' }), false, '只打印帮助时不写入');
});
