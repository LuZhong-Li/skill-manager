/**
 * K-03 索引服务。
 *
 * 负责全局索引的装配与读写：
 *   初始索引的构造（配置区声明默认根目录与默认目标）；
 *   从原始映射载入为带类型的索引，同时保留未识别字段（契约要求不得丢弃）；
 *   写回时按区块顺序输出，保证文本稳定、便于版本控制逐行比对。
 */
import { INDEX_SCHEMA_VERSION } from '../metadata/constants.ts';
import { hostById } from '../hosts/index.ts';
import type { IndexConfig, IndexRecord, SkillIndex } from '../metadata/types.ts';
import { readRawIndex, writeRawIndex } from '../../store/registry-store/index.ts';
import { CODES, type Finding } from '@skill-manager/contract';
import { finding } from '../../store/findings.ts';
import { KernelError } from '../../store/errors.ts';
import { resolveWithin } from '../../store/paths/index.ts';
import { TARGET_MODE_VALUES } from '../metadata/constants.ts';
import { validateIndexVersion, validateValidationBlock } from '../metadata/validate.ts';

/** 一期默认的 Skill 根目录，相对于工作区根目录 */
export const DEFAULT_SKILL_ROOT = './skills';

/** 内核版本号（`--version` 与索引 `tool_version` 的唯一来源）：随发布版本同步 */
export const TOOL_VERSION = '0.9.1';

export interface LoadedIndex {
  exists: boolean;
  index: SkillIndex | null;
  findings: Finding[];
}

/** 构造初始索引：配置区已声明根目录与默认目标，记录区为空 */
export function createInitialIndex(generatedAt: string, config?: Partial<IndexConfig>): SkillIndex {
  const resolved: IndexConfig = {
    skill_roots: config?.skill_roots ?? [DEFAULT_SKILL_ROOT],
    default_target: config?.default_target ?? 'claude',
    default_mode: config?.default_mode ?? 'copy',
  };
  return {
    schema_version: INDEX_SCHEMA_VERSION,
    tool_version: TOOL_VERSION,
    generated_at: generatedAt,
    config: resolved,
    skills: [],
  };
}

/** 载入索引；文件不存在返回 exists=false，版本不受支持时返回问题而不抛错 */
export function loadIndex(indexFile: string): LoadedIndex {
  const { exists, raw } = readRawIndex(indexFile);
  if (!exists || raw === null) return { exists: false, index: null, findings: [] };

  const findings = validateIndexVersion(raw['schema_version']);
  if (findings.some((item) => item.severity === 'error')) {
    return { exists: true, index: null, findings };
  }

  const records = Array.isArray(raw['skills']) ? (raw['skills'] as unknown[]) : [];
  for (const item of records) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const id = String((item as Record<string, unknown>)['id'] ?? '');
      findings.push(
        ...validateValidationBlock((item as Record<string, unknown>)['validation'], id),
      );
    }
  }

  const index: SkillIndex = {
    ...raw,
    schema_version: String(raw['schema_version']),
    tool_version: String(raw['tool_version'] ?? TOOL_VERSION),
    generated_at: String(raw['generated_at'] ?? ''),
    config: normalizeConfig(raw['config']),
    skills: records.filter(isRecordLike) as unknown as IndexRecord[],
  };
  return { exists: true, index, findings };
}

/** 写回索引：固定区块顺序，未识别字段排在已知区块之后 */
export function saveIndex(indexFile: string, index: SkillIndex): void {
  const { config, skills, ...rest } = index;
  const ordered: Record<string, unknown> = {
    schema_version: index.schema_version,
    tool_version: index.tool_version,
    generated_at: index.generated_at,
    config,
    skills,
  };
  for (const [key, value] of Object.entries(rest)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  writeRawIndex(indexFile, ordered);
}

function normalizeConfig(value: unknown): IndexConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { skill_roots: [DEFAULT_SKILL_ROOT] };
  }
  const config = value as Record<string, unknown>;
  const roots = Array.isArray(config['skill_roots'])
    ? config['skill_roots'].filter((item): item is string => typeof item === 'string')
    : [];
  return {
    ...config,
    skill_roots: roots.length > 0 ? roots : [DEFAULT_SKILL_ROOT],
  };
}

function isRecordLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const id = (value as Record<string, unknown>)['id'];
  return typeof id === 'string' && id !== '';
}

/** 可由 `config set` 修改的配置项 */
export const CONFIG_KEYS = ['skill_roots', 'default_target', 'default_mode'] as const;

/**
 * 宿主真实根的配置键形态：`host.<宿主标识>.root` 与 `host.<宿主标识>.rules_root`。
 * 依据指令契约规范 4.3 节（`--host` 的落点覆盖）；宿主标识必须是注册表内已登记的标识。
 */
export const HOST_ROOT_KEY_PATTERN = /^host\.([a-z0-9-]+)\.(root|rules_root)$/;

export interface SetConfigOutcome {
  /** 校验通过时为新的索引；失败时为 null，调用方不得写入 */
  index: SkillIndex | null;
  findings: Finding[];
  data: Record<string, unknown>;
}

/**
 * 修改单个配置项（契约 4.3）。
 * 只做校验与取值改写，写入与加锁由调用方负责；不触发重新登记，配置变更在下次登记时生效。
 */
export function setConfig(input: {
  index: SkillIndex;
  key: string;
  value: string;
  workspaceRoot: string;
}): SetConfigOutcome {
  const { index, key, value, workspaceRoot } = input;
  const previous = (index.config as unknown as Record<string, unknown>)[key];

  const hostRootKey = HOST_ROOT_KEY_PATTERN.exec(key);
  if (hostRootKey === null && !(CONFIG_KEYS as readonly string[]).includes(key)) {
    return {
      index: null,
      findings: [
        finding(CODES.INPUT_INVALID_ARG, {
          source: 'input',
          target: key,
          message: `配置键不在可修改范围内：${key}`,
          remedy: `可修改的配置项为 ${CONFIG_KEYS.join('、')}，以及宿主真实根键 host.<宿主标识>.root 与 host.<宿主标识>.rules_root`,
        }),
      ],
      data: { key },
    };
  }

  // 宿主真实根：宿主标识必须在注册表内，取值非空，类别须有对应的落位根
  if (hostRootKey !== null) {
    const hostId = hostRootKey[1] as string;
    const slot = hostRootKey[2] as string;
    const entry = hostById(hostId);
    if (entry === undefined) {
      return invalidValue(
        key,
        previous,
        `宿主标识不在宿主注册表内：${hostId}`,
        '请使用宿主注册表中已登记的标识；未登记取值不写入配置',
      );
    }
    if (entry.roots === undefined) {
      return invalidValue(
        key,
        previous,
        `该宿主没有落位根，不接受宿主根配置：${hostId}`,
        '不适用宿主（如模型提供方）不参与分发，无需配置落位根',
      );
    }
    const kinds = entry.roots.map((root) => root.kind);
    const wanted = slot === 'rules_root' ? 'rules' : 'skill';
    const satisfied = kinds.includes(wanted) || (wanted === 'skill' && kinds.includes('external'));
    if (!satisfied) {
      return invalidValue(
        key,
        previous,
        `该宿主没有 ${wanted} 类落位根：${hostId}`,
        `请改用该宿主支持的落位根类别；注册表中登记的类别为 ${kinds.join('、')}`,
      );
    }
    if (value.trim() === '') {
      return invalidValue(key, previous, '宿主落位根不能为空', '请给出宿主真实根的路径');
    }
    return accepted(index, key, previous, value.trim());
  }

  if (key === 'skill_roots') {
    const roots = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    if (roots.length === 0) {
      return invalidValue(
        key,
        previous,
        'Skill 根目录列表不能为空',
        '请至少给出一个根目录，多个目录用逗号分隔',
      );
    }
    for (const item of roots) {
      try {
        // 路径防护：根目录必须落在工作区之内
        resolveWithin(workspaceRoot, item, '工作区');
      } catch (error) {
        const kernelError = error instanceof KernelError ? error : null;
        return {
          index: null,
          findings: [
            finding(kernelError?.code ?? CODES.PATH_INVALID, {
              source: 'input',
              target: item,
              message: kernelError?.message ?? `根目录不可用：${item}`,
              remedy: '请把根目录限定在工作区之内，多个目录用逗号分隔',
            }),
          ],
          data: { key, previous_value: previous ?? null },
        };
      }
    }
    return accepted(index, key, previous, roots);
  }

  if (key === 'default_mode') {
    if (!TARGET_MODE_VALUES.includes(value as 'copy')) {
      return invalidValue(
        key,
        previous,
        `落位方式取值非法：${value}`,
        `仅允许 ${TARGET_MODE_VALUES.join(' 或 ')}`,
      );
    }
    return accepted(index, key, previous, value);
  }

  if (value.trim() === '') {
    return invalidValue(
      key,
      previous,
      '默认目标不能为空',
      '请给出默认目标标识；一期的目标标识没有登记表，取值域校验仅覆盖非空',
    );
  }
  return accepted(index, key, previous, value.trim());
}

function accepted(
  index: SkillIndex,
  key: string,
  previous: unknown,
  value: unknown,
): SetConfigOutcome {
  return {
    index: { ...index, config: { ...index.config, [key]: value } },
    findings: [],
    data: { key, previous_value: previous ?? null, new_value: value },
  };
}

function invalidValue(
  key: string,
  previous: unknown,
  message: string,
  remedy: string,
): SetConfigOutcome {
  return {
    index: null,
    findings: [finding(CODES.INPUT_INVALID_ARG, { source: 'input', target: key, message, remedy })],
    data: { key, previous_value: previous ?? null },
  };
}
