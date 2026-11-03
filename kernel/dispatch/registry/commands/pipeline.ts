/** pipeline 命令处理器。 */

import { CODES, type Finding } from '@skill-manager/contract';
import { finding } from '../../../store/findings.ts';
import { toKernelError } from '../../../store/errors.ts';
import { buildResult, type Result } from '../../result/index.ts';
import { option, optionList, flag } from '../../parsers/index.ts';
import {
  classifyProblem,
  planPipeline,
  runPipeline,
  LocalReasoningProvider,
  writeDocumentPackage,
  createDoubaoProvider,
  createClaudeProvider,
  OpenAICompatibleProvider,
  probeWorkspace,
} from '../../../core/pipeline/index.ts';
import type { CommandContext, CommandHandler, CommandSpec } from '../types.ts';
import type {
  DeliverableDoc,
  IntelligenceProvider,
  ProblemEvidence,
} from '../../../core/pipeline/types.ts';
import { join } from 'node:path';
import { layoutOf, resolveWorkspaceRoot } from '../../../store/workspace/index.ts';
import {
  buildExperience,
  countUnreadableExperiences,
  findSimilarExperience,
  listExperiences,
  newExperienceId,
  saveExperience,
} from '../../../core/experience/store.ts';
import {
  adaptPlanWithProfile,
  answersFromProfile,
  buildExperienceProfile,
  detectHost,
  experienceHintsOf,
} from '../../../core/experience/profile.ts';
import type { ExperienceDecision, ExperienceRecord } from '../../../core/experience/types.ts';

/** 固定问卷的问题文案（与 questionnaire.ts 同源；经验记录里保留 questionId 以便回填）。 */
const QUESTION_TEXTS: Record<string, string> = {
  q1: '这个问题要解决谁的痛点？',
  q2: '成功标准是什么？',
  q3: '有哪些硬约束？',
  q4: '有没有相关的参考或竞品？',
};

/** 校验必填选项；缺失时返回对应 findings。 */
function inputFindings(problem: string | undefined, outputDir: string | undefined): Finding[] {
  const findings: Finding[] = [];
  if (!problem) {
    findings.push(
      finding(CODES.INPUT_MISSING_ARG, {
        source: 'input',
        target: '--problem',
        message: '缺少 --problem 选项',
        remedy: '请提供 --problem "问题描述"',
      }),
    );
  }
  if (!outputDir) {
    findings.push(
      finding(CODES.INPUT_MISSING_ARG, {
        source: 'input',
        target: '--output-dir',
        message: '缺少 --output-dir 选项',
        remedy: '请提供 --output-dir 目录路径',
      }),
    );
  }
  return findings;
}

/**
 * 预填回答：相似经验的决策最具体，其次是宿主画像的高频回答。
 * 已有显式 `--answers` 的题目不回填，保证用户输入永远优先。
 */
function prefillAnswers(
  answers: Record<string, string>,
  profile: ReturnType<typeof buildExperienceProfile>,
  similar: ExperienceRecord | null,
  kind: string,
): Record<string, string> {
  const prefilled: Record<string, string> = {};
  for (const decision of similar?.decisions ?? []) {
    const questionId = decision.questionId ?? questionIdOf(decision.question);
    if (questionId !== undefined) prefilled[questionId] = decision.answer;
  }
  for (const [questionId, answer] of Object.entries(answersFromProfile(profile, kind as never))) {
    if (prefilled[questionId] === undefined) prefilled[questionId] = answer;
  }
  return prefilled;
}

/** pipeline run 命令处理器 */
const pipelineRunHandler: CommandHandler = async (context): Promise<Result<unknown>> => {
  const problem = option(context.args, 'problem');
  const outputDir = option(context.args, 'output-dir');
  const answersRaw = optionList(context.args, 'answers');

  const findings = inputFindings(problem, outputDir);
  if (problem === undefined || outputDir === undefined) {
    return buildResult(context.args.command, findings);
  }

  // 解析 answers（格式 q1=a1）
  const answers = parseAnswers(answersRaw);

  const workspaceRoot = resolveWorkspaceRoot(option(context.args, 'workspace'));
  const layout = layoutOf(workspaceRoot);
  const host = detectHost(option(context.args, 'host'));
  const classification = classifyProblem(problem);

  // 经验回归：读取历史记录 -> 归纳宿主画像 -> 预填回答 / 调整环节计划
  const profile = buildExperienceProfile(listExperiences(layout.experiencesDir), host);
  const similar = resolveSimilarExperience(context, layout.experiencesDir);
  const prefilled = prefillAnswers(answers, profile, similar, classification.kind);

  // 证据探查：指定仓库时只读取磁盘、不执行任何命令，结论写入各环节文档
  const repoRoot = resolveProbeRoot(context);
  const evidence: ProblemEvidence | null =
    repoRoot === null ? null : probeWorkspace(repoRoot, problem, classification.kind);

  const plan = planPipeline({
    id: 'cli-pipeline',
    statement: problem,
    kind: classification.kind,
    involvesUi: classification.involvesUi,
  });
  const adaptation = adaptPlanWithProfile(plan, profile);
  const provider = createProvider(context);

  const startedAt = Date.now();
  const docs = await runPipeline(adaptation.plan, provider, {
    problem,
    problemId: 'cli-pipeline',
    kind: classification.kind,
    involvesUi: classification.involvesUi,
    host,
    answers,
    prefilledAnswers: prefilled,
    experienceHints: experienceHintsOf(profile, classification.kind),
    evidence,
  });
  const durationMs = Date.now() - startedAt;

  const dryRun = flag(context.args, 'dry-run');
  const persist = persistRun({
    dryRun,
    outputDir,
    docs,
    experiencesDir: layout.experiencesDir,
    problem,
    kind: classification.kind,
    involvesUi: classification.involvesUi,
    host,
    plan: adaptation.plan,
    provider,
    answers,
    prefilled,
    durationMs,
    evidence,
  });
  if (persist.finding !== null) {
    return buildResult(context.args.command, [persist.finding]);
  }
  const experienceId = persist.experienceId;

  const docPaths = docs.map((doc) => join(outputDir, `${doc.stage}.md`));
  docPaths.push(join(outputDir, 'INDEX.md'));
  const prefilledQuestions = Object.keys(prefilled).filter(
    (questionId) => answers[questionId] === undefined,
  );

  return buildResult(context.args.command, [], [], {
    data: {
      message: '文档包处理完成',
      dry_run: dryRun,
      applied: !dryRun,
      output_dir: outputDir,
      provider: provider.name,
      host,
      documents: docPaths,
      experience_id: experienceId,
      experience_applied: prefilledQuestions.length > 0 || similar !== null,
      unreadable_experiences: countUnreadableExperiences(layout.experiencesDir),
      evidence: summarizeEvidence(evidence),
      experience_adapted: {
        host,
        sample_size: profile.sampleSize,
        host_sample_size: profile.hostSampleSize,
        prefilled_questions: prefilledQuestions,
        skipped_stages: adaptation.skipped,
        similar_experience: similar === null ? null : similar.id,
      },
    },
  });
};

/**
 * 证据探查的仓库根。
 *
 * 注意：`--workspace` 是**工作区**语义（索引、经验都落在这里），不能拿来当探查根——
 * 否则探查结果会污染工作区，经验也会写进被探查的仓库。探查根因此独立成 `--probe-root`。
 * 未给 `--probe-root` 时，显式 `--probe` 才回退到当前目录；两者都没有就不探查，
 * 保持 `pipeline run` 原有的纯文档行为不变。
 */
function resolveProbeRoot(context: CommandContext): string | null {
  const explicit = option(context.args, 'probe-root');
  if (explicit !== undefined && explicit !== '') return explicit;
  return flag(context.args, 'probe') ? process.cwd() : null;
}

/** 结果载荷里的证据摘要：只放计数与路径，避免把大清单塞进每次输出。 */
interface EvidenceSummary {
  probed: boolean;
  root: string | null;
  stack: string[];
  suspects: string[];
  related_tests: string[];
  checks: string[];
  warnings: string[];
}

/** 未探查时的空摘要（保留告警，便于说明为什么没探查）。 */
function emptySummary(warnings: string[]): EvidenceSummary {
  return {
    probed: false,
    root: null,
    stack: [],
    suspects: [],
    related_tests: [],
    checks: [],
    warnings,
  };
}

function summarizeEvidence(evidence: ProblemEvidence | null): EvidenceSummary {
  const probed = evidence !== null && evidence.source === 'workspace';
  if (!probed || evidence === null) return emptySummary(evidence?.warnings ?? []);
  return {
    probed: true,
    root: evidence.root,
    stack: evidence.stack,
    suspects: evidence.suspects.map((item) => item.path),
    related_tests: evidence.relatedTests,
    checks: evidence.checks.map((check) => check.argv.join(' ')),
    warnings: evidence.warnings,
  };
}

/** --experience 关键词检索相似经验；未给出或未命中返回 null。 */
function resolveSimilarExperience(
  context: CommandContext,
  experiencesDir: string,
): ExperienceRecord | null {
  const keyword = option(context.args, 'experience');
  if (keyword === undefined || keyword === '') return null;
  return findSimilarExperience(experiencesDir, keyword);
}

/** 解析 `q1=a1` 形式的回答列表。 */
function parseAnswers(raw: string[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const entry of raw) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex > 0) answers[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
  }
  return answers;
}

/** 由问题文案反查 questionId（兼容旧经验记录只存文本的情况）。 */
function questionIdOf(question: string): string | undefined {
  return Object.entries(QUESTION_TEXTS).find(([, text]) => text === question)?.[0];
}

/** 该取值是否表示内置本地 provider（含 v0.8 的 stub 兼容别名）。 */
function isLocalProviderType(type: string | undefined): type is undefined | 'local' | 'stub' {
  return type === undefined || type === 'local' || type === 'stub';
}

/** 组装外部 LLM provider 配置。 */
function llmConfigOf(
  context: CommandContext,
  apiKey: string,
): { apiKey: string; baseURL?: string; model?: string; temperature?: number } {
  const config: { apiKey: string; baseURL?: string; model?: string; temperature?: number } = {
    apiKey,
  };
  const baseURL = option(context.args, 'llm-base-url');
  const model = option(context.args, 'llm-model');
  const temperature = option(context.args, 'llm-temperature');
  if (baseURL !== undefined) config.baseURL = baseURL;
  if (model !== undefined) config.model = model;
  if (temperature !== undefined) config.temperature = parseFloat(temperature);
  return config;
}

/** 按 --llm-provider / --llm-api-key 创建 provider；缺省用内置本地 provider。 */
function createProvider(context: CommandContext): IntelligenceProvider {
  const type = option(context.args, 'llm-provider');
  const apiKey = option(context.args, 'llm-api-key');
  // 未选外部 provider，或选了却没给密钥：都使用内置本地能力，避免静默失败
  if (isLocalProviderType(type) || apiKey === undefined || apiKey === '') {
    return new LocalReasoningProvider();
  }
  const config = llmConfigOf(context, apiKey);
  if (type === 'doubao') return createDoubaoProvider(config);
  if (type === 'claude') return createClaudeProvider(config);
  return new OpenAICompatibleProvider(type, config);
}

/**
 * 写出文档包并累计经验。
 *
 * `--dry-run` 时零写入（不产出文件、不记经验），返回 null 作为经验 id，
 * 与全局 `--dry-run`「预演，不写入任何文件」的约定保持一致。
 * 写盘失败（输出路径是文件、无权限等）返回可读问题码，不让异常冒泡成崩溃栈。
 */
function persistRun(input: {
  dryRun: boolean;
  outputDir: string;
  docs: DeliverableDoc[];
  experiencesDir: string;
  problem: string;
  kind: string;
  involvesUi: boolean;
  host: string;
  plan: { stages: Array<{ stage: string; status: string }> };
  provider: { name: string };
  answers: Record<string, string>;
  prefilled: Record<string, string>;
  durationMs: number;
  evidence: ProblemEvidence | null;
}): { experienceId: string | null; finding: Finding | null } {
  try {
    if (input.dryRun) return { experienceId: null, finding: null };
    writeDocumentPackage(input.outputDir, input.docs);
    return { experienceId: recordExperience(input), finding: null };
  } catch (error) {
    const kernelError = toKernelError(error, CODES.IO_FAILED);
    return {
      experienceId: null,
      finding: finding(kernelError.code, {
        source: kernelError.source,
        target: kernelError.target ?? input.outputDir,
        message: kernelError.message,
        remedy: kernelError.remedy,
      }),
    };
  }
}

/** 把本次处理写为一条经验；失败静默（不影响主流程）。 */
function recordExperience(input: {
  experiencesDir: string;
  problem: string;
  kind: string;
  involvesUi: boolean;
  host: string;
  plan: { stages: Array<{ stage: string; status: string }> };
  docs: Array<{ docType: string }>;
  provider: { name: string };
  answers: Record<string, string>;
  prefilled: Record<string, string>;
  durationMs: number;
  evidence: ProblemEvidence | null;
}): string {
  const evidence = input.evidence;
  const evidenceSummary =
    evidence === null || evidence.source !== 'workspace'
      ? {}
      : {
          evidence: {
            root: evidence.root,
            stack: evidence.stack,
            suspects: evidence.suspects.map((item) => item.path),
            checks: evidence.checks.map((check) => check.argv.join(' ')),
          },
        };
  const record = buildExperience({
    id: newExperienceId(new Date().toISOString()),
    problem: input.problem,
    kind: input.kind,
    involvesUi: input.involvesUi,
    host: input.host,
    stages: input.plan.stages.filter((s) => s.status === 'pending').map((s) => s.stage),
    skippedStages: input.plan.stages.filter((s) => s.status === 'skipped').map((s) => s.stage),
    decisions: createDecisionRecords(input.answers, input.prefilled),
    docTypes: input.docs.map((d) => d.docType),
    provider: input.provider.name,
    durationMs: input.durationMs,
    createdAt: new Date().toISOString(),
    ...evidenceSummary,
  });
  try {
    saveExperience(input.experiencesDir, record);
  } catch {
    // 经验记录失败不影响主流程
  }
  return record.id;
}

/** 由回答构造决策记录（问题文本取问卷固定文案）。 */
function createDecisionRecords(
  answers: Record<string, string>,
  prefilled: Record<string, string>,
): ExperienceDecision[] {
  const merged: Record<string, string> = { ...prefilled, ...answers };
  return Object.entries(merged).map(([questionId, answer]) => ({
    questionId,
    question: QUESTION_TEXTS[questionId] ?? questionId,
    answer,
  }));
}

/** 注册 pipeline 命令 */
export function registerPipelineCommands(registerFn: (spec: CommandSpec) => void): void {
  registerFn({
    name: 'pipeline run',
    handler: pipelineRunHandler,
  });
}
