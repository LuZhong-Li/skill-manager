/** pipeline runner 单元测试。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalReasoningProvider,
  StubProvider,
  HumanFallbackProvider,
  getMetaSkill,
  runPipeline,
  runPipelineWithAnswers,
} from '../../kernel/core/pipeline/index.ts';
import type {
  PipelinePlan,
  PipelineStage,
  PipelineRunOptions,
  IntelligenceProvider,
  GenerationContext,
} from '../../kernel/core/pipeline/types.ts';

const DUMMY_ANSWERS = { q1: '内部用户', q2: '流程可自动化', q3: '必须离线可用' };

const BASE_OPTIONS: Omit<PipelineRunOptions, 'answers'> = {
  problem: '做一个数据看板，支持实时刷新',
  problemId: 'test-problem',
  kind: 'new-feature',
  involvesUi: false,
  host: 'claude',
};

function planOf(stages: Array<[PipelineStage, 'pending' | 'skipped' | 'done']>): PipelinePlan {
  return {
    problemId: 'test-problem',
    kind: 'new-feature',
    stages: stages.map(([stage, status]) => ({
      stage,
      status,
      reason: status === 'skipped' ? '不需要' : '需要',
      deliverableDoc: `doc.${stage}`,
    })),
    createdAt: new Date().toISOString(),
  };
}

test('LocalReasoningProvider 按环节产出真实内容（不依赖外部服务）', async () => {
  const provider = new LocalReasoningProvider();
  const docs = await runPipeline(planOf([['requirements', 'pending']]), provider, {
    ...BASE_OPTIONS,
    answers: DUMMY_ANSWERS,
  });
  assert.equal(docs.length, 1);
  const content = docs[0].content;
  assert.ok(content.includes('需求文档'));
  assert.ok(content.includes(BASE_OPTIONS.problem), '正文必须包含问题原文');
  assert.ok(content.includes('内部用户'), '正文必须包含回答');
  assert.equal(content.includes('待填写'), false, '不得再输出占位文本');
  assert.equal(docs[0].source, 'local');
});

test('草案优先：没有回答也产出文档，并列出待确认问题', async () => {
  const docs = await runPipeline(
    planOf([['requirements', 'pending']]),
    new LocalReasoningProvider(),
    {
      ...BASE_OPTIONS,
    },
  );
  assert.equal(docs.length, 1);
  assert.ok(docs[0].content.includes('待确认问题'));
  assert.ok(docs[0].content.includes('这个问题要解决谁的痛点？'));
});

test('缺陷类问题走复现与根因结构', async () => {
  const docs = await runPipeline(
    planOf([
      ['requirements', 'pending'],
      ['design', 'pending'],
    ]),
    new LocalReasoningProvider(),
    { ...BASE_OPTIONS, kind: 'bugfix', problem: '安装时崩溃并报错' },
  );
  const requirements = docs.find((doc) => doc.stage === 'requirements');
  assert.ok(requirements?.content.includes('现象与复现'));
  assert.ok(requirements?.content.includes('根因假设'));
  const design = docs.find((doc) => doc.stage === 'design');
  assert.ok(design?.content.includes('修复设计'));
});

test('skipped / done 环节不产出文档', async () => {
  const docs = await runPipeline(
    planOf([
      ['requirements', 'pending'],
      ['research', 'skipped'],
      ['design', 'done'],
    ]),
    new LocalReasoningProvider(),
    { ...BASE_OPTIONS, answers: DUMMY_ANSWERS },
  );
  assert.deepEqual(
    docs.map((doc) => doc.stage),
    ['requirements'],
  );
});

test('前置文档作为后续环节的上下文传入 provider', async () => {
  const seen: GenerationContext[] = [];
  class CapturingProvider implements IntelligenceProvider {
    readonly name = 'capture';
    async generate(_prompt: string, context: GenerationContext): Promise<string> {
      seen.push(context);
      return `# ${context.stage}\n`;
    }
  }
  await runPipeline(
    planOf([
      ['requirements', 'pending'],
      ['design', 'pending'],
    ]),
    new CapturingProvider(),
    { ...BASE_OPTIONS, answers: DUMMY_ANSWERS },
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0].priorDocs.length, 0);
  assert.equal(seen[1].priorDocs.length, 1);
  assert.equal(seen[1].priorDocs[0].stage, 'requirements');
  assert.equal(seen[1].problem, BASE_OPTIONS.problem, '上下文必须携带问题原文而不是占位 id');
});

test('HumanFallbackProvider 在 provider 抛错时回退人工模板', async () => {
  class FailingProvider implements IntelligenceProvider {
    readonly name = 'failing';
    async generate(): Promise<string> {
      throw new Error('Intentional failure');
    }
  }
  const provider = new HumanFallbackProvider(new FailingProvider());
  const docs = await runPipeline(planOf([['requirements', 'pending']]), provider, {
    ...BASE_OPTIONS,
  });
  assert.ok(docs[0].content.includes('（请人工填写）'));
  assert.equal(docs[0].source, 'failing', '回退时仍标注真实 provider 名称');
});

test('HumanFallbackProvider 成功时沿用内层 provider 名称', () => {
  const provider = new HumanFallbackProvider(new LocalReasoningProvider());
  assert.equal(provider.name, 'local');
});

test('getMetaSkill 对 9 个环节都能找到，未知环节抛错', () => {
  const stages: PipelineStage[] = [
    'requirements',
    'research',
    'design',
    'plan',
    'approval',
    'page-design',
    'ui',
    'interaction',
    'visual-style',
  ];
  for (const stage of stages) {
    assert.equal(getMetaSkill(stage).stage, stage);
  }
  assert.throws(() => {
    // @ts-expect-error testing unknown stage
    getMetaSkill('unknown-stage');
  });
});

test('runPipelineWithAnswers 收敛后产出文档且带决策记录', async () => {
  const docs = await runPipelineWithAnswers(
    planOf([
      ['requirements', 'pending'],
      ['design', 'pending'],
    ]),
    new StubProvider(),
    DUMMY_ANSWERS,
    BASE_OPTIONS,
  );
  assert.equal(docs.length, 2);
  const requirements = docs.find((doc) => doc.stage === 'requirements');
  assert.ok(requirements?.content.includes('决策记录'));
  assert.ok(requirements?.content.includes('基于用户回答'));
});

test('DeliverableDoc 字段完整', async () => {
  const docs = await runPipeline(planOf([['requirements', 'pending']]), new StubProvider(), {
    ...BASE_OPTIONS,
  });
  const doc = docs[0];
  assert.ok(doc.stage);
  assert.ok(doc.docType);
  assert.ok(doc.content.length > 0);
  assert.ok(doc.source);
  assert.ok(doc.createdAt);
});

/** 构造一份「已定位到文件」的证据，用于验证证据是否贯穿到文档。 */
const SAMPLE_EVIDENCE = {
  source: 'workspace' as const,
  root: 'D:/example-repo',
  stack: ['node', 'typescript'],
  checks: [
    {
      intent: '跑一遍仓库自带测试，确认问题可复现',
      argv: ['npm', 'run', 'test'],
      expect: '先拿到失败用例',
    },
  ],
  suspects: [
    {
      path: 'src/install.ts',
      matched: ['安装', 'throw'],
      reason: '可疑路径：第 12 行命中「安装、throw」',
    },
  ],
  relatedTests: ['tests/install.test.ts'],
  observations: ['仓库根：D:/example-repo', '技术栈：node / typescript'],
  warnings: [],
};

test('evidence 贯穿到上下文：文档写出定位到的文件与可执行命令', async () => {
  const docs = await runPipeline(
    planOf([
      ['requirements', 'pending'],
      ['design', 'pending'],
    ]),
    new LocalReasoningProvider(),
    { ...BASE_OPTIONS, kind: 'bugfix', evidence: SAMPLE_EVIDENCE },
  );
  const requirements = docs.find((doc) => doc.stage === 'requirements');
  const design = docs.find((doc) => doc.stage === 'design');
  assert.ok(requirements?.content.includes('src/install.ts'), '需求文档要写出定位到的文件');
  assert.ok(requirements?.content.includes('npm run test'), '需求文档要写出可执行命令');
  assert.ok(requirements?.content.includes('tests/install.test.ts'), '需求文档要列出相关测试');
  assert.ok(design?.content.includes('src/install.ts'), '修复设计要指向具体文件');
});

test('没有证据时文档明确标注为推断，不伪造定位结果', async () => {
  const docs = await runPipeline(planOf([['design', 'pending']]), new LocalReasoningProvider(), {
    ...BASE_OPTIONS,
    kind: 'bugfix',
  });
  const design = docs[0];
  assert.ok(design.content.includes('未探查仓库'));
  assert.equal(design.content.includes('src/install.ts'), false);
});

test('证据缺失字段不导致崩溃：空清单时给出「未定位」而非空表', async () => {
  const docs = await runPipeline(
    planOf([['requirements', 'pending']]),
    new LocalReasoningProvider(),
    {
      ...BASE_OPTIONS,
      kind: 'bugfix',
      evidence: { ...SAMPLE_EVIDENCE, suspects: [], relatedTests: [], checks: [] },
    },
  );
  assert.ok(docs[0].content.includes('未探查仓库') === false);
  assert.ok(docs[0].content.includes('仓库根'));
});
