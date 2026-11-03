/** M3 pilot 端到端测试。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../helpers/temp.ts';
import {
  classifyProblem,
  planPipeline,
  runPipelineWithAnswers,
  writeDocumentPackage,
  StubProvider,
} from '../../kernel/core/pipeline/index.ts';

test('M3 pilot: 完整文档包生成端到端', async () => {
  const problem = '把一个产品想法做成完整方案文档包';
  const outDir = makeTempDir('m3-pilot-');

  try {
    // 1. 分类
    const classification = classifyProblem(problem);

    // 2. 规划
    const plan = planPipeline({
      id: 'm3-pilot',
      statement: problem,
      kind: classification.kind,
      involvesUi: classification.involvesUi,
    });

    // 3. 模拟回答
    const answers = {
      q1: '解决产品经理的文档撰写痛点',
      q2: '成功标准是有一份完整的方案文档',
      q3: '硬约束是只用 Markdown 格式',
    };

    // 4. 运行流水线（带回答）
    const docs = await runPipelineWithAnswers(plan, new StubProvider(), answers, {
      problem,
      problemId: 'm3-pilot',
      kind: classification.kind,
      involvesUi: classification.involvesUi,
      host: 'unspecified',
    });

    // 5. 写出文档包
    writeDocumentPackage(outDir, docs);

    // 6. 验证实际生成的文件都存在
    const expectedFiles = docs.map((d) => `${d.stage}.md`);
    expectedFiles.push('INDEX.md');

    for (const file of expectedFiles) {
      const filePath = join(outDir, file);
      assert.ok(existsSync(filePath), `${file} 应该存在`);
      const content = readFileSync(filePath, 'utf-8');
      assert.ok(content.length > 0, `${file} 内容应该非空`);
    }

    // 7. 验证 INDEX.md 包含文档列表
    const indexContent = readFileSync(join(outDir, 'INDEX.md'), 'utf-8');
    for (const doc of docs) {
      assert.ok(indexContent.includes(`${doc.stage}.md`), `INDEX 应该包含 ${doc.stage}`);
    }
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true });
    throw e;
  }
});
