/**
 * 主列表的检索、排序与组合筛选。
 *
 * 这一层是纯函数：输入内核 list 载荷、筛选条件与排序键，输出稳定排序后的可见列表。
 * 界面的职责只是把用户输入翻译成这里的参数，不在这里推导任何业务状态——是否失效、
 * 是否启用全部取自内核结论（`cardStateOf`）。
 *
 * 三条硬口径（对应 M6-R18 / M6-R19）：
 * - 排序与筛选以原始稳定值为准，两种语言下结果完全一致，不随 locale 变化；
 * - 关键词匹配在大小写折叠后按子串包含判断，覆盖标识、名称、描述、来源类型与落位目标；
 * - 排序列必须稳定：同键值一律回落到标识升序，避免顺序抖动。
 */
import { cardStateOf, type CardState, type SkillSummary } from './types.ts';

export type SkillSortKey = 'id' | 'name' | 'updated_at' | 'status';

export interface SkillListQuery {
  /** 关键词；空串表示不按关键词过滤 */
  keyword: string;
  /** 状态筛选；空串表示全部状态 */
  state: CardState | '';
  /** 排序键；默认标识升序 */
  sort: SkillSortKey;
}

export const DEFAULT_SKILL_QUERY: SkillListQuery = {
  keyword: '',
  state: '',
  sort: 'id',
};

/** 关键词命中的字段：全部为内核载荷中的原始值，界面不额外合成可搜索文本 */
function haystackOf(record: SkillSummary): string[] {
  return [
    record.id,
    record.name,
    record.version ?? '',
    record.source_type,
    ...record.targets.map((item) => item.target),
    ...record.targets.map((item) => item.scope),
  ];
}

export function matchesKeyword(record: SkillSummary, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (needle === '') return true;
  return haystackOf(record).some((value) => value.toLowerCase().includes(needle));
}

export function matchesState(record: SkillSummary, state: CardState | ''): boolean {
  return state === '' || cardStateOf(record) === state;
}

/**
 * 按码位比较原始值，刻意不用 `localeCompare`：后者随运行环境的语言习惯变化，
 * 会让同一份索引在中文与英文界面下排出不同顺序，违反「两种语言下口径一致」。
 */
function compareRaw(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** 排序主键；`updated_at` 是 ISO 8601，按码位比较即等于按时间比较 */
function sortValueOf(record: SkillSummary, key: SkillSortKey): string {
  switch (key) {
    case 'name':
      return record.name.toLowerCase();
    case 'updated_at':
      return record.updated_at ?? '';
    case 'status':
      return cardStateOf(record);
    case 'id':
    default:
      return record.id;
  }
}

function compare(a: SkillSummary, b: SkillSummary, key: SkillSortKey): number {
  const primary = compareRaw(sortValueOf(a, key), sortValueOf(b, key));
  // 同键值一律回落到标识升序：相同名称与时间下顺序稳定，不随输入顺序抖动
  return primary !== 0 ? primary : compareRaw(a.id, b.id);
}

export interface SkillListResult {
  records: SkillSummary[];
  /** 命中数量，用于「N / M」式空态与计数展示 */
  matched: number;
  total: number;
}

export function selectSkills(
  records: readonly SkillSummary[],
  query: SkillListQuery,
): SkillListResult {
  const filtered = records.filter(
    (record) => matchesKeyword(record, query.keyword) && matchesState(record, query.state),
  );
  const sorted = [...filtered].sort((a, b) => compare(a, b, query.sort));
  return { records: sorted, matched: sorted.length, total: records.length };
}
