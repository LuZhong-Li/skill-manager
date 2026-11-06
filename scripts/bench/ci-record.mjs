#!/usr/bin/env node
/**
 * 将已下载的 Bench CI artifact 固化为版本化的、可复核的烟测记录。
 *
 * CI 只跑 N=100（macOS 额外跑 1000/5000），原始 report JSON 仍保留在
 * GitHub artifact；本文件保存完整汇总、run id 与 artifact 路径，供版本基线引用。
 * 绝不把 CI 的共享 runner 数值当成性能门禁。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ARGUMENT_SETTERS = {
  '--version': (options, value) => {
    options.version = value;
  },
  '--run-id': (options, value) => {
    options.runId = Number(value);
  },
  '--input': (options, value) => {
    options.input = value;
  },
  '--out': (options, value) => {
    options.out = value;
  },
};

function assertOptions(options) {
  for (const key of ['version', 'runId', 'input', 'out']) {
    if (options[key] === null || options[key] === '') throw new Error(`缺少 --${key}`);
  }
  if (!Number.isInteger(options.runId) || options.runId <= 0)
    throw new Error('--run-id 必须是正整数');
}

function parseArgs(argv) {
  const options = { version: null, runId: null, input: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const setter = ARGUMENT_SETTERS[token];
    if (setter === undefined) throw new Error(`未知选项：${token}`);
    index += 1;
    if (index >= argv.length) throw new Error(`选项 ${token} 缺少取值`);
    setter(options, argv[index]);
  }
  assertOptions(options);
  return options;
}

function findReports(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^report-.*\.json$/.test(entry.name)) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

function summarize(report) {
  const samples = {};
  for (const sample of report.samples) {
    samples[sample.scenario] = {
      wall_median_ms: sample.wall_ms.median,
      peak_rss_max_mb: sample.peak_rss_mb.max,
      coverage: sample.stages?.coverage ?? null,
      exit_codes: sample.exit_codes,
    };
  }
  return samples;
}

function platformOf(report) {
  if (report.environment.platform === 'darwin') return 'macos';
  if (report.environment.platform === 'win32') return 'windows';
  return report.environment.platform;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawReports = findReports(options.input).map((path) => ({
    path,
    report: JSON.parse(readFileSync(path, 'utf8')),
  }));
  const platforms = new Map();
  for (const item of rawReports) {
    const platform = platformOf(item.report);
    const entry = platforms.get(platform) ?? {
      platform,
      runner: item.report.environment.os_release,
      arch: item.report.environment.arch,
      kernel: item.report.environment.kernel,
      samples: { source: {}, sea: {} },
    };
    const form = item.report.environment.kernel_form;
    const n = item.report.fixture.n;
    entry.samples[form][`n${String(n)}`] = summarize(item.report);
    platforms.set(platform, entry);
  }
  const ordered = ['linux', 'windows', 'macos'].map((platform) => {
    const entry = platforms.get(platform);
    if (entry === undefined) throw new Error(`CI artifact 缺少 ${platform} 报告`);
    return entry;
  });
  const record = {
    schema: 'bench-ci-smoke/1',
    version: options.version,
    collection:
      'GitHub Actions artifact 下载后由 scripts/bench/ci-record.mjs 汇总；完整原始报告保留在 Actions artifact（14 天）',
    note: 'CI 为共享 runner，数值仅记录、不可作绝对性能门禁；用途是验证三平台采样链路和真机路径。',
    run_id: options.runId,
    run_url: `https://github.com/LuZhong-Li/skill-manager/actions/runs/${String(options.runId)}`,
    platforms: ordered,
    artifact_layout: {
      linux: `bench-linux-run${String(options.runId)}`,
      windows: `bench-windows-run${String(options.runId)}`,
      macos: `bench-macos-run${String(options.runId)}（含 extra/ 的 N=1000、N=5000 补充矩阵）`,
    },
    gaps: [],
  };
  writeFileSync(options.out, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `CI 烟测记录已写入 ${options.out}（${String(rawReports.length)} 份原始报告）\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

export { findReports, summarize };
