/**
 * L2 指令注册与路由入口。
 *
 * 各命令处理器、宿主切换与共享确认逻辑已拆分到本目录模块；
 * 本文件只保留指令清单、注册表和统一路由。
 */
import { CODES } from '@skill-manager/contract';
import { finding } from '../../store/findings.ts';
import { toKernelError } from '../../store/errors.ts';
import { withWriterLock } from '../../store/locking/index.ts';
import { layoutOf } from '../../store/workspace/index.ts';
import { buildResult, type Result } from '../result/index.ts';
import { flag, option } from '../parsers/index.ts';
import { workspaceRootOf } from '../shared/options.ts';
import { scanHandler } from '../scan/index.ts';
import {
  configGetHandler,
  depsHandler,
  exportHandler,
  inspectHandler,
  listHandler,
} from './commands/query.ts';
import { configSetHandler, toggleHandler, updateHandler } from './commands/mutate.ts';
import { importHandler } from './commands/import.ts';
import { initHandler } from './commands/init.ts';
import { installHandler, uninstallHandler } from './commands/lifecycle.ts';
import { restoreHandler } from './commands/restore.ts';
import { validateHandler } from './commands/validate.ts';
import { reconcileHandler } from '../reconcile/index.ts';
import { registerPipelineCommands } from './commands/pipeline.ts';
import { registerExperienceCommands } from './commands/experience.ts';
import type { CommandContext, CommandHandler, CommandSpec } from './types.ts';

export type { CommandContext, CommandHandler, CommandSpec } from './types.ts';

/** 一期已注册的指令名 */
export const REGISTERED_COMMANDS = [
  'init',
  'config get',
  'config set',
  'scan',
  'list',
  'inspect',
  'install',
  'uninstall',
  'enable',
  'disable',
  'update',
  'validate',
  'deps',
  'export',
  'import',
  'restore',
  'reconcile',
  'pipeline run',
  'experience list',
  'experience search',
  'experience show',
] as const;

const handlers = new Map<string, CommandHandler>();

/** 指令注册 */
export function register(spec: CommandSpec): void {
  handlers.set(spec.name, spec.handler);
}

// 注册所有命令
register({ name: 'init', handler: initHandler });
register({ name: 'scan', handler: scanHandler });
register({ name: 'install', handler: installHandler });
register({ name: 'uninstall', handler: uninstallHandler });
register({ name: 'validate', handler: validateHandler });
register({ name: 'list', handler: listHandler });
register({ name: 'inspect', handler: inspectHandler });
register({ name: 'config get', handler: configGetHandler });
register({ name: 'deps', handler: depsHandler });
register({ name: 'export', handler: exportHandler });
register({ name: 'config set', handler: configSetHandler });
register({ name: 'enable', handler: toggleHandler('enable') });
register({ name: 'disable', handler: toggleHandler('disable') });
register({ name: 'update', handler: updateHandler });
register({ name: 'import', handler: importHandler });
register({ name: 'restore', handler: restoreHandler });
register({ name: 'reconcile', handler: reconcileHandler });
registerPipelineCommands(register);
registerExperienceCommands(register);

const KIND_COMMANDS = new Set([
  'scan',
  'list',
  'inspect',
  'install',
  'uninstall',
  'enable',
  'disable',
]);

/**
 * 会写工作区（索引、中心库、宿主副本、账本）的指令。
 *
 * 跨进程互斥统一在路由层加锁：逐个处理器自行加锁容易漏掉插件、导入、
 * 恢复、宿主卸载这类路径，而漏掉一处就等于没有并发保护。
 * 只读指令与预演不入此表——它们不写盘，加锁只会白白串行化。
 */
const WRITE_COMMANDS = new Set([
  'init',
  'scan',
  'install',
  'uninstall',
  'enable',
  'disable',
  'update',
  'import',
  'restore',
  'reconcile',
  'config set',
  'pipeline run',
]);

/** 该次调用是否会写盘：预演与只读盘点不写，因而不需要写锁 */
function needsWriteLock(command: string, args: Parameters<typeof option>[0]): boolean {
  if (!WRITE_COMMANDS.has(command)) return false;
  if (flag(args, 'dry-run')) return false;
  if (command === 'scan' && flag(args, 'inventory')) return false;
  return true;
}

/** 指令路由：未注册的指令返回输入类错误 */
export async function dispatch(context: CommandContext): Promise<Result<unknown>> {
  const kind = option(context.args, 'kind');
  if (kind !== undefined) {
    if (!KIND_COMMANDS.has(context.args.command)) {
      return buildResult(context.args.command, [
        finding(CODES.INPUT_INVALID_ARG, {
          source: 'input',
          target: '--kind',
          message: `指令 ${context.args.command} 不接受 --kind`,
          remedy: '--kind 只用于 scan、list、inspect、install、uninstall、enable、disable',
        }),
      ]);
    }
    if (kind !== 'skill' && kind !== 'plugin') {
      return buildResult(context.args.command, [
        finding(CODES.INPUT_INVALID_ARG, {
          source: 'input',
          target: '--kind',
          message: `--kind 取值非法：${kind}`,
          remedy: '仅允许 skill 或 plugin',
        }),
      ]);
    }
  }
  const handler = handlers.get(context.args.command);
  if (handler === undefined) {
    return buildResult(context.args.command, [
      finding(CODES.INPUT_UNKNOWN_COMMAND, {
        source: 'input',
        target: context.args.command,
        message: `未知指令：${context.args.command}`,
        remedy: `一期可用指令：${REGISTERED_COMMANDS.join('、')}`,
      }),
    ]);
  }
  if (!needsWriteLock(context.args.command, context.args)) return await handler(context);
  try {
    return await withWriterLock(layoutOf(workspaceRootOf(context.args)), () => handler(context));
  } catch (error) {
    const kernelError = toKernelError(error, CODES.IO_FAILED);
    return buildResult(context.args.command, [
      finding(kernelError.code, {
        source: kernelError.source,
        target: kernelError.target,
        message: kernelError.message,
        remedy: kernelError.remedy,
      }),
    ]);
  }
}
