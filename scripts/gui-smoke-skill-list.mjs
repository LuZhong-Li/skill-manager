/**
 * 主列表检索 / 排序 / 组合筛选的 GUI 冒烟。
 *
 * 全部用 `data-testid` 与 `data-*` 选择器：中英文 runner 下文案会变，
 * 但测试标识不会。`input` 走原生 setter + input 事件，才能触发 Vue 的 v-model。
 */

/** 卡片标识列表，取自卡片内的 `.id` 文本，用于断言排序与过滤结果 */
const cardIdsExpression = `JSON.stringify([...document.querySelectorAll('article.card .id')].map((node) => node.textContent.trim()))`;

/** 造一个原生 setter 驱动的输入，Vue 的 v-model 才会收到 */
function setValueExpression(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

async function ids(evaluate) {
  const raw = await evaluate(cardIdsExpression);
  return JSON.parse(String(raw));
}

/** 等一次 v-model 更新后的重渲染落地 */
async function settle(waitFor, expression) {
  await waitFor(expression, 40);
}

export async function runSkillListSmoke({ evaluate, waitFor, check }) {
  // 调用方保证此刻停在仪表盘且卡片已渲染；这里只等一次稳定
  await waitFor("document.querySelectorAll('article.card').length === 2", 40);
  const baseline = await ids(evaluate);
  check(
    '主列表默认展示全部 Skill 且按标识升序',
    JSON.stringify(baseline) === '["local-skill","smoke-skill"]',
    JSON.stringify(baseline),
  );

  // 一、关键词检索：只保留标识命中的那一个
  check(
    '工具栏存在检索输入框',
    (await evaluate('document.querySelector(\'[data-testid="skill-search"]\') !== null')) === true,
  );
  await evaluate(setValueExpression('[data-testid="skill-search"]', 'local'));
  await settle(waitFor, "document.querySelectorAll('article.card').length === 1");
  const searched = await ids(evaluate);
  check(
    '关键词检索按标识命中并隐藏其余卡片',
    JSON.stringify(searched) === '["local-skill"]',
    JSON.stringify(searched),
  );

  // 二、无结果时进入独立的「筛选空态」，而不是「还没有 Skill」引导
  await evaluate(setValueExpression('[data-testid="skill-search"]', 'no-such-skill-keyword'));
  await settle(
    waitFor,
    'document.querySelector(\'[data-testid="dashboard-filter-empty"]\') !== null',
  );
  check(
    '筛选无结果时展示筛选空态',
    (await evaluate(
      'document.querySelector(\'[data-testid="dashboard-filter-empty"]\') !== null',
    )) === true,
  );
  check(
    '筛选空态不复用「还没有 Skill」引导',
    (await evaluate('document.querySelector(\'[data-testid="dashboard-scan"]\') === null')) ===
      true,
  );

  // 三、一键清除筛选后恢复全量
  await evaluate('document.querySelector(\'[data-testid="dashboard-reset-filters"]\')?.click()');
  await settle(waitFor, "document.querySelectorAll('article.card').length === 2");
  const reset = await ids(evaluate);
  check(
    '清除筛选条件后恢复全部 Skill',
    JSON.stringify(reset) === JSON.stringify(baseline),
    JSON.stringify(reset),
  );
  check(
    '清除筛选后检索框同步清空',
    (await evaluate('document.querySelector(\'[data-testid="skill-search"]\')?.value')) === '',
  );

  // 四、排序：倒序键（按名称）必须真的改变顺序，且结果是原始稳定值
  check(
    '工具栏存在排序下拉',
    (await evaluate('document.querySelector(\'[data-testid="skill-sort"]\') !== null')) === true,
  );
  await evaluate(setValueExpression('[data-testid="skill-sort"]', 'name'));
  await settle(waitFor, "document.querySelector('[data-testid=\"skill-sort\"]')?.value === 'name'");
  const byName = await ids(evaluate);
  check(
    '按名称排序结果确定（local-skill 在 smoke-skill 之前）',
    JSON.stringify(byName) === '["local-skill","smoke-skill"]',
    JSON.stringify(byName),
  );

  // 五、组合筛选：关键词 + 状态必须同时生效
  await evaluate(setValueExpression('[data-testid="skill-search"]', 'smoke'));
  await settle(waitFor, "document.querySelectorAll('article.card').length === 1");
  await evaluate(setValueExpression('[data-testid="skill-state-filter"]', 'enabled'));
  await settle(
    waitFor,
    "document.querySelector('[data-testid=\"skill-state-filter\"]')?.value === 'enabled'",
  );
  const combined = await ids(evaluate);
  check(
    '关键词与状态筛选组合后只剩 smoke-skill',
    JSON.stringify(combined) === '["smoke-skill"]',
    JSON.stringify(combined),
  );

  // 六、冲突组合：关键词命中但状态不符 → 筛选空态，证明两者是「与」关系
  await evaluate(setValueExpression('[data-testid="skill-state-filter"]', 'disabled'));
  await settle(
    waitFor,
    'document.querySelector(\'[data-testid="dashboard-filter-empty"]\') !== null',
  );
  check(
    '关键词与状态冲突时为空（组合为「与」而非「或」）',
    (await evaluate(
      'document.querySelector(\'[data-testid="dashboard-filter-empty"]\') !== null',
    )) === true,
  );

  // 七、复位，避免影响后续断言卡片数量的用例
  await evaluate('document.querySelector(\'[data-testid="dashboard-reset-filters"]\')?.click()');
  await settle(waitFor, "document.querySelectorAll('article.card').length === 2");
  await evaluate(setValueExpression('[data-testid="skill-sort"]', 'id'));
  const restored = await ids(evaluate);
  check(
    '复位后回到默认排序与全量列表',
    JSON.stringify(restored) === JSON.stringify(baseline),
    JSON.stringify(restored),
  );
}
