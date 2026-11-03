/**
 * 问题证据探查：把一句问题描述和「磁盘上真实存在的仓库」对上号。
 *
 * 这是内置能力从「套模板」走向「真处理」的那一步，也是最需要克制的模块：
 *
 *   1. **只读**：只做 stat/readdir/readFile，不建目录、不写缓存、不跑命令。
 *      证据探查可以在任何仓库上安全地跑，失败也只降级为「无证据」。
 *   2. **有界**：目录数、文件数、单文件读取量都有上限，大仓库不会被扫穿；
 *      不进入 node_modules / .git / 构建产物等目录。
 *   3. **可解释**：每条结论都带出处（哪个文件、命中哪个词），文档里能原样引用。
 *   4. **不猜测**：找不到就返回空数组，让文档如实标注「未核实」，而不是编造。
 *
 * 返回的 checks 只是**建议命令**（argv 形式，不经 shell）；是否执行由调用方决定，
 * 本模块永不执行它们。
 *
 * 词表与中文分词在 `evidence-terms.ts`（会随使用增补），磁盘巡览在 `evidence-scan.ts`
 * （纯 IO 约束）；这里只放「怎么判断哪个文件可疑」以及整体编排。
 */

import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codeTokensOf, isSymptomWord, keywordsOf, TERM_TOKENS } from './evidence-terms.ts';
import { isTestPath, PROBE_LIMITS, readHead, toPosix, walkSources } from './evidence-scan.ts';

import type { WalkResult } from './evidence-scan.ts';
import type { EvidenceCheck, EvidenceSuspect, ProblemEvidence, ProblemKind } from './types.ts';

/**
 * 探查器自身：这些文件里写满了 error / catch / update 等词，
 * 不排除的话每次都会把自己排到可疑清单第一名。
 */
const SELF_PATHS = [
  'kernel/core/pipeline/evidence.ts',
  'kernel/core/pipeline/evidence-terms.ts',
  'kernel/core/pipeline/evidence-scan.ts',
];

/** 标志文件 → 技术栈（按声明顺序输出，保证结果稳定）。 */
const STACK_MARKERS: ReadonlyArray<{ files: readonly string[]; stack: string }> = [
  { files: ['package.json'], stack: 'node' },
  { files: ['tsconfig.json'], stack: 'typescript' },
  { files: ['pyproject.toml', 'requirements.txt', 'setup.py'], stack: 'python' },
  { files: ['go.mod'], stack: 'go' },
  { files: ['Cargo.toml'], stack: 'rust' },
  { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], stack: 'jvm' },
  { files: ['Package.swift'], stack: 'swift' },
];

/** package.json 里出现即代表对应技术栈的标记。 */
const PACKAGE_STACK_MARKERS: ReadonlyArray<{ marker: string; stack: string }> = [
  { marker: '"typescript"', stack: 'typescript' },
  { marker: '"vue"', stack: 'vue' },
  { marker: '"react"', stack: 'react' },
  { marker: '"electron"', stack: 'electron' },
];

/** 追加不重复的技术栈名。 */
function pushStack(stack: string[], name: string): void {
  if (stack.includes(name)) return;
  stack.push(name);
}

/** 技术栈探测：只看仓库根的少数标志文件。 */
export function detectStack(root: string): string[] {
  const has = (name: string): boolean => existsSync(join(root, name));
  const stack: string[] = [];
  for (const item of STACK_MARKERS) {
    if (item.files.some(has)) pushStack(stack, item.stack);
  }
  const pkg = has('package.json') ? readHead(join(root, 'package.json'), 256 * 1024) : null;
  if (pkg === null) return stack;
  for (const item of PACKAGE_STACK_MARKERS) {
    if (pkg.includes(item.marker)) pushStack(stack, item.stack);
  }
  return stack;
}

/** package.json 里声明的脚本名（读不到时返回空）。 */
export function packageScriptsOf(root: string): string[] {
  const raw = readHead(join(root, 'package.json'), 256 * 1024);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return [];
    const scripts = (parsed as Record<string, unknown>)['scripts'];
    if (scripts === null || typeof scripts !== 'object') return [];
    return Object.keys(scripts as Record<string, unknown>);
  } catch {
    return [];
  }
}

/** 命令执行方式：只有能确认包管理器时才给建议，避免生成跑不起来的命令。 */
function nodeRunnerOf(root: string): string[] {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return ['pnpm'];
  if (existsSync(join(root, 'yarn.lock'))) return ['yarn'];
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return ['bun'];
  return ['npm'];
}

/**
 * 由仓库结构推断可执行检查。
 *
 * 只给「仓库自己声明过」的命令：package.json 里有对应脚本才建议 `npm run <script>`，
 * 否则不猜。测试命令优先，其次是类型检查与代码规范。
 */
export function checksFor(root: string): EvidenceCheck[] {
  const stack = detectStack(root);
  const checks: EvidenceCheck[] = [];
  if (stack.includes('node')) {
    const scripts = packageScriptsOf(root);
    const runner = nodeRunnerOf(root);
    const add = (script: string, intent: string, expect: string): void => {
      // runner 至少有一项（nodeRunnerOf 总是返回 ['npm'] 起步），这里显式兜底以免越界
      const tool = runner[0] ?? 'npm';
      checks.push({
        intent,
        argv: tool === 'npm' ? ['npm', 'run', script] : [tool, script],
        expect,
      });
    };
    if (scripts.includes('test'))
      add(
        'test',
        '跑一遍仓库自带测试，确认问题可复现',
        '先拿到失败用例；全绿说明问题不在现有测试覆盖内',
      );
    if (scripts.includes('typecheck'))
      add('typecheck', '确认是否类型层面的问题', '类型报错往往直接指向根因文件');
    if (scripts.includes('lint'))
      add('lint', '排除代码规范与未使用变量导致的静态错误', 'lint 报错行往往就是可疑改动');
    if (checks.length === 0 && stack.includes('typescript')) {
      checks.push({
        intent: '做一次类型检查，确认是否类型层面的问题',
        argv: ['npx', 'tsc', '--noEmit'],
        expect: '只读检查，定位类型错误的文件与行',
      });
    }
  }
  if (stack.includes('python')) {
    checks.push({
      intent: '跑一遍仓库自带测试',
      argv: ['python', '-m', 'pytest', '-q'],
      expect: '先拿到失败用例；全绿说明问题不在现有测试覆盖内',
    });
  }
  if (stack.includes('go')) {
    checks.push({
      intent: '编译并跑一遍测试',
      argv: ['go', 'test', './...'],
      expect: '编译期错误通常直接指向破坏点',
    });
  }
  if (stack.includes('rust')) {
    checks.push({
      intent: '编译并跑一遍测试',
      argv: ['cargo', 'test'],
      expect: '编译期错误通常直接指向破坏点',
    });
  }
  return checks;
}

/**
 * 路径是否包含任一检索片段（单复数做归一：tests 也能被 test 命中）。
 *
 * 路径按 `-`、`_`、`.`、`/` 切成分段后再比对，让 `search` 命中 `search-index.ts`，
 * 但不命中 `research.ts`——否则任何含 `search`/`install` 的长单词都会污染排名。
 */
function matchesAnyForm(pathLower: string, forms: ReadonlySet<string>): boolean {
  const segments = pathLower.split(/[^a-z0-9]+/).flatMap((part) => part.split(/(?=[0-9])/));
  for (const form of forms) {
    const head = form.replace(/s$/, '');
    // 只有去掉 s 后仍足够长才用词干，避免 reject -> reje 这类错误截断
    const candidate = head.length >= 4 ? head : form;
    if (candidate.length < 3) continue;
    for (const segment of segments) {
      if (segment === candidate) return true;
      // 复词与派生：installs / installskill 按前缀匹配，但不超过几个字符
      if (segment.startsWith(candidate) && segment.length <= candidate.length + 2) return true;
    }
  }
  return false;
}

/** 路径是否包含该检索片段。 */
function pathMatchesForm(pathLower: string, form: string): boolean {
  return matchesAnyForm(pathLower, new Set([form]));
}

/** 单个文件的关键词命中评估。 */
interface FileHit {
  path: string;
  matched: string[];
  score: number;
  line: number | null;
}

/** 一条待检索的片段：`label` 是报告里显示的词，`needle` 是实际比对的片段。 */
interface Probe {
  label: string;
  needle: string;
}

/** 英文标识符判定：只有这类词本身即可参与匹配，中文词要走词表展开。 */
function isIdentifierLike(word: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(word);
}

/** 由检索词生成正文比对片段：中文原词 + 词表展开出的英文片段。 */
function probesFor(keywords: readonly string[]): Probe[] {
  const probes: Probe[] = [];
  for (const keyword of keywords) {
    probes.push({ label: keyword, needle: keyword.toLowerCase() });
    if (isIdentifierLike(keyword)) continue;
    for (const form of TERM_TOKENS[keyword] ?? []) {
      probes.push({ label: keyword, needle: form.toLowerCase() });
    }
  }
  return probes;
}

/**
 * 路径命中得分：中文词按词表展开成英文片段（「安装」→ install），英文词本身即片段。
 *
 * 功能词（安装、导出、搜索）权重高，症状词（很慢、丢失）权重低：它们说明「哪里疼」，
 * 但不说明「疼在哪个文件」，把它当主证据只会让词表文件顶到前面。
 */
function scorePath(pathLower: string, keywords: readonly string[], matched: string[]): number {
  let score = 0;
  for (const keyword of keywords) {
    const forms = isIdentifierLike(keyword) ? [keyword] : (TERM_TOKENS[keyword] ?? []);
    if (!forms.some((form) => pathMatchesForm(pathLower, form))) continue;
    matched.push(keyword);
    score += isSymptomWord(keyword) ? 2 : 6;
  }
  return score;
}

/** 单条正文命中的分值：注释/文档行权重更低，症状词只作佐证。 */
function probeWeight(label: string, comment: boolean): number {
  if (comment) return 1;
  return isSymptomWord(label) ? 1 : 3;
}

/**
 * 正文命中得分：同一检索词只计一次分（多个英文同义词同时出现不代表证据更强）。
 * 命中行号取第一条命中的位置，供「第 N 行」引用。
 */
function scoreProbes(
  lines: readonly string[],
  probes: readonly Probe[],
  matched: string[],
): { score: number; line: number | null } {
  let score = 0;
  let line: number | null = null;
  const scored = new Set<string>();
  for (const probe of probes) {
    const index = lines.findIndex((text) => containsProbe(text, probe.needle));
    if (index < 0) continue;
    if (!matched.includes(probe.label)) matched.push(probe.label);
    if (line === null) line = index + 1;
    if (scored.has(probe.label)) continue;
    scored.add(probe.label);
    score += probeWeight(probe.label, isCommentLine(lines[index] ?? ''));
  }
  return { score, line };
}

/** 症状线索命中：每个线索只计 1 分，作为佐证而不是主证据。 */
function scoreClues(content: string, clues: readonly string[], matched: string[]): number {
  const lower = content.toLowerCase();
  let score = 0;
  for (const clue of clues) {
    if (!lower.includes(clue.toLowerCase())) continue;
    if (!matched.includes(clue)) matched.push(clue);
    score += 1;
  }
  return score;
}

/** 文件角色的降权：测试、文档、翻译表与构建脚本通常不是根因所在。 */
function penalizeRole(rel: string, score: number): number {
  let result = score;
  if (isTestPath(rel)) result = Math.floor(result / 3);
  // 翻译表天然包含全部词汇，命中它们说明不了任何问题
  if (/(^|\/)(i18n|locales?|lang|translations?)\//i.test(rel)) result = Math.floor(result / 3);
  if (/\.(md|txt|json|ya?ml)$/i.test(rel)) result = Math.floor(result / 2);
  if (/^(scripts|tools|\.github)\//i.test(rel)) result = Math.floor(result / 2);
  return result;
}

/** 单个文件的关键词命中评估：路径、正文、症状线索三者叠加后按角色降权。 */
function scoreFile(
  rel: string,
  content: string | null,
  keywords: readonly string[],
  clues: readonly string[],
): FileHit {
  const matched: string[] = [];
  let score = scorePath(rel.toLowerCase(), keywords, matched);
  let line: number | null = null;
  if (content !== null) {
    const lines = content.split(/\r?\n/);
    const probeHit = scoreProbes(lines, probesFor(keywords), matched);
    score += probeHit.score + scoreClues(content, clues, matched);
    line = probeHit.line;
  }
  return { path: rel, matched, score: penalizeRole(rel, score), line };
}

/**
 * 判断一行代码是否包含检索词。
 *
 * 中文词按子串匹配；英文片段要求落在词边界上——否则 `search` 会命中 `RESEARCH_KEYWORDS`、
 * `install` 会命中 `uninstall`，把无关文件顶到可疑清单前列。缩写与驼峰用 `_`、`.`、
 * 大小写变化作为分隔，因此 `installSkill` / `plugin_install` 仍能被 `install` 命中。
 */
function containsProbe(text: string, needle: string): boolean {
  if (needle === '') return false;
  if (!/^[a-z0-9_-]+$/.test(needle)) return text.toLowerCase().includes(needle);
  // 在原文里做大小写敏感的边界判断：大写字母是驼峰分界，不能先整体小写
  const parts = text.split(/[^A-Za-z0-9]+/);
  for (const part of parts) {
    for (const piece of part.split(/(?=[A-Z])/)) {
      if (piece.toLowerCase() === needle) return true;
    }
    // 复数与派生：installs
    if (part.toLowerCase() === needle) return true;
  }
  return false;
}

/** 判断一行是否为注释或文档行（这些行命中关键词时证据强度更弱）。 */
function isCommentLine(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('#')
  );
}

/**
 * 可疑文件的定位理由：由命中方式生成，不用模板话术。
 *
 * 区分「只在文件名里命中」和「在代码正文里命中」——前者说「这个文件可能相关」，
 * 后者才说得出第几行，两者的证据强度不同，不能混成一句话。
 */
function reasonOf(hit: FileHit, kind: ProblemKind): string {
  const words = hit.matched.slice(0, 3).join('、');
  const role = isTestPath(hit.path) ? '相关测试' : kind === 'bugfix' ? '可疑路径' : '相关实现';
  if (hit.matched.length === 0) return `${role}：路径落在相关目录下`;
  if (hit.line === null) return `${role}：仅文件名命中「${words}」，未核实内容`;
  return `${role}：第 ${String(hit.line)} 行命中「${words}」`;
}

/** 探查结果的最大体积控制与排序。 */
function finalizeSuspects(hits: FileHit[], kind: ProblemKind): EvidenceSuspect[] {
  return hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, PROBE_LIMITS.maxSuspects)
    .map((hit) => ({ path: hit.path, matched: hit.matched, reason: reasonOf(hit, kind) }));
}

/** 是否为本探查器自身的源文件。 */
function isSelfPath(rel: string): boolean {
  const lower = rel.toLowerCase();
  return SELF_PATHS.some((path) => lower.includes(path));
}

/**
 * 探查仓库，产出问题证据。
 *
 * 任何一步失败都只降级：目录不存在 -> source='none'；单个文件读不出 -> 跳过并记 warning。
 * 本函数不抛异常，调用方无需 try/catch。
 * @param root 仓库根目录（绝对路径或相对当前目录）
 * @param problem 问题描述原文
 * @param kind 问题分类（影响可疑文件的排序口径）
 */
/** 一次仓库扫描的结果。 */
interface RepoScan {
  hits: FileHit[];
  relatedTests: string[];
  truncated: boolean;
  scanned: number;
}

/** 由检索词生成测试文件匹配用的片段集合。 */
function testFormsOf(keywords: readonly string[]): Set<string> {
  const forms = new Set<string>();
  for (const keyword of keywords) {
    for (const form of TERM_TOKENS[keyword] ?? []) forms.add(form);
    if (isIdentifierLike(keyword)) forms.add(keyword);
  }
  return forms;
}

/** 遍历源文件并按关键词打分，同时挑出相关测试。 */
function scanRepo(
  root: string,
  walk: WalkResult,
  keywords: readonly string[],
  clues: readonly string[],
  limits: typeof PROBE_LIMITS,
): RepoScan {
  const hits: FileHit[] = [];
  const relatedTests: string[] = [];
  const testForms = testFormsOf(keywords);
  let scanned = 0;
  for (const rel of walk.files) {
    if (isSelfPath(rel)) continue;
    scanned += 1;
    const hit = scoreFile(rel, readHead(join(root, rel)), keywords, clues);
    if (hit.score > 0) hits.push(hit);
    const isRelatedTest = isTestPath(rel) && matchesAnyForm(rel.toLowerCase(), testForms);
    if (isRelatedTest && relatedTests.length < limits.maxRelatedTests) relatedTests.push(rel);
  }
  return { hits, relatedTests, truncated: walk.truncated, scanned };
}

/** 生成可读的探查说明：每条都对应真实发生过的事实。 */
function observationsOf(
  root: string,
  stack: readonly string[],
  scan: RepoScan,
  suspects: readonly EvidenceSuspect[],
  keywords: readonly string[],
): string[] {
  const observations = [`仓库根：${toPosix(relative(process.cwd(), root) || root)}`];
  if (stack.length > 0) observations.push(`技术栈：${stack.join(' / ')}`);
  const cap = scan.truncated ? '（达到上限，结论可能不完整）' : '';
  observations.push(`已扫描 ${String(scan.scanned)} 个源文件${cap}`);
  if (suspects.length === 0) {
    observations.push(`未找到与「${keywords.join('、') || '问题描述'}」直接相关的文件`);
  } else {
    observations.push(`按关键词定位到 ${String(suspects.length)} 个可疑文件`);
  }
  if (scan.relatedTests.length > 0)
    observations.push(`相关测试 ${String(scan.relatedTests.length)} 个`);
  return observations;
}

/** 校验探查根；不可用时返回原因，可用时返回 null。 */
function rootProblemOf(root: string): string | null {
  if (root.trim() === '') return '未指定仓库路径';
  try {
    return statSync(root).isDirectory() ? null : `仓库路径不是目录：${root}`;
  } catch {
    return `仓库路径不可访问：${root}`;
  }
}

/**
 * 探查仓库，产出问题证据。
 *
 * 任何一步失败都只降级：目录不存在 -> source='none'；单个文件读不出 -> 跳过。
 * 本函数不抛异常，调用方无需 try/catch。
 * @param root 仓库根目录（绝对路径或相对当前目录）
 * @param problem 问题描述原文
 * @param kind 问题分类（影响可疑文件的排序口径）
 */
export function probeWorkspace(
  root: string,
  problem: string,
  kind: ProblemKind,
  limits = PROBE_LIMITS,
): ProblemEvidence {
  const empty: ProblemEvidence = {
    source: 'none',
    root: null,
    stack: [],
    checks: [],
    suspects: [],
    relatedTests: [],
    observations: [],
    warnings: [],
  };
  const problem_ = rootProblemOf(root);
  if (problem_ !== null) return { ...empty, warnings: [problem_] };

  const keywords = keywordsOf(problem);
  const clues = codeTokensOf(keywords, problem);
  const stack = detectStack(root);
  const scan = scanRepo(root, walkSources(root, limits), keywords, clues, limits);
  const suspects = finalizeSuspects(scan.hits, kind);

  return {
    source: 'workspace',
    root,
    stack,
    checks: checksFor(root),
    suspects,
    relatedTests: scan.relatedTests,
    observations: observationsOf(root, stack, scan, suspects, keywords).slice(
      0,
      limits.maxObservations,
    ),
    warnings: scan.truncated ? ['扫描达到上限，可疑清单可能不完整'] : [],
  };
}

/** 证据是否足以支撑「已定位」的结论。 */
export function hasLocations(evidence: ProblemEvidence | null | undefined): boolean {
  return evidence !== null && evidence !== undefined && evidence.suspects.length > 0;
}
