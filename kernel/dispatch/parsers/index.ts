/**
 * L2 参数解析与参数级校验。
 *
 * 只做参数层面的处理：识别全局选项、区分位置参数、产出结构性错误。
 * 不包含任何领域规则。
 */

import { CODES, type Finding } from '@skill-manager/contract';
import { finding } from '../../store/findings.ts';

/** 选项规格：布尔选项不带取值，取值选项必须带一个值 */
export const BOOLEAN_OPTIONS = new Set([
  'json',
  'machine',
  'dry-run',
  'yes',
  'help',
  'version',
  'no-color',
  'verbose',
  'strict',
  'hard',
  'keep-library',
  'library-only',
  'all',
  'check',
  'no-config',
  'no-secrets',
  'tree',
  'list',
  'inventory',
  'apply',
  'audit',
  'bulk',
  'rename',
  'force',
  // pipeline run：探查仓库证据
  'probe',
]);

/**
 * 取值选项：必须带一个值。
 * 未登记的选项一律判为参数问题——把未知选项当成取值选项会静默吞掉后面的位置参数，
 * 这类缺陷曾经让「文档里写明、实现里没登记」的选项在解析阶段直接报错或悄悄改变语义。
 */
export const VALUE_OPTIONS = new Set([
  'workspace',
  'root',
  'state',
  'source',
  'target',
  'scope',
  'mode',
  'on-conflict',
  'timestamp',
  // 对象类型入口：仅 scan/list/inspect/install/uninstall/enable/disable 消费
  'kind',
  // 远端 update 的目标标签：只由 update 处理器消费
  'ref',
  // 宿主分发入口：取值来自宿主注册表（含按路径类分条的取值，如 cursor / cursor-rules）
  'host',
  'id',
  'path',
  'classification',
  'action',
  'role',
  'limit',
  'format',
  'output',
  // pipeline 命令专用
  'problem',
  'output-dir',
  'answers',
  // LLM provider 专用
  'llm-provider',
  'llm-api-key',
  'llm-base-url',
  'llm-model',
  'llm-temperature',
  // 经验回归：pipeline run 预填相似经验
  'experience',
  // pipeline run 证据探查的仓库根（与 --workspace 正交）
  'probe-root',
  // experience 命令专用
  'query',
]);

/**
 * 可重复出现的取值选项（显式声明；默认单值）。
 *
 * 当前仅 `scan` 的 `--root` 设计上可重复（语法标记为 `--root <路径>...`）。
 * 未登记的取值选项与全部布尔选项在同一命令中重复出现时按参数类错误拒绝——
 * 静默取最后值会悄悄丢弃用户写下的前一个取值。
 */
export const REPEATABLE_OPTIONS = new Set(['id', 'role', 'root', 'answers']);

/** 该选项是否设计为可重复（可在审计与测试中逐项核对） */
export function isRepeatableOption(name: string): boolean {
  return REPEATABLE_OPTIONS.has(name);
}

export interface ParsedArgs {
  command: string;
  positionals: string[];
  /** 布尔选项为 true；取值选项为字符串；可重复选项为数组 */
  options: Record<string, string | true | string[]>;
}

export interface ParseOutcome {
  args: ParsedArgs;
  findings: Finding[];
}

/** 解析命令行参数；遇到结构性错误时记录问题并跳过该项 */
export function parseArgs(argv: string[]): ParseOutcome {
  const findings: Finding[] = [];
  const positionals: string[] = [];
  const options: Record<string, string | true | string[]> = {};
  let command = '';
  const group: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token.startsWith('--')) {
      const name = token.slice(2);
      if (name === '') {
        findings.push(
          finding(CODES.INPUT_INVALID_ARG, {
            source: 'input',
            target: '--',
            message: '出现了空的选项名',
            remedy: '请检查命令中的选项拼写',
          }),
        );
        continue;
      }
      if (BOOLEAN_OPTIONS.has(name)) {
        if (options[name] === true) {
          findings.push(
            finding(CODES.INPUT_INVALID_ARG, {
              source: 'input',
              target: `--${name}`,
              message: `选项重复给出：--${name}`,
              remedy: '同一命令中每个选项只给一次；重复给出按参数类错误拒绝，不静默取最后值',
            }),
          );
          continue;
        }
        options[name] = true;
        continue;
      }
      if (!VALUE_OPTIONS.has(name)) {
        findings.push(
          finding(CODES.INPUT_INVALID_ARG, {
            source: 'input',
            target: `--${name}`,
            message: `未知选项：--${name}`,
            remedy: `请检查选项拼写；可用选项见 --help`,
          }),
        );
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        findings.push(
          finding(CODES.INPUT_MISSING_ARG, {
            source: 'input',
            target: `--${name}`,
            message: `选项 --${name} 缺少取值`,
            remedy: `请在 --${name} 之后补上取值`,
          }),
        );
        continue;
      }
      index += 1;
      if (REPEATABLE_OPTIONS.has(name)) {
        const bucket = options[name];
        options[name] = Array.isArray(bucket) ? [...bucket, value] : [value];
      } else {
        if (options[name] !== undefined) {
          findings.push(
            finding(CODES.INPUT_INVALID_ARG, {
              source: 'input',
              target: `--${name}`,
              message: `选项重复给出：--${name}`,
              remedy: '同一命令中每个选项只给一次；重复给出按参数类错误拒绝，不静默取最后值',
            }),
          );
          continue;
        }
        options[name] = value;
      }
      continue;
    }

    // 首个位置参数为指令名；两层指令（config get）由调用方按分组处理
    if (command === '') {
      command = token;
      continue;
    }
    const sub = trySubCommand(command, group, token);
    if (sub !== null) {
      command = sub;
      continue;
    }
    positionals.push(token);
  }

  if (command === '' && Object.keys(options).length > 0) {
    findings.push(
      finding(CODES.INPUT_MISSING_ARG, {
        source: 'input',
        target: 'command',
        message: '未给出指令名',
        remedy: '请提供指令名，例如 init 或 scan',
      }),
    );
  }

  return { args: { command, positionals, options }, findings };
}

/**
 * 识别两层指令（config get/set、pipeline run、experience list/search/show）。
 * 命中时把子命令并入 command 并返回新指令名；不命中返回 null。
 */
function trySubCommand(command: string, group: string[], token: string): string | null {
  if (group.length > 0) return null;
  if (command === 'config' && (token === 'get' || token === 'set')) {
    group.push(token);
    return `config ${token}`;
  }
  if (command === 'pipeline' && token === 'run') {
    group.push(token);
    return `pipeline run`;
  }
  if (command === 'experience' && (token === 'list' || token === 'search' || token === 'show')) {
    group.push(token);
    return `experience ${token}`;
  }
  return null;
}

/** 读取布尔选项 */
export function flag(args: ParsedArgs, name: string): boolean {
  return args.options[name] === true;
}

/** 读取取值选项 */
export function option(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === 'string' ? value : undefined;
}

/** 读取可重复选项 */
export function optionList(args: ParsedArgs, name: string): string[] {
  const value = args.options[name];
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}
