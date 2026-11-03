/** 经验回归：宿主识别、画像归纳与适配判定。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptPlanWithProfile,
  answersFromProfile,
  buildExperienceProfile,
  detectHost,
  experienceHintsOf,
  MIN_ADAPT_SAMPLES,
  UNKNOWN_HOST,
} from '../../kernel/core/experience/profile.ts';
import type { ExperienceRecord } from '../../kernel/core/experience/types.ts';
import type { PipelinePlan } from '../../kernel/core/pipeline/types.ts';

function recordOf(overrides: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    id: `exp-${Math.random().toString(36).slice(2, 8)}`,
    problem: '做一个数据看板',
    kind: 'new-feature',
    involvesUi: false,
    stages: ['requirements', 'design', 'plan', 'approval'],
    skippedStages: ['research'],
    decisions: [
      { questionId: 'q1', question: '这个问题要解决谁的痛点？', answer: '运营人员' },
      { questionId: 'q2', question: '成功标准是什么？', answer: '实时刷新' },
    ],
    docTypes: ['requirements', 'design', 'plan', 'approval'],
    provider: 'local',
    host: 'claude',
    durationMs: 10,
    createdAt: '2026-11-03T00:00:00Z',
    summary: '做一个数据看板',
    ...overrides,
  };
}

function planOf(kind: PipelinePlan['kind']): PipelinePlan {
  return {
    problemId: 'p',
    kind,
    stages: [
      {
        stage: 'requirements',
        status: 'pending',
        reason: '需要',
        deliverableDoc: 'doc.requirements',
      },
      { stage: 'research', status: 'pending', reason: '需要', deliverableDoc: 'doc.research' },
      { stage: 'design', status: 'pending', reason: '需要', deliverableDoc: 'doc.design' },
    ],
    createdAt: '2026-11-03T00:00:00Z',
  };
}

test('宿主识别：显式参数优先，其次环境变量，再按宿主特征推断', () => {
  assert.equal(detectHost('cursor', { CLAUDECODE: '1' }), 'cursor');
  assert.equal(detectHost(undefined, { SKILL_MANAGER_HOST: 'codex', CLAUDECODE: '1' }), 'codex');
  assert.equal(detectHost(undefined, { CLAUDECODE: '1' }), 'claude');
  assert.equal(detectHost(undefined, { CURSOR_TRACE_ID: 'trace' }), 'cursor');
  assert.equal(detectHost(undefined, { CODEX_HOME: '/x' }), 'codex');
  assert.equal(detectHost(undefined, {}), UNKNOWN_HOST);
});

test('画像归纳：同宿主与旧记录参与，其他宿主不串味', () => {
  const records = [
    recordOf({ host: 'claude' }),
    recordOf({
      host: 'claude',
      decisions: [{ questionId: 'q1', question: '这个问题要解决谁的痛点？', answer: '运营人员' }],
    }),
    recordOf({
      host: 'cursor',
      decisions: [{ questionId: 'q1', question: '这个问题要解决谁的痛点？', answer: '开发人员' }],
    }),
    recordOf({ host: undefined }),
  ];
  const profile = buildExperienceProfile(records, 'claude', '2026-11-03T00:00:00Z');
  assert.equal(profile.host, 'claude');
  assert.equal(profile.hostSampleSize, 2, '明确属于 claude 的样本');
  assert.equal(profile.sampleSize, 3, 'claude + 无 host 的旧记录');
  const kind = profile.kinds.find((item) => item.kind === 'new-feature');
  assert.ok(kind !== undefined);
  assert.equal(kind.count, 3);
  const q1 = kind.decisions.find((item) => item.questionId === 'q1');
  assert.equal(q1?.answer, '运营人员', '取最高票回答');
  assert.equal(q1?.count, 3);
  assert.equal(
    kind.decisions.some((item) => item.answer === '开发人员'),
    false,
    '其他宿主的回答不进入画像',
  );
  assert.equal(kind.skippedStages[0]?.stage, 'research');
  assert.equal(kind.skippedStages[0]?.ratio, 1);
});

test('按画像预填回答：同类型问题取高频回答', () => {
  const profile = buildExperienceProfile(
    [recordOf({ host: 'claude' }), recordOf({ host: 'claude' })],
    'claude',
  );
  assert.deepEqual(answersFromProfile(profile, 'new-feature'), {
    q1: '运营人员',
    q2: '实时刷新',
  });
  assert.deepEqual(answersFromProfile(profile, 'bugfix'), {}, '没有同类样本时不猜');
  assert.deepEqual(answersFromProfile(null, 'new-feature'), {});
});

test('经验提示：样本数、常走环节与历史成功标准', () => {
  const profile = buildExperienceProfile([recordOf(), recordOf()], 'claude');
  const hints = experienceHintsOf(profile, 'new-feature');
  assert.ok(hints.some((hint) => hint.includes('2 条')));
  assert.ok(hints.some((hint) => hint.includes('常走环节')));
  assert.ok(hints.some((hint) => hint.includes('历史成功标准：实时刷新')));
  assert.deepEqual(experienceHintsOf(null, 'new-feature'), []);
});

test('计划适配：样本足够且多数跳过时才降级为 skipped', () => {
  const profile = buildExperienceProfile([recordOf(), recordOf()], 'claude');
  const adapted = adaptPlanWithProfile(planOf('new-feature'), profile);
  assert.deepEqual(
    adapted.skipped.map((item) => item.stage),
    ['research'],
  );
  const research = adapted.plan.stages.find((item) => item.stage === 'research');
  assert.equal(research?.status, 'skipped');
  assert.match(String(research?.reason), /经验适配/);
  assert.equal(
    adapted.plan.stages.find((item) => item.stage === 'requirements')?.status,
    'pending',
    '只降级被多数跳过的环节，不误伤其他环节',
  );
});

test('计划适配：样本不足时不调整', () => {
  const profile = buildExperienceProfile([recordOf()], 'claude');
  assert.equal(profile.kinds[0].count < MIN_ADAPT_SAMPLES, true, '单样本不足以形成适配结论');
  const adapted = adaptPlanWithProfile(planOf('new-feature'), profile);
  assert.deepEqual(adapted.skipped, []);
  assert.equal(adapted.plan.stages[1].status, 'pending');
});
