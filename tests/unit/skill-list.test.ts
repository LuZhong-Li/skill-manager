import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SKILL_QUERY,
  matchesKeyword,
  matchesState,
  selectSkills,
  type SkillListQuery,
} from '../../gui/renderer/src/skill-list.ts';
import type { SkillSummary } from '../../gui/renderer/src/types.ts';

function skill(overrides: Partial<SkillSummary> & { id: string }): SkillSummary {
  return {
    name: overrides.id,
    status: 'enabled',
    source_type: 'local',
    targets: [{ target: 'claude', scope: 'global', enabled: true }],
    updated_at: '2026-11-01T00:00:00Z',
    validation: { status: 'ok', errors: [] },
    ...overrides,
  };
}

function query(overrides: Partial<SkillListQuery> = {}): SkillListQuery {
  return { ...DEFAULT_SKILL_QUERY, ...overrides };
}

const fixtures: SkillSummary[] = [
  skill({ id: 'beta', name: 'Beta Skill', updated_at: '2026-11-03T00:00:00Z' }),
  skill({ id: 'alpha', name: 'Alpha Skill', updated_at: '2026-11-05T00:00:00Z' }),
  skill({
    id: 'gamma',
    name: 'Gamma',
    status: 'disabled',
    source_type: 'git',
    targets: [{ target: 'codex', scope: 'project', enabled: false }],
    updated_at: '2026-11-02T00:00:00Z',
  }),
  skill({
    id: 'delta',
    name: 'Delta',
    validation: { status: 'invalid', errors: ['E-YAML-001'] },
    updated_at: '2026-11-04T00:00:00Z',
  }),
];

test('主列表：默认标识升序，且不改动入参数组', () => {
  const input = [...fixtures];
  const result = selectSkills(input, query());
  assert.deepEqual(
    result.records.map((item) => item.id),
    ['alpha', 'beta', 'delta', 'gamma'],
  );
  assert.equal(result.total, 4);
  assert.equal(result.matched, 4);
  assert.deepEqual(
    input.map((item) => item.id),
    ['beta', 'alpha', 'gamma', 'delta'],
    '排序必须返回新数组，不得就地改写内核载荷',
  );
});

test('主列表：按名称、最近变更与状态排序，同键值回落到标识升序', () => {
  assert.deepEqual(
    selectSkills(fixtures, query({ sort: 'name' })).records.map((item) => item.id),
    ['alpha', 'beta', 'delta', 'gamma'],
  );
  assert.deepEqual(
    selectSkills(fixtures, query({ sort: 'updated_at' })).records.map((item) => item.id),
    ['gamma', 'beta', 'delta', 'alpha'],
  );
  // 状态主键按字母序 disabled < enabled < invalid，与界面上的严重度无关
  assert.deepEqual(
    selectSkills(fixtures, query({ sort: 'status' })).records.map((item) => item.id),
    ['gamma', 'alpha', 'beta', 'delta'],
  );
  const twins = [
    skill({ id: 'b-twin', name: 'Same', updated_at: '2026-11-01T00:00:00Z' }),
    skill({ id: 'a-twin', name: 'Same', updated_at: '2026-11-01T00:00:00Z' }),
  ];
  assert.deepEqual(
    selectSkills(twins, query({ sort: 'name' })).records.map((item) => item.id),
    ['a-twin', 'b-twin'],
    '同名称时必须稳定回落到标识升序',
  );
});

test('主列表：关键词按子串匹配标识、名称、来源类型与落位目标', () => {
  assert.deepEqual(
    selectSkills(fixtures, query({ keyword: 'alp' })).records.map((item) => item.id),
    ['alpha'],
  );
  assert.deepEqual(
    selectSkills(fixtures, query({ keyword: '  GIT  ' })).records.map((item) => item.id),
    ['gamma'],
    '关键词必须去空白并大小写折叠',
  );
  assert.deepEqual(
    selectSkills(fixtures, query({ keyword: 'codex' })).records.map((item) => item.id),
    ['gamma'],
    '落位目标也是可检索字段',
  );
  assert.equal(matchesKeyword(fixtures[0]!, 'beta'), true, '标识本身必须可命中');
  assert.equal(matchesKeyword(fixtures[0]!, 'not-there'), false);
});

test('主列表：状态筛选按内核结论判定，失效优先于禁用', () => {
  assert.deepEqual(
    selectSkills(fixtures, query({ state: 'invalid' })).records.map((item) => item.id),
    ['delta'],
  );
  assert.deepEqual(
    selectSkills(fixtures, query({ state: 'disabled' })).records.map((item) => item.id),
    ['gamma'],
  );
  const disabledButInvalid = skill({
    id: 'both',
    status: 'disabled',
    validation: { status: 'invalid', errors: ['E-YAML-001'] },
  });
  assert.equal(matchesState(disabledButInvalid, 'invalid'), true, '失效与禁用是两件事，失效优先');
  assert.equal(matchesState(disabledButInvalid, 'disabled'), false);
});

test('主列表：检索与状态筛选组合生效，total 保留筛选前总数', () => {
  const result = selectSkills(fixtures, query({ keyword: 'skill', state: 'enabled' }));
  assert.deepEqual(
    result.records.map((item) => item.id),
    ['alpha', 'beta'],
    'gamma 名称不含 skill 且已禁用；delta 名称不含 skill',
  );
  assert.equal(result.matched, 2);
  assert.equal(result.total, 4, 'total 必须是筛选前总数，供筛选空态区分「没有 Skill」');
});

test('主列表：无结果时返回空列表而不是报错，total 仍为真实总数', () => {
  const result = selectSkills(fixtures, query({ keyword: '不存在的关键词' }));
  assert.deepEqual(result.records, []);
  assert.equal(result.matched, 0);
  assert.equal(result.total, 4);
});

test('主列表：空工作区与空关键词边界', () => {
  const empty = selectSkills([], query());
  assert.deepEqual(empty, { records: [], matched: 0, total: 0 });
  assert.equal(matchesKeyword(fixtures[0]!, ''), true);
  assert.equal(matchesKeyword(fixtures[0]!, '   '), true, '只有空白等同于不筛选');
});

test('主列表：排序与筛选不受 locale 影响（同一输入两种语言下顺序一致）', () => {
  const mixed = [
    skill({ id: 'cn-b', name: '技能乙' }),
    skill({ id: 'cn-a', name: '技能甲' }),
    skill({ id: 'en-a', name: 'Alpha' }),
  ];
  const byName = selectSkills(mixed, query({ sort: 'name' })).records.map((item) => item.id);
  // 码位序：'Alpha'（A=U+0041）< '技能乙'（乙=U+4E59）< '技能甲'（甲=U+7532）。
  // 这里刻意不用中文语言习惯的顺序，因为它随运行环境变化。
  assert.deepEqual(byName, ['en-a', 'cn-b', 'cn-a']);
  assert.deepEqual(
    selectSkills(mixed, query({ sort: 'name' })).records.map((item) => item.id),
    byName,
    '同一输入重复调用顺序必须完全一致',
  );
  assert.deepEqual(
    selectSkills(mixed, query({ sort: 'id' })).records.map((item) => item.id),
    ['cn-a', 'cn-b', 'en-a'],
    '标识排序同样恒为码位序',
  );
});
