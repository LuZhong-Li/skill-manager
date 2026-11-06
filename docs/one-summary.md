# 交付盘点（二期进行中）

本文档是交付盘点与 backlog 说明，只做记录与规划，不引入任何新需求。
盘点依据是仓库当前状态：代码、契约、测试与构建产物，均可按文中给出的命令复核。

**文档状态**：本文件原先是一期收官盘点，自二期起**按现状整体维护**（缺口登记表、backlog、计数与规模都随批次刷新）。
**一期收官时点的快照不再单独保存**：对应状态以 `CHANGELOG.md` 的「一期收官（2026-10-15）」条目为准，可追溯。

**结论**：一期与二期功能面均无未实现项——缺口登记表 12 项**全部已实现**（N-12 随界面批次收口），体积优化已交付。表内另登记 1 项**已知选项**（N-13，换内核分发形态），非缺口，待指标触发时再评估。
**后续阶段 M5（宿主适配层）已收官**：需求（9.3.6，M5-R1 至 M5-R9）、调研、设计、计划、实现与测试全链路完成，验收映射见 [`docs/plan/m5-host-adapter.md`](plan/m5-host-adapter.md) 第 3 章；遗留项见本文档 [7.3 节](#73-m5宿主适配层状态与遗留项)。

---

## 1. 功能面

### 1.1 指令：17 条，与契约逐条对应

| 序 | 指令 | 类别 | 说明 |
|---|---|---|---|
| 1 | `init` | 环境 | 建立工作区与索引，重复执行幂等 |
| 2 | `config get` | 配置 | 读取配置区，不做推导也不补默认值 |
| 3 | `config set` | 配置 | 修改单个配置项，取值域校验后原子写入 |
| 4 | `scan` | 登记 | 扫描根目录、组装索引、计算运行期结论 |
| 5 | `list` | 查询 | 列表与过滤，给出分组计数 |
| 6 | `inspect` | 查询 | 单个 Skill 的完整信息与指纹比对结论 |
| 7 | `install` | 生命周期 | 校验、冲突检测、写入中心库、逐文件落位、登记 |
| 8 | `uninstall` | 生命周期 | 备份 → 回收副本 → 移除记录；`--hard` 一并删除原件 |
| 9 | `enable` | 生命周期 | 前置校验、按需补齐副本、切换可见性 |
| 10 | `disable` | 生命周期 | 只切换副本可见性，不分发、不删除 |
| 11 | `update` | 生命周期 | 按磁盘现状刷新记录，并重分发已存在的副本 |
| 12 | `validate` | 校验 | 只读校验；不刷新运行期结论，过期时建议重新扫描 |
| 13 | `deps` | 依赖 | 依赖条目分级与影响面分析 |
| 14 | `export` | 备份 | 导出索引状态，剥离未知字段并登记清单 |
| 15 | `import` | 备份 | 整体校验后逐条登记，既有标识跳过不覆盖 |
| 16 | `restore` | 备份 | 从备份载体恢复内容：写回中心库、重分发副本、刷新或重建记录 |
| 17 | `reconcile` | 盘点动作 | T0~T6 已落地：六动作、共享根整组、插件 x-、分类批量、GUI 确认与三平台写探针 |

复核：`node kernel/entry/cli.ts --help`，或运行 `npm test` 里的契约测试（断言已注册指令是契约清单的子集）。

### 1.2 桌面外壳

| 项 | 状态 |
|---|---|
| Electron 主进程与窗口生命周期 | 已实现，开发模式与打包模式分别解析内核路径 |
| G-02 内核桥接器 | 已实现：子进程调用、结果解析、十七条指令门面、预览 → 确认 → 执行；`reconcile` 经通用 `kernel:invoke` 接入盘点视图 |
| 预加载白名单 | 已实现：`contextBridge` 暴露内核四方法与 `updates` 白名单（检查、设置、确认后 update、提示订阅），构建为 CommonJS 以兼容沙箱 |
| 渲染层页面 | 已实现：仪表盘卡片列表、详情、安装、校验报告、确认弹窗（含逐文件预览）、**备份管理页**（列出内核产出的备份并恢复）、空工作区引导、操作日志 |
| 应用图标 | 已实现：程序化绘制、七档尺寸、内嵌进可执行文件与安装包 |
| 打包产物 | 已实现：免安装目录、NSIS 安装包、便携单文件；内核以独立可执行文件随包分发 |
| 界面冒烟 | 已实现：经调试协议校验真实界面（含备份管理页列出真实备份、恢复确认弹窗、确认后真写回原件），开发产物 / 免安装目录 / 便携单文件三种方式各 9/9 |

---

## 2. 契约面

| 契约资产 | 位置 | 规模 |
|---|---|---|
| 需求规格 | `docs/requirements.md` | 12 条功能需求、5 类非功能需求、附录 A 至 D |
| 系统架构 | `docs/architecture.md` | 四层架构、32 个模块、12 项架构决议 |
| 界面设计 | `docs/ui-design.md` | 一期页面与视觉规范 |
| 元数据规范 | `docs/specification/skill-meta-spec.md` | 字段定义、18 条校验规则 |
| 索引格式规范 | `docs/specification/index-format.md` | 三区结构、投影规则、重建流程 |
| 指令契约 | `docs/specification/cli-contract.md` | 17 条指令、确认强度、缺口登记表 |
| 结果与退出码规范 | `docs/specification/result-and-exit-codes.md` | 结果封装 8 字段、问题码 69 个、退出码 7 档 |
| 宿主注册表规范 | `docs/specification/host-registry.spec.md` | 宿主注册表字段与 15 条校验规则（HR-01 ~ HR-15）；`adapter_forms` / `landing_roots` / `inventory_roots` 单一来源；安全控制字段按宿主语义证据准入、外部消费方登记 |
| 插件格式规范 | `docs/specification/plugin-format.md` | 声明式 host-profile 插件 manifest、独立插件索引、`x-` 命名空间与插件问题码 |
| 内置宿主账本规范 | `docs/specification/host-landings.spec.md` | `host_landings.yaml` 字段、摘要、共享根、状态机与双源权威等级 |
| JSON Schema | `schemas/*.json` | 八份，与七份规范文档逐字段对齐并由测试守住 |

### 2.1 问题码与退出码

- 问题码 69 个，覆盖输入、环境、标识、字段、状态、时间、指纹、语法、依赖、运行时、校验、冲突、路径、索引、版本、来源、备份、宿主账本、盘点动作、锁与文件系统、通道等类别。
- 退出码 7 档（0 至 6），派生规则为「命中即停」。
- **专属优先原则**：指令另有专属退出码规定时优先于通用派生。当前三条指令适用——`validate` 采用 0 至 3 的专属口径；`deps` 与 `enable` 的依赖类分支可达 6；`import` 的格式与指纹校验失败返回 3。

### 2.2 写入权限边界

| 数据 | 写入者 |
|---|---|
| 索引声明区与派生区 | 内核在登记、安装、卸载、更新、恢复、导入时写入；用户只可编辑配置区与记录的启用状态。派生区含聚合指纹与逐文件内容摘要 `digests`，后者只存索引、不进导出物 |
| 运行期结论区块 | **只由登记与刷新动作写入**；校验动作保持只读，结论过期时只报告并建议重新扫描 |
| 元文件派生区字段 | 由内核在登记、安装、更新、扫描时回填；用户侧缺失表示待回填，存在但格式不合规才报错 |
| 运行时探测结果 | **不写入任何文件**：运行时可用性与版本属环境相关数据，只由 `deps` 实时呈现，不入索引与运行期结论 |

---

## 3. 架构面

### 3.1 分层与依赖方向

| 约束 | 落地方式 |
|---|---|
| 内核零界面依赖 | `npm run check:layer` 硬拦：内核包的依赖与源码引用中出现界面框架即失败 |
| 界面不越层引用内核 | 同一条检查断言 GUI 不引用 `kernel/dispatch`、`kernel/core`、`kernel/store`、`kernel/entry` |
| 内核零反向引用 | 内核源码引用界面侧即失败 |
| 界面数据源唯一 | 渲染层不接触 Node，只经预加载白名单调用内核；桥接器以子进程与标准输出通信 |

### 3.2 关键机制

| 机制 | 说明 |
|---|---|
| 受控副本 | 启用与禁用只改副本内的技能元数据文件名，不移动、不重命名、不删除任何目录，原件与用户源文件永不改动 |
| 可推导副本布局 | 副本位置按 `.<目标标识>/skills/<Skill 标识>` 推导，不依赖原件是否存在；原件缺失时卸载仍能完整回收 |
| 逐文件落位 | 元文件提供 `file_map` 时按映射落位，缺省时整目录复制；落位计划逐文件进入载荷 |
| 原子写入 | 写临时文件 → 刷盘 → 原子替换；对 Windows 上的瞬时占用做有限重试，用尽仍按文件系统类错误上报 |
| 备份先行 | 卸载前强制备份，备份校验通过才允许删除；备份失败即中止且不改动环境 |
| 备份恢复 | `restore` 按标识与时间戳定位载体，写回中心库、按落位计划重分发副本、刷新或重建记录；载体只读消费 |
| 备份列表 | `restore --list` 为备份管理界面提供数据出口（界面不直读工作区文件）；只读清单、不校验载体 |
| 逐文件漂移定位 | 索引派生区保存逐文件内容摘要，内容一致性校验据此报出发生变化的文件相对路径与新旧摘要；缺基准时退化为聚合级报告 |
| 运行时探测 | 运行时可用性与版本由 `deps` 实时探测（POSIX `command -v` / Windows `where` 加 `--version`），按语义化版本范围判定；结果不入索引 |
| 失败原子性 | 安装、卸载、刷新、导入的失败路径都回到调用前状态；刷新固定为「先重分发副本、再写索引」 |

---

## 4. 工程面

### 4.1 规模

| 目录 | 源文件数 | 行数 |
|---|---|---|
| `kernel/` | 50 | 12236 |
| `gui/` | 23 | 2607 |
| `tests/` | 59 | 11500 |
| `scripts/` | 31 | 4121 |
| 合计 | 163 | 30464 |

口径：`kernel/`、`gui/`、`tests/`、`scripts/` 下的文本源文件（`.ts`、`.vue`、`.mjs`、`.json`、`.css`、`.html`、`.yml`），排除 `node_modules/`、构建产物与二进制资源；行数含空行与注释。

**刷新记录（2026-10-17，M3-T3）**：本表口径不变，数值按上述口径重测刷新（此前一次刷新停留在 M1 时点，属**文档漂移**——差异来源为 M2/M3 新增脚本、测试与宿主适配层源码；原表数值未再追溯）。

### 4.2 验证手段

| 手段 | 覆盖 | 命令 |
|---|---|---|
| 单元测试 | 校验规则、存储原语、生命周期编排、查询与导出、逐文件落位、配置写入、参数解析、桥接层 | `npm test` |
| 契约测试 | 问题码登记、指令清单子集、选项登记、schema 样例校验与字段一致性 | 同上 |
| 端到端测试 | 十七条指令的闭环、确认流程、只读断言、导入导出往返 | 同上 |
| 构建期检查 | 契约校验与分层校验 | `npm run check` |
| 类型检查 | 内核与界面两侧 | `npm run typecheck` |
| 界面冒烟 | 真实窗口与真实内核调用 | `npm run smoke:gui` |
| 打包验证 | 免安装目录与便携单文件的启动闭环 | `npm run smoke:gui -- --app <产物>` |

当前测试总数 **525 项**（单元 348、契约 104、端到端 73），全部通过；另有慢测试 1 项经 `npm run test:slow` 单独执行；`smoke:gui` 18/18 通过。其中 M5 宿主适配层贡献：注册表与适配器契约测试、渲染层断言、落位执行器与外部根解析用例、`--host` 接线的端到端断言、收口审计用例；M2 贡献图标管线与构建配置用例；M3 贡献夹具、测量器、基线与报告契约用例；M4a T1/T2/T3 贡献检查四态、semver、只读 probe、确认执行、频率开关、`update --ref` 与真机交互用例。

### 4.3 工程约定

| 约定 | 由来 |
|---|---|
| 端到端测试必须核对实际执行的用例数 | 曾出现用例被静默跳过而报告「全通过」的情况，只断言无失败不足以发现 |
| 改行为时必须回看既有用例语义 | 曾出现用例前提被静默削弱、断言仍成立的情况 |
| 契约中写明的选项必须已登记 | 曾出现文档写了而实现未登记的选项，在解析阶段报错或悄悄改变语义 |
| 含子进程的指令断言走独立进程 | 就地替换标准输出会把测试框架写往同一管道的消息一并捕获，表现为「断言无故失败」；改用 `spawnSync` 跑真实入口取退出码与输出 |
| 冒烟脚本使用空闲端口并结束整个进程树 | 固定端口会连到上一次遗留实例；只杀直接子进程会留下占用端口的实例 |
| 先文档后实现 | 语义变更先落到契约与规范，再改实现 |

---

## 5. 缺口登记表现状

登记表在 `docs/specification/cli-contract.md` 第 7.3 节，共 **13 项**：**12 项缺口全部已实现**，另 1 项是**已知选项**（评估过、有量化收益但未采用，记录以便日后按指标重新评估）。

### 5.1 已实现（12 项）

| 编号 | 项目 | 完成于 |
|---|---|---|
| N-01 | 卸载前生成备份并输出备份位置 | 备份批次 |
| N-02 | `install` 的 `--target`、`--scope`、`--mode` | 逐文件落位批次 |
| N-03 | 逐文件落位映射与每文件落位计划 | 逐文件落位批次 |
| N-04 | 确认级别 | 交互策略层批次 |
| N-05 | Git 仓库地址与本地归档来源（含远端 Git 地址与远端归档地址） | 来源扩展批次（本地 + 远端） |
| N-06 | 卸载输出的逐条文件路径与文件数量 | 逐文件落位批次 |
| N-07 | 内容漂移定位到具体文件（索引派生区逐文件内容摘要 `digests`） | 内容漂移定位批次 |
| N-08 | 备份载体的恢复（第 16 条指令 `restore`）与载体枚举 | 备份恢复批次 |
| N-09 | 中心库原件缺失时回收受控副本 | 逐文件落位批次 |
| N-10 | 外部运行时探测与依赖版本比较（`deps` 实时探测，不入索引） | 运行时探测批次 |
| N-11 | 刷新后重分发受控副本 | 逐文件落位批次 |
| N-12 | 界面上的备份恢复入口（`restore --list` 出口 + 备份管理页的预览 → 确认 → `--yes`） | 界面批次 |

### 5.2 在册（0 项）

无。缺口全部关闭。

### 5.3 已知选项（1 项，非缺口）

| 编号 | 选项 | 实测收益 | 未采用的理由与重新评估条件 |
|---|---|---|---|
| N-13 | 内核分发形态改用 Electron 的 Node 模式（随包分发脚本包，不再携带 Node 运行时副本） | 约 23 MB/产物（119.7 → 97.8 MiB）、92 MB/解包目录 | 需改架构决议 AD-09，其价值正是内核与界面框架解耦；体积已由零风险手段下降 7.7%，边际收益递减。待分发体积成为硬指标时再评估 |

### 5.3 已知限制（1 项，不阻塞）

| 项目 | 说明 |
|---|---|
| 内核可执行文件体积 | 内核可执行文件约 88 MB（Node 运行时 87.2 MiB + 内核包 0.7 MB），随包产物约 119.5 MiB。已做随包侧的体积裁剪（asar 排除构建期依赖、locales 裁剪），内核侧的进一步压缩需要改 AD-09 的分发形态，属架构变更 |
| ~~备份载体枚举~~ | 已随 N-08 解决：备份载体按标识与时间戳枚举，`restore` 按唯一时间戳寻址 |

---

## 6. 文档基线

| 类别 | 文件 |
|---|---|
| 需求与设计 | `docs/requirements.md`、`docs/architecture.md`、`docs/ui-design.md` |
| 设计文档 | `docs/design/` 下八份：`m1-ci.md`、`m2-packaging.md`、`m3-benchmark.md`、`m4a-auto-update.md`、`m4b-plugin-ecosystem.md`、`m5-host-adapter.md`、`m4c-host-inventory.md`、`maintainability.md` |
| 计划文档 | `docs/plan/` 下八份：`m1-ci.md`、`m2-packaging.md`、`m3-benchmark.md`、`m4a-auto-update.md`、`m4b-plugin-ecosystem.md`、`m5-host-adapter.md`、`m4c-host-inventory.md`、`maintainability.md` |
| 契约规范 | `docs/specification/` 下七份 |
| 机器可读形态 | `schemas/` 下八份 JSON Schema |
| 调研记录 | `docs/research/` 下六份：`skill-plugin-manager-research.md`（快照，不修改）、`host-mechanisms.md`、`post-phase-references.md`、`kernel-findings-m3.md`、`m4c-host-inventory-2026-10-18.md`、`maintainability-audit-2026-10-18.md` |
| 基准与报告 | `docs/benchmark/`（基线 JSON、压测报告、CI 烟测记录；M3 起） |
| 评审记录 | `docs/reviews/` 下五份（快照，不修改；修订以补记承接） |
| 变更记录 | `CHANGELOG.md` |

仓库内所有文档的具体改动，`docs/reviews/` 下的快照一律不改，问题状态变化以新增补记承接，保证变更可追溯。

### 6.1 M4c 与可维护性调研批次（2026-10-18）

| 线 | 文档 | 关键结论 |
|---|---|---|
| M4c 宿主盘点 | [`docs/research/m4c-host-inventory-2026-10-18.md`](research/m4c-host-inventory-2026-10-18.md) | 内置宿主无统一分发账本；`targets[]` 仅为工作区目标；插件 `landings` 可判 managed / path 缺失但无渲染摘要；本机 Codex 实际在 `~/.codex/skills`、豆包平台 `.skills` 有 141 个有效技能，注册表默认根会显示 0；顶层与递归口径使同机总量在 161 / 166 / 205 之间变化；建议将内置账本、根范围与盘点语法作为需求侧裁决项 |
| 可维护性 | [`docs/research/maintainability-audit-2026-10-18.md`](research/maintainability-audit-2026-10-18.md) | 110 个 TS/JS 文件、315 条 import 边、0 循环；2 条 store→core 反向依赖、1 条 scripts→store 内部引用；99 个函数 complexity > 10（最大 52）；`dispatch/registry` 2621 行、`lifecycle` 1738 行；GUI 侧问题码 / 结果类型双写；测试夹具重复；建议先落 `check:arch` + ESLint ratchet + 单一来源，再拆分 hotspot |

### 6.2 M4c 与可维护性设计批次（2026-10-18）

| 文档 | 关键设计决定 |
|---|---|
| [`docs/design/m4c-host-inventory.md`](design/m4c-host-inventory.md) | 内置宿主使用独立 `host_landings.yaml`；与 M4b `plugin_index.landings` 双源并存、读取合并；`uninstall` 扩展 `--host`；`root_role` 分 user/system/platform/project，主计数只算 user；`scan --inventory` 未初始化可用；历史副本标推断；三平台 fixture 探针 |
| [`docs/design/maintainability.md`](design/maintainability.md) | P0 全量前置：`check:arch` 清零 3 条违例、complexity ratchet、`contract/` 单一来源、共享测试夹具；P1 只前置宿主三处合一与 dispatch scan 段；lifecycle/plugins 拆分与 P2 后置；批次序列与 569 项测试逐批全绿（P0-a 558 → P0-d 569） |

### 6.3 M4c 与可维护性计划批次（2026-10-18）

| 文档 | 批次范围 |
|---|---|
| [`docs/plan/m4c-host-inventory.md`](plan/m4c-host-inventory.md) | L-1 ~ L-5 账本批次、M4c-1 ~ M4c-7 功能批次；v0.4.0 范围、契约 6→7 / schema 7→8、测试增量与验收映射 |
| [`docs/plan/maintainability.md`](plan/maintainability.md) | P0-a ~ P0-d、P1-a ~ P1-d、P2；全局批次表、contract 约束、complexity ratchet、测试 / 发版门禁 |
| [`docs/plan/v0.4.0-acceptance.md`](plan/v0.4.0-acceptance.md) | v0.4.0 总验收：M4c / NFR / 风险 / MNT-R 逐条映射、前后指标、遗留项、打包与生产验证 |

统一批次：P0-a → P0-b → P0-c → P0-d → L-1 ~ L-5 → P1-a → P1-b → M4c-1 ~ M4c-7 → P1-c → P1-d → P2；账本 + M4c 合并 v0.4.0，纯重构不发版。

### 6.4 P0-b `contract/` 单一来源（2026-10-18）

| 项 | 结果 |
|---|---|
| 共享包 | `contract/`（`@skill-manager/contract`，零运行时依赖，TS 源码直接由 esbuild / electron-vite 编译） |
| 迁移 | 结果类型、`CODES`、来源超时/体积/备份提示、`SKILL.md` 文件名、插件纯结构类型 |
| 双写收敛 | GUI `update-check/constants.ts` 删除；bridge/renderer 结果类型改为 contract；`E-CHANNEL-001` / `E-SRC-*` 改为 `CODES` |
| 违例 | P0-a 3 条 allowlist 清零；`check:arch` 126 文件 / 331 边 / 0 循环 / 0 例外 |
| 构建 | `build:kernel` + `smoke:kernel` 通过；`build:desktop` + `smoke:gui` 28/28 通过 |
| 技术债 | `core/metadata/constants.ts`、`core/plugins/types.ts` 兼容 re-export barrel 登记到 P1/P2 收口删除 |
| 验证 | 563 项测试、typecheck / lint / format:check / build 全绿 |

### 6.5 P0-c complexity / 文件规模 ratchet（2026-10-18）

| 项 | 结果 |
|---|---|
| 基线 | 99 个 complexity > 10 函数 / 43 个文件 / 最大 52；12 个超阈值文件 |
| 阈值 | core 500 / vue 800 / tests 1000 / scripts 500；按非基线最大值 423 / 248 / 611 / 457 反推 |
| 检查器 | `scripts/check-complexity.mjs` + `scripts/architecture/complexity-baseline.json`；`check:complexity` 已入 `npm run check` |
| 规则 | 新复杂函数失败；基线函数升高失败、下降需更新；新超阈值文件失败；基线文件加行失败；拆分后残留基线条目失败 |
| 自检 | 新复杂函数 12、基线函数 52→53、基线文件 2621→2622 三类均被捕获并恢复 |
| 验证 | 563 项测试、typecheck / lint / format:check / build 全绿 |

### 6.6 P0-d 共享测试夹具（2026-10-18）

| 项 | 结果 |
|---|---|
| 夹具 | `tests/helpers/temp.ts`、`skill.ts`、`host.ts`、`plugin.ts`、`backup.ts`、`git-daemon.ts` |
| 收编 | 38 个测试文件、**82 个直接 `mkdtemp` 调用点** → **0**（grep 120 含 38 处 import）；统一 `makeTempDir` 自动清理 |
| 迁移 | `validMeta` 3 处、`tempHostRoot` 3 处、插件 manifest、备份、回环 git daemon（含 Windows 进程树收尾） |
| 特殊保留 | 归档 / zip 安全样本与 bench 大夹具保留专门构造，仍统一经 `makeTempDir`；见计划 P0-d 状态 |
| 防回潮 | `check:test-fixtures` + `test-fixture-baseline.json`；直接 mkdtemp 基线 0 |
| 临时目录 | 完整套件与慢测试前后 `sm-*` / `bench-fixture-*` 新目录均为 0 |
| 验证 | 569 项测试（568 通过 + 1 平台跳过）、慢测试 1 项、typecheck / lint / format:check / build 全绿 |

### 6.7 L-1 内置宿主账本契约（2026-10-18）

| 项 | 结果 |
|---|---|
| 需求 | 9.3.7 增补账本前置与 `uninstall --host` 分发生命周期；指令数仍 16 |
| 规范 | `docs/specification/host-landings.spec.md`（第 7 份契约规范，HL-01 ~ HL-15） |
| Schema | `schemas/host_landings.schema.json`（第 8 份 JSON Schema） |
| 字段 | `skill_id / source_version? / source_ref? / host_id / target_path / format / visibility / state / origin / source_checksum / content_digest / adapter_ref / registry_version / created_at / updated_at` |
| 摘要 | 复用 `collectHashEntries` / `computeChecksum` 的「相对路径 + NUL + 文件字节」单次 SHA-256；`SKILL.md.disabled` 规范化为 `SKILL.md`；不引入第二套哈希 |
| 根属性 | `root_role` / `root_id` 不固化进账本；读取时由注册表与配置判定 |
| 共享根 | 同一物理路径按宿主各记一条；账本不去重；单宿主卸载遇其他活跃消费方拒绝 `E-LANDING-001`；`--host all` 一次清理 |
| 状态机 | `uninstall --host` / `--host all` 保留 `orphaned` 审计；原件卸载成功且无 active 后物理清除该 Skill 的 `orphaned` 记录 |
| 双源 | 内置账本权威四分类；插件账本 managed / 缺失权威、内容一致 / 漂移需重渲染；无账本推断；输出按 managed / content / source 三轴标注 |
| 问题码 | `E-LANDING-001`（账本或绑定不可用）、`E-LANDING-002`（原件卸载被 active 宿主账本阻断）；`check:contract` 锁定 7 / 8 与两码同源 |
| 测试 | 新增 4 项契约测试；常规 569 → **573 项**（572 通过 + 1 平台跳过） |
| 验证 | `npm run check`、`npm test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过 |

> 本节起，当前契约面为 **七份规范 / 八份 schema / 69 个问题码**；第 7 章早期小结中的六份 / 七份表述为当时快照，不再代表当前状态。

### 6.8 L-2 内置宿主账本写路径（2026-10-18）

| 项 | 结果 |
|---|---|
| Store | `kernel/store/host-landings/index.ts`：原子读写、主键 CRUD、共享路径同步；损坏 / 重复主键 / 坏枚举返回 `E-LANDING-001` |
| Core | `kernel/core/host-landings/index.ts`：记录构造、adopted、按物理路径同步、账本提交与回滚编排 |
| Dispatch | `kernel/dispatch/host/` 拆为 channel / landing-result / index 三文件；`dispatch/registry` 只保留路由与确认 |
| init | 幂等创建空 `host_landings.yaml`；已有账本不覆盖，重复 init 不产生额外变更 |
| 四命令 | install/update 落位后写账本；enable/disable 改名后更新 visibility；物理副本先写、账本后写并在失败时回滚 |
| Digest | `computeLandingChecksum` 复用 `collectHashEntries` / `computeChecksum` 的单次 SHA-256；可见副本摘要与 `computeChecksum` 完全相同，`.disabled` 规范化后不变 |
| 共享根 | codex/cursor 同路径 e2e：只写一份副本、按宿主各记一条；disable/enable/update 同步全部活跃记录 |
| adopted | 历史副本 enable 以 `origin: adopted` 入账，结果 `adopted: true`；不误记为 distributed |
| 形态 | entry 不产生账本；rules 只允许 visible，规则形态 enable/disable 返回参数类错误 |
| 回滚 | 单测覆盖已有副本恢复、首次副本删除、规则文件恢复/删除、账本字节不变、共享根两记录整体回滚；e2e 覆盖损坏账本前置中止与路径冲突 |
| 测试 | 新增 18 项（11 unit + 7 e2e）；常规 573 → **591 项**（单元 382、契约 116、端到端 93；590 通过 + 1 平台跳过） |
| 结构 | 复杂函数基线 99 → **96**；`dispatch/registry` 2621 → **2419** 行；`dispatch/host` 三文件均低于 500 行；`check:arch` 134 文件 / 377 边 / 0 循环 |
| 验证 | `npm run check`、`npm test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过 |

> 账本写路径已落地；`uninstall --host` / `--host all` 与原件卸载闭环仍属 L-3，本批未实现。

### 6.9 L-3 宿主副本卸载与原件闭环（2026-10-18）

| 项 | 结果 |
|---|---|
| 路由 | 内置 host-id / `cursor-rules` → `host_landings`；`x-` 前缀 → `plugin_index.landings`；`all` 同时读取两账本 |
| 单宿主 | 副本临时改名 → 两账本写 orphaned → 删除；共享根仍有其他 active 宿主时拒绝 `E-LANDING-001`；路径不存在按幂等成功 |
| `--host all` | 按物理副本分组，共享副本只删一次；逐组提交，单组失败不影响其他组，结果逐宿主列出 `removed` / `missing` / `unchanged` / `failed` |
| 一致性 | 每组先临时移走副本，再写两账本，再删除；账本失败恢复副本与账本，删除失败恢复副本并保留 orphaned |
| 原件阻断 | `uninstall` / `--hard` 前检查两账本 active；命中 `E-LANDING-002`，消息含 host / path / ledger_source 与逐宿主 / `--host all` 引导 |
| 孤儿清理 | 原件卸载成功后清除 `host_landings` 中该 Skill 的 orphaned 记录；插件账本孤儿按 M4b 保留 |
| 互斥 / 再激活 | `--host` 与 `--hard` / `--kind plugin` 互斥；orphaned 后 `update --host` 复用同主键回到 active，不重复 |
| 备份 | `--host` 不创建 Skill 备份；结果 `backup: null`、`workspace_unchanged: true`；插件包不卸载 |
| 测试 | 新增 12 项（6 unit + 6 e2e）；常规 591 → **603 项**（单元 388、契约 116、端到端 99；602 通过 + 1 平台跳过） |
| 结构 | 复杂函数基线 96 → **95**；`dispatch/registry` 保持 **2419** 行；`dispatch/host/uninstall*` 四个文件均低于 500 行；`check:arch` 139 文件 / 407 边 / 0 循环 |
| 验证 | `npm run check`、`npm test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过 |

> L-3 已收口；`scan --inventory`（M4c）、inferred / export 边界（L-4）与旧工作区兼容（L-5）仍未实现。

### 6.10 L-4 对账纯函数与 export 边界（2026-10-18）

| 项 | 结果 |
|---|---|
| 类型 | `contract/src/host-reconciliation.ts`：观察副本、账本记录、工作区基线、三轴证据与分类输出 |
| 纯函数 | `kernel/core/host-landings/reconcile.ts`：`reconcileHostCopy`，不做文件系统枚举 |
| host 判定 | active 一致 / 内容漂移 / 可见性漂移 / 来源漂移 / 版本漂移 / 缺失 / 不可读；渲染基线变化不判漂移，content 降 inferred |
| 无账本 | inferred_consistent / inferred_drift / untracked / not_distributed；任何无账本场景不判 missing |
| orphaned | 副本残留且工作区有记录：`orphaned` + content/source inferred，并区分一致 / 漂移；工作区无记录：all insufficient + untracked_candidate；副本不存在：`copy_present:false` |
| 插件 | managed / missing 权威；content 与 source 最多 inferred；无重渲染基线时 undetermined |
| 无工作区 / 根不可读 | 只出 undetermined，三轴 insufficient，不判 missing/drift |
| 降级 | `ledger_state: missing 或 unreadable` 走无账本推断，带 `ledger_unavailable_degraded`，不抛崩、不伪造权威 |
| export | `host_landings` 不进 export 包；restore 不恢复账本；测试断言导出文档无 `host_landings`/`landings`，restore 前后账本字节一致 |
| 测试 | 新增 13 项（12 unit / 1 contract）；常规 603 → **616 项**（单元 400、契约 117、端到端 99；615 通过 + 1 平台跳过） |
| 结构 | complexity 基线保持 **95**；`reconcile.ts` ≤ 500 行；`check:arch` 141 文件 / 408 边 / 0 循环 |
| 验证 | `npm run check`、`npm test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过 |

> M4c 对账的纯函数“大脑”已独立可测；宿主枚举、IO 接线与 GUI 展示仍属 M4c。L-5 兼容旧工作区尚未实现。

### 6.11 L-5 v0.3.0 旧工作区兼容（2026-10-18）

| 项 | 结果 |
|---|---|
| 缺失 | 无 `host_landings.yaml` 按空账本读取：`exists:false` / `index:null` / `findings:[]`；不报错、不归类损坏 |
| 损坏 | 文件存在但不可解析 / schema 不合规：`E-LANDING-001`；损坏字节不被重置，副本不被先改 |
| 懒初始化 | install/update/enable/disable 首次遇到缺失账本时幂等补建空文件；dry-run 与被拒确认不写 |
| 不迁移 | 升级不扫描宿主、不批量写记录；只读路径保持文件缺失，历史副本走 inferred，不伪造 distributed |
| adopted | 首次 `disable --host` 补建账本并以 `origin: adopted` 入账；首次 `update/install --host` 正常 `distributed` |
| 字节断言 | 只读 / enable-disable 前后 `skill_index.yaml`、`plugin_index.yaml` 字节一致；update 只改 skill 索引且插件索引字节不变 |
| 版本 | 新账本 `schema_version: "1"`，`tool_version` 取当前工具版本；后续演进按 schema 版本递增 |
| 测试 | 新增 5 项 e2e；常规 616 → **621 项**（单元 400、契约 117、端到端 104；620 通过 + 1 平台跳过） |
| 结构 | complexity 基线保持 **95**；`dispatch/registry` 保持 2419 行；`check:arch` 141 文件 / 408 边 / 0 循环 |
| 验证 | `npm run check`、`npm test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过 |

> 至此 L-1 ~ L-5 账本批次全部完成；P1-a 随后在 6.12 收口。

### 6.12 P1-a 宿主三处合一与盘点根（2026-10-19）

| 项 | 结果 |
|---|---|
| 单一来源 | `registry-data.ts` 每个宿主引用一份 `HOST_ROOT_MODELS`，统一提供 `adapter_forms` / `landing_roots` / `inventory_roots`；`FORM_BY_HOST` 删除 |
| selector | `formImplementationOf` 从 `adapter_forms` 派生并复用形态实现；`defaultRootFor` 只展开 `landing_roots`，无 hostId 分支 |
| 分发行为 | 六宿主默认根保持等价；Codex 仍分发到 `~/.agents/skills`，`~/.codex/skills` 仅作为盘点 legacy 根 |
| 盘点根 | Codex：agents user / legacy user / system / project；豆包：`.user_skills` user + `.skills` platform；Cursor 技能根递归、规则根顶层；其余按宿主约定 |
| 角色与来源 | `role = user/system/platform/project`；`origin = default/legacy/config`；配置根由 selector 追加为 user 根，不写回注册表 |
| 跨平台 | 静态根标 `pending_verification`；macOS / Linux 由 M4c-7 CI 探针验证，真机目录仍登记 TD-02 |
| x- 宿主 | 插件 catalog selector 从已启用插件 profile 产出同一 `InventoryRootView`；未配置 global 根时 `configured:false` + `missing_root_config`，不硬编码进内置注册表 |
| 契约 | `host-registry.spec.md` 新增 3.5.1 ~ 3.5.3、HR-14 / HR-15；schema 收紧三组字段与 `env` 基址约束；`plugin-format.md` 的 P-04 / 隔离条款改指 `adapter_forms` |
| 测试 | 新增 6 项契约测试；常规 621 → **627 项**（单元 400、契约 123、端到端 104；626 通过 + 1 平台跳过） |
| 结构 | complexity 基线 95 → **94**；`registry-data.ts` 428 行、`host-root-models.ts` 204 行、`inventory.ts` 117 行；`check:arch` 146 文件 / 416 边 / 0 循环 |
| 验证 | `npm run check`、`npm test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过 |

> P1-a 已收口；P1-b 随后在 6.13 收口。

### 6.13 P1-b dispatch scan 段拆分（2026-10-19）

| 项 | 结果 |
|---|---|
| 模块 | `kernel/dispatch/scan/`：`index.ts` / `types.ts` / `options.ts` / `workspace.ts` / `plugin.ts` / `result.ts` |
| Skill 扫描 | 索引存在性检查、`withLock`、`loadIndex`、`scanWorkspace`、`saveIndex`、结果组装进入 `workspace.ts` / `result.ts` |
| 插件扫描 | `scan --kind plugin` 的索引刷新、未登记候选与孤儿账本保持无锁，进入 `plugin.ts` |
| 共享辅助 | `rejectPluginOptions` / `workspaceRootOf` 等进入 `dispatch/shared`；插件索引读取状态进入 `dispatch/plugins/state.ts` |
| registry | `dispatch/registry/index.ts` 仅保留 `scanHandler` 导入与注册；2419 → **2172** 行 |
| M4c 分流点 | 在索引检查前形成计划并标注：inventory 将不锁、不写 `last_scan_at`、未初始化可运行；本批不注册占位参数 |
| 行为等价 | 现有 Skill / 插件 scan e2e 全绿；索引、`last_scan_at`、输出、退出码与锁行为保持 |
| 测试 | 新增 2 项结构测试；常规 627 → **629 项**（单元 400、契约 125、端到端 104；628 通过 + 1 平台跳过） |
| 结构 | complexity 保持 **94**；`check:arch` 154 文件 / 462 边 / 0 循环 / 0 allowlist |
| 验证 | `check`、`test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过、`smoke:gui` 28/28、慢测试 1 项通过 |

> P0 + L-1 ~ L-5 + P1-a/P1-b 已全部收口；M4c-1 随后在 6.14 收口。

### 6.14 M4c-1 `scan --inventory` 命令骨架（2026-10-19）

| 项 | 结果 |
|---|---|
| 参数 | `--inventory` 布尔选项；与 `--kind` / `--root` / `--dry-run` 及位置参数互斥，统一 `E-INPUT-002`；允许 `--workspace` 与通用输出选项 |
| 分流 | `scanPlanOf` 后、workspace 索引检查前进入 `inventoryScanCommand`；不加锁、不写 `last_scan_at`、不调用 `scanWorkspace` |
| 未初始化 | 无 `skill_index.yaml` 正常 exit 0，`workspace.state = uninitialized`，不创建索引 / 插件索引 / 账本 |
| 根清单 | `data.mode = inventory`，`workspace` + `roots[]`；内置 `InventoryRootView` 映射 root_role / recursive / origin / consumed_by / configured；已启用 x- 宿主带 `is_x_host: true` |
| 配置 / 插件 | `host.<id>.root` 覆盖根展开为 config 根；启用插件后 x- 宿主根出现，未启用插件不出现；env 缺失根保留并标 `missing_environment` |
| 只读 | 测试断言 `skill_index.yaml` 运行前后字节一致；结构测试禁止 inventory 调用锁、索引写入、scanWorkspace 与 last_scan_at |
| 契约 | `cli-contract.md` 4.4 登记 inventory 语法、互斥、允许项与输出字段；指令数仍 16，规范 / schema 份数不变 |
| 测试 | 新增 5 项（2 unit / 3 e2e）；常规 629 → **634 项**（单元 402、契约 125、端到端 107；633 通过 + 1 平台跳过） |
| 结构 | `check:arch` 155 文件 / 474 边 / 0 循环 / 0 allowlist；complexity 保持 **94** |
| 验证 | `check`、`test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过、`smoke:gui` 28/28、慢测试 1 项通过 |

> M4c-1 已收口；M4c-2 随后在 6.15 收口。

### 6.15 M4c-2 宿主目录发现与物理去重（2026-10-19）

| 项 | 结果 |
|---|---|
| 发现 | `kernel/core/inventory/discover.ts` 只读遍历根；direct 只枚举一级子目录，recursive 任意深度查找；references/examples 等无 SKILL.md 目录不计数 |
| 识别 | SKILL.md frontmatter 必须有 name/description；`.disabled` 标 disabled；bad YAML / 缺 name/description / 可见性冲突进 corrupt；rules 只识别 `.mdc`；agents-md entry 根为 not_applicable |
| 观察 | copies[] 含 path、host/root/role、format、visibility、recursive、skill_id/version、content_digest、readable/exists、consumed_by/root_ids/sources；digest 复用 `computeLandingChecksum` |
| 去重 | physical_key = realpath + Windows casefold；共享根和父子根重叠合并，同一 skill_id 的不同物理根分别保留 |
| 根状态 | ok / empty / missing / unconfigured / unreadable / not_applicable；损坏副本进 `corrupt[]` |
| 只读 | 宿主文件与 `skill_index.yaml` 运行前后字节一致；未初始化工作区照常发现 |
| 性能 | 200 技能 × 每技能 10 个 references 文件（2200 文件）Windows 本机 **214 ms** |
| 测试 | 新增 5 项（4 unit / 1 e2e）；常规 634 → **639 项**（单元 406、契约 125、端到端 108；638 通过 + 1 平台跳过） |
| 结构 | `check:arch` 157 文件 / 480 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；`discover.ts` 457 行 |
| 验证 | `check`、`test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过、`smoke:gui` 28/28、慢测试 1 项通过 |

> M4c-2 已收口；M4c-3 随后在 6.16 收口。

### 6.16 M4c-3 双源双向对账（2026-10-19）

| 项 | 结果 |
|---|---|
| 正向 | `kernel/dispatch/scan/reconcile.ts` 将 M4c-2 copies/corrupt 接入 `reconcileHostCopy`，保留 classification / ledger_source / 三轴 evidence / reasons / drift_reasons |
| 反向 | active `host_landings` 与 `plugin_index.landings` 按规范化 target_path 反查；未观察到时输出 `missing[]`；orphaned 不产生 missing |
| 工作区 | 只读 `skill_index` 与工作区源文件构造 baseline；未初始化、账本损坏、根/工作区不可读均保留 degraded 语义 |
| 插件 | managed / missing 权威；content/source 使用现有 profile 重渲染为 inferred；无基线时 undetermined，禁止 authoritative content/source |
| 共享根 | 同一物理副本可匹配多条 active 记录；副本删除时按宿主账本逐条进入 missing |
| 测试 | 新增 5 项（2 unit / 3 e2e）；常规 639 → **644 项**（单元 408、契约 125、端到端 111；643 通过 + 1 平台跳过） |
| 结构 | `check:arch` 158 文件 / 496 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；`reconcile.ts` 474 行 |
| 验证 | `check`、`test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过、`smoke:gui` 28/28、慢测试 1 项通过 |

> M4c-3 已收口；M4c-4 随后在 6.17 收口。

### 6.17 M4c-4 结构化聚合与最终统计（2026-10-19）

| 项 | 结果 |
|---|---|
| 主计数 | `summary.main` = user role 的去重有效副本数与 `unique_skills`；system/platform/project 独立分组 |
| 分类 | by_classification 保留 L-4 原分类；groups 保留 managed/drift 的 authoritative/inferred，missing/untracked/undetermined/unreadable/not_distributed/orphaned 单列，orphaned 分区工作区在/不在 |
| 层级 | `hosts → roots → copies/corrupt/missing`；扁平 copies 保留全部对账证据供下钻 |
| 人类输出 | 默认突出 `全机盘点：X 个安装副本 / Y 个不同技能`；role/分类/宿主摘要；`--verbose` 才列副本明细 |
| 计数边界 | 共享根只算一份；corrupt 只入 corrupt_count；missing 不增加有效副本；同 id 多根分别计副本、合并计 unique |
| 测试 | 新增 3 项（2 unit / 1 e2e）；常规 644 → **647 项**（单元 410、契约 125、端到端 112；646 通过 + 1 平台跳过） |
| 结构 | `check:arch` 159 文件 / 498 边 / 0 循环 / 0 allowlist；complexity 94 → **93**；`aggregate.ts` 253 行 |
| 验证 | `check`、`test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过、`smoke:gui` 28/28、慢测试 1 项通过 |

> M4c-4 已收口；M4c-5 随后在 6.18 收口。

### 6.18 M4c-5 只读保证系统化（2026-10-19）

| 项 | 结果 |
|---|---|
| 静态守卫 | `check:arch` 审计盘点只读源：只允许 read/stat/realpath 类 fs API，拒绝写调用、锁、索引写入、落位与账本提交；synthetic 反例可捕获 |
| 动态快照 | `tests/helpers/snapshot.ts` 记录相对路径、类型、mtime、大小与 SHA-256；工作区与全部宿主根前后逐项比较 |
| 场景 | 多宿主/共享根/x- 宿主、未初始化工作区、损坏 host_landings、缺失/非目录根、100 副本规模 |
| 证据 | 损坏账本字节不变；无锁/临时/缓存残留；索引与 `last_scan_at` 不变；全部快照一致 |
| 测试 | 新增 5 项（1 contract / 4 e2e）；常规 647 → **652 项**（单元 410、契约 126、端到端 116；651 通过 + 1 平台跳过） |
| 结构 | `check:arch` 159 文件 / 498 边 / 0 循环 / 0 allowlist；complexity 保持 **93** |
| 验证 | `check`、`test`、typecheck、lint、format:check、build 全绿；`smoke:kernel` 通过、`smoke:gui` 28/28、慢测试 1 项通过 |

> M4c-5 已收口；下一批为 M4c-6 GUI 盘点视图。

### 6.19 M4c-6 GUI 盘点视图（2026-10-19）

| 项 | 结果 |
|---|---|
| 入口 | 侧边导航「全机盘点」；空工作区与已初始化空列表均提供「盘点这台电脑上已安装的 Skill」，未初始化即可运行 |
| 通道 | 复用通用 `kernel:invoke` 调用 `scan --inventory`；不新增 IPC、不走预览/确认 |
| 主计数 | user「安装副本 / 不同技能」置顶；system/platform/project 折叠并标注平台/系统内置，不参与主计数 |
| 分组与分类 | 内置 / 第三方 x- 宿主分区；共享根 `consumed_by`；managed/drift 保留 authoritative/inferred，missing/untracked/undetermined/unreadable/orphaned 分项 |
| 下钻 | 宿主 → 根 → 副本；id、版本、路径、可见性、分类、权威、账本来源与判定依据；损坏、缺失、未纳管分开展示 |
| 只读 | 无写动作入口；二期导入/修复为禁用占位；盘点前后工作区与 settings 字节一致 |
| 组件 | `HostInventoryView` + 3 个盘点子组件 + 纯展示映射；`App.vue` 858 → **844** 行，新组件均低于 800 行 |
| 发现修正 | 插件 rules 根兼容 `.md`，内置 Cursor 仍只识别 `.mdc`；修复 x- 宿主副本在盘点中显示为 0 |
| 冒烟 | 28 → **40/40**；空工作区、主计数、平台折叠、共享根、损坏、未纳管、x- 宿主、只读与 200 副本滚动均实测 |
| 测试 | 新增 6 项（2 unit / 4 contract）；常规 652 → **658 项**（单元 412、契约 130、端到端 116；657 通过 + 1 平台跳过） |
| 结构 | `check:arch` 167 文件 / 511 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；`scripts/gui-smoke.mjs` 743 → **660** 行 |

> M4c-6 已收口；下一批为 M4c-7 三平台 CI fixture 探针。

### 6.20 M4c-7 三平台 CI fixture 探针（2026-10-19）

| 项 | 结果 |
|---|---|
| 探针 | 新增 `scripts/probe-host-inventory.mjs`，真实执行 `scan --inventory --json`；临时 HOME/LOCALAPPDATA 夹具，35 项断言 |
| CI | [run 39189852362](https://github.com/LuZhong-Li/skill-manager/actions/runs/39189852362)：`inventory-probe` 独立 job，ubuntu-24.04 / windows-latest / macos-15，fail-fast false；三平台均 Success |
| 路径机制 | HOME 展开、平台分隔符、config 根、Claude / Codex / Cursor 用户根；Windows 豆包平台根按平台出现 |
| 发现与对账 | 有效技能、`.disabled`、坏 YAML、缺 name、无 SKILL.md 忽略、references 不计数、共享根去重、Cursor 递归、managed/drift/missing/untracked、未初始化 |
| symlink | macOS / Linux 创建目录符号链接并验证 realpath 去重；Windows 条件跳过并在输出标注 |
| 插件规则 | x- 宿主 `.zed/rules/<id>.md` 作为 rules 发现，验证 `.md` 兼容与 id 识别 |
| pending | 移除 Claude / Cursor 机制根；保留三个 Codex 事实根；依据逐条登记 |
| 真机项 | TD-02：真实安装 Claude / Codex / Cursor 的 macOS/Linux 默认布局；TD-07：Codex 官方 vs 遗留分发根口径 |
| 测试 | 新增 3 项契约测试；常规 658 → **661 项**（单元 412、契约 133、端到端 116；660 通过 + 1 平台跳过） |
| 结构 | `check:arch` 168 文件 / 511 边 / 0 循环 / 0 allowlist；complexity 保持 **94** |

> M4c-7 已收口，M4c 功能与验证全部完成；下一批为 v0.4.0 总验收与发版准备。

### 6.21 v0.4.0 发布与发布后验证（2026-10-19）

| 项 | 结果 |
|---|---|
| tag | `v0.4.0` → `4711cc0`；annotated tag 已推送 |
| 发布 run | [39194534164](https://github.com/LuZhong-Li/skill-manager/actions/runs/39194534164)：四 leg + release job Success |
| Release | [v0.4.0](https://github.com/LuZhong-Li/skill-manager/releases/tag/v0.4.0)：latest、非 draft、非 prerelease，6 资产齐备 |
| 资产复算 | 回下载 5 个交付物 `sha256sum -c` 全部 OK；6 个资产与 SHA256SUMS.txt 一致 |
| Windows 生产 GUI | Release portable + 生产 `resources/app.asar/out/renderer`；`smoke:gui` **40/40**；空工作区盘点、主计数、宿主分区、共享根、分类与只读均实测 |
| 发布物内核 | `--version=0.4.0`；`PRODUCTION_KERNEL_RESULT=ok managed=2 missing=2`，覆盖 init → 分发 → scan --inventory → missing → untracked；大 JSON 管道输出不截断 |
| macOS C 组 | arm64 / x64 dmg 内内核 `0.4.0`、`Signature=adhoc`、init → scan → list 全通过 |
| 历史版本 | v0.1.0 已知问题提示已幂等指向 v0.4.0；v0.1.1/v0.1.2/v0.2.0/v0.3.0 未改动 |
| 远端 | 仅 `main` 与 tags `v0.1.0` ~ `v0.4.0`；临时分支已删除 |

> v0.4.0 已发布；M1 ~ M5 与 M4c、可维护性横切批次全部落地。

### 6.22 P1-c lifecycle 拆分（2026-10-19）

| 项 | 结果 |
|---|---|
| 入口 | `kernel/core/lifecycle/index.ts` 1738 → **19 行**，只保留公共导出 |
| 模块 | `install` / `uninstall` / `toggle` / `update` / `restore` + `shared` / `types`；新模块均低于 500 行 |
| 行为 | 16 指令输出、退出码、落位、备份、锁与失败原子性不变；lifecycle 单测 58、CLI/update/host-uninstall e2e 70 全绿 |
| 结构 | `check:arch` 176 文件 / 570 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；超阈值文件 12 → **11** |
| 测试 | 新增 1 项结构断言；常规 661 → **662 项**（单元 412、契约 134、端到端 116；661 通过 + 1 平台跳过） |

> P1-c 已收口；下一批 P1-d plugins/manifest 拆分。

### 6.23 P1-d plugins/manifest 拆分（2026-10-19）

| 项 | 结果 |
|---|---|
| 入口 | `kernel/core/plugins/manifest.ts` 636 → **9 行**，只保留公共导出 |
| 模块 | `manifest-shared` / `manifest-root` / `manifest-host` / `manifest-validate`，均低于 500 行 |
| 行为 | 插件 T0/T1/T2/T3 与 schema / 宿主单一来源测试 31 项全绿；安全字段、canonical 命名、config 隔离与 M4c x- 盘点不变 |
| 结构 | `check:arch` 180 文件 / 583 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；超阈值文件 11 → **10** |
| 测试 | 新增 1 项结构断言；常规 662 → **663 项**（单元 412、契约 135、端到端 116；662 通过 + 1 平台跳过） |

> P1-d 已收口；下一批 P2 收口。

### 6.24 P2-1 内核超阈值文件清零（2026-10-19）

| 项 | 结果 |
|---|---|
| registry | 2172 → **106 行**；命令模块、host-toggle、shared 分离，仅保留注册与路由 |
| source | 722 → **196 行**；shared / remote / archive 分阶段 |
| validation / backup / metadata / hosts | 670 / 654 / 579 / 730 → 各自 barrel + 职责模块，均 <500 行 |
| 行为 | 16 指令、插件、盘点全链路等价；registry targeted 与 CLI/update/host-uninstall e2e 全绿 |
| 结构 | `check:arch` 210 文件 / 792 边 / 0 循环 / 0 allowlist；超阈值文件 **10 → 4**；complexity 保持 **94** |
| 测试 | 新增 1 项 kernel 规模结构断言；常规 663 → **664 项**（单元 412、契约 136、端到端 116；663 通过 + 1 平台跳过） |

> P2-1 已收口；剩余超阈值文件为 App.vue、bench runner、gui-smoke 与 e2e cli，进入 P2-2。

### 6.25 P2-2 最后四个超阈值文件清零（2026-10-19）

| 项 | 结果 |
|---|---|
| App.vue | 844 → **785 行**；设置页独立为 `SettingsPanel.vue`，App 只保留外壳与视图路由 |
| e2e CLI | 1148 → `cli-core` 133 / `cli-backup` 363 / `cli-import-restore` 473 / `cli-runtime` 136；共享 `tests/helpers/cli.ts` |
| bench runner | 534 → **421 行**；参数解析进入 `bench/args.mjs` |
| gui-smoke | 660 → **495 行**；插件流程与进程收尾独立 |
| 行为 | 61 项 CLI e2e 数量与断言不变；`smoke:gui` 40/40；bench 实跑可用 |
| 结构 | 超阈值文件 **4 → 0**；`check:arch` 214 文件 / 800 边 / 0 循环 / 0 allowlist；complexity 保持 **94** |

> P2-2 已收口；下一批 P2-3 处理 TD-06、架构依赖图与死代码。

### 6.26 P2-3 TD-06、架构依赖图与死代码收口（2026-10-19）

| 项 | 结果 |
|---|---|
| TD-06 | 删除 `kernel/store/contract.ts` 与 `kernel/core/plugins/types.ts`；`metadata/constants.ts` 与 `scan/types.ts` 不再转出 contract 类型/常量；finding helper 独立到 `store/findings.ts` |
| 引用迁移 | 内核 / GUI / scripts / tests 全部直接 import `@skill-manager/contract`；仅 `kernel/index.ts` 与 `kernel/dispatch/result/index.ts` 作为公共入口保留显式 re-export |
| 依赖图 | `npm run arch:graph` 生成 `docs/architecture/dependency-graph.json`；`check:arch-graph` 接入 `npm run check`，源码与入库图逐字节比对 |
| 图规模 | 214 源文件 + 1 资产节点、761 条相对 import、0 循环、0 allowlist |
| 死代码 | 删除零外部引用的 `HostRootModelId`、`SecurityControlField`、`isDigestMap`、`makeHostSkill`；143 个仅文件内使用的 export 保留 |
| 孤立文件 | 除 7 个声明入口外无无入边源码；依赖图测试锁定入口清单 |
| 结构 | complexity 保持 **94**；超阈值文件保持 **0**；P2-3 未新增复杂函数 |
| 测试 | 新增 4 项结构/契约断言；常规 664 → **668 项**（667 通过 + 1 平台跳过） |

> P2-3 已收口。第 10 章 MNT-R1 ~ R9 全部闭环；代码库达到 0 架构违例、0 循环、0 超阈值文件、单一 contract 来源与完整机械护栏。

### 6.27 M4c 二期动作文档（2026-10-19）

| 项 | 结果 |
|---|---|
| 需求 | 新增 9.3.8；M4c2-R1 至 M4c2-R10；`scan --inventory` 永远只读 |
| 调研 | [`docs/research/m4c-inventory-actions-2026-10-19.md`](research/m4c-inventory-actions-2026-10-19.md)：现有写原语、五个真实缺口、同类工具惯例、`update --host` 契约边界漂移 |
| 设计 | [`docs/design/m4c-inventory-actions.md`](design/m4c-inventory-actions.md)：六动作矩阵、推荐 `reconcile`、默认预览 + `--apply`、事务与共享根规则 |
| 计划 | [`docs/plan/m4c-inventory-actions.md`](plan/m4c-inventory-actions.md)：T0 契约 / 只读计划 → T1 repair + forget → T2 adopt + track → T3 accept + clean → T4 插件 / 批量 → T5 GUI → T6 跨平台收口 |
| 裁决 | 新增 17 条 `reconcile`；adopt 导入磁盘实际内容；drift 默认工作区 repair；target 默认按 `default_target + skill_id`；clean 使用临时快照；插件先限四动作 |
| 边界 | 文档批次已完成；T0 随后落地 `reconcile` 注册与只读预览，详见 6.28 |

> M4c 二期文档已评审通过；T0 已实现。

### 6.28 M4c 二期 T0：reconcile 注册与只读预览（2026-10-19）

| 项 | 结果 |
|---|---|
| 指令 | 新增第 17 条 `reconcile`；`scan --inventory` 保持只读，静态守卫扩展到 reconcile 预览路径 |
| 选择器 | `--action` / `--path` / `--id + --host` / `--classification + --root|--host`；默认预览，`--apply` 才进入执行阶段 |
| 计划 | `contract/src/reconcile.ts`：动作、选中副本、前后分类、证据、写入、账本变化、共享根事务组与汇总 |
| 只读预览 | 复用 `inventorySnapshotOf` 与 L-4 对账；精确 path 只选一个物理副本；预览前后工作区与宿主字节不变 |
| 未实现边界 | T0 带 `--apply` 返回 `E-RECONCILE-001`，`applied: false`，不伪造写入 |
| update 对齐 | `update --host` 目标缺失时返回 `E-PATH-001`，引导 `reconcile --action repair`；不再隐式创建副本 |
| 契约 | CLI 17 条；新增 `E-RECONCILE-001/002/003`；七份规范 / 八份 schema 不变 |
| 结构 | `check:arch` 218 文件 / 778 边 / 0 循环；complexity 94；超阈值文件 0 |
| 测试 | 常规 **676 项**（675 通过 + 1 平台跳过） |

> T0 已收口；下一批 T1 实现 `repair` + `forget`。

### 6.29 M4c 二期 T1：repair 与 forget（2026-10-19）

| 项 | 结果 |
|---|---|
| repair | missing / not_distributed 创建，content / visibility drift 恢复，orphaned 再激活，有工作区基线的 corrupt 副本修复 |
| 渲染 | 从中心库本地重渲染，复用 `runHostLanding` / `landPlan` / adapter；不访问网络，不新增第二套渲染 |
| 事务 | `--apply` 获取工作区锁、复查计划签名、标准确认；单副本逐项执行并返回 succeeded / failed / skipped |
| stale | 预览后宿主内容或分类变化返回 `E-RECONCILE-002`，不执行旧计划 |
| forget | missing active 记录转 orphaned；宿主无副本、skill 索引字节不变，不触碰磁盘 |
| 边界 | 共享根 `shared_root_t4` 与插件 `plugin_host_t4` 跳过；目标被文件占用时失败且账本保持原状 |
| 测试 | 新增 8 项 T1 e2e；常规 676 → **684 项**（683 通过 + 1 平台跳过） |
| 结构 | landing visibility / result builder / reconcile candidates 独立模块；check:arch 222 文件 / 807 边 / 0 循环；complexity 94 |

> T1 已收口；T2 已完成，见 6.30。

### 6.30 M4c 二期 T2：adopt 与 track（2026-10-19）

| 项 | 结果 |
|---|---|
| adopt | 从宿主实际内容建立 `skills/<skill_id>`，合成 `source.type: unknown` 元文件，写索引与 adopted 账本；不反向解渲染、不修改源宿主副本 |
| 元数据 | `--target` 只写工作区目标声明，路径按 `.<target>/skills/<skill_id>`；中心库目录始终按 `skill_id`；目录名与 frontmatter `name` 不一致时以 `name` 为 ID |
| 冲突 | 同 ID 内容一致引导 `track`，不一致引导 `accept` / `repair`；未登记同名中心库目录拒绝覆盖；目标被其他 Skill 占用时要求显式 `--target` |
| track | 仅处理 `inferred_consistent`，只补 adopted 账本；工作区、宿主与索引字节不变；drift / untracked 拒绝 |
| 事务 | 中心库同卷暂存 + 原子改名；索引/账本失败恢复索引并移除中心库；损坏账本在物理写入前中止 |
| 边界 | 共享根 `shared_root_t4`、插件 `plugin_host_t4` 跳过；`accept` / `clean` 仍明确未实现 |
| 测试 | 新增 12 项 T2 e2e；常规 684 → **696 项**（695 通过 + 1 平台跳过） |
| 结构 | `check:arch` 225 文件 / 839 边 / 0 循环；complexity 94；超阈值文件 0 |

> T2 已收口；T3 已完成，见 6.31。

### 6.31 M4c 二期 T3：accept 与 clean（2026-10-19）

| 项 | 结果 |
|---|---|
| accept content | 宿主内容覆盖中心库，保留工作区 `skill_meta.yaml`；重算 checksum / digests，更新索引与账本；覆盖前写标准备份 |
| accept visibility | 只同步索引 `status` 与账本 `visibility`；中心库与宿主内容不变 |
| source 边界 | source/version 漂移拒绝 accept，引导 repair；不改 source 声明；结果提示下次 update 可能被远端覆盖 |
| clean | 无工作区 orphaned、无基线 corrupt/unreadable；同卷快照移走 → 账本提交 → 删除；成功无残留，失败恢复副本与账本 |
| 安全 | clean 禁止仅按分类批量，必须 `--path` 或 `--id` + `--host`；未纳管副本不被误删 |
| 边界 | 共享根 `shared_root_t4`、插件 `plugin_host_t4` 跳过 |
| 测试 | 新增 7 项 T3 e2e（含备份失败、账本失败、删除失败注入）；常规 696 → **703 项**（702 通过 + 1 平台跳过） |
| 结构 | `check:arch` 228 文件 / 864 边 / 0 循环；complexity 94；超阈值文件 0 |

> T3 已收口；T4 已完成，见 6.32。

### 6.32 M4c 二期 T4：共享根、插件 x- 与分类批量（2026-10-19）

| 项 | 结果 |
|---|---|
| 共享根 | realpath + casefold 事务组；repair/accept 一次物理写、全部 active 账本同步；adopt 一份中心库；track 全部消费宿主补账 |
| 引用计数 | forget 单宿主只转选中记录；clean 有 active 消费时只清选中 orphaned 账本，全部 orphaned 才删物理；组内账本失败整组保持原状 |
| 冲突 | 同路径不同 form / 账本归属冲突分别以 `shared_root_form_conflict` / `shared_root_ledger_conflict` 拒绝 |
| 插件 x- | track/repair/clean/forget 写 `plugin_index.landings`；repair 复用插件 profile/adapter；禁用后 orphaned 副本可从账本发现并 clean；插件包保留 |
| 隔离 | 内置动作不写 plugin_index，插件动作不写 host_landings；adopt/accept 对 x- 明确拒绝 |
| 批量 | classification 必须 host/root；逐项结果，单副本失败不回滚成功项；共享组内原子 |
| 测试 | 新增 7 项 T4 e2e + 1 项单元；常规 703 → **711 项**（710 通过 + 1 平台跳过） |
| 结构 | `check:arch` 232 文件 / 896 边 / 0 循环；complexity 94；超阈值文件 0 |

> T4 已收口；下一批 T5 GUI 动作预览与确认。

### 6.33 M4c 二期 T5：GUI 动作预览与确认（2026-10-19）

| 项 | 结果 |
|---|---|
| 入口 | 盘点副本明细按分类给出推荐动作；未纳管、缺失、漂移、孤儿、损坏与 not_distributed 均可进入；managed 与 undetermined 无可执行按钮 |
| 预览 | 动作对话框挂载即调用 `reconcile`（不带 `--apply`），由对话框自持预览 / 执行状态；展示写入项、账本变化、备份根、执行后分类与共享根全部消费宿主 |
| 确认 | 仅确认按钮发 `--apply --yes`；accept / clean 需勾选破坏性确认；取消零写入；无一键全修 / 全删，clean 不提供分类批量 |
| 插件 | x- 宿主禁用 adopt / accept，保留 track / repair / clean / forget；插件 repair 只写 `plugin_index` |
| 结果 | 逐项 succeeded / failed / skipped 与问题码可读；成功后重新盘点，分类与未纳管清单即时更新；计划过期与占用错误原样呈现 |
| 组件 | `inventory-actions.ts`、`InventoryActionMenu.vue`、`InventoryActionDialog.vue` 独立；App.vue 保持 785 行，低于 800 阈值 |
| 测试 | 新增 3 项动作映射单元与 21 项界面冒烟；常规 711 → **714 项**（713 通过 + 1 平台跳过）；`smoke:gui` **61/61** |
| 结构 | 依赖图 236 源文件 / 905 边 / 0 循环；complexity 94；超阈值文件 0 |

> T5 已收口；下一批 T6 三平台 e2e、失败注入与发布前门禁。

### 6.34 M4c 二期 T6：三平台写探针、失败矩阵与 EPERM 收口（2026-10-19）

| 项 | 结果 |
|---|---|
| 三平台写探针 | 新增 `probe:reconcile` 与 verify `reconcile-probe` job；隔离 HOME + 显式 config 根；87 项断言覆盖六动作、预览零写入、共享根、插件 x-、分类批量、symlink 与目标占用失败隔离；CI [39264446848](https://github.com/LuZhong-Li/skill-manager/actions/runs/39264446848) 三平台全 Success |
| 失败矩阵 | 新增 track / forget 账本损坏、accept 计划过期、accept 账本失败回滚 4 项 e2e；既有 repair / clean / 共享组失败注入保留 |
| EPERM | 目录级换名统一走 `renameWithRetry`（5 次，10/20/30/40ms 线性退避；EPERM / EACCES / EBUSY）；静态守卫确保 kernel 只有 `store/atomic` 直接调用 `renameSync` |
| 版本 | 0.5.0 发版候选；三处 package.json、`TOOL_VERSION`、CHANGELOG 顶部段一致；未打 tag / 未发布 |
| 测试 | 常规 714 → **726 项**（725 通过 + 1 平台跳过）；`smoke:gui` 61/61；写探针 87 项 |
| 结构 | 依赖图 238 源文件 + 1 资产节点 / 913 边 / 0 循环；complexity 94；超阈值文件 0 |
| CI / Bench | CI [39264446848](https://github.com/LuZhong-Li/skill-manager/actions/runs/39264446848) Success；Bench [39264446881](https://github.com/LuZhong-Li/skill-manager/actions/runs/39264446881) Success |

> T6 已收口；M4c 二期文档、实现与三平台验证全部完成，等待 v0.5.0 发布授权。

### 6.35 v0.5.0 发布与 v0.5.1 修复发布（2026-10-19）

| 项 | 结果 |
|---|---|
| v0.5.0 发布 | tag `v0.5.0` → `e156ec0`；Pack [39266741537](https://github.com/LuZhong-Li/skill-manager/actions/runs/39266741537) 四 leg + Release job Success；Release 为 latest、非 draft、非 prerelease；6 资产齐备 |
| Release Verify | 资产与 SHA 复算 Success；macOS arm64/x64 六动作全部通过，但大 JSON 管道在约 64KB 处截断；Windows 生产 GUI 冒烟在动作入口出现时序抖动 |
| 根因 | `kernel/entry/exe.ts` 仍使用 `process.exit(code)`，源码入口已改 `process.exitCode`；SEA 入口因此未等待 macOS 管道 stdout 排空 |
| v0.5.1 发布 | tag `v0.5.1` → `433b3e4`；Pack [39272915140](https://github.com/LuZhong-Li/skill-manager/actions/runs/39272915140) 四 leg + Release job Success；Release Verify [39275887751](https://github.com/LuZhong-Li/skill-manager/actions/runs/39275887751) 四 job 全 Success |
| 修复 | `exe.ts` 改 `process.exitCode`；三平台 `sea-pipe-probe`；`kernel/` 与 `gui/` 无 `process.exit(` 静态守卫；GUI 动作按钮就绪等待 |
| 生产验证 | Windows portable + app.asar `smoke:gui` **61/61**；Windows / macOS arm64 / macOS x64 均 `actions=6`、`pipe_copies=302`、约 1.03MB JSON 完整解析（v0.5.0 在 65,378 B 截断） |
| 测试 | 727 项（726 通过 + 1 平台跳过）；0.5.1 SEA 本地探针 302 副本 / 1,027,633 B |

> v0.5.0 已标记 macOS SEA 管道已知问题并指向 v0.5.1；v0.5.1 为 latest 修复版。

### 6.36 Dogfood 修正：reconcile 角色写保护（2026-10-20）

| 项 | 结果 |
|---|---|
| 缺陷 | 六动作此前无角色门槛，system / platform / project 副本在分类允许时会生成 `planned`；GUI 未纳管清单也给出采纳动作 |
| 内核 | 候选携带 `root_roles`；仅全部角色为 user 才可写；非 user 与混合角色共享根一律 `skipped` / `non_user_role_read_only`，零写入；执行层防御性拒绝 |
| 根归属 | missing 记录按最长路径匹配 root，修正 `~/.codex/skills/.system` 被外层 user 根误归 |
| GUI | 未纳管清单只列 user（本机 20）；system/platform/project 无动作按钮并标注「由对应工具管理」 |
| 插件 | 写动作测试迁移到 global 作用域（user 角色）；project 作用域插件副本同样只读 |
| 测试 | 常规 727 → **731 项**（730 通过 + 1 平台跳过）；写探针 87 → **102** 项；`smoke:gui` 61 → **64/64** |
| 结构 | 依赖图 238 文件 / 914 边 / 0 循环；complexity 94；超阈值文件 0 |

> 未发版，随下一补丁或下一版本。

### 6.37 全机盘点结果导出（2026-10-20）

| 项 | 结果 |
|---|---|
| 入口 | 盘点工具栏「重新盘点」旁新增「导出」，默认 `skill-inventory.json` |
| IPC | 渲染层将已有 `InventoryScanData` 纯化后经 `inventory:export` 交主进程；主进程 `dialog.showSaveDialog` 写用户选择文件 |
| 内容 | 与 `scan --inventory --json` 的 data 一致：summary/roles/hosts/copies/missing/corrupt/degradation/workspace |
| 边界 | 取消零写入；不写工作区、settings、宿主、账本；导出不是 reconcile，不改变分类 |
| 测试 | 1MB 级序列化单测；GUI 导出冒烟 669KB / 204 副本完整解析、取消零写入、工作区/宿主/settings 字节不变；常规 **732 项**（731 通过 + 1 平台跳过） |
| 冒烟 | `smoke:gui` 64 → **69/69** |

> 未发版，随下一补丁或下一版本。

### 6.38 v0.5.2 发布：角色写保护 + 盘点导出（2026-10-20）

| 项 | 结果 |
|---|---|
| tag | `v0.5.2` → `ea4e6ed` |
| Pack | [39369569286](https://github.com/LuZhong-Li/skill-manager/actions/runs/39369569286) 四 leg + Release job Success |
| Release | [v0.5.2](https://github.com/LuZhong-Li/skill-manager/releases/tag/v0.5.2)，latest、非 draft / prerelease；6 资产 + SHA256SUMS |
| 生产 GUI | Windows portable + app.asar `smoke:gui` **69/69**；导出读回/取消零写入、非 user 副本无动作 |
| 发布物内核 | Windows / macOS arm64 / macOS x64：`actions=6`、`pipe_copies=302`、约 1.03MB JSON 完整；system/project（Windows 含 platform）写保护全 skipped/零写入 |
| 测试 | 常规 **732 项**（731 通过 + 1 平台跳过）；慢测试 1；写探针 102 |
| 结构 | 依赖图 242 文件 / 919 边 / 0 循环；complexity 94；App.vue 790 行 |

> v0.5.2 已发布；v0.1.0 Release 提示指向 v0.5.2，v0.1.1~v0.5.0 未改动。

---

### 7.5 内核核查批次（2026-10-17）

| 项 | 状态 |
|---|---|
| T0 核查 | **已完成**：`docs/research/kernel-findings-m3.md`（三项观察项的源码位置、契约原文、只读探针证据与六项拍板点） |
| T1 修复 | **已完成并随 v0.1.2 发布**（发布后实测：Windows 便携包内核对环夹具 `scan`=6、坏元文件=1、索引损坏=3；macOS arm64/x64 包内内核 0.1.2 且 `init→scan` 0/0）：① 依赖环改为**全量图定环 + 单调传播**（环成员各一条 `E-DEP-003`、下游 `E-VALIDATION-002`、不随迭代轮次或技能数量变化；修复前会振荡并随 N 奇偶翻转归因）；② 退出码第 3 步增加**对象限定**（技能元文件 YAML → 1，索引/配置文件仍 3；`scan` 的环场景 → 6）；③ 索引以**实际目录名**为物理归属键（`id≠目录名` 只报 `E-ID-003`/`E-FIELD-002`，重扫不再产生重复记录） |
| 规范 | 四份规范补文各附变更记录行：skill-meta-spec 5.2/5.3、index-format 2.3/3.2（结论一致性）、cli-contract 4.4、result-and-exit-codes 5.2；指令数 16 与索引格式版本 1 不变 |
| 测试 | 常规套件 471 → **486 项**（单元 +9 / 端到端 +6，端到端全部独立子进程）；修复前的环断言按新语义重写；核查探针转入正式用例后删除 |
| 连带 | bench 预期码表 `scan` → `[0,1,6]`（修复后小档实测通过）；`baseline-0.1.0.json` 原样保留，报告注明退出码口径变化、性能数字无需重录 |
| 发布 | **`v0.1.2` 已发布**（latest、6 资产、回下载复算一致；v0.1.0 提示指向 v0.1.2，v0.1.1 不动）——内核核查批次关闭 |
## 7. 一期冻结状态与二期入口

### 7.1 冻结声明

一期功能清单在需求文档附录 D 冻结：冻结范围为功能需求、指令清单、元数据契约与索引结构；冻结的含义是变更必须先更新文档再实施。一期实施期间的所有语义调整都按该流程执行，契约与实现没有出现方向性分歧。

### 7.2 二期 backlog

| 优先级建议 | 项目 | 依赖或前置 |
|---|---|---|
| — | 来源扩展（N-05） | **已完成**：本地与远端来源、来源类问题码完整路径 |
| — | 备份恢复与载体枚举（N-08） | **已完成**：第 16 条指令 `restore` |
| — | 每文件漂移定位（N-07） | **已完成**：索引派生区逐文件内容摘要 |
| — | 外部运行时探测与版本比较（N-10） | **已完成**：`deps` 实时探测，引入 `semver` 受控依赖 |
| — | 界面备份恢复入口（N-12） | **已完成**：`restore --list` 出口 + 备份管理页的「预览 → 确认 → `--yes`」 |
| 低 | 交互策略扩展 | 后续新增指令带来的确认级别 |
| 低 | 内核可执行文件体积优化 | **已交付**：随包产物 129.6 → 119.7 MiB（asar 排除构建期依赖 + 语言包裁剪）。剩余空间只在 `N-13`（换分发形态），列为已知选项，待体积成为硬指标时再评估 |

二期功能面**已全部交付**：缺口登记表 12 项全部关闭，体积优化批次也已交付（随包产物 −7.7%）。表内只剩 1 项已知选项（N-13，换内核分发形态），属可选优化而非缺口。契约面的语义变更一律先落文档再改实现，做法与一期一致。

### 7.3 M5（宿主适配层）状态与遗留项

**交付现状**

| 面 | 状态 |
|---|---|
| 契约 | 第五份（宿主注册表）、第六份（插件格式）与第七份（内置宿主分发账本）契约规范 + 对应 schema；当前为**七份规范 / 八份 schema** |
| 内核 | K-13 宿主注册表、K-14 渲染层、K-15 适配器层（含外部根解析与落位执行器）；`--host` 已接入 `install` / `enable` / `disable` / `update` |
| 首批宿主 | `claude`、`codex`、`cursor`、`doubao`，以及两个通用条目 `agentskills`（标准目标）与 `agents-md`（指令文件载体）；`deepseek` 维持**不适用**（模型提供方，2026-10-16 复议后不变）；`dsh`（DeepSeek Harness）以**外部消费方**登记在 agents 根下，不立宿主条目 |
| 落位根 | 各宿主默认根由注册表 + 默认路径表给出，可用 `config set host.<id>.root` 覆盖；**Codex 默认 `$HOME/.agents/skills`**（2026-10-16 起，官方文档依据；与 Cursor、`dsh` 共享，一次落位多宿主可见），旧版 `~/.codex/skills` 作为遗留兼容根仅经配置启用，**不默认双写** |
| 分发语义 | `--host <宿主>` 分发到宿主真实根（默认路径 + 配置覆盖）；与 `--target` **正交**，后者保持一期工作区目标语义不变 |
| 验证 | 当前 525 项测试全绿，慢测试 1 项与 `smoke:gui` 18/18 通过；M5 专属用例覆盖注册表、适配器、渲染、落位、`--host` 接线、收口审计与 2026-10-16 收口批次，M2 覆盖图标管线（T0）与构建配置（T1：打包计划 / 未签名三口径 / `maintainer` 判定 / 配置结构 / README 文案）；验收映射见 `docs/plan/m5-host-adapter.md` 第 3 章与 `docs/plan/m2-packaging.md` 第 3 章 |

**遗留项（登记，不关闭）**

| 编号 | 事项 | 状态与下一步 |
|---|---|---|
| M5-L-01 | Cursor 对标准外字段的处理（设计待确认 HD-01） | **部分更新（2026-10-16）**：官方字段表复核完成（较原记录新增 `disable-model-invocation` 与 `metadata`），但「标准外字段被忽略还是报错」文档未述；仍需 Cursor 环境实测，当前保持保守裁剪（透传白名单为空） |
| M5-L-02 | Codex 官方字段全集与技能根优先级（HD-06） | **已关闭（2026-10-16，浏览器一手取证）**：官方页重定向到 `learn.chatgpt.com/docs/build-skills`——`SKILL.md` 必需 `name` + `description`，扩展元数据在 `agents/openai.yaml`，加载位置为 `.agents/skills` 链 + `$HOME/.agents/skills` + `/etc/codex/skills` + 随包 SYSTEM，重名不合并，禁用走 `[[skills.config]]`；**残余**：官方 USER 根与注册项所用的 `~/.codex/skills`（本机实测应用读取）不一致 → 待裁决（M5-L-07 ①） |
| M5-L-03 | AGENTS.md 合并策略未定稿 | 未定稿：`agents-md` 只产出待合并片段、不落盘；策略定稿前不得写入宿主既有文件 |
| M5-L-04 | DeepSeek Harness 插件线索 | **已关闭（2026-10-16）**：`dsh` 为 DeepSeek 官方开源 agent harness（公开仓库、开发者预览、明示破坏性变更），技能为一等子系统；**裁定：不立注册项、不产出适配器**，仅以顶层 `external_consumers` 登记为 `~/.agents/skills` 的消费方；GA 后评估是否升级为宿主条目 |
| M5-L-05 | `--host` 为单值选项 | 解析器已硬化：重复给出按参数类错误拒绝（不静默取最后值）；多宿主分发用多次调用；「单次调用分发到多个宿主」作为未来能力保留待评估 |
| M5-L-06 | `docs/architecture.md` 行尾符（CRLF） | **已关闭**（独立 EOL 规范化批次）：实测该 CRLF 只在**工作副本**，仓库侧 blob 经审计全为 LF（`.gitattributes` 的 `text=auto eol=lf` 入库即规范化）；工作副本已转 LF，与仓库逐字节一致，无内容变更 |
| M5-L-07 | 2026-10-16 取证引出的裁决项 | ①②③ **已裁定并执行**（Codex 根改 `$HOME/.agents/skills` 且遗留根仅经配置；`disable-model-invocation` 按宿主语义证据准入、Codex 纳入；`dsh` 仅登记为外部消费方）；④ **保持开放**（Cursor 白名单维持保守，待 HD-01 实测）。明细见 `docs/design/m5-host-adapter.md` 9.5 / 9.6 与 `docs/research/host-mechanisms.md` 6.3 补记（2026-10-16 第二批：裁定与逐处引文） |
| M4a-L-01 | 成功更新后仍出现 `W-DRIFT-001` 措辞 | **登记后续措辞批次**：上游来源推进本就会使旧记录指纹与新内容不同；当前提示「本地内容与记录不一致」会让成功更新用户误解。后续改为「已更新/本次刷新写入」语义或按动作抑制该告警；本批不改变问题码与索引语义 |

### 7.4 后续阶段其余里程碑状态（M1 ~ M4）

| 里程碑 | 状态 |
|---|---|
| M1 CI 接入 | **已收官（2026-10-16）**。落地物：工作流 `.github/workflows/ci.yml`、缩减冒烟 `scripts/smoke-kernel.mjs`、版本守卫 `scripts/check-node-version.mjs`（均为 CI 支撑物，未新增指令与选项）。四次真实运行给出全部验收证据：首次 run 38769499271（三 job 齐备、两平台 × Node 22、358 项同时通过、两份产物）、加固后 run 38828716615（Success 1m 58s，动作主版本升级 + Linux runner 固定、告警清零）、刻意失败探测 run 38829261658、合并请求 run 38834451784（事件 `pull_request`，探测 PR 已关闭且分支已删除）。9.3.1 七条验收 6 条闭合，缓存条目以「机制已验证 + 时长未达成并附原因」闭合；详见 `docs/design/m1-ci.md` 第 14 章与 `docs/plan/m1-ci.md` 3.1 |
| M2 跨平台打包验证 | **M2 已收官（T0~T4 完成，v0.1.0 已发布）**——`docs/design/m2-packaging.md`、`docs/plan/m2-packaging.md`（T2 执行状态与 EX-07 / EX-08 登记在计划第 1 节）。**T0 图标管线**：纯函数渲染（按目标尺寸直接渲染、零图形库）+ `build-icon.mjs`（14 个文件）+ `iconutil` 封装（可注入、非 macOS 写盘前拒绝）；生成物不入库（`.gitignore` + `git check-ignore` 双证）；既有 `icon.ico` / `icon.png` 零漂移。**T1 构建配置**：`mac`（dmg / icns / 不写签名键）与 `linux`（AppImage / 图标目录 / `executableName` / `maintainer`）段；打包入口 `pack.mjs` + 计划模块 `pack-plan.mjs`；未签名断言 `unsigned-check.mjs`（三口径）＋ `assert-unsigned.mjs`；`maintainer` 实测 `maintainer-probe.mjs` + `check-maintainer.mjs`；README 增「跨平台分发与安装」；签名预留（五个 secrets 名 + 条件骨架，仅文档）。**T2 矩阵**：`verify.yml` 抽取为可复用工作流（ci.yml 改消费、步骤逐条不变）＋ `pack.yml` 四 leg（`windows-latest` / `ubuntu-24.04` / `macos-15` / `macos-15-intel`，`fail-fast: false`、tag 不取消旧运行）；**终态四 leg 全绿**（run 38887140603：Windows 238 MB、Linux AppImage 156 MB、macOS x64 dmg 149 MB、macOS arm64 dmg 145 MB）；**EX-07 根因与修复**：Node 官方 SEA 流程要求 macOS 注入前后处理签名（`--remove-signature` → 注入 → `--sign -`），原构建脚本缺失导致 arm64 打包期签名校验失败，已由 `scripts/sea-signing.mjs` 按序接入并加「包内内核有效签名」可失败断言（同批次并修正未签名断言语义：ad-hoc 为 arm64 平台要求）；三项真机结论以运行页注解公开：`iconutil` 产出 icns（79768 字节）✓、未签名断言判定 `adhoc`（arm64）/ `unsigned`（x64）✓、`linux.maintainer` **not-consumed**（已回写配置注释）；fail-fast 探测实证（单 leg 红时其余 leg 仍出产物）。**EX-08**：`workflow_dispatch` 首跑待有已登录会话时补测。测试 389 → 420 项全绿；**v0.1.0 已发布**（Release 为 latest、非 prerelease；5 资产 + `SHA256SUMS.txt`，回下载复核一致）；T4 的资产级冒烟与验收映射证据见设计 8.6 与计划 T4 |
| M3 性能与规模压测 | **M3 已收官（T0~T3 + EX-13 闭环）；`v0.1.2` 已发布**（[`docs/design/m3-benchmark.md`](design/m3-benchmark.md)、[`docs/plan/m3-benchmark.md`](plan/m3-benchmark.md)）。调研（四环境实测）：跨平台峰值内存口径已选定并验证——Linux `VmHWM` / macOS `ps -o rss=` / Windows `PeakWorkingSet64`，四环境对「分配 192 MB」的子进程分别报 238 / 231 / 224 / 228 MB（偏差一致）；**踩到并修掉两个测量坑**（退出竞态使 Linux 腿 ENOENT 失败、PowerShell 空读被静默记成 0），解法为「就绪握手 + 存活期采样 + 采样失败即报错」；夹具规模实测 N=1000 生成 150 ms~3.9 s、N=5000 1.3~17 s（3000 / 15000 文件、32 / 160 MB），故夹具不入库可复现；**发布二进制启动比源码更快**（SEA 13~96 ms vs 源码 151~327 ms）；CI 不设阈值门禁的依据为共享 runner 的实测波动（同探针跨运行 17%~30%）。设计：夹具分布与固定种子、三平台测量器与固定 JSON 格式、三指令 × 三档 × 冷热矩阵、本机 / 发布二进制 / CI 烟测三线、基线 JSON + 报告 + 回归判定（阈值档硬判、同机波动带、显著回归需同环境复跑）、五条瓶颈候选路径。**五项开放决策点已裁定**：N=1000 阈值保持 30 / 30 / 15 s 与 512 MB 并登记为「未测先收紧」（首测接近阈值即登记优化项、不放宽）、并发对照仅作观察位、N=5000 仅人工触发、基线逐版本重录并只作同环境时序对比、夹具分布在首测前冻结。**计划（T0 夹具与阈值登记 → T1 测量器 → T2 双线三档跑测 → T3 基线报告与判定）登记 13 项计划期事实更正与口径**（`export` 目标为位置参数、夹具根即工作区根、冷态指「内核无索引」、N=5000 仍按 9.4.3 给结论但不作门禁、并发结论形式、`--cpu-prof` 阶段拆分与 SEA 线限制、阈值登记时点与沿革、本章 4.1 规模表漂移待 T3 修复、无效五类按实测问题码、版本字段内核不校验、悬空依赖判无效、依赖图 DAG 约束、文件数公式）。**T0 落地（2026-10-16）**：需求 9.4.3 的 N=1000 档收紧为 `scan`/`validate` ≤ 30 s、`export` ≤ 15 s、内存 ≤ 512 MB 并登记为「未测先收紧」（含改前/改后/依据与沿革）；阈值常量集中在 `scripts/bench/thresholds.mjs`，由契约测试与需求表逐项钉住（放宽即红）；夹具 `scripts/bench/fixture.mjs` + CLI `npm run bench:fixture`（确定性、精确配额、不入库，无效样本按内核实测问题码定型五类，未知字段降为警告样本）。规模实测（本机 Windows / Node v24.14.1）：N=100 → 298 文件 / 3.7 MiB / 112 ms；N=1000 → 2968 文件 / 32.8 MiB / 1083 ms；**N=5000 → 14840 文件 / 159.7 MiB / 10.6 s**（预判 ≤ 14 s 达成）。**实测发现依赖可用性是不动点迭代**：初版构造（回绕窗口 + 成环）下 100 个技能里 48 个被判无效，改为 DAG（依赖指向更小序号）+ 排除无效目标 + 有界级联（深度 3 链 + 2 个叶子依赖方）后，有效无效数可按序推导且与内核判定逐条相等（N=100 18/18、N=1000 134/134，零差异）；「环问题码在收敛后被报告清单吞掉」登记为观察项（不改内核）。；**T1 落地（2026-10-17）**：三平台采样链路（Linux 直读 /proc 的 VmHWM、macOS 长驻 sh + ps、Windows 长驻 PowerShell 读 PeakWorkingSet64）以**会话级助手 + 预热采样**落地（逐场景启动会漏掉短场景，实测校正），采样失败即报错、绝不用 0 兜底；阶段归集（六阶段 + 未归集占比 + 索引写入延迟）与 fs 观测（尺寸或 mtime 变化）就位，编排入口为 `npm run bench`。真机冒烟（本机 Windows / 源码线 / N=100 × 2）：`startup` 207 ms / 77.9 MB、`scan-cold` 347.5 ms / 97.1 MB、`scan-hot` 393 ms / 112.7 MB、`validate` 355.5 ms / 105.2 MB、`export` 278.5 ms / 92.5 MB，退出码全部落在预期码表内（夹具含不合格项：`scan` 3、`validate` 1、`export` 0）；N=100 的阶段归集覆盖率仅 0.02~0.19（剖面含进程启动与模块加载），报告须给出覆盖率。按裁决把 N=5000 落盘用例隔离为慢测试（`npm run test:slow`），常规套件回到约 11 s。另登记两处内核侧观察项：元文件 YAML 错误落到退出码 3（对象限定不符）、标识与目录名不一致的技能在索引里出现两条记录。**T2 落地（2026-10-17）**：SEA 线改用**发布资产解包的内核**（`v0.1.0` 便携包 → `resources/kernel/skill-manager.exe`，资产 SHA256 与 `SHA256SUMS.txt` 一致；报告新增 `kernel_provenance`），**BX-01 关闭**——SEA 不接受 Node 命令行参数（`--cpu-prof` 判 `E-INPUT-002`），但 `NODE_OPTIONS` 生效且产出含内核帧的剖面。本机全矩阵（Windows，runs=3）：源码线 `scan-cold` 100/1000/5000 = 329 / 1154 / 11370 ms、SEA 线 253 / 1118 / 12747 ms，`startup` 源码 193 ms vs SEA 85 ms；**N=1000 阈值初步全部达标**（1.15 / 1.14 / 0.56 s、RSS 326.4 MB）；拐点预判 `scan-cold` 单技能 1000→5000 源码 1.97×、SEA 2.28×（阈值 2×）→ 临界，交 T3 复测；归集覆盖率随档位上升（源码 0.44→0.71→0.78、SEA 0.29→0.50→0.62）。CI 新增 `bench.yml` 三平台 N=100 烟测（run 38938465443 三 leg 全绿，性能数值不作门禁、采样失败即红），**两条 T1 遗留真机路径验证通过**（Linux 直读 `/proc`、macOS `ps` 重采样），结论以注解公开、原始 JSON 随 artifact。**发现发布缺陷 EX-13**：macOS arm64 上本流水线产出的 SEA 内核一执行即被 SIGKILL（137；同 runner 源码线正常、Linux/Windows SEA 正常、已赋权仍复现），影响面含 `v0.1.0` 的 macOS arm64 dmg 包内内核；M3 不修（属发布链路），macOS 的 bench 腿暂只跑源码线并保留取证步骤。失败自证通道（`failure-<form>.txt` → `::error::` 注解）本轮即用于定位该缺陷 |
| M4a 自动更新 / M4b 插件生态 | **M4a 已收官并随 v0.2.0 发布**（`docs/plan/m4a-auto-update.md`）：检查源仅限索引登记来源，四态为 `update-available` / `up-to-date` / `not-checkable` / `failed`，远端仅比较 semver 正式版，probe 只读 `git ls-remote`；GUI 提供角标、四态弹窗、预览→确认→`update`，定期/即时默认关闭、定期 6h、只提示不执行、无系统常驻。**远端专用 `update --ref <tag>`**：更新前备份、目标标签获取后持久化 `source.ref`，再检查为最新；本地来源/`--check --ref`/非法 ref 拒绝，目标不存在不写状态。**发布复核**：Windows 便携包生产形态 GUI 冒烟 18/18；发布物内核 `update --ref` 闭环通过；mac arm64/x64 C 组 `version=0.2.0`、`init_scan=0/0`；SHA 5/5 一致。**M4a-2（应用自更新，不排期）**：矩阵为 macOS/Squirrel.Mac 需签名、Windows NSIS/portable 与 Linux AppImage 需 `latest*.yml`，当前均降级为打开 Release 页；触发条件为签名/公证接入 **且** 发布 `latest*.yml`。**M4b T0/T1/T2/T3 已落地；v0.3.0 已发布**：第六份规范、两份 schema、独立 `plugin_index.yaml`、manifest 校验/发现/哈希、默认 disabled、生命周期、`x-` 宿主落位、`landings` 账本、插件 GUI/宿主分区；T3 失败矩阵 6 项真实 CLI 子进程、`smoke:gui` 28/28（生产 asar）、发布物内核插件闭环、mac C 组 0.3.0/0/0。 |

---

**盘点结论**：16 条指令、六份契约规范与七份 JSON Schema、Electron 桌面外壳与可分发产物均已交付；二期五个批次（来源扩展、备份恢复、漂移定位、运行时探测、界面恢复入口）同样无未实现项，缺口登记表全部关闭。**后续阶段的 M5（宿主适配层）已收官**：第五份契约规范与内核侧注册表 / 渲染 / 适配器三层落地，`--host` 宿主分发接入四条指令，2026-10-16 收口批次完成三项裁决（Codex agents 根、安全控制字段按语义证据准入、`dsh` 仅登记为外部消费方），遗留项见 7.3 节。**M1（CI 接入）亦已收官**：门禁在 Windows 与 Linux 上随推送与合并请求自动执行，四次真实运行给出全部验收证据，七条验收 6 条闭合、缓存条目按需求原文出口以「未达成 + 原因」闭合。**M2（跨平台打包）已收官**：T0~T4 全部完成，`v0.1.0` 已作为 latest Release 发布（5 资产 + SHA256SUMS，含 Windows 两形态 / Linux AppImage / macOS 双架构 dmg），验收映射见设计 8.6；遗留项见 7.4 节与计划第 5 节。**M3（性能与规模压测）已收官**：T0~T3 全部完成，`docs/benchmark/` 三类产物入库，N=1000 四项达标（时间余量 26× 以上、内存 1.6× 为最紧），拐点两轮复测归入「轻微超线性观察项」不优化，覆盖率随档位上升；EX-13（macOS SEA 内核启动即 SIGSEGV）已定位（注入缺 `--macho-segment-name NODE_SEA`）并修复，A/B 两组在 arm64 与 x64 均验证可执行，**C 组（v0.1.0 发布 dmg 内内核）两个架构均 exit=139** → 已发布包内核不可执行；维护者裁决发补丁，**`v0.1.1` 已发布**，发布后对新资产复核：arm64 与 x64 包内内核 `--version` exit=0（0.1.1）、`init → scan` 闭环 0/0，`v0.1.0` 的 notes 已加已知问题提示；内核核查批次三项正确性修复随 **`v0.1.2`** 发布（见 7.4 节）。**M4a（Skill 更新检查）T0~T3 已收官**：四态检查、GUI 确认执行/频率开关、远端 `update --ref <tag>` 目标标签闭环均已交付；真实 daemon 全链路与 `smoke:gui` 18/18 通过。**M4a-2（应用自更新）登记未排期**：签名/公证 + `latest*.yml` 双前提；当前各平台均降级为打开 Release 页。**M4b T0/T1/T2/T3 已落地**：第六份规范、两份 schema、独立插件索引、manifest 校验/发现/哈希、默认 disabled、生命周期、`x-` 宿主落位、`landings` 账本、插件 GUI/宿主分区与失败矩阵；六条机械保证 + 三条审计逐条有用例；CI `39053919194` 与 Bench `39053919195` 均 Success。**P0-a `check:arch` 基线已完成**：121 文件 / 330 条相对 import 边 / 0 循环 / 3 条 P0-a 基线 allowlist；新增 5 项架构契约测试，常规套件由 558 增至 **563 项**（单元 365、契约 112、端到端 86；562 通过 + 1 项平台条件跳过），另有 1 项慢测试经 `npm run test:slow` 单独执行。剩余为 7.2 节的内核体积优化（工程项）、M5 遗留项（M5-L-01 Cursor 实测、M5-L-03 AGENTS.md 合并策略、M5-L-05 多宿主单次分发、M5-L-07 ④）、M4a-L-01 `W-DRIFT-001` 措辞批次、M2 的遗留项（EX-08 `workflow_dispatch` 首跑待登录会话、EX-09 内核产物命名、EX-10 dmg 构建抖动、EX-12 draft 根因待查、`portable.exe` 无 arch 后缀的命名一致性项）与 M1 的缓存收益复测触发器。

**当前 latest Release**：**v0.3.0**（非 draft / 非 prerelease，6 项资产）；发布后复核见 CHANGELOG 的「发布与发布后复核（v0.3.0）」。

**M4b 插件生态**：八项裁决已确认，调研设计与实施计划已落库（[`docs/design/m4b-plugin-ecosystem.md`](design/m4b-plugin-ecosystem.md)、[`docs/plan/m4b-plugin-ecosystem.md`](plan/m4b-plugin-ecosystem.md)）。范围固定为**仅声明式 host-profile 插件**：工作区级 `plugins/<plugin_id>/plugin.json`、独立 `plugin_index.yaml`、`x-<plugin_id>-<host_key>` 命名空间、默认 disabled、六条机械隔离断言；代码插件/全局插件/插件更新检查/安全控制字段/新指令均排除。**T0/T1/T2/T3 已落地，v0.3.0 已发布**：第六份规范、两份 schema、插件索引原子读写、manifest 校验/发现/哈希、插件记录构造与加载合并纯函数；七个指令的 `--kind plugin` 分支、生命周期、`x-` 宿主落位、`plugin.*` 配置路由与 `landings` 副本账本；插件 GUI 列表/详情/安装/启停/卸载、候选与内置/第三方宿主分区；T3 失败矩阵、隔离复核、CI/Bench 三平台与发布物复核均通过。
