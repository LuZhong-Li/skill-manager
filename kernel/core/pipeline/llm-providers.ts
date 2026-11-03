/**
 * LLM Provider 实现。
 *
 * 支持 OpenAI 兼容的 API（Doubao、Claude、GPT 等）。
 * 提示词分两层：system 用元 skill 的角色设定，user 携带问题、决策记录与前置文档，
 * 因此接入 LLM 时同样具备「按环节处理问题」的骨架，而不是只写一篇泛泛的文档。
 */

import type { GenerationContext, IntelligenceProvider } from './types.ts';
import { getMetaSkill } from './meta-skills.ts';

/** LLM 配置 */
export interface LLMProviderConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** 消息格式 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** OpenAI 兼容的响应格式 */
interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/** 单份前置文档注入提示词时的最大字符数，避免上下文无限膨胀。 */
const PRIOR_DOC_EXCERPT = 1200;

/**
 * OpenAI 兼容的 LLM Provider。
 *
 * 支持：
 * - Doubao（豆包）
 * - Claude
 * - GPT
 * - 其他 OpenAI 兼容的 API
 */
export class OpenAICompatibleProvider implements IntelligenceProvider {
  readonly name: string;
  private readonly config: LLMProviderConfig;

  constructor(name: string, config: LLMProviderConfig) {
    this.name = name;
    this.config = {
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 2000,
      baseURL: 'https://api.openai.com/v1',
      ...config,
    };
  }

  async generate(_prompt: string, context: GenerationContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: this.buildUserPrompt(context) },
    ];

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API call failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const first = data.choices[0];
    return first?.message?.content ?? '';
  }

  private buildSystemPrompt(context: GenerationContext): string {
    let role = '你是负责把问题落成文档的资深工程师。';
    let instruction = `输出一份结构清晰、可直接使用的${context.docType}。`;
    try {
      const metaSkill = getMetaSkill(context.stage);
      role = metaSkill.role;
      instruction = metaSkill.instruction;
    } catch {
      // 未知环节时使用通用角色
    }
    return `${role}\n本次要产出：${context.docType}。\n${instruction}\n\n要求：\n- 只写与当前问题相关的内容，不要写通用套话；\n- 能推断的直接给出结论，推断不了的列为「待确认」；\n- 使用 Markdown，标题层级清晰，可用表格与清单。`;
  }

  private buildUserPrompt(context: GenerationContext): string {
    const parts: string[] = [
      `问题类型：${context.kind}${context.involvesUi ? '（涉及界面）' : ''}`,
      `调用宿主：${context.host}`,
      `问题原文：${context.problem}`,
    ];
    if (context.decisions.length > 0) {
      parts.push(
        `已确认的决策：\n${context.decisions
          .map((item) => `- ${item.question} → ${item.answer}`)
          .join('\n')}`,
      );
    }
    if (context.openQuestions.length > 0) {
      parts.push(
        `尚未确认（写入「待确认」）：\n${context.openQuestions
          .map((item) => `- ${item.text}`)
          .join('\n')}`,
      );
    }
    if (context.experienceHints.length > 0) {
      parts.push(`历史经验：\n${context.experienceHints.map((hint) => `- ${hint}`).join('\n')}`);
    }
    for (const doc of context.priorDocs) {
      const excerpt =
        doc.content.length > PRIOR_DOC_EXCERPT
          ? `${doc.content.slice(0, PRIOR_DOC_EXCERPT)}…`
          : doc.content;
      parts.push(`前置文档 ${doc.stage}（${doc.docType}）节选：\n${excerpt}`);
    }
    return parts.join('\n\n');
  }
}

/**
 * 创建豆包 (Doubao) Provider
 */
export function createDoubaoProvider(config: LLMProviderConfig): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('doubao', {
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'ep-20241203182217-q5666',
    ...config,
  });
}

/**
 * 创建 Claude Provider
 */
export function createClaudeProvider(config: LLMProviderConfig): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('claude', {
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-3-haiku-20240307',
    ...config,
  });
}
