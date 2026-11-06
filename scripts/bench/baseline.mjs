#!/usr/bin/env node
/**
 * 基线生成器：把**原始测量报告**与**CI 烟测记录**合成一份可复核的基线 JSON（设计 §6 第 1 条）。
 *
 * 设计取舍：
 *   - 基线必须**自带原始逐次样本**（`run_details`），因为 `build/` 不入库——只留中位数会让基线不可复核；
 *   - 拐点所需的第二轮 N=5000 数据一并入库，比较值由本脚本**算出来**（而不是文档里手算）；
 *   - 缺测项（如 macOS SEA 线）显式写进 `gaps`，不伪造、不留空。
 *
 * 用法：`node scripts/bench/baseline.mjs --version 0.1.0 --out docs/benchmark/baseline-0.1.0.json`
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MEASURED_SCENARIOS, STARTUP_SCENARIO } from './measure.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW_DIR = join(ROOT, 'build', 'bench');

/** 基线 schema 标识（契约测试与文档同源比对） */
export const BASELINE_SCHEMA = 'bench-baseline/1';

function parseArgs(argv) {
  const options = { version: '0.1.0', out: null, rawDir: RAW_DIR, ciSmoke: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`选项 ${token} 缺少取值`);
      return argv[i];
    };
    if (token === '--version') options.version = next();
    else if (token === '--out') options.out = next();
    else if (token === '--raw') options.rawDir = next();
    else if (token === '--ci-smoke') options.ciSmoke = next();
    else throw new Error(`未知选项：${token}`);
  }
  if (options.out === null) throw new Error('缺少 --out');
  options.ciSmoke ??= join(ROOT, 'docs', 'benchmark', `ci-smoke-${options.version}.json`);
  return options;
}

/** 读某目录下匹配的报告（按文件名排序，保证输出稳定；第二轮文件名为 `round2-*.json`） */
export function readReports(dir, pattern = /^report-.*\.json$/) {
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => ({ name, report: JSON.parse(readFileSync(join(dir, name), 'utf8')) }));
}

/** 场景条目 → 该场景的中位墙钟 / 峰值 / 覆盖率（缺测返回 null） */
export function summarizeSample(sample) {
  if (sample === undefined) return null;
  return {
    scenario: sample.scenario,
    n: sample.n,
    wall_ms: sample.wall_ms,
    peak_rss_mb: sample.peak_rss_mb,
    runs: sample.runs,
    exit_codes: sample.exit_codes,
    coverage: sample.stages?.coverage ?? null,
    index_bytes: sample.index_bytes,
    export_bytes: sample.export_bytes,
    index_write_ms: sample.index_write_ms,
    fs_observation: sample.fs_observation,
  };
}

/** 从一份报告里抽出「档位 → 场景 → 摘要」表 */
export function tierTable(report) {
  const table = {};
  for (const sample of report.samples) {
    const tier = sample.n === null ? STARTUP_SCENARIO : String(sample.n);
    table[tier] ??= {};
    table[tier][sample.scenario] = summarizeSample(sample);
  }
  return table;
}

/** 单技能平均耗时（毫秒/技能）：用于拐点判定 */
export function perSkillMs(sample) {
  if (sample === null || sample.n === null || sample.wall_ms.median === null) return null;
  return Math.round((sample.wall_ms.median / sample.n) * 1000) / 1000;
}

/** 拐点比较：同一环境的相邻档位（1000 → 5000）单技能平均耗时之比 */
export function inflectionOf({ n1000, n5000First, n5000Second, scenario }) {
  const base = perSkillMs(n1000[scenario]);
  const first = perSkillMs(n5000First[scenario]);
  const second = perSkillMs(n5000Second[scenario]);
  const ratio = (value) =>
    value === null || base === null ? null : Math.round((value / base) * 1000) / 1000;
  return {
    scenario,
    per_skill_ms_n1000: base,
    per_skill_ms_n5000_round1: first,
    per_skill_ms_n5000_round2: second,
    ratio_round1: ratio(first),
    ratio_round2: ratio(second),
    threshold: 2,
    /**
     * 判定口径（裁决原文的三条分支）：
     *   - 两轮都 ≤ 2.0 → `none`（线性以内）；
     *   - 任一轮 > 2.0 且两轮都 ≤ 2.5 → `mild-superlinear`（登记为轻微超线性观察项，**不优化**）；
     *   - 任一轮 > 2.5 → `significant`（按设计 §7 定位）。
     */
    classification: (() => {
      const values = [ratio(first), ratio(second)].filter((value) => value !== null);
      if (values.length === 0) return null;
      if (values.some((value) => value > 2.5)) return 'significant';
      if (values.some((value) => value > 2)) return 'mild-superlinear';
      return 'none';
    })(),
  };
}

/** 同一线在同一轮会有多份报告（按档位分文件）：合并成一张「档位 → 场景」表 */
const reportsOfForm = (items, form, name = 'report-') =>
  items.filter((item) => item.name.startsWith(`${name}${form}-`)).map((item) => item.report);
const mergedTiers = (reports) => Object.assign({}, ...reports.map((report) => tierTable(report)));

function buildMeasurement(rounds) {
  const measurement = {};
  for (const form of ['source', 'sea']) {
    const first = reportsOfForm(rounds.round1, form);
    if (first.length === 0) continue;
    const second = reportsOfForm(rounds.round2, form, 'round2-');
    measurement[form] = {
      environment: first[0].environment,
      fixture: first[0].fixture,
      tiers: mergedTiers(first),
      round2_n5000: second.length === 0 ? null : mergedTiers(second)['5000'],
      /** 报告侧仍保留原始逐次样本，保证基线可复核（build/ 不入库） */
      raw_reports: first,
      raw_reports_round2: second,
    };
  }
  return measurement;
}

function buildInflection(measurement) {
  const inflection = {};
  for (const form of Object.keys(measurement)) {
    const tiers = measurement[form].tiers;
    const round2 = measurement[form].round2_n5000;
    if (tiers['1000'] === undefined || tiers['5000'] === undefined || round2 === null) continue;
    inflection[form] = MEASURED_SCENARIOS.map((scenario) =>
      inflectionOf({
        n1000: tiers['1000'],
        n5000First: tiers['5000'],
        n5000Second: round2,
        scenario,
      }),
    );
  }
  return inflection;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rounds = {
    round1: readReports(join(options.rawDir, 'round1')),
    round2: readReports(options.rawDir, /^round2-.*\.json$/),
  };
  if (rounds.round1.length === 0) {
    throw new Error(`未找到第一轮报告：${join(options.rawDir, 'round1')}（拐点比较需要两轮数据）`);
  }
  const measurement = buildMeasurement(rounds);
  const inflection = buildInflection(measurement);
  const ciSmoke = JSON.parse(readFileSync(options.ciSmoke, 'utf8'));

  const baseline = {
    schema: BASELINE_SCHEMA,
    version: options.version,
    recorded_at: new Date().toISOString(),
    /** 口径声明：本基线怎么来的、什么能比、什么不能比 */
    scope: {
      local: `${measurement.source.environment.platform}/${measurement.source.environment.arch} / ${measurement.source.environment.node} / runs=3（N=5000 也独立复测 3 次，用于拐点判定）`,
      cross_line: '跨线只比总墙钟与峰值内存；SEA 为打包产物、库内部帧名被改写，阶段归集系统性偏低',
      cross_environment: '跨环境只比量级与采样链路健康，不做绝对阈值比较（CI 为共享 runner）',
      thresholds:
        'N=1000 硬阈值：scan ≤ 30 s、validate ≤ 30 s、export ≤ 15 s、峰值 RSS ≤ 512 MB（需求 9.4.3，未测先收紧）',
    },
    measurement,
    inflection,
    ci_smoke: ciSmoke,
    gaps: [
      {
        platform: 'darwin-arm64',
        form: 'local-matrix',
        reason:
          '无本机 macOS 环境：三档 × 双线 × runs=3 的全矩阵无法在本机执行（环境限制，非缺陷）',
        evidence: `CI 记录见 ci_smoke（run ${String(ciSmoke.run_id ?? 'unknown')}；macOS 以 runs=1 补齐双线三档）`,
        follow_up: '如需可作同机时序比较的 macOS 基线，需专用 macOS 机器或长跑 runner（可选项）',
      },
    ],
    closed_defects:
      options.version === '0.1.0'
        ? [
            {
              id: 'EX-13',
              title: 'macOS 上 SEA 内核启动即被系统终止（SIGSEGV 139）',
              root_cause:
                'SEA 注入缺 macOS 必需参数 --macho-segment-name NODE_SEA（Node 官方文档口径）',
              fix: 'scripts/sea-postject.mjs（postject 参数唯一实现，仅 darwin 加段名）+ build-kernel.mjs 改用它',
              verification: {
                'darwin-arm64': { A: 0, B: 0, C: 139 },
                'darwin-x64': { A: 0, B: 0, C: 139 },
              },
              notes: [
                'A = 构建期产物、B = electron-builder 打包后 .app 内内核、C = v0.1.0 发布 dmg 内内核；数值为 --version 的退出码',
                'C 组 139 说明 v0.1.0 的 macOS 包（arm64 与 x64）内嵌内核不可执行 —— 是否发 v0.1.1 补丁由维护者裁决',
                '排除项：签名校验有效、可执行位正常、裸 node 副本可运行、Linux/Windows 同流程正常',
              ],
            },
          ]
        : [],
    notes: [
      '本基线的原始逐次样本随文档入库（build/ 不入库），因此可离线复核中位数与极差',
      'CI 烟测数值仅记录、不作门禁；其作用是验证三平台采样链路与真机路径',
      'N=1000 阈值判定见报告；拐点判定用两轮独立 N=5000 数据（同环境、每轮 runs=3）',
    ],
  };

  writeFileSync(options.out, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(`基线已写入 ${options.out}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
