/** pipeline questionnaire 单元测试。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQuestionnaire,
  recordAnswer,
  isConverged,
  nextRound,
  getOpenQuestions,
  buildDecisionRecords,
  runPipeline,
  runPipelineWithAnswers,
  StubProvider,
} from '../../kernel/core/pipeline/index.ts';
import type { PipelinePlan, Problem } from '../../kernel/core/pipeline/types.ts';

const testProblem: Problem = {
  id: 'test-problem',
  statement: '测试问题',
  kind: 'new-feature',
  involvesUi: false,
};

const testPlan: PipelinePlan = {
  problemId: 'test-problem',
  kind: 'new-feature',
  stages: [
    {
      stage: 'requirements',
      status: 'pending',
      reason: '需要',
      deliverableDoc: 'doc.requirements',
    },
    { stage: 'research', status: 'pending', reason: '需要', deliverableDoc: 'research.fetch' },
    { stage: 'design', status: 'pending', reason: '需要', deliverableDoc: 'design.arch' },
  ],
  createdAt: new Date().toISOString(),
};

test('createQuestionnaire 产出 >=3 个 required 问题', () => {
  const q = createQuestionnaire(testProblem);
  const requiredCount = q.questions.filter((x) => x.required).length;
  assert.ok(requiredCount >= 3);
});

test('recordAnswer 后问题标记已答', () => {
  let q = createQuestionnaire(testProblem);
  const questionId = q.questions[0].id;
  assert.ok(q.questions[0].answer === undefined);

  q = recordAnswer(q, questionId, '测试回答');
  assert.equal(q.questions[0].answer, '测试回答');
});

test('所有 required 回答后 isConverged=true', () => {
  let q = createQuestionnaire(testProblem);

  for (const question of q.questions) {
    if (question.required) {
      q = recordAnswer(q, question.id, '回答');
    }
  }

  assert.ok(isConverged(q));
});

test('maxRounds=3 时强制收敛', () => {
  let q = createQuestionnaire(testProblem, 3);
  assert.equal(q.state, 'asking');

  q = nextRound(q); // round 2
  q = nextRound(q); // round 3
  q = nextRound(q); // round 4 > maxRounds

  assert.equal(q.state, 'max_rounds_reached');
  assert.ok(isConverged(q));
});

test('getOpenQuestions 只返回未答的 required', () => {
  let q = createQuestionnaire(testProblem);
  const requiredCount = q.questions.filter((x) => x.required).length;
  assert.equal(getOpenQuestions(q).length, requiredCount);

  // 回答第一个必填问题
  const firstRequired = q.questions.find((x) => x.required)!;
  q = recordAnswer(q, firstRequired.id, '回答');

  assert.equal(getOpenQuestions(q).length, requiredCount - 1);
});

const testOptions = {
  problem: '测试问题',
  problemId: 'test-problem',
  kind: 'new-feature',
  involvesUi: false,
  host: 'unspecified',
} as const;

test('runPipelineWithAnswers 收敛后产出完整文档', async () => {
  const q = createQuestionnaire(testProblem);
  const answers: Record<string, string> = {};

  for (const question of q.questions) {
    if (question.required) {
      answers[question.id] = '回答';
    }
  }

  const docs = await runPipelineWithAnswers(testPlan, new StubProvider(), answers, testOptions);
  assert.ok(docs.length >= 3);
  assert.ok(docs.some((d) => d.stage === 'requirements'));
  assert.ok(docs.some((d) => d.stage === 'research'));
  assert.ok(docs.some((d) => d.stage === 'design'));
});

test('草案优先：未回答时不阻塞，产出文档并标注待确认', async () => {
  const docs = await runPipeline(testPlan, new StubProvider(), testOptions);
  assert.equal(docs.length, 3, '未回答也产出完整文档包');
  const requirements = docs.find((d) => d.stage === 'requirements');
  assert.ok(requirements?.content.includes('待确认问题'));
  assert.equal(
    docs.some((d) => d.docType === 'questionnaire-pending'),
    false,
    '不再返回问卷占位文档',
  );
});

test('buildDecisionRecords 返回已回答问题的记录', () => {
  let q = createQuestionnaire(testProblem);
  q = recordAnswer(q, q.questions[0].id, '回答1');
  q = recordAnswer(q, q.questions[1].id, '回答2');

  const records = buildDecisionRecords(q);
  assert.equal(records.length, 2);
  assert.equal(records[0].rationale, '基于用户回答');
});

test('requirements 文档包含决策记录', async () => {
  const q = createQuestionnaire(testProblem);
  const answers: Record<string, string> = {};

  for (const question of q.questions) {
    if (question.required) {
      answers[question.id] = '回答';
    }
  }

  const docs = await runPipelineWithAnswers(testPlan, new StubProvider(), answers, testOptions);
  const requirementsDoc = docs.find((d) => d.stage === 'requirements')!;
  assert.ok(requirementsDoc.content.includes('决策记录'));
});

test('nextRound 不改变已收敛状态', () => {
  let q = createQuestionnaire(testProblem);

  for (const question of q.questions) {
    if (question.required) {
      q = recordAnswer(q, question.id, '回答');
    }
  }

  assert.equal(q.state, 'converged');
  const q2 = nextRound(q);
  assert.equal(q2.state, 'converged');
});
