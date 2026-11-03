/**
 * 内置示范 Skill 自动安装。
 *
 * 首次运行时把 `kernel/builtin-skills/` 下的示范 Skill 复制到工作区中心库 skills/ 目录。
 * 已存在的不覆盖（用户删除后不会重新出现）。
 *
 * 目录解析刻意不使用 `import.meta`：内核会被 esbuild 打包成 CommonJS 的单文件可执行
 * 文件（SEA），该形态下 `import.meta` 为空对象，模块顶层用 `new URL(..., import.meta.url)`
 * 求值会直接抛 ERR_INVALID_URL，使打包后的内核在任何命令执行前就崩溃（v0.8.0 缺陷）。
 * 改为运行期探测候选目录，源码形态与可执行形态走同一段逻辑：
 *   1. `SKILL_MANAGER_BUILTIN_SKILLS_DIR` 环境变量（测试与自定义分发）；
 *   2. 可执行文件所在目录下的 `builtin-skills/`（安装包 / SEA 形态，构建脚本随产物复制）；
 *   3. 源码入口脚本上一级目录下的 `builtin-skills/`（`node kernel/entry/cli.ts` 形态）。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 覆盖内置示范 Skill 目录的环境变量（测试与自定义分发用）。 */
export const BUILTIN_SKILLS_DIR_ENV = 'SKILL_MANAGER_BUILTIN_SKILLS_DIR';

const BUILTIN_SKILLS_DIR_NAME = 'builtin-skills';

export interface BuiltinSkillsDirOptions {
  /** 当前可执行文件路径；默认 process.execPath。 */
  execPath?: string;
  /** 源码入口脚本路径（通常是 process.argv[1]）；默认不参与探测。 */
  entryPath?: string;
  /** 环境变量来源；默认 process.env。 */
  env?: NodeJS.ProcessEnv;
}

/** 按优先级列出候选目录（不检查存在性，便于测试与诊断）。 */
export function builtinSkillsDirCandidates(options: BuiltinSkillsDirOptions = {}): string[] {
  const env = options.env ?? process.env;
  const candidates: string[] = [];

  const override = env[BUILTIN_SKILLS_DIR_ENV];
  if (override !== undefined && override !== '') candidates.push(resolve(override));

  const execPath = options.execPath ?? process.execPath;
  if (execPath !== '') candidates.push(join(dirname(execPath), BUILTIN_SKILLS_DIR_NAME));

  const entryPath = options.entryPath;
  if (entryPath !== undefined && entryPath !== '') {
    candidates.push(resolve(dirname(entryPath), '..', BUILTIN_SKILLS_DIR_NAME));
  }

  return candidates;
}

/** 返回第一个真实存在的候选目录；都不存在时返回 null。 */
export function resolveBuiltinSkillsDir(options: BuiltinSkillsDirOptions = {}): string | null {
  return builtinSkillsDirCandidates(options).find((candidate) => existsSync(candidate)) ?? null;
}

/** 逐文件递归复制（绕过 Windows Node v24 cpSync 中文路径崩溃 bug）。 */
function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

/**
 * 确保内置 Skill 已安装到中心库。返回新安装的 Skill id 列表。
 *
 * @param skillsDir 工作区中心库的 skills/ 目录
 * @param builtinDir 内置技能源目录；缺省时按运行形态探测
 */
export function ensureBuiltinSkills(skillsDir: string, builtinDir?: string): string[] {
  const source = builtinDir ?? resolveBuiltinSkillsDir();
  if (source === null || !existsSync(source)) return [];
  mkdirSync(skillsDir, { recursive: true });

  const installed: string[] = [];
  const entries = readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = join(skillsDir, entry.name);
    if (existsSync(target)) continue;
    copyDirRecursive(join(source, entry.name), target);
    installed.push(entry.name);
  }
  return installed;
}

/** 首次运行安装判定的输入。 */
export interface BuiltinInstallDecision {
  /** 本次调用解析出的工作区根。 */
  workspaceRoot: string;
  /** 未显式指定工作区时应使用的默认工作区根。 */
  defaultWorkspaceRoot: string;
  /** 指令名；空字符串表示只打印帮助。 */
  command: string;
  /** 是否为只读的 --inventory 全机盘点。 */
  inventory: boolean;
  /** 是否为 --dry-run 预演。 */
  dryRun: boolean;
}

/**
 * 是否应在本次调用安装内置示范 Skill。
 *
 * 只对默认工作区生效：显式指定其他工作区时写入演示文件会改变用户既有目录，也会污染
 * 测试用临时工作区。只读命令（全机盘点 / dry-run）与帮助、版本同样不写。
 */
export function shouldInstallBuiltinSkills(input: BuiltinInstallDecision): boolean {
  if (input.command === '') return false;
  if (input.inventory) return false;
  if (input.dryRun) return false;
  return resolve(input.workspaceRoot) === resolve(input.defaultWorkspaceRoot);
}
