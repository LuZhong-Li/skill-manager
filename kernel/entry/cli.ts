#!/usr/bin/env node
/**
 * 命令行宿主入口。
 *
 * 职责只有四步：解析参数、组装上下文、调用调度层、渲染输出并按退出码结束。
 * 异常一律在调度层内被转换为结果封装，本文件不再捕获业务异常。
 */

import { dispatch } from '../dispatch/registry/index.ts';
import { parseArgs, flag, option, optionList } from '../dispatch/parsers/index.ts';
import { render } from '../dispatch/render/index.ts';
import { buildResult } from '../dispatch/result/index.ts';
import { CODES } from '@skill-manager/contract';
import { finding } from '../store/findings.ts';
import { TOOL_VERSION } from '../core/index/index.ts';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import type { Interaction } from '../dispatch/policy/index.ts';
import { resolveWorkspaceRoot, layoutOf } from '../store/workspace/index.ts';
import {
  ensureBuiltinSkills,
  resolveBuiltinSkillsDir,
  shouldInstallBuiltinSkills,
} from '../core/bootstrap/builtin-skills.ts';

/** 协调世界时秒级时间戳 */
function utcNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * 基于标准输入输出的交互通道。
 * 只有标准输入与标准输出都是终端时才视为可交互；否则禁止等待输入，
 * 由策略层拒绝执行并要求显式给出跳过确认选项，避免脚本挂起。
 */
export function createStdioInteraction(): Interaction {
  return {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    write: (text: string): void => {
      process.stdout.write(text);
    },
    read: (): Promise<string> =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.once('line', (line) => {
          rl.close();
          resolve(line);
        });
      }),
  };
}

export async function run(
  argv: string[],
  interaction: Interaction = createStdioInteraction(),
): Promise<number> {
  const { args, findings } = parseArgs(argv);
  const json = flag(args, 'json');
  const machine = flag(args, 'machine');
  const color = !flag(args, 'no-color');

  if (flag(args, 'version')) {
    // 版本号的唯一来源是 TOOL_VERSION（与索引 tool_version 同源），不得在此写死字面量
    process.stdout.write(`${TOOL_VERSION}\n`);
    return 0;
  }
  if (flag(args, 'help') || args.command === '') {
    // 帮助是信息性输出：没有请求执行任何指令，因此解析器产生的「未给出指令名」
    // 之类问题不构成失败，退出码恒为 0（与 --version 一致）。
    process.stdout.write(helpText());
    return 0;
  }

  if (findings.length > 0) {
    const result = buildResult(args.command, findings);
    process.stdout.write(`${render(result, { json, machine, color })}\n`);
    return result.exit_code;
  }

  maybeInstallBuiltinSkills(args);

  const result = await dispatch({ args, now: utcNow(), interaction });
  const rawReport = rawReportOf(args.command, args, result);
  if (rawReport !== null) {
    process.stdout.write(rawReport.endsWith('\n') ? rawReport : `${rawReport}\n`);
    return result.exit_code;
  }
  process.stdout.write(
    `${render(result, { json, machine, color, verbose: flag(args, 'verbose') })}\n`,
  );
  return result.exit_code;
}

/**
 * 首次运行时把内置示范 Skill 安装到默认工作区。
 *
 * 只对默认工作区生效，且只读命令（全机盘点 / dry-run）、帮助与版本不触发写入；
 * 判定逻辑见 `shouldInstallBuiltinSkills`。失败不阻塞主流程：演示技能属于附赠能力，
 * 缺失不应让真实指令失败。
 */
function maybeInstallBuiltinSkills(args: ReturnType<typeof parseArgs>['args']): void {
  try {
    const workspaceRoot = resolveWorkspaceRoot(option(args, 'workspace'));
    const installable = shouldInstallBuiltinSkills({
      workspaceRoot,
      defaultWorkspaceRoot: resolveWorkspaceRoot(),
      command: args.command,
      inventory: flag(args, 'inventory'),
      dryRun: flag(args, 'dry-run'),
    });
    if (!installable) return;
    const entryPath = process.argv[1];
    const builtinDir = resolveBuiltinSkillsDir(entryPath === undefined ? {} : { entryPath });
    ensureBuiltinSkills(layoutOf(workspaceRoot).skillsDir, builtinDir ?? undefined);
  } catch {
    // 内置安装失败不阻塞主流程
  }
}

function rawReportOf(
  command: string,
  args: ReturnType<typeof parseArgs>['args'],
  result: Awaited<ReturnType<typeof dispatch>>,
): string | null {
  if (
    command !== 'scan' ||
    option(args, 'format') === undefined ||
    option(args, 'output') !== undefined
  ) {
    return null;
  }
  const data = result.data;
  if (data === null || typeof data !== 'object') return null;
  const report = (data as Record<string, unknown>)['report'];
  if (report === null || typeof report !== 'object') return null;
  const content = (report as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : null;
}

function helpText(): string {
  return [
    `skill-manager ${TOOL_VERSION}`,
    '',
    '用法：skill-manager <指令> [选项]',
    '',
    '一期可用指令：',
    '  init                    在工作区建立索引与标准目录，重复执行幂等',
    '  config get              读取当前配置区的全部内容，不做推导也不补默认值',
    '  scan                    扫描 Skill 根目录并生成或更新索引',
    '  list                    列出已管理的 Skill，可按状态、来源与目标过滤',
    '  inspect <标识>          查看单个 Skill 的完整元信息与内容指纹比对结论',
    '  install <来源>          从本地目录或元文件安装 Skill，写入中心库并登记索引',
    '  uninstall <标识>        卸载 Skill；默认保留中心库原件，--hard 时一并删除',
    '  update <标识>           从登记来源刷新 Skill；--ref <tag> 指定远端目标标签',
    '  validate [路径或标识]   只读校验元数据、配置与索引；省略对象时校验整个环境',
    '  deps <标识>             检查该 Skill 的依赖是否满足，并给出受影响的对象',
    '  export <路径>           把索引状态导出为一份备份文件，路径相对工作区根',
    '  import <路径>           从备份清单恢复索引记录；已存在的标识一律跳过，不覆盖',
    '  restore <标识>          从备份载体把内容写回中心库并重分发副本；省略时间戳时取最新',
    '  reconcile               对盘点后的宿主副本生成显式动作计划（默认预览）',
    '  pipeline run            处理问题：分类 -> 规划 -> 生成文档包（内置本地能力，无需外部服务）',
    '  experience list         列出历史处理经验（累计的每次问题处理，含宿主）',
    '  experience search       按关键词检索相似经验',
    '  experience show <id>    查看单条经验详情',
    '',
    'pipeline run 专用选项：',
    '  --problem <描述>        输入问题描述（必填）',
    '  --output-dir <路径>     文档包输出目录（必填）',
    '  --answers q1=a1         问题答案，可重复（如 --answers q1=a --answers q2=b）',
    '  --host <宿主>           经验画像归属宿主；缺省按 SKILL_MANAGER_HOST 与环境特征识别',
    '  --experience <关键词>   检索相似经验并预填问答（可选）',
    '  --llm-provider <类型>   LLM provider：local/doubao/claude/openai（默认 local，内置本地生成）',
    '  --llm-api-key <key>     外部 provider 的 API key；缺省时退回内置本地生成',
    '  --llm-base-url <url>    LLM API base URL（可选）',
    '  --llm-model <model>     LLM model name（可选）',
    '  --llm-temperature <num> 温度参数 0-2，默认 0.7（可选）',
    '  --probe-root <路径>     探查该路径的仓库代码，把定位结果写进文档（只读，不执行命令）',
    '  --probe                 未给 --probe-root 时探查当前目录',
    '',
    'experience 专用选项：',
    '  --query <关键词>        experience search 的检索关键词',
    '  --limit <数量>          experience list 的条数上限，默认 10（可选）',
    '',
    '通用选项：',
    '  --workspace <路径>      指定工作区根目录，覆盖环境变量',
    '  --kind <skill|plugin>   对象类型入口；scan 默认扫描 Skill',
    '  --root <路径>           覆盖索引中声明的 Skill 根目录，可重复',
    '  --dry-run               预演，返回将要发生的变更，不写入任何文件',
    '  --inventory             只读列出宿主盘点根；scan 专用，不扫描目录',
    '  --action <动作>         reconcile 动作：adopt/track/repair/accept/clean/forget',
    '  --path <路径>           reconcile 精确选择物理副本',
    '  --id <标识>             reconcile 与 --host 一起选择技能副本',
    '  --classification <类>   reconcile 分类批量过滤，需配合 --host 或 --root',
    '  --target <目标>         adopt 的工作区目标覆盖',
    '  --bulk                  批量采纳当前盘点中的候选副本',
    '  --role <角色>           bulk 采纳的角色过滤，可重复',
    '  --limit <N>             bulk 采纳候选数量上限',
    '  --rename                bulk 采纳同 ID 冲突时自动取 -2/-3 后缀',
    '  --force                 bulk 采纳同 ID 内容不同时备份后覆盖',
    '  --format <格式>         审计报告格式：markdown / html / sarif',
    '  --output <路径>         把审计报告写入指定路径',
    '  --apply                 reconcile 显式执行；默认只预览',
    '  --hard                  卸载时连同中心库原件一并删除',
    '  --keep-library          卸载时保留中心库原件（默认行为，供显式声明）',
    '  --library-only          安装时只写入中心库与登记记录，不分发到目标位置',
    '  --strict                校验时把警告级问题也视为失败',
    '  --ref <tag>             update 的远端目标标签，成功后更新已声明的 source.ref',
    '  --yes                   跳过确认；非交互环境下需要确认的指令必须显式给出',
    '  --json                  输出机器可读结构',
    '  --machine               输出制表符分隔的扁平结构',
    '  --no-color              关闭人类可读输出的着色',
    '  --version               输出版本',
    '  --help                  输出本帮助',
  ].join('\n');
}

/**
 * 是否作为入口被直接执行。
 * 必须与 argv[1] 的实际路径比较：只判断模块名会被「被其他模块导入」误判为入口。
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry === '') return false;
  try {
    return pathToFileURL(entry).href.toLowerCase() === import.meta.url.toLowerCase();
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  // 不用顶层 await：内核也要能被打包成 CommonJS 的单文件可执行形态
  // 不能直接 process.exit：macOS 的管道 stdout 可能尚未排空，会截断较大的 --json 输出。
  // 设置 exitCode 后让事件循环自然结束，退出码语义不变。
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

export { CODES, finding, option, optionList };
