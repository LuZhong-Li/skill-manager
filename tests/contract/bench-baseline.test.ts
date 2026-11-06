import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_SCHEMA } from '../../scripts/bench/baseline.mjs';
import { THRESHOLDS } from '../../scripts/bench/thresholds.mjs';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const baselinePath = join(root, 'docs', 'benchmark', 'baseline-0.1.0.json');
const reportPath = join(root, 'docs', 'benchmark', 'report-0.1.0.md');

type Baseline = {
  schema: string;
  version: string;
  measurement: Record<
    string,
    {
      tiers: Record<
        string,
        Record<string, { wall_ms: { median: number }; peak_rss_mb: { max: number } }>
      >;
      raw_reports: unknown[];
    }
  >;
  inflection: Record<
    string,
    Array<{ scenario: string; classification: string; threshold: number }>
  >;
  ci_smoke: {
    run_id: number;
    platforms: Array<{ platform: string; samples: Record<string, unknown> }>;
  };
  gaps: Array<{ platform: string; form: string; reason: string }>;
  scope: Record<string, string>;
};

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;

/** 报告里与基线同源比对的机器可读块 */
function reportSummary(): {
  thresholds_n1000: Record<
    string,
    { scan_ms: number; validate_ms: number; export_ms: number; peak_rss_mb: number }
  >;
  inflection: Record<string, Record<string, string>>;
  coverage_scan_cold: Record<string, number[]>;
  gaps: string[];
} {
  const doc = readFileSync(reportPath, 'utf8');
  const marker = doc.indexOf('<!-- baseline-summary');
  assert.notEqual(marker, -1, '报告应含 baseline-summary 同源块');
  const block = /```json\n([\s\S]*?)\n```/.exec(doc.slice(marker));
  assert.ok(block !== null, 'baseline-summary 应含 json 代码块');
  return JSON.parse(block[1]);
}

test('契约：基线 JSON 的 schema / 口径声明 / 缺口 / 原始样本', () => {
  assert.equal(baseline.schema, BASELINE_SCHEMA);
  assert.equal(baseline.version, '0.1.0');
  for (const key of ['local', 'cross_line', 'cross_environment', 'thresholds']) {
    assert.ok(
      typeof baseline.scope[key] === 'string' && baseline.scope[key].length > 0,
      `scope.${key} 必须写明`,
    );
  }
  assert.deepEqual(
    baseline.gaps.map((gap) => `${gap.platform}:${gap.form}`),
    ['darwin-arm64:local-matrix'],
    '缺测项必须显式登记（不伪造、不留空）：macOS 缺的是本机全矩阵，不是 CI 数据',
  );
  for (const form of ['source', 'sea']) {
    assert.ok(
      baseline.measurement[form].raw_reports.length >= 3,
      `${form} 线应带三档原始报告（可离线复核）`,
    );
    for (const tier of ['100', '1000', '5000']) {
      assert.ok(
        baseline.measurement[form].tiers[tier] !== undefined,
        `${form} 线应有 N=${tier} 数据`,
      );
    }
  }
  assert.equal(baseline.ci_smoke.run_id > 0, true);
  assert.deepEqual(
    baseline.ci_smoke.platforms.map((item) => item.platform),
    ['linux', 'windows', 'macos'],
  );
  assert.equal(
    baseline.ci_smoke.platforms.find((item) => item.platform === 'macos')?.samples['sea'] !== null,
    true,
    'EX-13 修复后 macOS 的 SEA 线必须已有真机数据（此前缺测已补）',
  );
});

test('契约：报告的阈值表与基线数据一致，且阈值取自唯一来源', () => {
  const summary = reportSummary();
  for (const form of ['source', 'sea'] as const) {
    const tiers = baseline.measurement[form].tiers['1000'];
    const row = summary.thresholds_n1000[form];
    assert.equal(
      row.scan_ms,
      Math.round(tiers['scan-cold'].wall_ms.median),
      `${form} scan 与基线一致`,
    );
    assert.equal(
      row.validate_ms,
      Math.round(tiers.validate.wall_ms.median),
      `${form} validate 与基线一致`,
    );
    assert.equal(
      row.export_ms,
      Math.round(tiers.export.wall_ms.median),
      `${form} export 与基线一致`,
    );
    assert.equal(
      row.peak_rss_mb,
      Math.max(
        tiers['scan-cold'].peak_rss_mb.max,
        tiers['scan-hot'].peak_rss_mb.max,
        tiers.validate.peak_rss_mb.max,
        tiers.export.peak_rss_mb.max,
      ),
      `${form} 峰值取四场景最大，且与基线一致`,
    );
    assert.ok(row.scan_ms <= THRESHOLDS[1000].scan_ms, 'scan 达标');
    assert.ok(row.validate_ms <= THRESHOLDS[1000].validate_ms, 'validate 达标');
    assert.ok(row.export_ms <= THRESHOLDS[1000].export_ms, 'export 达标');
    assert.ok(row.peak_rss_mb <= THRESHOLDS[1000].peak_rss_mb, '峰值 RSS 达标');
  }
});

test('契约：报告的拐点判定与基线分类一致，且口径为三条分支', () => {
  const summary = reportSummary();
  for (const form of ['source', 'sea']) {
    for (const entry of baseline.inflection[form]) {
      assert.equal(
        summary.inflection[form][entry.scenario],
        entry.classification,
        `${form}/${entry.scenario} 分类与基线一致`,
      );
      assert.equal(entry.threshold, 2, '阈值为 2×');
      assert.ok(
        ['none', 'mild-superlinear', 'significant'].includes(entry.classification),
        '分类必须是三条分支之一',
      );
    }
  }
  // 本版本没有需要优化的拐点：不得出现 significant
  assert.equal(
    Object.values(baseline.inflection)
      .flat()
      .some((entry) => entry.classification === 'significant'),
    false,
    '0.1.0 无显著超线性项（若出现则须开优化批次）',
  );
});

test('契约：报告说明 EX-13 与三处内核观察项（不留悬空）', () => {
  const doc = readFileSync(reportPath, 'utf8');
  for (const marker of [
    'EX-13',
    'O-1',
    'O-2',
    'O-3',
    '未测先收紧',
    '轻微超线性',
    '已修复',
    '已发布',
  ]) {
    assert.ok(doc.includes(marker), `报告应写明 ${marker}`);
  }
  assert.ok(
    doc.includes('exit=0') && doc.includes('init → scan'),
    '报告应给出发布后 C 组复核结论（新发布物内内核可执行 + 闭环）',
  );
  assert.ok(
    doc.includes('darwin-arm64') || doc.includes('macOS 全矩阵'),
    '缺测范围必须点名（macOS 本机全矩阵）',
  );
});

test('契约：0.9.2 再基线的报告摘要与原始基线同源', () => {
  const nextBaselinePath = join(root, 'docs', 'benchmark', 'baseline-0.9.2.json');
  const nextReportPath = join(root, 'docs', 'benchmark', 'report-0.9.2.md');
  const nextBaseline = JSON.parse(readFileSync(nextBaselinePath, 'utf8')) as Baseline;
  const nextDoc = readFileSync(nextReportPath, 'utf8');
  const marker = nextDoc.indexOf('<!-- baseline-summary');
  assert.notEqual(marker, -1, '0.9.2 报告应含 baseline-summary 同源块');
  const block = /```json\n([\s\S]*?)\n```/.exec(nextDoc.slice(marker));
  assert.ok(block !== null, '0.9.2 baseline-summary 应含 json 代码块');
  const summary = JSON.parse(block[1]) as ReturnType<typeof reportSummary> & { ci_run: number };

  assert.equal(nextBaseline.schema, BASELINE_SCHEMA);
  assert.equal(nextBaseline.version, '0.9.2');
  assert.equal(nextBaseline.ci_smoke.run_id, summary.ci_run);
  assert.deepEqual(
    nextBaseline.gaps.map((gap) => `${gap.platform}:${gap.form}`),
    ['darwin-arm64:local-matrix'],
  );
  for (const form of ['source', 'sea'] as const) {
    const tiers = nextBaseline.measurement[form].tiers['1000'];
    assert.equal(
      summary.thresholds_n1000[form].scan_ms,
      Math.round(tiers['scan-cold'].wall_ms.median),
    );
    assert.equal(
      summary.thresholds_n1000[form].validate_ms,
      Math.round(tiers.validate.wall_ms.median),
    );
    assert.equal(summary.thresholds_n1000[form].export_ms, Math.round(tiers.export.wall_ms.median));
    assert.equal(
      summary.thresholds_n1000[form].peak_rss_mb,
      Math.max(
        tiers['scan-cold'].peak_rss_mb.max,
        tiers['scan-hot'].peak_rss_mb.max,
        tiers.validate.peak_rss_mb.max,
        tiers.export.peak_rss_mb.max,
      ),
    );
    for (const item of nextBaseline.inflection[form]) {
      assert.equal(summary.inflection[form][item.scenario], item.classification);
      assert.notEqual(item.classification, 'significant', '0.9.2 不应有显著超线性项');
    }
  }
});
