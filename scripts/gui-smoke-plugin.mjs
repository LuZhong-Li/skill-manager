/** 插件视图冒烟流程。 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runThirdPartyInventoryCheck } from './gui-smoke-inventory.mjs';
import { runPluginInventoryActionChecks } from './gui-smoke-inventory-actions.mjs';

const CLI = fileURLToPath(new URL('../kernel/entry/cli.ts', import.meta.url));

function runKernel(argv) {
  const result = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`GUI smoke kernel setup failed: ${result.stdout ?? result.stderr ?? ''}`);
  }
}

export async function runPluginSmoke({ evaluate, waitFor, check, workspace }) {
  // M4b T2：插件视图的真实全流程（安装默认 disabled → enable → x- 宿主分发 → 账本 → 停用/卸载）
  await evaluate(
    "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('插件（扩展）'))?.click()",
  );
  check(
    '插件视图渲染且与技能视图分区',
    await waitFor('document.querySelector(\'[data-testid="plugin-panel"]\') !== null'),
  );
  check(
    '插件视图没有更新检查入口',
    (await evaluate("document.querySelector('.update-check') === null")) === true,
  );
  await waitFor(
    'document.querySelector(\'[data-testid="plugin-panel"] button.primary\')?.disabled === false',
    80,
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '安装插件')?.click()",
  );
  await waitFor('document.querySelector(\'[data-testid="plugin-source"]\') !== null');
  await evaluate(
    `(() => { const input = document.querySelector('[data-testid="plugin-source"]'); input.value = ${JSON.stringify(
      join(workspace, 'plugin-source'),
    )}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await waitFor("document.querySelector('.dialog button.primary')?.disabled === false", 20);
  await evaluate(
    "[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === '安装插件')?.click()",
  );
  await waitFor(
    "[...document.querySelectorAll('.dialog footer button')].some((b) => b.textContent.includes('确认执行'))",
    80,
  );
  await evaluate(
    "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
  );
  await waitFor(
    "document.querySelector('[data-plugin-id=\"smoke-tools\"]')?.innerText.includes('已停用') === true",
    80,
  );
  check(
    '插件安装后默认 disabled',
    (await evaluate(
      "document.querySelector('[data-plugin-id=\"smoke-tools\"]')?.innerText.includes('已停用')",
    )) === true,
  );
  runKernel([
    'config',
    'set',
    'plugin.smoke-tools.zed.rules_root',
    join(workspace, '.zed', 'rules'),
    '--workspace',
    workspace,
  ]);
  await evaluate(
    "document.querySelector('[data-plugin-id=\"smoke-tools\"] button')?.parentElement?.querySelector('button:nth-of-type(2)')?.click()",
  );
  await waitFor(
    "[...document.querySelectorAll('.dialog footer button')].some((b) => b.textContent.includes('确认执行'))",
    80,
  );
  await evaluate(
    "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
  );
  await waitFor('document.querySelector(\'[data-host-id="x-smoke-tools-zed"]\') !== null', 60);
  check(
    'enable 后第三方 x- 宿主出现在分区',
    (await evaluate(
      "document.querySelector('[data-host-id=\"x-smoke-tools-zed\"]')?.innerText.includes('可选')",
    )) === true,
  );
  runKernel([
    'install',
    join(workspace, 'plugin-smoke-source'),
    '--host',
    'x-smoke-tools-zed',
    '--workspace',
    workspace,
    '--yes',
  ]);
  await evaluate('location.reload()');
  await waitFor('document.querySelector(\'[data-nav="plugins"]\') !== null', 80);
  await evaluate('document.querySelector(\'[data-nav="plugins"]\')?.click()');
  await waitFor('document.querySelector(\'[data-testid="plugin-hosts"]\') !== null', 80);
  await waitFor('document.querySelector(\'[data-host-id="claude"]\') !== null', 80);
  await waitFor(
    "[...document.querySelectorAll('[data-testid=\"plugin-hosts\"] option')].some((item) => item.value === 'plugin-smoke-skill')",
    80,
  );
  await waitFor(
    "document.querySelector('[data-testid=\"plugin-hosts\"]')?.innerText.includes('内置宿主') === true",
    80,
  );
  const hostBefore = String(
    await evaluate("document.querySelector('[data-testid=\"plugin-hosts\"]')?.innerText ?? ''"),
  );
  await evaluate(
    "(() => { const select = document.querySelector('[data-testid=\"plugin-hosts\"] select'); select.value = 'plugin-smoke-skill'; select.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  await waitFor(
    'document.querySelector(\'[data-host-id="x-smoke-tools-zed"] button\')?.disabled === false',
    20,
  );
  await evaluate('document.querySelector(\'[data-host-id="x-smoke-tools-zed"] button\')?.click()');
  await waitFor(
    "[...document.querySelectorAll('.dialog footer button')].some((b) => b.textContent.includes('确认执行'))",
    120,
  );
  await evaluate(
    "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
  );
  let pluginLanded = false;
  for (let index = 0; index < 80; index += 1) {
    if (existsSync(join(workspace, '.zed', 'rules', 'plugin-smoke-skill.md'))) {
      pluginLanded = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check('第三方宿主分发落位成功', pluginLanded);
  await waitFor(
    "document.querySelector('[data-testid=\"plugin-message\"]')?.innerText.includes('已将') === true",
    80,
  );
  check(
    '内置宿主分区在插件流程中保持存在',
    hostBefore.includes('claude') && hostBefore.includes('内置宿主'),
    hostBefore.slice(0, 160),
  );
  await runThirdPartyInventoryCheck({ evaluate, waitFor, check });
  await runPluginInventoryActionChecks({ evaluate, waitFor, check, workspace });
  await evaluate('document.querySelector(\'[data-plugin-id="smoke-tools"] button\')?.click()');
  await waitFor("document.querySelector('.dialog')?.innerText.includes('landings') === true", 60);
  // 断言稳定属性而非本地化文案：状态标签会被中英切换改写（enabled / 已启用），
  // 用它做判据会让结果随界面语言漂移。data-plugin-state 始终是内核原始值。
  check(
    '插件详情展示 landings 账本与落位路径',
    (await evaluate(
      "document.querySelector('.dialog')?.innerText.includes('.zed') && document.querySelector('[data-testid=\"plugin-detail-state\"]')?.getAttribute('data-plugin-state') === 'enabled'",
    )) === true,
    String(await evaluate("document.querySelector('.dialog')?.innerText.slice(0, 240) ?? ''")),
  );
  await evaluate('document.querySelector(\'.dialog header button[aria-label="关闭"]\')?.click()');
  await waitFor("document.querySelector('.dialog') === null");
  await evaluate(
    'document.querySelector(\'[data-plugin-id="smoke-tools"] button:nth-of-type(2)\')?.click()',
  );
  await waitFor(
    "[...document.querySelectorAll('.dialog footer button')].some((b) => b.textContent.includes('确认执行'))",
    80,
  );
  await evaluate(
    "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
  );
  await waitFor('document.querySelector(\'[data-host-id="x-smoke-tools-zed"]\') === null', 60);
  check(
    '停用后第三方宿主从分发区消失，既有副本保留',
    existsSync(join(workspace, '.zed', 'rules', 'plugin-smoke-skill.md')),
  );
  await waitFor(
    'document.querySelector(\'[data-plugin-id="smoke-tools"] button.danger\')?.disabled === false',
    80,
  );
  await evaluate(
    'document.querySelector(\'[data-plugin-id="smoke-tools"] button.danger\')?.click()',
  );
  await waitFor(
    "document.querySelector('.dialog')?.innerText.includes('orphan') === true || document.querySelector('.dialog')?.innerText.includes('孤儿') === true",
    60,
  );
  const uninstallText = String(
    await evaluate("document.querySelector('.dialog')?.innerText.replace(/\\s+/g, ' ') ?? ''"),
  );
  check(
    '插件卸载确认列出路径、文件数与孤儿副本提示',
    uninstallText.includes('plugins') &&
      uninstallText.includes('文件') &&
      (uninstallText.includes('孤儿') || uninstallText.includes('orphan')),
    uninstallText.slice(0, 260),
  );
  await evaluate(
    "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
  );
  await waitFor('document.querySelector(\'[data-plugin-id="smoke-tools"]\') === null', 80);
  check(
    '卸载删除插件包但保留 Skill 产物',
    !existsSync(join(workspace, 'plugins', 'smoke-tools')) &&
      existsSync(join(workspace, '.zed', 'rules', 'plugin-smoke-skill.md')),
  );
}
