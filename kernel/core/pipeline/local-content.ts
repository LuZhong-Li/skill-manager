/**
 * 内置本地内容生成：核心环节（需求、调研、设计、计划、评审）。
 *
 * 设计目标：不依赖任何外部服务也能处理问题——产出的不是「待填写」占位，
 * 而是带结构、带推断、带待确认清单的文档；接入 LLM 后同一套环节骨架沿用。
 */

import type { DeliverableDoc, GenerationContext, PipelineStage } from './types.ts';
import {
  answerOf,
  bullets,
  checksOf,
  commandLine,
  constraints,
  decisionsSection,
  evidenceSection,
  experienceSection,
  hintFor,
  kindLabel,
  locateStepsSection,
  numbered,
  openQuestionsSection,
  priorSection,
  probed,
  referenceNote,
  risks,
  rootCausesFor,
  scopeIn,
  successCriteria,
  suspectsOf,
  table,
  titleOf,
  userAndPain,
} from './local-content-shared.ts';
import { interactionDoc, pageDesignDoc, uiDoc, visualStyleDoc } from './local-content-ui.ts';

/** 需求文档（new-feature / refactor / docs / research 通用）。 */
function requirementsDoc(ctx: GenerationContext): string {
  const hint = hintFor(ctx.problem);
  const acceptance = successCriteria(ctx).map((item) => `- [ ] ${item}`);
  return [
    `# 需求文档：${titleOf(ctx.problem)}`,
    '',
    `> 问题类型：${kindLabel(ctx.kind)}；宿主：${ctx.host}`,
    '',
    '## 1. 目标',
    '',
    `- 问题原文：${ctx.problem}`,
    `- 期望结果：${answerOf(ctx, 'q2') ?? '把问题描述中的目标变成可验收的交付物'}`,
    '',
    '## 2. 目标用户与痛点',
    '',
    userAndPain(ctx),
    '',
    '## 3. 范围',
    '',
    '### 本期做',
    '',
    bullets(scopeIn(ctx)),
    '',
    '### 本期不做',
    '',
    bullets(['与核心目标无关的扩展能力', '跨期规划中的依赖方改造']),
    '',
    '## 4. 成功标准',
    '',
    numbered(successCriteria(ctx)),
    '',
    '## 5. 验收标准',
    '',
    acceptance.join('\n'),
    '',
    '## 6. 约束与风险',
    '',
    `- 硬约束：${constraints(ctx).join('；')}`,
    bullets(risks(ctx)),
    '',
    '## 7. 参考与竞品',
    '',
    bullets(referenceNote(ctx)),
    '',
    ...(hint === null ? [] : ['## 8. 建议模块', '', bullets(hint.modules), '']),
    evidenceSection(ctx),
    '',
    decisionsSection(ctx),
    '',
    openQuestionsSection(ctx),
    '',
    experienceSection(ctx),
  ].join('\n');
}

/** 缺陷处理需求：以复现、期望/实际与影响面组织。 */
function bugfixRequirementsDoc(ctx: GenerationContext): string {
  const repro = probed(ctx)
    ? bullets([
        `现象原文：${ctx.problem}`,
        ...checksOf(ctx)
          .slice(0, 2)
          .map((check) => `复现手段：\`${commandLine(check.argv)}\`（${check.expect}）`),
        '最小复现路径：按「进入场景 → 触发动作 → 观察结果」补全，并与上面的命令输出一起留档',
      ])
    : bullets([
        `现象原文：${ctx.problem}`,
        '复现步骤：待补充最小复现路径（按「进入场景 → 触发动作 → 观察结果」记录）',
        '本次未探查仓库，无法给出可执行命令；加 `--probe-root <仓库路径>` 可自动生成',
      ]);
  return [
    `# 缺陷处理：${titleOf(ctx.problem)}`,
    '',
    `> 宿主：${ctx.host}`,
    '',
    '## 1. 现象与复现',
    '',
    repro,
    '',
    `- 出现频率与影响范围：${answerOf(ctx, 'q1') ?? '待确认'}`,
    '',
    '## 2. 期望行为 vs 实际行为',
    '',
    `- 期望：${answerOf(ctx, 'q2') ?? '按既有契约正常工作'}`,
    '- 实际：与期望不符（见现象）',
    '',
    '## 3. 根因假设',
    '',
    numbered(
      rootCausesFor(ctx.problem).map((cause) =>
        probed(ctx) ? `${cause}（需结合下方可疑文件核实）` : `${cause}（未探查仓库，属推断）`,
      ),
    ),
    '',
    evidenceSection(ctx),
    '',
    locateStepsSection(ctx),
    '',
    '## 4. 验证方式',
    '',
    bullets([
      '先写一个能稳定复现的用例（失败），再修',
      '修复后该用例通过且不引入其它用例回归',
      '补充边界用例（空值、并发、超大输入）',
    ]),
    '',
    '## 5. 影响面与风险',
    '',
    `- 硬约束：${constraints(ctx).join('；')}`,
    bullets(['同类代码路径可能同样受影响', '修复范围不清时优先定位再改']),
    '',
    decisionsSection(ctx),
    '',
    openQuestionsSection(ctx),
    '',
    experienceSection(ctx),
  ].join('\n');
}

/** 调研文档：给出可比较的方案与结论。 */
function researchDoc(ctx: GenerationContext): string {
  const hint = hintFor(ctx.problem);
  const recommended = hint === null ? '方案 B（增量实现）' : '方案 B（复用同类模块增量实现）';
  const rows: Array<[string, string, string]> = [
    ['方案 A：复用现成能力', '最快，成本最低', '受既有实现边界限制'],
    ['方案 B：在现有结构上增量实现', '可控、可测试、可维护', '需要设计与排期'],
    ['方案 C：引入外部服务或新依赖', '能力完整', '引入依赖与运维成本'],
  ];
  return [
    `# 调研文档：${titleOf(ctx.problem)}`,
    '',
    `> 调研目标：为「${ctx.problem}」选择实现路径`,
    '',
    '## 1. 候选方案',
    '',
    numbered([
      '方案 A：复用现成能力（内置 Skill / 已有模块）',
      '方案 B：在现有结构上增量实现',
      '方案 C：引入外部服务或新依赖',
    ]),
    '',
    '## 2. 评估维度对比',
    '',
    table(['方案', '优势', '代价'], rows),
    '',
    '## 3. 推荐结论',
    '',
    `- 推荐：${recommended}`,
    `- 理由：${answerOf(ctx, 'q2') ?? '在交付周期、可维护性与风险之间取得平衡'}`,
    '- 落地前提：先确认约束与验收口径',
    '',
    '## 4. 待确认',
    '',
    bullets([
      ...(answerOf(ctx, 'q3') === null ? ['硬约束（时间/兼容性/合规）'] : []),
      ...(hint === null
        ? ['是否有可复用的既有实现']
        : [`是否已有与「${hint.modules[0]}」相关的实现`]),
    ]),
    '',
    decisionsSection(ctx),
    '',
    openQuestionsSection(ctx),
    '',
    experienceSection(ctx),
  ].join('\n');
}

/** 设计文档（缺陷类走修复设计）。 */
function designDoc(ctx: GenerationContext): string {
  if (ctx.kind === 'bugfix') return fixDesignDoc(ctx);
  const hint = hintFor(ctx.problem);
  const suspects = suspectsOf(ctx);
  const modules =
    hint !== null
      ? hint.modules
      : suspects.length === 0
        ? ['入口与编排', '核心逻辑', '数据与持久化']
        : suspects.slice(0, 3).map((item) => item.path);
  const rows = modules.map((name, index) => [
    name,
    `承担「${name}」的职责`,
    `模块接口 ${String(index + 1)}：输入 → 处理 → 输出`,
  ]);
  return [
    `# 设计文档：${titleOf(ctx.problem)}`,
    '',
    `> 设计依据：需求文档（${ctx.kind}）；宿主：${ctx.host}`,
    '',
    '## 1. 设计目标与约束',
    '',
    bullets([
      `满足成功标准：${successCriteria(ctx)[0]}`,
      `约束：${constraints(ctx).join('；')}`,
      '结构可测试、可回滚，不引入未评估的依赖',
    ]),
    '',
    '## 2. 整体架构',
    '',
    '采用「入口 / 领域 / 存储」三层：入口只做参数与结果封装，领域层承载规则，存储层负责读写与原子性。',
    '',
    '## 3. 核心模块与职责',
    '',
    table(['模块', '职责', '接口要点'], rows),
    '',
    '## 4. 关键接口与数据结构',
    '',
    bullets([
      '输入：问题描述、回答（决策记录）、宿主标识',
      '输出：分环节文档（Markdown）与文档包索引',
      '状态：计划（pending/skipped/done）与决策记录',
    ]),
    '',
    '## 5. 错误处理与边界',
    '',
    bullets([
      '外部依赖失败时降级为人工模板，不中断整批',
      '非法输入在入口拒绝并给出可读问题码',
      '写盘失败保留原状态，不留半截产物',
    ]),
    '',
    '## 6. 需求对应关系',
    '',
    table(
      ['需求要点', '设计落点'],
      scopeIn(ctx).map((item) => [item, '设计章节 3 中的对应模块']),
    ),
    '',
    '## 7. 技术风险与取舍',
    '',
    bullets(risks(ctx)),
    '',
    evidenceSection(ctx),
    '',
    priorSection(ctx),
    '',
    experienceSection(ctx),
    '',
    decisionsSection(ctx),
  ].join('\n');
}

/** 缺陷修复设计：根因假设 → 修复方案 → 回归验证（有证据时指向具体文件）。 */
function fixDesignDoc(ctx: GenerationContext): string {
  const suspects = suspectsOf(ctx);
  const checks = checksOf(ctx);
  const hypotheses = rootCausesFor(ctx.problem)
    .slice(0, 3)
    .map((cause) => {
      const target = suspects[0] === undefined ? '待定位文件' : `\`${suspects[0].path}\``;
      return `${cause} —— 首个验证点：${target}`;
    });
  const plan = probed(ctx)
    ? [
        suspects.length === 0
          ? '未定位到相关文件：先确认问题所属仓库，或改用现象中的关键对象名词重新描述'
          : `先读 ${suspects
              .slice(0, 2)
              .map((item) => `\`${item.path}\``)
              .join('、')}，确认触发路径后最小改动`,
        '改动限定在已定位路径；不做顺手重构',
        checks.length > 0
          ? `用仓库自带命令验证：${checks
              .slice(0, 2)
              .map((check) => `\`${commandLine(check.argv)}\``)
              .join('、')}`
          : '用最小复现用例验证（仓库未声明测试命令）',
      ]
    : [
        '最小改动优先：只改导致问题的路径，不做顺手重构',
        '防御性补齐：输入校验、异常捕获与边界处理',
        '若涉及契约变化，单独列出兼容策略',
      ];
  const firstCheck = checks[0];
  const regression = probed(ctx)
    ? [
        firstCheck === undefined
          ? '回归门槛：最小复现用例由失败转通过'
          : `回归门槛：\`${commandLine(firstCheck.argv)}\` 全绿`,
        ctx.evidence !== null && ctx.evidence.relatedTests.length > 0
          ? `重点复跑相关测试：${ctx.evidence.relatedTests
              .slice(0, 4)
              .map((path) => `\`${path}\``)
              .join('、')}`
          : '相邻功能用例全绿',
        '补充同类路径的边界用例（空值、并发、超大输入）',
      ]
    : ['复现用例由失败转通过', '相邻功能用例全绿', '补充同类路径的边界用例'];
  return [
    `# 修复设计：${titleOf(ctx.problem)}`,
    '',
    `> 宿主：${ctx.host}${probed(ctx) ? '；依据：只读探查仓库的证据' : '；未探查仓库，以下为推断'}`,
    '',
    '## 1. 根因假设与验证顺序',
    '',
    numbered(hypotheses),
    '',
    evidenceSection(ctx),
    '',
    '## 2. 修复方案',
    '',
    bullets(plan),
    '',
    '## 3. 回归验证',
    '',
    bullets(regression),
    '',
    '## 4. 回滚与风险',
    '',
    bullets(['修复可独立回滚', '不改动无关注释与格式', ...risks(ctx)]),
    '',
    priorSection(ctx),
    '',
    experienceSection(ctx),
    '',
    decisionsSection(ctx),
  ].join('\n');
}

/** 计划文档：里程碑 + 任务 + 验收映射。 */
function planDoc(ctx: GenerationContext): string {
  const hint = hintFor(ctx.problem);
  const suspects = suspectsOf(ctx);
  const modules =
    hint !== null
      ? hint.modules
      : suspects.length > 0
        ? suspects.slice(0, 3).map((item) => item.path)
        : ['核心逻辑', '界面与交互', '验证与收尾'];
  const rows = modules.map((name, index) => [
    `T${String(index + 1)}`,
    name,
    `M${String(Math.min(index + 1, 3))}`,
    `完成「${name}」并通过针对性验收`,
  ]);
  return [
    `# 计划文档：${titleOf(ctx.problem)}`,
    '',
    `> 依据：需求 / 设计文档；宿主：${ctx.host}`,
    '',
    '## 1. 交付目标',
    '',
    `- 完成「${titleOf(ctx.problem)}」并达到验收标准`,
    '',
    '## 2. 里程碑',
    '',
    '### M1：打通主路径',
    '',
    bullets(['核心模块可运行', '主流程可演示']),
    '',
    '### M2：补齐边界与体验',
    '',
    bullets(['异常与空态处理', '校验与反馈完整']),
    '',
    '### M3：验证与收口',
    '',
    bullets(['验收用例全绿', '文档与经验记录更新']),
    '',
    '## 3. 任务拆分与验收映射',
    '',
    table(['任务', '内容', '里程碑', '验收'], rows),
    '',
    '## 4. 依赖与风险',
    '',
    bullets(['依赖项：硬约束中的外部条件', ...risks(ctx), '工作量按任务粒度粗估，实施前复核']),
    '',
    evidenceSection(ctx),
    '',
    decisionsSection(ctx),
    '',
    experienceSection(ctx),
  ].join('\n');
}

/** 评审文档：收口前检查遗漏与风险。 */
function approvalDoc(ctx: GenerationContext): string {
  const covered = ctx.priorDocs.map((doc) => doc.stage);
  const suspectCount = suspectsOf(ctx).length;
  const checklist: ReadonlyArray<readonly [string, boolean]> = [
    ['需求目标明确', covered.includes('requirements')],
    ['成功标准可验证', successCriteria(ctx).length > 0],
    ['方案与取舍已记录', covered.includes('research') || ctx.kind === 'bugfix'],
    ['设计可落地', covered.includes('design')],
    ['计划可排期', covered.includes('plan')],
    ['风险已识别', risks(ctx).length > 0],
    [probed(ctx) ? '已基于仓库证据定位' : '未探查仓库（结论均为推断）', suspectCount > 0],
    ['待确认问题已收敛', ctx.openQuestions.length === 0],
  ];
  return [
    `# 评审文档：${titleOf(ctx.problem)}`,
    '',
    '## 1. 评审清单',
    '',
    table(
      ['检查项', '结论'],
      checklist.map(([item, ok]) => [item, ok ? '✅ 通过' : '⚠️ 待补']),
    ),
    '',
    '## 2. 需求覆盖检查',
    '',
    table(
      ['需求要点', '是否覆盖'],
      scopeIn(ctx).map((item) => [item, '已覆盖（见设计/计划）']),
    ),
    '',
    '## 3. 未决问题',
    '',
    bullets(ctx.openQuestions.length === 0 ? ['无'] : ctx.openQuestions.map((item) => item.text)),
    '',
    '## 4. 风险与放行建议',
    '',
    bullets(risks(ctx)),
    '',
    ctx.openQuestions.length === 0
      ? '- 建议：可进入实施。'
      : '- 建议：待确认问题收敛后再实施；不影响主路径的部分可先行。',
    '',
    evidenceSection(ctx),
    '',
    priorSection(ctx),
    '',
    experienceSection(ctx),
  ].join('\n');
}

/** 环节 → 内容生成函数。 */
const COMPOSERS: Record<PipelineStage, (ctx: GenerationContext) => string> = {
  requirements: (ctx) =>
    ctx.kind === 'bugfix' ? bugfixRequirementsDoc(ctx) : requirementsDoc(ctx),
  research: researchDoc,
  design: designDoc,
  'page-design': pageDesignDoc,
  ui: uiDoc,
  interaction: interactionDoc,
  'visual-style': visualStyleDoc,
  plan: planDoc,
  approval: approvalDoc,
};

/** 生成某个环节的文档正文。 */
export function composeStageContent(ctx: GenerationContext): string {
  const composer = COMPOSERS[ctx.stage];
  const raw = composer === undefined ? `# ${ctx.docType}\n\n${ctx.problem}\n` : composer(ctx);
  // 各区块以空行分隔；空区块会留下连续空行，压缩为单空行并保证末尾换行
  return `${raw.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** 供测试与诊断使用：列出已支持的环节。 */
export function supportedStages(): PipelineStage[] {
  return Object.keys(COMPOSERS) as PipelineStage[];
}

/** 文档包索引条目（供输出层复用）。 */
export function indexEntryOf(doc: DeliverableDoc): string {
  return `- [${doc.stage}](./${doc.stage}.md) (${doc.docType}) - ${doc.source}`;
}
