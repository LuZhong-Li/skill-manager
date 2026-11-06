#!/usr/bin/env node
/**
 * 桌面外壳冒烟：启动 Electron，经 DevTools 走完空工作区、初始化、扫描与卡片列表，
 * 并验证插件、库存、更新/备份与双语切换等真实界面链路。
 *
 * 用法：node scripts/gui-smoke.mjs（开发产物）
 *       node scripts/gui-smoke.mjs --app <可执行文件路径>（针对打包产物，需要图形会话；
 *       相对路径按当前目录解析，例如 build/desktop/win-unpacked/skill-manager.exe）
 *       环境变量 SKILL_MANAGER_ELECTRON_EXECUTABLE 可指定开发模式使用的 Electron 可执行文件。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareHostFixture,
  prepareUserData,
  prepareWorkspace,
  remoteMeta,
} from './gui-smoke-fixtures.mjs';
import { runEmptyWorkspaceInventoryChecks } from './gui-smoke-inventory.mjs';
import { runInventoryActionChecks } from './gui-smoke-inventory-actions.mjs';
import { runAuditMatrixSmoke } from './gui-smoke-audit.mjs';
import { runPipelineSmoke } from './gui-smoke-pipeline.mjs';
import { runSkillListSmoke } from './gui-smoke-skill-list.mjs';
import { connectDebugger, waitForTarget } from './gui-smoke-cdp.mjs';
import { runPluginSmoke } from './gui-smoke-plugin.mjs';
import { killTree, readTextOrFallback } from './gui-smoke-launch.mjs';
import { runI18nSmoke } from './gui-smoke-i18n.mjs';
import { printSmokeReport } from './gui-smoke-report.mjs';
import { installBrowserProblemCapture, waitForWorkspaceInit } from './gui-smoke-workspace-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUI = join(ROOT, 'gui');

/**
 * 每次运行取一个空闲端口：固定端口会把探针连到上一次遗留的实例上，
 * 那种「连得上但状态不对」的假象比连不上更难排查。
 */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function git(cwd, args) {
  const result = spawnSync(
    'git',
    ['-C', cwd, '-c', 'user.email=smoke@example.com', '-c', 'user.name=smoke', ...args],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${result.stderr}`);
  return result.stdout ?? '';
}

async function startGitDaemon(basePath, port) {
  const child = spawn(
    'git',
    [
      'daemon',
      '--reuseaddr',
      '--export-all',
      `--base-path=${basePath}`,
      `--port=${port}`,
      '--listen=127.0.0.1',
    ],
    { stdio: 'ignore', detached: process.platform !== 'win32' },
  );
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const attempt = () => {
      const probe = spawnSync(process.execPath, [
        '-e',
        `require('net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))`,
      ]);
      if (probe.status === 0) return resolve();
      if (Date.now() > deadline) return reject(new Error('git daemon 未在 10 秒内就绪'));
      setTimeout(attempt, 100);
    };
    attempt();
  });
  return child;
}

function electronExecutable() {
  const override = process.env['SKILL_MANAGER_ELECTRON_EXECUTABLE'];
  if (override !== undefined && override !== '') return override;
  const name = process.platform === 'win32' ? 'electron.exe' : 'electron';
  return join(ROOT, 'node_modules', 'electron', 'dist', name);
}

/** 指定 --app 时直接运行打包后的可执行文件，否则运行开发产物 */
const appIndex = process.argv.indexOf('--app');
const appArgument = appIndex >= 0 ? process.argv[appIndex + 1] : undefined;
if (appIndex >= 0 && (appArgument === undefined || appArgument.startsWith('--'))) {
  console.error('--app 需要一个可执行文件路径');
  process.exit(2);
}
/**
 * `--app` 既接受绝对路径，也接受相对当前目录的路径。
 * 必须在这里解析成绝对路径：Electron 子进程以 gui/ 为工作目录启动，
 * 相对路径交给 spawn 会按 gui/ 解析，得到「明明存在却 ENOENT」的假象。
 */
const packagedApp = appArgument === undefined ? undefined : resolve(appArgument);

async function waitForUpdatedSkill(workspace) {
  const skillDir = join(workspace, 'skills', 'smoke-skill');
  let content = '';
  let meta = '';
  for (let index = 0; index < 80; index += 1) {
    content = readTextOrFallback(join(skillDir, 'SKILL.md'), '').replace(/\r\n/g, '\n');
    meta = readTextOrFallback(join(skillDir, 'skill_meta.yaml'), '');
    if (content === '# smoke v2' && /ref: v1\.1\.0/.test(meta)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    content,
    meta,
    refLine: /^\s*ref:\s*.*$/m.exec(meta)?.[0]?.trim() ?? '(source.ref missing)',
  };
}

async function main() {
  const PORT = await freePort();
  const gitPort = await freePort();
  const gitRoot = mkdtempSync(join(tmpdir(), 'sm-gui-git-'));
  const gitWork = join(gitRoot, 'work');
  const gitServed = join(gitRoot, 'served');
  mkdirSync(gitWork, { recursive: true });
  mkdirSync(gitServed, { recursive: true });
  const gitUrl = `git://127.0.0.1:${gitPort}/sample.git`;
  git(gitWork, ['init', '-q', '-b', 'main']);
  writeFileSync(join(gitWork, 'SKILL.md'), '# smoke');
  writeFileSync(join(gitWork, 'skill_meta.yaml'), remoteMeta(gitUrl, 'v1.0.0', '1.0.0'));
  git(gitWork, ['add', '-A']);
  git(gitWork, ['commit', '-q', '-m', 'v1']);
  git(gitWork, ['tag', 'v1.0.0']);
  writeFileSync(join(gitWork, 'SKILL.md'), '# smoke v2');
  writeFileSync(join(gitWork, 'skill_meta.yaml'), remoteMeta(gitUrl, 'v1.0.0', '1.1.0'));
  git(gitWork, ['add', '-A']);
  git(gitWork, ['commit', '-q', '-m', 'v2']);
  git(gitWork, ['tag', 'v1.1.0']);
  git(gitRoot, ['clone', '-q', '--bare', gitWork, join(gitServed, 'sample.git')]);
  const gitDaemon = await startGitDaemon(gitServed, gitPort);

  const workspace = prepareWorkspace(gitUrl);
  const hostHome = mkdtempSync(join(tmpdir(), 'sm-gui-home-'));
  const hostLocal = mkdtempSync(join(tmpdir(), 'sm-gui-local-'));
  prepareHostFixture(hostHome, hostLocal);
  const userData = mkdtempSync(join(tmpdir(), 'sm-gui-user-data-'));
  prepareUserData(userData);
  const electron = packagedApp ?? electronExecutable();
  const child = spawn(
    electron,
    [...(packagedApp === undefined ? ['.'] : []), `--remote-debugging-port=${PORT}`],
    {
      cwd: GUI,
      env: {
        ...process.env,
        HOME: hostHome,
        USERPROFILE: hostHome,
        LOCALAPPDATA: hostLocal,
        SKILL_MANAGER_WORKSPACE: workspace,
        SKILL_MANAGER_USER_DATA_DIR: userData,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const diagnostics = [];

  try {
    const target = await waitForTarget(PORT, 90_000);
    diagnostics.push(`目标页面：${String(target.url)}｜${String(target.title)}`);
    const client = connectDebugger(target.webSocketDebuggerUrl);
    await client.ready;

    const evaluate = async (expression) => {
      const response = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return response.result?.result?.value;
    };
    await installBrowserProblemCapture(evaluate);
    const captureScreenshot = async (name) => {
      const response = await client.send('Page.captureScreenshot', { format: 'png' });
      const path = join(tmpdir(), `skill-manager-${name}-${String(process.pid)}.png`);
      writeFileSync(path, Buffer.from(String(response.result?.data), 'base64'));
      diagnostics.push(`界面截图：${path}`);
      return path;
    };

    diagnostics.push(
      `渲染层地址：${String(await evaluate('location.href'))}｜标题：${String(await evaluate('document.title'))}`,
    );
    diagnostics.push(
      `直接经预加载调用一次 list：${String(
        await evaluate(
          "window.skillManager.invoke(['list']).then((r) => r.command + '/' + r.exit_code)",
        ),
      )}`,
    );
    diagnostics.push(
      `当前按钮：${String(
        await evaluate(
          "[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')",
        ),
      )}`,
    );

    // 等界面把首次 list 调用跑完
    for (let index = 0; index < 40; index += 1) {
      const ready = await evaluate("document.body.innerText.includes('skill-manager')");
      if (ready === true) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const waitFor = async (expression, attempts = 40) => {
      for (let index = 0; index < attempts; index += 1) {
        if ((await evaluate(expression)) === true) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    };

    check(
      '窗口渲染出侧边导航',
      (await evaluate("document.querySelector('aside h1')?.textContent === 'skill-manager'")) ===
        true,
    );
    check(
      '未初始化时显示引导而非错误',
      await waitFor("document.body.innerText.includes('工作区尚未初始化')"),
    );

    await runEmptyWorkspaceInventoryChecks({
      evaluate,
      waitFor,
      check,
      workspace,
      userData,
      captureScreenshot,
    });

    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('初始化工作区'))?.click()",
    );
    await waitForWorkspaceInit({ workspace, evaluate, stderr });
    for (let index = 0; index < 40; index += 1) {
      const done = await evaluate("document.body.innerText.includes('还没有已管理的 Skill')");
      if (done === true) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check(
      '初始化后进入空列表引导',
      (await evaluate("document.body.innerText.includes('还没有已管理的 Skill')")) === true,
    );

    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('立即扫描'))?.click()",
    );
    await waitFor("document.querySelectorAll('article.card').length > 0", 60);
    const cards = Number(await evaluate("document.querySelectorAll('article.card').length"));
    check('扫描后仪表盘展示真实 Skill 卡片', cards === 2, `卡片数 ${String(cards)}`);
    if (cards === 0) {
      diagnostics.push(
        `扫描后正文：${String(await evaluate('document.body.innerText')).slice(0, 400)}`,
      );
    }
    check(
      '卡片状态标签取自内核结论',
      (await evaluate("document.querySelector('article.card .tag')?.textContent")) === '已启用',
    );
    check(
      '状态栏记录了内核调用',
      (await evaluate("document.querySelector('.statusbar')?.innerText.includes('scan')")) === true,
    );

    const smokeContext = { evaluate, waitFor, check, workspace, hostHome, hostLocal, userData };
    // 主列表检索 / 排序 / 组合筛选：必须在离开仪表盘之前跑，且跑完会复位筛选
    await runSkillListSmoke(smokeContext);
    console.log('[smoke] skill list checks complete');
    console.log('[smoke] base UI ready');
    await runPluginSmoke(smokeContext);
    console.log('[smoke] plugin checks complete');
    await runInventoryActionChecks(smokeContext);
    console.log('[smoke] inventory checks complete');
    await runAuditMatrixSmoke(smokeContext);
    // M7 GUI：问题处理 → 文档包 → 经验库闭环（只用 data-* 选择器，切换语言也稳定）
    await runPipelineSmoke(smokeContext);
    console.log('[smoke] pipeline and experience checks complete');
    // T2/T3：设置默认关闭；即时检查触发角标，点击角标进入已有结果视图。
    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '设置')?.click()",
    );
    await waitFor("document.body.innerText.includes('更新检查')");
    const defaults = await evaluate(
      'JSON.stringify({ periodic: document.querySelector(\'input[data-setting="periodic"]\')?.checked, instant: document.querySelector(\'input[data-setting="instant"]\')?.checked })',
    );
    check(
      '定期与即时检查默认关闭',
      defaults === '{"periodic":false,"instant":false}',
      String(defaults),
    );

    await evaluate('document.querySelector(\'input[data-setting="instant"]\')?.click()');
    let settingsText = '';
    for (let index = 0; index < 40; index += 1) {
      try {
        settingsText = readFileSync(join(userData, 'settings.json'), 'utf8');
        if (JSON.parse(settingsText).instant_check_enabled === true) break;
      } catch {
        // 文件尚未写入，继续等
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    check(
      '切换即时检查开关写入 userData/settings.json',
      JSON.parse(settingsText).instant_check_enabled === true,
      settingsText,
    );
    check(
      '即时检查发现更新后点亮角标',
      await waitFor("document.querySelector('.update-dot') !== null", 60),
    );

    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('检查更新'))?.click()",
    );
    await waitFor("document.querySelector('.dialog') !== null", 60);
    const updateDialog = String(
      await evaluate(
        "(() => { const dialog = document.querySelector('.dialog'); return dialog ? dialog.innerText.replace(/\\s+/g, ' ') : ''; })()",
      ),
    );
    check(
      '检查更新入口打开四态结果视图',
      ['可更新', '已是最新', '不可检查', '检查失败'].every((label) => updateDialog.includes(label)),
      updateDialog.slice(0, 260),
    );
    check(
      '检查结果显示基线到目标标签并保留本地来源引导',
      updateDialog.includes('1.0.0') &&
        updateDialog.includes('v1.1.0') &&
        updateDialog.includes('本地来源') &&
        updateDialog.includes('update --check'),
      updateDialog.slice(0, 260),
    );

    await evaluate(
      "[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.includes('预览并更新'))?.click()",
    );
    await waitFor(
      "[...document.querySelectorAll('.dialog footer button')].some((b) => b.textContent.includes('确认执行'))",
      120,
    );
    const confirmUpdate = String(
      await evaluate(
        "(() => { const dialog = [...document.querySelectorAll('.dialog')].find((item) => item.innerText.includes('确认执行')); return dialog ? dialog.innerText.replace(/\\s+/g, ' ') : ''; })()",
      ),
    );
    check(
      '更新确认弹窗展示内核预演的影响范围',
      confirmUpdate.includes('确认更新 smoke-skill') &&
        confirmUpdate.includes('skills/smoke-skill') &&
        confirmUpdate.includes('确认执行'),
      confirmUpdate.slice(0, 220),
    );
    await evaluate(
      "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
    );

    const updated = await waitForUpdatedSkill(workspace);
    check(
      '确认后更新到目标标签并持久化 source.ref',
      updated.content === '# smoke v2' && /ref: v1\.1\.0/.test(updated.meta),
      `内容 ${JSON.stringify(updated.content)}｜${updated.refLine}`,
    );
    check(
      '更新完成后结果视图重新检查为已是最新',
      await waitFor(
        "document.querySelector('.dialog')?.innerText.includes('已是最新（1）') === true",
        60,
      ),
      String(await evaluate("document.querySelector('.dialog')?.innerText.slice(0, 260) ?? ''")),
    );
    await evaluate('document.querySelector(\'.dialog header button[aria-label="关闭"]\')?.click()');
    await waitFor("document.querySelector('.dialog') === null");

    await evaluate('document.querySelector(\'input[data-setting="periodic"]\')?.click()');
    for (let index = 0; index < 40; index += 1) {
      try {
        settingsText = readFileSync(join(userData, 'settings.json'), 'utf8');
        if (JSON.parse(settingsText).periodic_check_enabled === true) break;
      } catch {
        // 文件尚未写入，继续等
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    check(
      '切换定期开关写入 userData/settings.json',
      JSON.parse(settingsText).periodic_check_enabled === true,
      settingsText,
    );

    // 备份管理页：列表只能来自内核的 restore --list（界面不得直读备份目录）
    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '备份管理')?.click()",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('读取备份列表'))?.click()",
    );
    await waitFor("document.querySelectorAll('table.backups tbody tr').length > 0");
    const backupSummary = String(
      await evaluate(
        "[...document.querySelectorAll('table.backups tbody tr')].map((row) => row.innerText.replace(/\\s+/g, ' ')).join(' || ')",
      ),
    );
    const restoreEntry = await evaluate(
      "[...document.querySelectorAll('table.backups tbody tr button')].some((b) => b.textContent.trim() === '恢复')",
    );
    check(
      '备份管理页经内核列出真实备份并给出恢复入口（含更新前备份）',
      backupSummary.includes('smoke-skill') &&
        backupSummary.includes('2026-01-01T00:00:00Z') &&
        backupSummary.split(' || ').length >= 2 &&
        restoreEntry === true,
      backupSummary.slice(0, 260),
    );

    // 恢复是覆盖性写操作：确认弹窗必须展示内核预演的真实影响范围（覆盖提示 + 逐文件清单）
    await evaluate(
      "(() => { const row = [...document.querySelectorAll('table.backups tbody tr')].find((item) => item.innerText.includes('2026-01-01T00:00:00Z')); return row?.querySelector('button')?.click(); })()",
    );
    await waitFor("document.querySelector('.dialog') !== null");
    const dialogText = String(
      await evaluate(
        "(() => { const dialog = document.querySelector('.dialog'); return dialog ? dialog.innerText.replace(/\\s+/g, ' ') : ''; })()",
      ),
    );
    check(
      '恢复确认弹窗展示预演的覆盖提示与文件清单',
      dialogText.includes('覆盖') &&
        dialogText.includes('skills/smoke-skill/') &&
        dialogText.includes('确认执行'),
      dialogText.slice(0, 160),
    );

    await evaluate(
      "[...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.includes('确认执行'))?.click()",
    );
    // 等原件被写回：预览与执行之间隔着一次确认，因此按「磁盘效果」等待，不看状态栏文案
    let restored = false;
    let restoredContent = 'absent';
    for (let index = 0; index < 60; index += 1) {
      const content = readTextOrFallback(
        join(workspace, 'skills', 'smoke-skill', 'SKILL.md'),
        'absent',
      );
      restoredContent = content;
      if (content === '# smoke') {
        restored = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const statusText = String(
      await evaluate("document.querySelector('.statusbar')?.innerText.replace(/\\s+/g, ' ') ?? ''"),
    );
    check(
      '确认后恢复执行并写回原件',
      restored && statusText.includes('restore'),
      `原件内容 ${JSON.stringify(restoredContent)}`,
    );
    console.log('[smoke] update/backup checks complete');

    await runI18nSmoke({
      evaluate,
      waitFor,
      check,
      userData,
      reload: () => client.send('Page.reload', { ignoreCache: true }),
    });

    client.close();
  } finally {
    killTree(child);
    killTree(gitDaemon);
    await new Promise((resolve) => setTimeout(resolve, 500));
    rmSync(workspace, { recursive: true, force: true });
    rmSync(hostHome, { recursive: true, force: true });
    rmSync(hostLocal, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
    rmSync(gitRoot, { recursive: true, force: true });
  }

  printSmokeReport(checks, diagnostics, stderr);
}

await main();
