/**
 * 元 skill 注册表：把流水线环节映射到「角色 + 写作指令 + 交付文档类型」。
 *
 * 元 skill 是 skill-manager 自带的问题处理骨架：即使不接外部 LLM，
 * 内置本地 provider 也会按同一组环节与文档骨架产出可读内容；
 * 接入 LLM 时，role 作为 system prompt、instruction 作为任务指令。
 */

import type { PipelineStage } from './types.ts';

/** 元 skill 定义。 */
export interface MetaSkill {
  id: string;
  stage: PipelineStage;
  docType: string;
  /** 该环节的角色设定（LLM system prompt 的核心）。 */
  role: string;
  /** 该环节要产出的文档与必须覆盖的要点。 */
  instruction: string;
}

/** 已注册的元 skill 列表。 */
const META_SKILLS: MetaSkill[] = [
  {
    id: 'doc.requirements',
    stage: 'requirements',
    docType: 'requirements',
    role: '你是资深产品经理，负责把一句问题描述收敛成可执行的需求。',
    instruction:
      '输出需求文档：目标、目标用户与痛点、范围（做/不做）、成功标准、验收标准、风险与待确认问题。' +
      '能从问题与回答中推断的内容直接写，推断不了的列为待确认，不要留空占位。',
  },
  {
    id: 'research.fetch',
    stage: 'research',
    docType: 'research',
    role: '你是技术调研负责人，负责给出可比较的方案结论。',
    instruction:
      '输出调研文档：候选方案（至少两个）、评估维度（成本/风险/维护性/交付周期）、' +
      '每个方案的适用条件与代价、推荐结论与理由。',
  },
  {
    id: 'design.arch',
    stage: 'design',
    docType: 'design',
    role: '你是系统架构师，负责把需求落成可实现的结构。',
    instruction:
      '输出设计文档：整体架构、核心模块与职责、关键接口与数据结构、错误处理与边界、' +
      '与需求的对应关系、技术风险与取舍。',
  },
  {
    id: 'page-design.layout',
    stage: 'page-design',
    docType: 'page-design',
    role: '你是页面结构设计师，负责信息架构与页面分区。',
    instruction: '输出页面设计文档：页面目标、信息层级、区域划分、主要操作入口、空态与异常态。',
  },
  {
    id: 'ui.components',
    stage: 'ui',
    docType: 'ui',
    role: '你是前端组件设计者，负责组件边界与复用。',
    instruction: '输出组件文档：组件清单、职责与输入输出、状态与校验、复用关系与实现注意点。',
  },
  {
    id: 'interaction.flow',
    stage: 'interaction',
    docType: 'interaction',
    role: '你是交互设计师，负责主流程与异常流程。',
    instruction: '输出交互文档：主流程步骤、分支与异常、反馈与加载态、取消与回退、可访问性要点。',
  },
  {
    id: 'visual-style.tokens',
    stage: 'visual-style',
    docType: 'visual-style',
    role: '你是视觉设计负责人，负责风格与设计 token。',
    instruction:
      '输出视觉风格文档：风格关键词、颜色/字体/间距/圆角 token、组件状态规范、明暗与响应式约定。',
  },
  {
    id: 'plan.milestone',
    stage: 'plan',
    docType: 'plan',
    role: '你是交付负责人，负责把设计拆成可验收的里程碑。',
    instruction:
      '输出计划文档：里程碑与目标、每阶段任务与产出、验收标准映射、依赖与风险、' +
      '工作量粗估与并行建议。',
  },
  {
    id: 'approval.review',
    stage: 'approval',
    docType: 'approval',
    role: '你是评审人，负责在收口前找出遗漏与风险。',
    instruction: '输出评审文档：评审清单与结论、需求覆盖检查、未决问题、风险与放行建议。',
  },
];

/** 环节顺序（供计划与上下文链使用）。 */
export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = META_SKILLS.map(
  (skill) => skill.stage,
);

/**
 * 根据环节获取对应的元 skill。找不到时抛错。
 */
export function getMetaSkill(stage: PipelineStage): MetaSkill {
  const skill = META_SKILLS.find((item) => item.stage === stage);
  if (!skill) {
    throw new Error(`Meta skill not found for stage: ${stage}`);
  }
  return skill;
}

/** 全部元 skill（只读）。 */
export function listMetaSkills(): readonly MetaSkill[] {
  return META_SKILLS;
}
