/**
 * M0 问题分类：规则匹配，不接 LLM。
 *
 * 分类口径（顺序即优先级，先命中先赢）：
 *   1. 症状类词（崩溃 / 报错 / 失败 / 慢 / 丢数据 …）优先判为 bugfix——
 *      这是最容易被漏判的一类：「更新失败」曾经因为不含 bug/error 而落进 new-feature；
 *   2. 明确的改造意图（重构 / 迁移 / 优化结构）判 refactor；
 *   3. 文档、调研类；
 *   4. 其余按新功能处理。
 *
 * 「慢 / 卡」只有在描述现象时才判缺陷：单纯写「性能优化」属于重构意图。
 */
import type { ProblemKind } from './types.ts';

/** 缺陷症状词：出现即认为在描述一个坏掉的行为。 */
const SYMPTOM_KEYWORDS = [
  'bug',
  'crash',
  'error',
  'fix',
  'broken',
  'regression',
  'fail',
  '崩溃',
  '闪退',
  '报错',
  '修复',
  '故障',
  '异常',
  '失败',
  '错误',
  '不生效',
  '没反应',
  '无法',
  '不能',
  '超时',
  '卡顿',
  '很慢',
  '太慢',
  '变慢',
  '丢数据',
  '丢失',
  '不一致',
  '重复',
  '死锁',
  '内存泄漏',
  '泄露',
  '越界',
  '乱码',
  '白屏',
  '闪退',
];

/** 性能现象词：单独出现时才按缺陷处理（「性能优化」属于重构意图）。 */
const PERF_SYMPTOM_KEYWORDS = ['慢', '卡', '超时', 'timeout', 'slow', 'lag', 'oom', '内存占用'];

const REFACTOR_KEYWORDS = [
  'refactor',
  'cleanup',
  'restructure',
  'migrate',
  'improve',
  'tech debt',
  '重构',
  '清理',
  '迁移',
  '优化结构',
  '技术债',
  '性能优化',
  '优化性能',
];

const DOCS_KEYWORDS = [
  'document',
  'docs',
  'readme',
  'guide',
  'tutorial',
  'api doc',
  '文档',
  '说明文',
  '教程',
  '注释',
];

const RESEARCH_KEYWORDS = [
  'research',
  'investigate',
  'compare',
  'evaluate',
  'feasibility',
  '调研',
  '对比',
  '评估',
  '可行性',
  '选型',
];

const UI_KEYWORDS = [
  'ui',
  'ux',
  '界面',
  '页面',
  '按钮',
  '弹窗',
  '交互',
  '视觉',
  '样式',
  '布局',
  'frontend',
  'dashboard',
  '看板',
  'view',
  'component',
  '组件',
];

export interface ClassificationResult {
  kind: ProblemKind;
  involvesUi: boolean;
}

function hasKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function classifyProblem(statement: string): ClassificationResult {
  const involvesUi = hasKeyword(statement, UI_KEYWORDS);
  if (hasKeyword(statement, SYMPTOM_KEYWORDS) || hasKeyword(statement, PERF_SYMPTOM_KEYWORDS)) {
    return { kind: 'bugfix', involvesUi };
  }
  if (hasKeyword(statement, REFACTOR_KEYWORDS)) return { kind: 'refactor', involvesUi };
  if (hasKeyword(statement, DOCS_KEYWORDS)) return { kind: 'docs', involvesUi };
  if (hasKeyword(statement, RESEARCH_KEYWORDS)) return { kind: 'research', involvesUi };
  // 默认：新功能
  return { kind: 'new-feature', involvesUi };
}
