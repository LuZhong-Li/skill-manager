/**
 * 经验回归：把历史处理记录归纳成「宿主画像」，并据此预填回答、调整环节计划。
 *
 * 设计取向：
 *   1. 只读归纳，不额外落盘——经验记录本身是唯一事实来源，记录越多画像越准；
 *   2. 优先使用同一宿主的记录，旧记录（无 host）降级为通用证据，避免升级后失效；
 *   3. 适配必须可解释：预填的每条回答、跳过的每个环节都由「同类历史样本占比」支撑，
 *      并写进结果供用户核对。
 */

import type { ExperienceRecord } from './types.ts';
import type { PipelinePlan, ProblemKind } from '../pipeline/types.ts';

/** 未识别宿主时的取值。 */
export const UNKNOWN_HOST = 'unspecified';

/** 经验适配生效所需的最小同类样本数。 */
export const MIN_ADAPT_SAMPLES = 2;

/** 经验适配的跳过阈值：同类历史中该环节被跳过的比例达到此值才跟着跳过。 */
export const SKIP_ADAPT_RATIO = 0.6;

/** 宿主环境特征：命中任一环境变量即认为调用来自该宿主。 */
const HOST_ENV_HINTS: Array<{ host: string; envKeys: string[] }> = [
  { host: 'claude', envKeys: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] },
  { host: 'cursor', envKeys: ['CURSOR_TRACE_ID', 'CURSOR_SESSION'] },
  { host: 'codex', envKeys: ['CODEX_HOME', 'CODEX_SANDBOX'] },
  { host: 'doubao', envKeys: ['DOUBAO_SESSION', 'DOUBAO_USER_ID'] },
];

/** 识别调用宿主：显式 --host > SKILL_MANAGER_HOST > 宿主环境变量特征。 */
export function detectHost(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicitHost = (explicit ?? '').trim();
  if (explicitHost !== '') return explicitHost;
  const envHost = (env['SKILL_MANAGER_HOST'] ?? '').trim();
  if (envHost !== '') return envHost;
  for (const hint of HOST_ENV_HINTS) {
    if (hint.envKeys.some((key) => env[key] !== undefined)) return hint.host;
  }
  return UNKNOWN_HOST;
}

/** 画像中的单条决策投票。 */
export interface ProfileDecision {
  questionId: string;
  question: string;
  answer: string;
  count: number;
}

/** 某一问题类型的画像。 */
export interface ProfileKind {
  kind: string;
  count: number;
  /** 出现过的环节及次数（按次数倒序）。 */
  stages: Array<{ stage: string; count: number }>;
  /** 被跳过的环节及比例（按比例倒序）。 */
  skippedStages: Array<{ stage: string; count: number; ratio: number }>;
  /** 决策投票（同一问题下按次数倒序）。 */
  decisions: ProfileDecision[];
}

/** 宿主画像。 */
export interface ExperienceProfile {
  host: string;
  /** 参与归纳的样本数（含无 host 的旧记录）。 */
  sampleSize: number;
  /** 明确属于该宿主的样本数。 */
  hostSampleSize: number;
  updatedAt: string;
  kinds: ProfileKind[];
}

/** 该记录是否可作为当前宿主的证据（同宿主，或升级前的无 host 记录）。 */
function isEvidence(record: ExperienceRecord, host: string): boolean {
  if (record.host === undefined || record.host === '') return true;
  return record.host === host;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** 由经验记录归纳宿主画像。 */
export function buildExperienceProfile(
  records: ExperienceRecord[],
  host: string,
  now: string = new Date().toISOString(),
): ExperienceProfile {
  const evidence = records.filter((record) => isEvidence(record, host));
  const hostSampleSize = records.filter((record) => record.host === host).length;
  const byKind = new Map<string, ExperienceRecord[]>();
  for (const record of evidence) {
    const bucket = byKind.get(record.kind) ?? [];
    bucket.push(record);
    byKind.set(record.kind, bucket);
  }

  const kinds: ProfileKind[] = [...byKind.entries()]
    .map(([kind, bucket]) => {
      const stageCounts = new Map<string, number>();
      const skipCounts = new Map<string, number>();
      for (const record of bucket) {
        for (const stage of record.stages) increment(stageCounts, stage);
        for (const stage of record.skippedStages ?? []) increment(skipCounts, stage);
      }
      const decisions = collectDecisions(bucket);
      return {
        kind,
        count: bucket.length,
        stages: [...stageCounts.entries()]
          .map(([stage, count]) => ({ stage, count }))
          .sort((a, b) => b.count - a.count),
        skippedStages: [...skipCounts.entries()]
          .map(([stage, count]) => ({ stage, count, ratio: count / bucket.length }))
          .sort((a, b) => b.ratio - a.ratio),
        decisions,
      };
    })
    .sort((a, b) => b.count - a.count);

  return { host, sampleSize: evidence.length, hostSampleSize, updatedAt: now, kinds };
}

/** 汇总同类问题中每个问题的高频回答。 */
function collectDecisions(bucket: ExperienceRecord[]): ProfileDecision[] {
  const votes = new Map<
    string,
    { questionId: string; question: string; answer: string; count: number }
  >();
  for (const record of bucket) {
    for (const decision of record.decisions) {
      const questionId = decision.questionId ?? decision.question;
      const key = `${questionId}\u0000${decision.answer}`;
      const existing = votes.get(key);
      if (existing === undefined) {
        votes.set(key, {
          questionId,
          question: decision.question,
          answer: decision.answer,
          count: 1,
        });
      } else {
        existing.count += 1;
      }
    }
  }
  return [...votes.values()].sort((a, b) => b.count - a.count);
}

/** 按问题类型取画像；没有样本返回 null。 */
export function profileKindOf(
  profile: ExperienceProfile | null,
  kind: ProblemKind,
): ProfileKind | null {
  if (profile === null) return null;
  return profile.kinds.find((item) => item.kind === kind) ?? null;
}

/**
 * 从画像预填回答：每个问题取同类问题中出现次数最多的回答。
 * 只返回至少出现过一次的回答；样本不足时不猜。
 */
export function answersFromProfile(
  profile: ExperienceProfile | null,
  kind: ProblemKind,
): Record<string, string> {
  const profileKind = profileKindOf(profile, kind);
  if (profileKind === null) return {};
  const answers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const decision of profileKind.decisions) {
    if (seen.has(decision.questionId)) continue;
    seen.add(decision.questionId);
    answers[decision.questionId] = decision.answer;
  }
  return answers;
}

/** 由画像生成可读的经验提示（用于文档正文与结果数据）。 */
export function experienceHintsOf(profile: ExperienceProfile | null, kind: ProblemKind): string[] {
  if (profile === null) return [];
  const profileKind = profileKindOf(profile, kind);
  if (profileKind === null) return [];
  const hints: string[] = [`同类历史问题 ${String(profileKind.count)} 条（宿主 ${profile.host}）`];
  if (profileKind.stages.length > 0) {
    hints.push(
      `常走环节：${profileKind.stages
        .slice(0, 4)
        .map((item) => item.stage)
        .join('、')}`,
    );
  }
  const success = profileKind.decisions.find((item) => item.questionId === 'q2');
  if (success !== undefined) {
    hints.push(`历史成功标准：${success.answer}`);
  }
  return hints;
}

/** 计划适配结果。 */
export interface PlanAdaptation {
  plan: PipelinePlan;
  /** 因历史经验被跳过的环节（含依据）。 */
  skipped: Array<{ stage: string; reason: string }>;
}

/**
 * 用画像调整环节计划：仅当同类历史样本足够且多数跳过某环节时，才把该环节
 * 从 pending 降为 skipped。从不新增环节——新增属于设计决策，不能由统计替代。
 */
export function adaptPlanWithProfile(
  plan: PipelinePlan,
  profile: ExperienceProfile | null,
): PlanAdaptation {
  const profileKind = profileKindOf(profile, plan.kind);
  if (profileKind === null || profileKind.count < MIN_ADAPT_SAMPLES) {
    return { plan, skipped: [] };
  }
  const skipped: Array<{ stage: string; reason: string }> = [];
  const stages = plan.stages.map((stagePlan) => {
    if (stagePlan.status !== 'pending') return stagePlan;
    const stat = profileKind.skippedStages.find((item) => item.stage === stagePlan.stage);
    if (stat === undefined || stat.ratio < SKIP_ADAPT_RATIO) return stagePlan;
    const percent = Math.round(stat.ratio * 100);
    const reason = `经验适配：同类历史问题中 ${String(percent)}% 不经过该环节`;
    skipped.push({ stage: stagePlan.stage, reason });
    return { ...stagePlan, status: 'skipped' as const, reason };
  });
  return { plan: { ...plan, stages }, skipped };
}
