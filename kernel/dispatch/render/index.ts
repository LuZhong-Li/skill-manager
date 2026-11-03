/**
 * L2 输出渲染。
 *
 * 三种通道承载同一份信息：人类可读文本、机器可读结构、机器表格。
 * 结构化输出是权威形态，其余两种由它派生，不得增删语义。
 */
import type { Result } from '@skill-manager/contract';
import type { InventoryHostNode, InventorySummary } from '@skill-manager/contract';

export interface RenderOptions {
  json: boolean;
  machine: boolean;
  color: boolean;
  verbose?: boolean;
}

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  green: '\u001b[32m',
};

/** 渲染结果封装为待输出文本 */
export function render(result: Result<unknown>, options: RenderOptions): string {
  if (options.json) return JSON.stringify(result, null, 2);
  if (options.machine) return renderMachine(result);
  return renderHuman(result, options.color, options.verbose === true);
}

function paint(text: string, color: keyof typeof ANSI, enabled: boolean): string {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function renderHuman(result: Result<unknown>, color: boolean, verbose: boolean): string {
  const lines: string[] = [];
  appendHeader(result, lines, color);
  appendFindings(result, lines, color);
  appendChanges(result, lines, color);
  appendOutcome(result, lines, color, verbose);
  return lines.join('\n');
}

function appendHeader(result: Result<unknown>, lines: string[], color: boolean): void {
  const status = result.ok
    ? paint('成功', 'green', color)
    : paint(`失败（退出码 ${result.exit_code}）`, 'red', color);
  lines.push(`指令 ${result.command}：${status}`);
  if (result.preview === true) {
    lines.push(paint('  预演模式：未写入任何文件，下列变更均未发生', 'dim', color));
  }
  if (abortedReason(result) !== null) {
    lines.push(paint('  已取消：未做任何变更', 'dim', color));
  }
}

function appendFindings(result: Result<unknown>, lines: string[], color: boolean): void {
  for (const item of result.findings) {
    const level =
      item.severity === 'error' ? paint('错误', 'red', color) : paint('警告', 'yellow', color);
    lines.push(`  [${level}] ${item.code} ${item.target}`);
    lines.push(`        ${item.message}`);
    if (item.remedy !== '') lines.push(`        建议：${item.remedy}`);
  }
}

function appendChanges(result: Result<unknown>, lines: string[], color: boolean): void {
  if (result.changes.length > 0) {
    lines.push(paint(`变更 ${result.changes.length} 项：`, 'dim', color));
    for (const change of result.changes) {
      lines.push(`  ${change.action} ${change.path}`);
    }
  }
}

function appendOutcome(
  result: Result<unknown>,
  lines: string[],
  color: boolean,
  verbose: boolean,
): void {
  const inventory = inventoryDataOf(result);
  if (inventory !== null) {
    lines.push(...renderInventoryHuman(inventory, color, verbose));
    return;
  }
  const pipeline = pipelineDataOf(result);
  if (pipeline !== null) {
    lines.push(...renderPipelineHuman(pipeline, color));
    return;
  }
  const experiences = experiencesDataOf(result);
  if (experiences !== null) {
    lines.push(...renderExperiencesHuman(experiences, color));
    return;
  }
  const record = experienceRecordOf(result);
  if (record !== null) {
    lines.push(...renderExperienceRecord(record, color));
    return;
  }
  if (result.ok && result.findings.length === 0 && result.changes.length === 0) {
    lines.push('  无变更');
  }
}

interface PipelineData {
  output_dir: string;
  provider: string;
  host: string;
  documents: string[];
  dry_run: boolean;
  experience_id: string | null;
  evidence?: {
    probed: boolean;
    root: string | null;
    stack: string[];
    suspects: string[];
    related_tests: string[];
    checks: string[];
    warnings: string[];
  };
  experience_adapted?: {
    sample_size: number;
    prefilled_questions: string[];
    skipped_stages: Array<{ stage: string }>;
  };
}

/**
 * pipeline run 载荷识别：以 output_dir + documents 为特征，避免与其他指令的 data 混淆。
 */
function pipelineDataOf(result: Result<unknown>): PipelineData | null {
  const data = result.data;
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record['output_dir'] !== 'string' || !Array.isArray(record['documents'])) return null;
  return data as unknown as PipelineData;
}

/** 证据段落：探查到什么就说什么，没探查就如实说明可开启。 */
function renderEvidenceLines(evidence: PipelineData['evidence'], color: boolean): string[] {
  if (evidence === undefined || !evidence.probed) {
    return [
      paint(
        '  证据：未探查仓库（结论均属推断；加 --probe-root <仓库路径> 可基于真实代码处理）',
        'dim',
        color,
      ),
    ];
  }
  const lines = [`  证据：已探查 ${evidence.root ?? ''}`.trimEnd()];
  if (evidence.stack.length > 0) lines.push(`    技术栈：${evidence.stack.join(' / ')}`);
  if (evidence.suspects.length > 0) {
    lines.push(`    可疑文件：${evidence.suspects.slice(0, 5).join('、')}`);
  } else {
    lines.push('    可疑文件：未定位到相关文件（文档内已标注为推断）');
  }
  if (evidence.checks.length > 0)
    lines.push(`    建议检查：${evidence.checks.slice(0, 3).join(' | ')}`);
  for (const warning of evidence.warnings)
    lines.push(paint(`    告警：${warning}`, 'yellow', color));
  return lines;
}

/** 经验段落：只有在真的用到历史经验时才输出。 */
function renderAdaptedLines(adapted: PipelineData['experience_adapted']): string[] {
  if (adapted === undefined || (adapted.sample_size === 0 && adapted.skipped_stages.length === 0))
    return [];
  const parts = [`样本 ${String(adapted.sample_size)} 条`];
  if (adapted.prefilled_questions.length > 0) {
    parts.push(`预填回答 ${adapted.prefilled_questions.join('、')}`);
  }
  if (adapted.skipped_stages.length > 0) {
    parts.push(`按经验跳过 ${adapted.skipped_stages.map((item) => item.stage).join('、')}`);
  }
  return [`  经验：${parts.join('，')}`];
}

/**
 * pipeline run 的人类可读摘要。
 *
 * 这条指令的价值全在载荷里，但默认输出曾经只有「成功 / 无变更」——
 * 用户看不出产出了什么、依据是什么。这里把三件事直接摆出来：
 * 产出了哪些文档、是否基于仓库证据、经验回归用到了什么。
 */
function renderPipelineHuman(data: PipelineData, color: boolean): string[] {
  const count = data.documents.filter((path) => !path.endsWith('INDEX.md')).length;
  const suffix = data.dry_run ? '（预演，未写入）' : '';
  const lines = [
    `  文档包：${String(count)} 份文档 -> ${data.output_dir}${suffix}`,
    ...data.documents.map((path) => paint(`    ${path}`, 'dim', color)),
    ...renderEvidenceLines(data.evidence, color),
    ...renderAdaptedLines(data.experience_adapted),
  ];
  if (data.experience_id !== null)
    lines.push(paint(`  经验已记录：${data.experience_id}`, 'dim', color));
  return lines;
}

interface ExperiencesData {
  count: number;
  keyword?: string;
  experiences: Array<{
    id: string;
    problem: string;
    kind: string;
    host?: string;
    createdAt: string;
    stages: string[];
  }>;
}

function experiencesDataOf(result: Result<unknown>): ExperiencesData | null {
  const data = result.data;
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const items = record['experiences'];
  if (!Array.isArray(items) || typeof record['count'] !== 'number') return null;
  return data as unknown as ExperiencesData;
}

/** experience show 的人类可读摘要：单条记录原样排版。 */
function renderExperienceRecord(record: Record<string, unknown>, color: boolean): string[] {
  const lines: string[] = [];
  const field = (key: string): string => {
    const value = record[key];
    return value === undefined || value === null ? '' : String(value);
  };
  lines.push(`  经验：${field('id')}`);
  lines.push(`    问题：${field('problem')}`);
  lines.push(`    分类：${field('kind')}；宿主：${field('host') || 'unspecified'}`);
  lines.push(`    环节：${field('stages')}`);
  const decisions = record['decisions'];
  if (Array.isArray(decisions) && decisions.length > 0) {
    lines.push('    决策：');
    for (const item of decisions) {
      const decision = item as Record<string, unknown>;
      lines.push(`      ${String(decision['question'])} → ${String(decision['answer'])}`);
    }
  }
  const evidence = record['evidence'];
  if (evidence !== null && typeof evidence === 'object') {
    const summary = evidence as Record<string, unknown>;
    const suspects = Array.isArray(summary['suspects']) ? summary['suspects'] : [];
    lines.push(`    证据：探查 ${String(summary['root'] ?? '')}`);
    lines.push(
      suspects.length === 0
        ? '      未定位到相关文件'
        : `      可疑文件：${suspects.slice(0, 5).map(String).join('、')}`,
    );
  } else {
    lines.push(paint('    证据：本记录未探查仓库', 'dim', color));
  }
  return lines;
}

/** experience show 的载荷识别：单条经验记录（含 id / problem / kind / createdAt）。 */
function experienceRecordOf(result: Result<unknown>): Record<string, unknown> | null {
  const data = result.data;
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || typeof record['problem'] !== 'string') return null;
  // 必须带经验独有的字段，避免把 Skill 详情之类的载荷误判为经验
  if (typeof record['createdAt'] !== 'string' || typeof record['kind'] !== 'string') return null;
  if (Array.isArray(record['experiences'])) return null;
  return record;
}

/** experience list / search 的人类可读摘要。 */
function renderExperiencesHuman(data: ExperiencesData, color: boolean): string[] {
  const scope = data.keyword === undefined ? '全部经验' : `匹配「${data.keyword}」`;
  if (data.count === 0) {
    return [paint(`  ${scope}：没有记录（每次 pipeline run 会累计一条）`, 'dim', color)];
  }
  const lines = [`  ${scope}：${String(data.count)} 条`];
  for (const item of data.experiences) {
    const host = item.host ?? 'unspecified';
    lines.push(`    ${item.id}  [${item.kind}/${host}]  ${item.problem}`);
  }
  lines.push(paint('  提示：详情用 experience show <id>', 'dim', color));
  return lines;
}

interface InventoryData {
  mode: 'inventory';
  summary: InventorySummary;
  hosts: InventoryHostNode[];
  copies: Array<{
    path: string;
    host_id: string;
    reconciliation: { classification: string };
  }>;
}

function inventoryDataOf(result: Result<unknown>): InventoryData | null {
  const data = result.data;
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  return record['mode'] === 'inventory' ? (data as InventoryData) : null;
}

function renderInventoryHuman(data: InventoryData, color: boolean, verbose: boolean): string[] {
  const lines: string[] = [];
  const main = data.summary.main;
  lines.push(
    `  全机盘点：${String(main.total_copies)} 个安装副本 / ${String(main.unique_skills)} 个不同技能`,
  );
  lines.push(
    `  用户 user：${String(data.summary.roles.user.total_copies)} 个副本 / ${String(data.summary.roles.user.unique_skills)} 个不同技能`,
  );
  for (const role of ['system', 'platform', 'project'] as const) {
    const item = data.summary.roles[role];
    lines.push(
      `  ${roleLabel(role)}：${String(item.total_copies)} 个副本 / ${String(item.unique_skills)} 个不同技能`,
    );
  }
  lines.push(
    `  分类：managed ${String(data.summary.classification_groups.managed.total)} · drift ${String(
      data.summary.classification_groups.drift.total,
    )} · missing ${String(data.summary.classification_groups.missing)} · untracked ${String(
      data.summary.classification_groups.untracked,
    )}`,
  );
  lines.push(
    `  其他：undetermined ${String(data.summary.classification_groups.undetermined)} · unreadable ${String(
      data.summary.classification_groups.unreadable,
    )} · orphaned ${String(data.summary.classification_groups.orphaned.total)}`,
  );
  lines.push(
    paint(
      '  提示：system/platform 为平台或系统内置；明细可用 --json 或 --verbose 查看',
      'dim',
      color,
    ),
  );
  if (data.hosts.length > 0) {
    lines.push(paint('  宿主：', 'dim', color));
    for (const host of data.hosts) {
      lines.push(
        `    ${host.display_name}（${host.host_id}）：${String(host.counts.total_copies)} 个副本 / ${String(
          host.counts.unique_skills,
        )} 个技能`,
      );
    }
  }
  if (verbose) {
    lines.push(paint('  副本明细：', 'dim', color));
    for (const copy of data.copies) {
      lines.push(`    ${copy.reconciliation.classification} ${copy.host_id} ${copy.path}`);
    }
  }
  return lines;
}

function roleLabel(role: 'system' | 'platform' | 'project'): string {
  if (role === 'system') return '系统 system';
  if (role === 'platform') return '平台 platform';
  return '项目 project';
}

/** 读取结果载荷中的取消标记；非取消结果返回 null */
function abortedReason(result: Result<unknown>): string | null {
  const data = result.data;
  if (data === undefined || data === null || typeof data !== 'object') return null;
  const aborted = (data as Record<string, unknown>)['aborted'];
  return typeof aborted === 'string' && aborted !== '' ? aborted : null;
}

function renderMachine(result: Result<unknown>): string {
  const rows: string[] = [['ok', 'command', 'exit_code', 'findings', 'changes'].join('\t')];
  rows.push(
    [
      String(result.ok),
      result.command,
      String(result.exit_code),
      String(result.findings.length),
      String(result.changes.length),
    ].join('\t'),
  );
  for (const item of result.findings) {
    rows.push(['finding', item.code, item.severity, item.target, item.message].join('\t'));
  }
  return rows.join('\n');
}
