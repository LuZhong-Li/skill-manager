/**
 * 流水线执行器：把 PipelinePlan 转换为可用的交付文档。
 *
 * 默认行为是「草案优先」：即使没有回答，也先把文档包产出来（推断内容 +
 * 待确认问题），而不是只返回一份问卷。回答越完整（显式 --answers 或由历史
 * 经验预填），文档就越具体；这条路径同时服务于内置本地 provider 与 LLM。
 */

import type {
  PipelinePlan,
  PipelineStage,
  DeliverableDoc,
  IntelligenceProvider,
  GenerationContext,
  DecisionRecord,
  Question,
  Questionnaire,
  PipelineRunOptions,
  Problem,
} from './types.ts';
import { HumanFallbackProvider } from './provider.ts';
import { getMetaSkill } from './meta-skills.ts';
import { createQuestionnaire, recordAnswer, getOpenQuestions } from './questionnaire.ts';

/** 建立问卷并回填回答。 */
function questionnaireOf(options: PipelineRunOptions): Questionnaire {
  const problem: Problem = {
    id: options.problemId,
    statement: options.problem,
    kind: options.kind,
    involvesUi: options.involvesUi,
  };
  let questionnaire = createQuestionnaire(problem);
  const answers: Record<string, string> = {
    ...(options.prefilledAnswers ?? {}),
    ...(options.answers ?? {}),
  };
  for (const [questionId, answer] of Object.entries(answers)) {
    questionnaire = recordAnswer(questionnaire, questionId, answer);
  }
  return questionnaire;
}

/** 构建决策记录；区分「用户回答」与「历史经验预填」。 */
function decisionsOf(questionnaire: Questionnaire, options: PipelineRunOptions): DecisionRecord[] {
  const explicit = options.answers ?? {};
  const prefilled = options.prefilledAnswers ?? {};
  return questionnaire.questions
    .filter((item) => item.answer !== undefined && item.answer !== '')
    .map((item) => ({
      questionId: item.id,
      question: item.text,
      answer: String(item.answer),
      rationale:
        explicit[item.id] !== undefined
          ? '基于用户回答'
          : prefilled[item.id] !== undefined
            ? '基于历史经验（同类问题）'
            : '基于用户回答',
    }));
}

/** 决策记录的 Markdown 表格；已由 provider 写入时不重复追加。 */
function decisionsMarkdown(decisions: DecisionRecord[]): string {
  const rows = decisions.map((item) => `| ${item.question} | ${item.answer} | ${item.rationale} |`);
  return ['## 决策记录', '', '| 问题 | 回答 | 依据 |', '| --- | --- | --- |', ...rows].join('\n');
}

/**
 * 执行完整流水线。
 *
 * @param plan 已生成的环节计划
 * @param provider 生成提供者（内置本地或 LLM）
 * @param options 问题、回答、宿主与经验提示
 */
export async function runPipeline(
  plan: PipelinePlan,
  provider: IntelligenceProvider,
  options: PipelineRunOptions,
): Promise<DeliverableDoc[]> {
  return runStages(plan, provider, options);
}

/**
 * 带回答的执行入口，保留原有签名以兼容既有调用方。
 */
export async function runPipelineWithAnswers(
  plan: PipelinePlan,
  provider: IntelligenceProvider,
  answers: Record<string, string>,
  options: Omit<PipelineRunOptions, 'answers'>,
): Promise<DeliverableDoc[]> {
  return runStages(plan, provider, { ...options, answers });
}

/** 内部：逐环节生成，并把已产出的文档作为后续环节的上下文。 */
async function runStages(
  plan: PipelinePlan,
  provider: IntelligenceProvider,
  options: PipelineRunOptions,
): Promise<DeliverableDoc[]> {
  const safeProvider = new HumanFallbackProvider(provider);
  const questionnaire = questionnaireOf(options);
  const decisions = decisionsOf(questionnaire, options);
  const openQuestions: Question[] = getOpenQuestions(questionnaire);
  const docs: DeliverableDoc[] = [];

  for (const stagePlan of plan.stages) {
    if (stagePlan.status !== 'pending') continue;
    const metaSkill = getMetaSkill(stagePlan.stage);
    const context: GenerationContext = {
      stage: stagePlan.stage,
      docType: metaSkill.docType,
      problem: options.problem,
      problemId: options.problemId,
      kind: options.kind,
      involvesUi: options.involvesUi,
      host: options.host,
      decisions,
      openQuestions,
      priorDocs: [...docs],
      experienceHints: options.experienceHints ?? [],
      evidence: options.evidence ?? null,
    };
    let content = await safeProvider.generate(metaSkill.instruction, context);
    if (
      stagePlan.stage === 'requirements' &&
      decisions.length > 0 &&
      !content.includes('## 决策记录')
    ) {
      content = `${content}\n\n${decisionsMarkdown(decisions)}\n`;
    }
    docs.push({
      stage: stagePlan.stage,
      docType: metaSkill.docType,
      content,
      source: safeProvider.name,
      createdAt: new Date().toISOString(),
    });
  }

  return docs;
}

/** 环节中文名（供计划调整与结果展示复用）。 */
export function stageLabel(stage: PipelineStage): string {
  return getMetaSkill(stage).docType;
}
