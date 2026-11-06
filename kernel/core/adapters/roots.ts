/**
 * K-15 适配器层：宿主真实根的解析。
 *
 * 依据：T5 前置裁决——宿主落位根 = 默认路径（按宿主惯例与平台展开）+ 配置覆盖
 * （工作区索引配置区的 `host.<id>.root` / `host.<id>.rules_root`，经既有 config set 通道写入）。
 *
 * 解析规则：
 * 一、默认路径只在有证据的宿主与平台上给出（依据调研文档的平台展开）；
 * 二、没有默认值的宿主或平台必须由配置显式给出，否则报错误级问题，不猜测路径；
 * 三、解析结果必须可校验：已存在但不是目录、或父级不是目录时明确报错；
 * 四、根位于工作区之外时标记 external，供落位与确认使用。
 */
import { dirname, join } from 'node:path';
import { CODES, type Finding } from '@skill-manager/contract';
import { finding } from '../../store/findings.ts';
import { isDirectory, pathExists } from '../../store/library-fs/index.ts';
import { isPhysicallyWithin } from '../../store/paths/index.ts';
import { hostById } from '../hosts/index.ts';
import type { RootKind } from '../hosts/types.ts';
import type { HostLandingRootDefinition } from '@skill-manager/contract';

const SOURCE = 'host-roots';

/** 配置键：技能根与规则路径根 */
export function rootConfigKey(hostId: string, rootKind: RootKind): string {
  return rootKind === 'rules' ? `host.${hostId}.rules_root` : `host.${hostId}.root`;
}

/** 默认分发根从注册表的 landing_roots 派生；未登记的组合要求配置覆盖。 */
export function defaultRootFor(
  hostId: string,
  rootKind: RootKind,
  context: { home: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv },
): string | undefined {
  const root = hostById(hostId)?.landing_roots?.find(
    (item) => item.kind === rootKind && platformMatches(item, context.platform),
  );
  return root === undefined ? undefined : expandLandingRoot(root, context);
}

function platformMatches(root: HostLandingRootDefinition, platform: string): boolean {
  return root.platform === undefined || root.platform === 'any' || root.platform === platform;
}

function expandLandingRoot(
  root: HostLandingRootDefinition,
  context: { home: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv },
): string | undefined {
  const base = root.base === 'home' ? context.home : context.env[root.env_var ?? ''];
  if (base === undefined || base === '') return undefined;
  return join(base, ...root.path_template.split('/'));
}

/** 宿主根解析结果 */
export interface HostRootResolution {
  host_id: string;
  root_kind: RootKind;
  /** 解析后的路径（可能是相对工作区的可推导路径，也可能是工作区外的绝对路径） */
  path: string;
  source: 'config' | 'default';
  /** 是否位于工作区之外 */
  external: boolean;
  exists: boolean;
  findings: Finding[];
}

/** 路径是否位于工作区之内：按物理等价比较，避免前缀误判与 Windows 大小写差异 */
function isInside(workspaceRoot: string, target: string): boolean {
  return isPhysicallyWithin(workspaceRoot, target);
}

/**
 * 解析宿主落位根。
 *
 * `rootKind` 缺省取该宿主的技能根（技能形态优先，其次工作区外技能根）；
 * 未登记宿主返回 undefined（与适配器层一致：不适用宿主没有根）。
 */
export function resolveHostRoot(input: {
  hostId: string;
  workspaceRoot: string;
  config?: Record<string, unknown>;
  rootKind?: RootKind;
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): HostRootResolution | undefined {
  const entry = hostById(input.hostId);
  if (entry === undefined) return undefined;
  // 不适用宿主（如模型提供方）没有任何落位根，无可解析对象
  if (entry.roots === undefined) return undefined;
  const kinds = (entry.roots ?? []).map((root) => root.kind);
  const rootKind: RootKind =
    input.rootKind ??
    (kinds.includes('skill') ? 'skill' : kinds.includes('external') ? 'external' : 'rules');

  const findings: Finding[] = [];
  const context = {
    home: input.home ?? process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
  };

  if (!kinds.includes(rootKind)) {
    findings.push(
      finding(CODES.FIELD_INVALID_VALUE, {
        source: SOURCE,
        target: `${input.hostId}:${rootKind}`,
        message: `该宿主没有 ${rootKind} 类落位根`,
        remedy: '在宿主注册表中登记对应类别的落位根，或改用该宿主支持的形态',
      }),
    );
    return {
      host_id: input.hostId,
      root_kind: rootKind,
      path: '',
      source: 'default',
      external: true,
      exists: false,
      findings,
    };
  }

  const key = rootConfigKey(input.hostId, rootKind);
  const configured = input.config?.[key];
  let path: string;
  let source: 'config' | 'default';
  if (typeof configured === 'string' && configured.trim() !== '') {
    path = configured.trim();
    source = 'config';
  } else {
    const fallback = defaultRootFor(input.hostId, rootKind, context);
    if (fallback === undefined) {
      findings.push(
        finding(CODES.FIELD_REQUIRED, {
          source: SOURCE,
          target: `${input.hostId}:${rootKind}`,
          message: `该宿主在 ${context.platform} 上没有默认落位根，且未给出配置覆盖`,
          remedy: `请执行 config set ${key} <路径> 显式给出宿主真实根；内核不猜测路径`,
        }),
      );
      return {
        host_id: input.hostId,
        root_kind: rootKind,
        path: '',
        source: 'default',
        external: true,
        exists: false,
        findings,
      };
    }
    path = fallback;
    source = 'default';
  }

  const external = !isInside(input.workspaceRoot, path);
  const exists = pathExists(path);
  if (exists && !isDirectory(path)) {
    findings.push(
      finding(CODES.PATH_INVALID, {
        source: SOURCE,
        target: path,
        message: '宿主落位根已存在但不是目录',
        remedy: '修正配置中的路径，或先处理占用该路径的文件',
      }),
    );
  }
  if (!exists) {
    // 向上找到最近的存在祖先：它不是目录时该路径无法创建（隔层父级为文件同样要拦住）
    let ancestor = dirname(path);
    while (!pathExists(ancestor) && dirname(ancestor) !== ancestor) {
      ancestor = dirname(ancestor);
    }
    if (pathExists(ancestor) && !isDirectory(ancestor)) {
      findings.push(
        finding(CODES.PATH_INVALID, {
          source: SOURCE,
          target: path,
          message: `宿主落位根无法创建：最近的上级 ${ancestor} 不是目录`,
          remedy: '修正配置中的路径层级，或先处理占用该路径的文件',
        }),
      );
    }
  }

  return {
    host_id: input.hostId,
    root_kind: rootKind,
    path,
    source,
    external,
    exists,
    findings,
  };
}
