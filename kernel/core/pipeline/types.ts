/**
 * 文档流水线领域模型。
 *
 * skill-manager 作为「Skill / 插件管理 + 综合使用」的入口：既管理元数据，
 * 也自带处理问题的能力。输入一个问题，产出一条流水线计划（走哪些环节、
 * 为什么走/不走），每个环节对应一份可用的交付文档。
 *
 * 生成环节不依赖外部服务即可工作（内置 LocalReasoningProvider），
 * 也可切换到 LLM provider；两者消费同一份上下文。
 */

/** 问题类型（规则分类，不接 LLM）。 */
export type ProblemKind = 'new-feature' | 'refactor' | 'bugfix' | 'docs' | 'research';

/** 流水线环节。 */
export type PipelineStage =
  | 'requirements'
  | 'research'
  | 'design'
  | 'plan'
  | 'approval'
  | 'page-design'
  | 'ui'
  | 'interaction'
  | 'visual-style';

/** 环节状态。 */
export type StageStatus = 'pending' | 'skipped' | 'done';

/** 输入问题。 */
export interface Problem {
  id: string;
  statement: string;
  kind: ProblemKind;
  /** 是否涉及 UI / 前端 / 界面（决定是否加 UI 四件套）。 */
  involvesUi: boolean;
}

/** 单个环节的计划。 */
export interface StagePlan {
  stage: PipelineStage;
  status: StageStatus;
  /** 走/不走这个环节的理由。 */
  reason: string;
  /** 产出文档类型（doc.* 主元skill）。 */
  deliverableDoc: string;
}

/** 一条问题对应的完整流水线计划。 */
export interface PipelinePlan {
  problemId: string;
  kind: ProblemKind;
  stages: StagePlan[];
  createdAt: string;
}

/** 单份交付文档。 */
export interface DeliverableDoc {
  stage: PipelineStage;
  docType: string;
  content: string;
  source: string;
  createdAt: string;
}

/** 单个追问问题。 */
export interface Question {
  id: string;
  text: string;
  required: boolean;
  answer?: string;
}

/** 追问状态机状态。 */
export type QuestionnaireState = 'idle' | 'asking' | 'converged' | 'max_rounds_reached';

/** 决策记录。 */
export interface DecisionRecord {
  questionId: string;
  question: string;
  answer: string;
  rationale: string;
}

/** 完整的追问问卷状态。 */
export interface Questionnaire {
  problemId: string;
  state: QuestionnaireState;
  rounds: number;
  maxRounds: number;
  questions: Question[];
}

/** 问题证据来源。 */
export type EvidenceSource = 'workspace' | 'none';

/** 一个可在仓库里执行的检查步骤；命令始终以 argv 形式给出，不经 shell。 */
export interface EvidenceCheck {
  /** 这条检查要回答的问题，例如「test 仓库里的哪个用例会挂」。 */
  intent: string;
  /** 命令与参数（argv）；`cwd` 为空时在仓库根执行。 */
  argv: string[];
  /** 预期能确认或排除什么。 */
  expect: string;
}

/** 一个可疑文件：命中了问题关键词，并带有命中理由。 */
export interface EvidenceSuspect {
  /** 相对仓库根的路径。 */
  path: string;
  /** 命中的关键词。 */
  matched: string[];
  /** 为什么值得先看它（由命中位置与文件角色共同决定）。 */
  reason: string;
}

/**
 * 问题证据：由只读探查仓库得到的、与问题相关的事实。
 *
 * 这是「基础处理能力」与「套模板」的分界线：有证据时，根因假设、复现步骤、
 * 定位命令与验证方式都指向本仓库里真实存在的东西；没有证据时，各文档明确
 * 标注为推断，而不是假装已经查过。
 */
export interface ProblemEvidence {
  source: EvidenceSource;
  /** 探查的仓库根（绝对路径）；未探查时为 null。 */
  root: string | null;
  /** 技术栈线索，例如 ['node', 'typescript']。 */
  stack: string[];
  /** 从仓库推断出的可执行检查命令；没有可信来源时为空。 */
  checks: EvidenceCheck[];
  /** 与问题相关的可疑文件，按相关度倒序。 */
  suspects: EvidenceSuspect[];
  /** 与问题相关的测试文件（路径推断）。 */
  relatedTests: string[];
  /** 面向人的事实摘要（写入文档，也写进经验记录）。 */
  observations: string[];
  /** 探查过程中遇到的问题（如目录不可读），供文档如实标注。 */
  warnings: string[];
}

/**
 * 单次生成所需的上下文。
 *
 * 这是「处理问题」能力的输入契约：内置本地 provider 与 LLM provider
 * 都只从这里取事实，不再依赖 `topic: 'cli-pipeline'` 这类占位值。
 */
export interface GenerationContext {
  stage: PipelineStage;
  docType: string;
  /** 问题原文。 */
  problem: string;
  problemId: string;
  kind: ProblemKind;
  involvesUi: boolean;
  /** 调用所在宿主（用于经验适配；未知为 unspecified）。 */
  host: string;
  /** 已收集的决策记录（问答对）。 */
  decisions: DecisionRecord[];
  /** 尚未回答的必填问题。 */
  openQuestions: Question[];
  /** 本次流水线中已产出的前置文档（按环节顺序）。 */
  priorDocs: DeliverableDoc[];
  /** 由历史经验归纳出的提示（同类问题的成功标准、常用环节等）。 */
  experienceHints: string[];
  /** 问题证据；未探查时为 null，各文档据此区分「已核实」与「推断」。 */
  evidence: ProblemEvidence | null;
}

/** 智能生成提供者接口。 */
export interface IntelligenceProvider {
  readonly name: string;
  generate(prompt: string, context: GenerationContext): Promise<string>;
}

/** 流水线执行选项。 */
export interface PipelineRunOptions {
  /** 问题原文。 */
  problem: string;
  problemId: string;
  kind: ProblemKind;
  involvesUi: boolean;
  /** 宿主标识，未识别时为 unspecified。 */
  host: string;
  /** 已收集的回答（q1=a1 ...）。 */
  answers?: Record<string, string>;
  /** 检索到相似经验后预填的回答（优先级低于显式 --answers）。 */
  prefilledAnswers?: Record<string, string>;
  /** 经验适配提示。 */
  experienceHints?: string[];
  /** 问题证据；为空时按「未探查」处理。 */
  evidence?: ProblemEvidence | null;
}
