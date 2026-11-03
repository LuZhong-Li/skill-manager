/**
 * 内置本地推理 provider：skill-manager 自带的「处理问题」能力。
 *
 * 不调用任何外部服务，也不读环境变量密钥：按元 skill 的环节骨架，
 * 把问题、决策记录与前置文档组合成可用的 Markdown。它是默认 provider，
 * 因此首次安装后 `pipeline run` 立刻能产出内容；需要更强表达力时再切 LLM。
 */

import type { GenerationContext, IntelligenceProvider } from './types.ts';
import { composeStageContent } from './local-content.ts';

export class LocalReasoningProvider implements IntelligenceProvider {
  readonly name = 'local';

  async generate(_prompt: string, context: GenerationContext): Promise<string> {
    return composeStageContent(context);
  }
}

/**
 * 兼容旧命名：v0.8.0 及更早版本把内置 provider 称为 Stub（只输出占位文本）。
 * 保留别名避免外部脚本引用断裂，行为已升级为真实内容生成。
 */
export const StubProvider = LocalReasoningProvider;
