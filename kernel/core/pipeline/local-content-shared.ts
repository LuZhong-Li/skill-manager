/**
 * 内置本地内容生成的共享片段：领域提示、Markdown 小工具与通用区块。
 *
 * 拆分目的：单个文件保持在项目规模 ratchet 的 500 行阈值以内。
 */

import type {
  EvidenceCheck,
  EvidenceSuspect,
  GenerationContext,
  ProblemEvidence,
  ProblemKind,
} from './types.ts';

/** 领域提示：按关键词补充模块、验收标准与风险。 */
interface DomainHint {
  keywords: string[];
  modules: string[];
  acceptance: string[];
  risks: string[];
}

const DOMAIN_HINTS: DomainHint[] = [
  {
    keywords: ['看板', 'dashboard', '报表', '统计', '图表', '指标'],
    modules: ['指标口径与数据源', '图表与筛选', '导出与分享'],
    acceptance: ['关键指标口径唯一且可追溯', '筛选条件可组合且能保存', '数据刷新有明确时效说明'],
    risks: ['指标口径不一致导致返工', '大数据量下的查询性能'],
  },
  {
    keywords: ['导入', '导出', '批量', 'excel', 'csv', '文件'],
    modules: ['文件解析与校验', '错误定位与重试', '批量任务与进度'],
    acceptance: ['非法行有明确错误定位', '批量任务可中断可重试', '导入结果可回滚'],
    risks: ['脏数据拖垮整批任务', '大文件内存占用'],
  },
  {
    keywords: ['登录', '权限', '账号', '认证', '角色', '鉴权'],
    modules: ['身份认证', '权限模型', '审计日志'],
    acceptance: ['未授权访问被拒绝', '权限变更即时生效', '关键操作留痕'],
    risks: ['权限模型过度设计', '越权路径遗漏'],
  },
  {
    keywords: ['搜索', '检索', '筛选', '过滤', '查询'],
    modules: ['查询解析', '索引与匹配', '结果排序与分页'],
    acceptance: ['常见查询能命中且可解释', '结果稳定可复现', '空结果有引导'],
    risks: ['匹配规则与用户预期不一致', '索引更新延迟'],
  },
  {
    keywords: ['通知', '消息', '提醒', '订阅', '推送'],
    modules: ['事件定义', '模板与渠道', '去重与重试'],
    acceptance: ['通知不重复不遗漏', '失败可重试且有记录', '用户可配置开关'],
    risks: ['重复通知造成骚扰', '渠道限流'],
  },
  {
    keywords: ['接口', 'api', '集成', '同步', 'webhook', '对接'],
    modules: ['契约定义', '调用与重试', '幂等与对账'],
    acceptance: ['契约有版本与错误码', '失败可重试且幂等', '数据可对账'],
    risks: ['对端稳定性不可控', '超时与重复提交'],
  },
  {
    keywords: ['性能', '慢', '优化', '卡顿', '超时'],
    modules: ['基线测量', '瓶颈定位', '优化与回归'],
    acceptance: ['有可复现的性能基线', '优化前后有对比数据', '无功能回归'],
    risks: ['过早优化', '缺少真实数据'],
  },
];

const BUG_ROOT_CAUSES: Array<{ keywords: string[]; causes: string[] }> = [
  {
    keywords: ['崩溃', 'crash', '闪退', '退出码'],
    causes: [
      '异常路径未捕获（空值/越界/类型不符）',
      '原生或运行时兼容问题',
      '资源耗尽（内存/句柄）',
    ],
  },
  {
    keywords: ['报错', 'error', '失败', '异常'],
    causes: ['输入校验缺失', '配置或依赖版本不匹配', '外部服务不可用或返回格式变化'],
  },
  {
    keywords: ['慢', '卡顿', '性能', '超时'],
    causes: ['数据量增长导致复杂度上升', '重复计算或重复 IO', '缺少缓存或索引'],
  },
  {
    keywords: ['数据', '丢失', '不一致', '重复'],
    causes: ['并发写入缺少保护', '迁移或批量操作未事务化', '校验逻辑与写入路径不同步'],
  },
];

/** 按关键词匹配领域提示；无命中返回 null。 */
export function hintFor(problem: string): DomainHint | null {
  const lower = problem.toLowerCase();
  let best: DomainHint | null = null;
  let bestScore = 0;
  for (const hint of DOMAIN_HINTS) {
    const score = hint.keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
    if (score > bestScore) {
      best = hint;
      bestScore = score;
    }
  }
  return best;
}

/** 按关键词给出缺陷根因假设。 */
export function rootCausesFor(problem: string): string[] {
  const lower = problem.toLowerCase();
  for (const group of BUG_ROOT_CAUSES) {
    if (group.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return group.causes;
  }
  return ['输入与边界未覆盖', '配置与环境差异', '依赖或接口契约变化'];
}

/** 证据是否已探查（不论是否定位到文件）。 */
export function probed(ctx: GenerationContext): boolean {
  return ctx.evidence !== null && ctx.evidence !== undefined && ctx.evidence.source === 'workspace';
}

/** 证据中的可疑文件；无证据时为空数组。 */
export function suspectsOf(ctx: GenerationContext): EvidenceSuspect[] {
  return ctx.evidence?.suspects ?? [];
}

/** 证据中的建议检查命令；无证据时为空数组。 */
export function checksOf(ctx: GenerationContext): EvidenceCheck[] {
  return ctx.evidence?.checks ?? [];
}

/** 把 argv 渲染成可复制的命令行（含空格的参数加引号）。 */
export function commandLine(argv: readonly string[]): string {
  return argv.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}

/** 证据摘要区块：把探查到的事实如实写进文档；未探查时明确标注。 */
export function evidenceSection(ctx: GenerationContext): string {
  const evidence: ProblemEvidence | null = ctx.evidence ?? null;
  if (evidence === null || evidence.source !== 'workspace') {
    return [
      '## 证据',
      '',
      '- 本次未探查仓库：以下结论均为**推断**，不含代码层面的核实结果',
      '- 如需基于真实代码处理，加 `--probe-root <仓库路径>` 重新生成',
      ...(evidence !== null && evidence.warnings.length > 0
        ? [`- 探查问题：${evidence.warnings.join('；')}`]
        : []),
    ].join('\n');
  }
  const lines: string[] = [
    '## 证据',
    '',
    '> 由只读探查仓库得出，可复核；未列出的事实均属推断。',
    '',
  ];
  lines.push(bullets(evidence.observations));
  if (evidence.suspects.length > 0) {
    lines.push('', '**可疑文件（按相关度）**', '');
    lines.push(
      table(
        ['文件', '命中', '理由'],
        evidence.suspects.map((item) => [
          item.path,
          item.matched.slice(0, 4).join('、'),
          item.reason,
        ]),
      ),
    );
  }
  if (evidence.relatedTests.length > 0) {
    lines.push('', `**相关测试**：${evidence.relatedTests.slice(0, 6).join('、')}`);
  }
  if (evidence.warnings.length > 0) {
    lines.push('', `**探查告警**：${evidence.warnings.join('；')}`);
  }
  return lines.join('\n');
}

/** 定位步骤区块：给出可执行的排查顺序，而不是复现模板。 */
export function locateStepsSection(ctx: GenerationContext): string {
  const suspects = suspectsOf(ctx);
  const checks = checksOf(ctx);
  if (!probed(ctx)) {
    return [
      '## 定位顺序',
      '',
      bullets([
        '先用仓库自带测试复现：`npm run test`（无此脚本时按技术栈换成对应测试命令）',
        '打开本仓库，从问题涉及的入口模块往下读' + '（本次未探查仓库，无法给出具体文件）',
        '定位到函数后补一个最小失败用例，再改',
      ]),
    ].join('\n');
  }
  const steps: string[] = [];
  for (const check of checks.slice(0, 3)) {
    steps.push(`${commandLine(check.argv)} —— ${check.intent}；${check.expect}`);
  }
  for (const suspect of suspects.slice(0, 4)) {
    steps.push(`读 \`${suspect.path}\`（${suspect.reason}），确认该路径是否被问题触发`);
  }
  if (steps.length === 0) {
    steps.push('仓库中未找到相关文件：先确认问题是否属于本仓库，或换更贴近现象的描述词重试');
  }
  return ['## 定位顺序', '', numbered(steps)].join('\n');
}

/** 问题标题：取首句，限制长度，避免把整段描述塞进标题。 */
export function titleOf(problem: string): string {
  const first = problem
    .split(/[。！？\n;；]/)
    .map((part) => part.trim())
    .find((part) => part !== '');
  const text = first ?? problem.trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text === '' ? '未命名问题' : text;
}

/** 取某个问卷问题的回答。 */
export function answerOf(ctx: GenerationContext, questionId: string): string | null {
  const hit = ctx.decisions.find((item) => item.questionId === questionId);
  return hit === undefined || hit.answer.trim() === '' ? null : hit.answer.trim();
}

/** Markdown 列表。 */
export function bullets(items: readonly string[], emptyText = '（暂无）'): string {
  return items.length === 0 ? `- ${emptyText}` : items.map((item) => `- ${item}`).join('\n');
}

/** Markdown 有序列表。 */
export function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${String(index + 1)}. ${item}`).join('\n');
}

/** Markdown 表格。 */
export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

/** 决策记录区块：统一以 Markdown 表格呈现，便于评审与经验回归。 */
export function decisionsSection(ctx: GenerationContext): string {
  if (ctx.decisions.length === 0) {
    return '## 决策记录\n\n- 本次未提供显式回答，文中结论按问题描述与同类经验推断，标注为「待确认」的项需人工确认。';
  }
  const rows = ctx.decisions.map((item) => [item.question, item.answer, item.rationale]);
  return `## 决策记录\n\n${table(['问题', '回答', '依据'], rows)}`;
}

/** 待确认问题区块；没有未答问题时返回空串。 */
export function openQuestionsSection(ctx: GenerationContext): string {
  if (ctx.openQuestions.length === 0) return '';
  return `## 待确认问题\n\n${bullets(ctx.openQuestions.map((item) => item.text))}`;
}

/** 历史经验提示区块；无提示时返回空串。 */
export function experienceSection(ctx: GenerationContext): string {
  if (ctx.experienceHints.length === 0) return '';
  return `## 历史经验提示\n\n${bullets(ctx.experienceHints)}`;
}

/** 前置文档区块；首个环节返回空串。 */
export function priorSection(ctx: GenerationContext): string {
  if (ctx.priorDocs.length === 0) return '';
  return `## 前置文档\n\n${bullets(ctx.priorDocs.map((doc) => `${doc.stage}（${doc.docType}）`))}`;
}

/** 目标用户与痛点。 */
export function userAndPain(ctx: GenerationContext): string {
  const who = answerOf(ctx, 'q1');
  return who === null
    ? `- 目标用户：待确认（按问题描述推断为直接提出该问题的使用者）\n- 痛点：${ctx.problem}`
    : `- 目标用户：${who}\n- 痛点：${ctx.problem}`;
}

/** 成功标准：回答优先，领域提示补充。 */
export function successCriteria(ctx: GenerationContext): string[] {
  const answer = answerOf(ctx, 'q2');
  const hint = hintFor(ctx.problem);
  const criteria = answer === null ? ['问题描述中的目标可被验证达成'] : [answer];
  if (hint !== null) criteria.push(...hint.acceptance.slice(0, 2));
  criteria.push('有可复现的验收方式（步骤或用例）');
  return criteria;
}

/** 硬约束。 */
export function constraints(ctx: GenerationContext): string[] {
  const answer = answerOf(ctx, 'q3');
  return answer === null ? ['待确认（时间、兼容性、依赖与合规约束）'] : [answer];
}

/** 本期范围（做的事情）。 */
export function scopeIn(ctx: GenerationContext): string[] {
  const hint = hintFor(ctx.problem);
  const items = ['问题描述中的核心能力'];
  if (hint !== null) items.push(...hint.modules);
  return items;
}

/** 风险清单。 */
export function risks(ctx: GenerationContext): string[] {
  const hint = hintFor(ctx.problem);
  const items = hint === null ? ['需求边界不清导致返工'] : [...hint.risks];
  if (answerOf(ctx, 'q3') === null) items.push('硬约束尚未确认');
  return items;
}

/** 参考与竞品。 */
export function referenceNote(ctx: GenerationContext): string[] {
  const answer = answerOf(ctx, 'q4');
  return answer === null ? ['暂无参考或竞品信息（待确认）'] : [answer];
}

/** 问题类型中文标签。 */
export function kindLabel(kind: ProblemKind): string {
  const labels: Record<ProblemKind, string> = {
    'new-feature': '新功能',
    refactor: '重构',
    bugfix: '缺陷修复',
    docs: '文档',
    research: '调研',
  };
  return labels[kind];
}
