/** IntelligenceProvider 内置实现：人工兜底包装。 */

import type { GenerationContext, IntelligenceProvider } from './types.ts';
import { getMetaSkill } from './meta-skills.ts';

/**
 * 人工兜底实现：包装另一个 provider，调用失败时返回可读的人工模板。
 * 不抛异常，保证流水线不中断。成功时沿用内层 provider 名称，便于在结果里
 * 区分「内置本地生成」与「外部 LLM 生成」。
 */
export class HumanFallbackProvider implements IntelligenceProvider {
  private readonly inner: IntelligenceProvider;

  constructor(inner: IntelligenceProvider) {
    this.inner = inner;
  }

  get name(): string {
    return this.inner.name;
  }

  async generate(prompt: string, context: GenerationContext): Promise<string> {
    try {
      return await this.inner.generate(prompt, context);
    } catch {
      const docType = context.docType === '' ? '文档' : context.docType;
      const stage = context.stage;
      let instruction = '（请人工填写）';
      try {
        instruction = getMetaSkill(stage).instruction;
      } catch {
        // 未知环节时沿用通用提示
      }
      return `# ${docType}\n\n## 生成失败，已降级为人工模板\n\n> 环节：${stage}\n\n${instruction}\n\n（请人工填写）\n`;
    }
  }
}
