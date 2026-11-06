/**
 * Problem-handling and experience-library GUI flows.
 *
 * Selectors are `data-*` attributes only (never button text): the smoke runner switches
 * locale for one pass, so text-based selectors would fork between zh-CN and en.
 * Assertions read machine-readable data attributes written by the two view components.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROBLEM = '安装时崩溃并报错 E-SRC-004';

function setValue(selector, value) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) return false;
    node.value = ${JSON.stringify(value)};
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

function attr(selector, name) {
  return `(document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null)`;
}

function click(selector) {
  return `document.querySelector(${JSON.stringify(selector)})?.click()`;
}

export async function runPipelineSmoke({ evaluate, waitFor, check, workspace }) {
  const probeRoot = join(workspace, 'probe-repo');
  const outputDir = join(workspace, 'pipeline-output');
  rmSync(probeRoot, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(join(probeRoot, 'src'), { recursive: true });
  writeFileSync(
    join(probeRoot, 'package.json'),
    JSON.stringify({ name: 'probe-repo', version: '1.0.0' }),
  );
  writeFileSync(
    join(probeRoot, 'src', 'installSkill.ts'),
    'export function installSkill(): void {\n  throw new Error("install failed E-SRC-004");\n}\n',
  );

  await evaluate(click('[data-nav="pipeline"]'));
  check(
    'M7-GUI：问题处理视图可通过导航打开',
    await waitFor('document.querySelector(\'[data-testid="pipeline-view"]\') !== null'),
  );

  await evaluate(click('[data-testid="pipeline-run"]'));
  check(
    'M7-GUI：问题描述为空时给出提示且不产生结果',
    await waitFor(
      'document.querySelector(\'[data-testid="pipeline-message"]\') !== null && document.querySelector(\'[data-testid="pipeline-result"]\') === null',
    ),
  );

  check(
    'M7-GUI：问题描述与仓库路径可写入',
    (await evaluate(setValue('[data-testid="pipeline-problem"]', PROBLEM))) === true &&
      (await evaluate(setValue('[data-testid="pipeline-probe-root"]', probeRoot))) === true,
  );

  await evaluate(`(() => {
    const node = document.querySelector('[data-testid="pipeline-dry-run"]');
    node.checked = true;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await evaluate(click('[data-testid="pipeline-run"]'));
  check(
    'M7-GUI：预演模式产出文档清单',
    await waitFor(`${attr('[data-testid="pipeline-result"]', 'data-dry-run')} === 'true'`),
  );
  check(
    'M7-GUI：预演模式不写文件、不记经验',
    (await evaluate(`${attr('[data-testid="pipeline-result"]', 'data-documents')}`)) !== '0' &&
      (await evaluate(`${attr('[data-testid="pipeline-result"]', 'data-experience-id')}`)) === '' &&
      existsSync(outputDir) === false,
  );

  await evaluate(`(() => {
    const node = document.querySelector('[data-testid="pipeline-dry-run"]');
    node.checked = false;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await evaluate(click('[data-testid="pipeline-run"]'));
  check(
    'M7-GUI：正式执行写入文档包并记录经验',
    await waitFor(
      `${attr('[data-testid="pipeline-result"]', 'data-applied')} === 'true' && (${attr('[data-testid="pipeline-result"]', 'data-experience-id')} ?? '') !== ''`,
      120,
    ),
  );
  const documentCount = Number(
    await evaluate(`${attr('[data-testid="pipeline-result"]', 'data-documents')}`),
  );
  check(
    'M7-GUI：文档包落到输出目录',
    documentCount > 0 &&
      existsSync(outputDir) &&
      readdirSync(outputDir).filter((name) => name.endsWith('.md')).length >= documentCount,
  );
  check(
    'M7-GUI：指定仓库后结论标注为已探查',
    (await evaluate(`${attr('[data-testid="pipeline-result"]', 'data-probed')}`)) === 'true' &&
      (await waitFor('document.querySelector(\'[data-testid="pipeline-evidence"]\') !== null')) ===
        true,
  );

  const experienceId = await evaluate(
    `${attr('[data-testid="pipeline-result"]', 'data-experience-id')}`,
  );
  await evaluate(click('[data-testid="pipeline-open-experience"]'));
  check(
    'M7-GUI：从处理结果跳到经验库并定位到该条记录',
    await waitFor(
      `document.querySelector('[data-testid="experience-view"]') !== null && ${attr('[data-testid="experience-detail"]', 'data-detail-id')} === ${JSON.stringify(
        experienceId,
      )}`,
      120,
    ),
  );

  await evaluate(click('[data-nav="experience"]'));
  check(
    'M7-GUI：经验库列出已记录的经验',
    await waitFor(
      `Number(${attr('[data-testid="experience-view"]', 'data-count')}) > 0 && document.querySelectorAll('[data-testid="experience-row"]').length > 0`,
    ),
  );

  await evaluate(setValue('[data-testid="experience-keyword"]', 'E-SRC-004'));
  await evaluate(click('[data-testid="experience-search"]'));
  // Wait for this exact query to land: a stale list would otherwise let the next assertion
  // pass against old rows and the following click hit a still-disabled button.
  const matched = await waitFor(
    `${attr('[data-testid="experience-view"]', 'data-query')} === 'E-SRC-004' && ${attr(
      '[data-testid="experience-view"]',
      'data-loading',
    )} === 'false'`,
  );
  check(
    'M7-GUI：经验检索命中同一条记录',
    matched &&
      (await waitFor(
        `document.querySelectorAll('[data-testid="experience-row"]').length > 0 && ${attr(
          '[data-testid="experience-row"]',
          'data-experience-id',
        )} === ${JSON.stringify(experienceId)}`,
      )),
  );

  await evaluate(setValue('[data-testid="experience-keyword"]', 'no-such-experience-keyword'));
  await evaluate(click('[data-testid="experience-search"]'));
  const noMatchLanded = await waitFor(
    `${attr('[data-testid="experience-view"]', 'data-query')} === 'no-such-experience-keyword' && ${attr(
      '[data-testid="experience-view"]',
      'data-loading',
    )} === 'false'`,
  );
  const emptyPassed = await waitFor(
    `document.querySelectorAll('[data-testid="experience-row"]').length === 0 && document.querySelector('[data-testid="experience-empty"]') !== null`,
  );
  const emptyState = await evaluate(`JSON.stringify({
    rows: document.querySelectorAll('[data-testid="experience-row"]').length,
    empty: document.querySelector('[data-testid="experience-empty"]') !== null,
    keyword: document.querySelector('[data-testid="experience-keyword"]')?.value ?? null,
    count: document.querySelector('[data-testid="experience-view"]')?.getAttribute('data-count'),
    query: document.querySelector('[data-testid="experience-view"]')?.getAttribute('data-query'),
  })`);
  check(
    'M7-GUI：无匹配关键词时给出空态而不是残留旧结果',
    noMatchLanded && emptyPassed,
    String(emptyState),
  );
}
