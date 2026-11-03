/**
 * 内置本地内容生成：界面相关环节（页面结构、组件、交互、视觉风格）。
 */

import type { GenerationContext } from './types.ts';
import {
  bullets,
  experienceSection,
  numbered,
  openQuestionsSection,
  table,
  titleOf,
} from './local-content-shared.ts';

/** 页面结构设计。 */
export function pageDesignDoc(ctx: GenerationContext): string {
  return [
    `# 页面设计：${titleOf(ctx.problem)}`,
    '',
    '## 1. 页面目标',
    '',
    `- ${ctx.problem}`,
    '',
    '## 2. 信息层级',
    '',
    numbered(['页面标题与关键操作', '核心内容区（一屏可完成主任务）', '辅助信息与设置']),
    '',
    '## 3. 区域划分',
    '',
    table(
      ['区域', '内容', '主操作'],
      [
        ['顶部', '标题、全局操作', '主操作按钮'],
        ['主体', '核心列表 / 表单 / 图表', '行内操作'],
        ['底部/侧栏', '辅助说明与设置', '保存/取消'],
      ],
    ),
    '',
    '## 4. 空态与异常态',
    '',
    bullets(['无数据：说明与引导操作', '加载中：骨架或进度', '失败：原因与重试']),
    '',
    openQuestionsSection(ctx),
    '',
    experienceSection(ctx),
  ].join('\n');
}

/** 组件设计。 */
export function uiDoc(ctx: GenerationContext): string {
  return [
    `# 组件设计：${titleOf(ctx.problem)}`,
    '',
    '## 1. 组件清单',
    '',
    table(
      ['组件', '职责', '输入', '事件'],
      [
        ['页面容器', '布局与数据编排', '查询参数', '刷新/提交'],
        ['列表/表单', '展示与编辑', '数据模型', '选择/提交'],
        ['反馈组件', '提示与错误', '消息与级别', '关闭/重试'],
      ],
    ),
    '',
    '## 2. 状态与校验',
    '',
    bullets(['加载 / 空 / 错误 / 正常四态', '必填与格式校验前置', '提交中禁用重复操作']),
    '',
    '## 3. 复用关系',
    '',
    bullets(['优先复用既有组件', '新组件保持单一职责', '样式走 token，不写死颜色']),
    '',
    openQuestionsSection(ctx),
  ].join('\n');
}

/** 交互流程。 */
export function interactionDoc(ctx: GenerationContext): string {
  return [
    `# 交互文档：${titleOf(ctx.problem)}`,
    '',
    '## 1. 主流程',
    '',
    numbered(['进入页面并加载数据', '完成主操作（提交/筛选/确认）', '看到明确结果反馈']),
    '',
    '## 2. 分支与异常',
    '',
    table(
      ['场景', '处理', '用户可见反馈'],
      [
        ['校验失败', '阻止提交并定位字段', '字段级错误提示'],
        ['请求失败', '保留输入并允许重试', '错误说明 + 重试'],
        ['重复提交', '防抖/禁用', '按钮置灰与进度'],
      ],
    ),
    '',
    '## 3. 取消与回退',
    '',
    bullets(['可取消的耗时操作提供取消入口', '破坏性操作二次确认', '返回不丢失未提交内容']),
    '',
    openQuestionsSection(ctx),
  ].join('\n');
}

/** 视觉风格。 */
export function visualStyleDoc(ctx: GenerationContext): string {
  return [
    `# 视觉风格：${titleOf(ctx.problem)}`,
    '',
    '## 1. 风格关键词',
    '',
    bullets(['清晰、克制、可读', '信息优先，弱化装饰']),
    '',
    '## 2. 设计 Token',
    '',
    table(
      ['类别', '取值', '用途'],
      [
        ['主色', '品牌主色 1 个 + 中性色阶', '主操作与强调'],
        ['文字', '标题/正文/次要三级', '层级区分'],
        ['间距', '4/8 的倍数', '布局节奏'],
        ['圆角', '小/中两级', '容器与控件'],
      ],
    ),
    '',
    '## 3. 组件状态规范',
    '',
    bullets(['默认 / 悬停 / 聚焦 / 禁用 / 危险', '暗色与浅色共用语义色']),
    '',
    openQuestionsSection(ctx),
  ].join('\n');
}
