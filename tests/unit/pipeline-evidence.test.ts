/**
 * 问题证据探查的单元测试。
 *
 * 全部基于临时目录构造的迷你仓库，不依赖本仓库结构，因此改动真实代码不会让这些用例漂移。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checksFor,
  codeTokensOf,
  detectStack,
  isTestPath,
  keywordsOf,
  probeWorkspace,
  segmentChinese,
} from '../../kernel/core/pipeline/index.ts';
import { makeTempDir } from '../helpers/temp.ts';

/** 建一个临时仓库并写入文件。 */
function makeRepo(files: Record<string, string>): string {
  const root = makeTempDir('evidence-test-');
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

test('segmentChinese: 把连续汉字切成受控词表里的检索词', () => {
  assert.deepEqual(segmentChinese('安装时崩溃并报错'), ['安装', '崩溃', '报错']);
  assert.deepEqual(segmentChinese('更新失败'), ['更新', '失败']);
  assert.deepEqual(segmentChinese('导出备份时丢数据'), ['导出', '备份', '丢数据']);
  assert.deepEqual(segmentChinese('搜索很慢'), ['搜索', '很慢']);
  // 词表外的片段被跳过，不产生整句 token
  assert.deepEqual(segmentChinese('随便说点什么'), []);
});

test('keywordsOf: 中英文混合描述都能切出检索词', () => {
  assert.deepEqual(keywordsOf('安装时崩溃并报错'), ['安装', '崩溃', '报错']);
  const mixed = keywordsOf('update 时 crash');
  assert.ok(mixed.includes('update'));
  assert.ok(mixed.includes('crash'));
});

test('codeTokensOf: 中文词展开成代码标识符片段，并混入症状线索', () => {
  const tokens = codeTokensOf(['安装', '崩溃'], '安装崩溃');
  assert.ok(tokens.includes('install'));
  assert.ok(tokens.includes('crash'));
  assert.ok(tokens.includes('throw'));
});

test('isTestPath: 识别常见测试目录与文件名', () => {
  assert.equal(isTestPath('tests/unit/a.test.ts'), true);
  assert.equal(isTestPath('src/__tests__/a.ts'), true);
  assert.equal(isTestPath('pkg/foo_test.go'), true);
  assert.equal(isTestPath('src/main.ts'), false);
});

test('detectStack: 由标志文件推断技术栈', () => {
  const nodeRepo = makeRepo({
    'package.json': JSON.stringify({ devDependencies: { typescript: '5' } }),
    'tsconfig.json': '{}',
  });
  const stack = detectStack(nodeRepo);
  assert.ok(stack.includes('node'));
  assert.ok(stack.includes('typescript'));

  const goRepo = makeRepo({ 'go.mod': 'module x' });
  assert.deepEqual(detectStack(goRepo), ['go']);
});

test('checksFor: 只建议仓库自己声明过的脚本', () => {
  const withScripts = makeRepo({
    'package.json': JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .' } }),
  });
  const checks = checksFor(withScripts);
  const lines = checks.map((check) => check.argv.join(' '));
  assert.ok(lines.includes('npm run test'));
  assert.ok(lines.includes('npm run lint'));
  // 仓库没声明 typecheck，就不该编出这条命令
  assert.ok(!lines.some((line) => line.includes('typecheck')));

  // 声明了 pnpm 锁文件时用 pnpm
  const pnpmRepo = makeRepo({
    'package.json': JSON.stringify({ scripts: { test: 'x' } }),
    'pnpm-lock.yaml': '',
  });
  assert.deepEqual(checksFor(pnpmRepo)[0]?.argv, ['pnpm', 'test']);
});

test('checksFor: 非 Node 仓库按技术栈给对应命令', () => {
  const pyRepo = makeRepo({ 'requirements.txt': 'pytest' });
  assert.deepEqual(checksFor(pyRepo)[0]?.argv, ['python', '-m', 'pytest', '-q']);
});

test('probeWorkspace: 按问题关键词定位到真实文件并给出理由', () => {
  const repo = makeRepo({
    'src/install.ts': 'export function install() {\n  throw new Error("boom");\n}\n',
    'src/export-report.ts': 'export function buildReport() { return []; }\n',
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
  });
  const evidence = probeWorkspace(repo, '安装时崩溃并报错', 'bugfix');
  assert.equal(evidence.source, 'workspace');
  assert.equal(evidence.root, repo);
  const paths = evidence.suspects.map((item) => item.path);
  assert.ok(paths.includes('src/install.ts'));
  assert.ok(!paths.includes('src/export-report.ts'));
  const hit = evidence.suspects.find((item) => item.path === 'src/install.ts');
  assert.ok(hit !== undefined);
  // 理由必须能追溯到命中词；正文命中还要给出行号
  assert.match(hit.reason, /安装/);
  assert.match(hit.reason, /第 \d+ 行/);
});

test('probeWorkspace: 英文片段按词边界匹配，不被更长的词吞掉', () => {
  // search 不应命中 embodiment/research 这类包含它的更长单词
  const repo = makeRepo({
    'src/research.ts': 'export const TOPICS = ["compare"];\n',
    'src/query.ts': 'export function search(text) { return text; }\n',
  });
  const evidence = probeWorkspace(repo, '搜索很慢', 'bugfix');
  const paths = evidence.suspects.map((item) => item.path);
  assert.ok(paths.includes('src/query.ts'));
  assert.ok(!paths.includes('src/research.ts'));
});

test('probeWorkspace: 注释行命中的权重低于实现代码', () => {
  const repo = makeRepo({
    'src/impl.ts': 'export function run() {\n  // 与导出无关的实现\n  return 1;\n}\n',
    'src/notes.ts': '// 导出 导出 导出\nexport const a = 1;\n',
  });
  const evidence = probeWorkspace(repo, '导出失败', 'bugfix');
  const paths = evidence.suspects.map((item) => item.path);
  assert.ok(paths.includes('src/impl.ts') || paths.includes('src/notes.ts'));
  assert.equal(evidence.suspects[0]?.path, 'src/impl.ts');
});

test('probeWorkspace: 只有文件名命中时如实标注「未核实内容」', () => {
  // 正文里没有中文「安装」，只有文件名 install 命中
  const repo = makeRepo({ 'src/install.ts': 'export function run() { return 1; }\n' });
  const evidence = probeWorkspace(repo, '安装失败', 'bugfix');
  const hit = evidence.suspects.find((item) => item.path === 'src/install.ts');
  assert.ok(hit !== undefined);
  assert.match(hit.reason, /未核实内容/);
});

test('probeWorkspace: 症状词只作佐证，不让词表文件顶掉功能实现', () => {
  // 「搜索很慢」里 search 是功能词，很慢 是症状；定义了 slow 词表的文件不该排第一
  const repo = makeRepo({
    'src/keywords.ts': 'export const PERF_KEYWORDS = ["slow", "timeout", "perf"];\n',
    'src/query.ts': 'export function search(text) {\n  return text.filter(Boolean);\n}\n',
  });
  const evidence = probeWorkspace(repo, '搜索很慢', 'bugfix');
  assert.equal(evidence.suspects[0]?.path, 'src/query.ts');
});

test('probeWorkspace: 翻译表不当作可疑实现', () => {
  const repo = makeRepo({
    'src/i18n/locales/zh.ts': 'export const labels = { export: "导出", backup: "备份" };\n',
    'src/backup/export.ts': 'export function exportAll() {\n  return 1;\n}\n',
  });
  const evidence = probeWorkspace(repo, '导出备份丢数据', 'bugfix');
  assert.equal(evidence.suspects[0]?.path, 'src/backup/export.ts');
});

test('probeWorkspace: 相关测试被单独列出，且不挤占可疑文件排名', () => {
  const repo = makeRepo({
    'src/update.ts': 'export function update() {}\n',
    'tests/update.test.ts': "import { update } from '../src/update.ts';\n",
  });
  const evidence = probeWorkspace(repo, '更新失败', 'bugfix');
  assert.ok(evidence.relatedTests.includes('tests/update.test.ts'));
});

test('probeWorkspace: 找不到相关文件时如实返回空清单，不编造', () => {
  const repo = makeRepo({ 'src/index.ts': 'export const a = 1;\n' });
  const evidence = probeWorkspace(repo, '安装时崩溃并报错', 'bugfix');
  assert.deepEqual(evidence.suspects, []);
  assert.ok(evidence.observations.some((line) => line.includes('未找到')));
});

test('probeWorkspace: 跳过 node_modules 与构建产物', () => {
  const repo = makeRepo({
    'node_modules/pkg/install.ts': 'export function install() { throw new Error(); }\n',
    'dist/install.js': 'function install(){throw new Error()}\n',
    'src/app.ts': 'export const x = 1;\n',
  });
  const evidence = probeWorkspace(repo, '安装崩溃', 'bugfix');
  assert.ok(!evidence.suspects.some((item) => item.path.startsWith('node_modules')));
  assert.ok(!evidence.suspects.some((item) => item.path.startsWith('dist')));
});

test('probeWorkspace: 路径不存在时降级为无证据并给出告警，不抛异常', () => {
  const missing = join(makeTempDir('evidence-test-'), 'definitely-not-here');
  const evidence = probeWorkspace(missing, '崩溃', 'bugfix');
  assert.equal(evidence.source, 'none');
  assert.equal(evidence.root, null);
  assert.equal(evidence.warnings.length, 1);
});

test('probeWorkspace: 空路径直接判为无证据', () => {
  const evidence = probeWorkspace('   ', '崩溃', 'bugfix');
  assert.equal(evidence.source, 'none');
});
