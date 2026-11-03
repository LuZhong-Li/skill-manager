/**
 * 经验回归领域模型。
 *
 * 每次 pipeline run 处理完一个问题后自动记录一条经验；
 * 之后可以通过 experience list / search / show 查询回归，或由宿主画像
 * （profile.ts）自动预填相似问题的回答、调整同类问题的环节计划。
 */

/** 单条经验记录。 */
export interface ExperienceRecord {
  id: string;
  /** 问题原文。 */
  problem: string;
  /** 问题分类。 */
  kind: string;
  /** 是否涉及 UI。 */
  involvesUi: boolean;
  /** 走过的环节。 */
  stages: string[];
  /** 被计划跳过的环节（供经验适配判断）。 */
  skippedStages?: string[];
  /** 追问的决策记录（问答对）。 */
  decisions: ExperienceDecision[];
  /** 产出文档类型列表。 */
  docTypes: string[];
  /** 使用的 provider 名称。 */
  provider: string;
  /** 处理时所在宿主（旧记录可能缺失）。 */
  host?: string;
  /** 耗时毫秒。 */
  durationMs: number;
  /** 记录时间（ISO）。 */
  createdAt: string;
  /** 问题摘要（用于检索展示，取原文前 N 字）。 */
  summary: string;
  /** 处理时探查仓库得到的证据摘要；未探查时不写（旧记录同样缺失）。 */
  evidence?: ExperienceEvidence;
}

/** 经验中保留的证据摘要：够用来复查，又不把整份探查结果搬进记录。 */
export interface ExperienceEvidence {
  /** 探查时的仓库根（绝对路径，便于复查；不同机器上不可移植）。 */
  root: string | null;
  /** 技术栈线索。 */
  stack: string[];
  /** 定位到的可疑文件路径（按相关度）。 */
  suspects: string[];
  /** 建议过的检查命令。 */
  checks: string[];
}

/** 经验中的单条问答决策。 */
export interface ExperienceDecision {
  /** 问题标识（如 q1）；旧记录可能缺失，检索时回退到问题文本。 */
  questionId?: string;
  question: string;
  answer: string;
}
