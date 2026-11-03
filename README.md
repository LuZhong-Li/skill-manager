# skill-manager

Skill 元信息管理器：统一管理环境内已安装 Skill 的元数据，负责登记、索引、安装、卸载、启用、禁用、更新、校验、依赖检查与备份导入导出。

**边界**：只管理 Skill 的元信息与文件编排，不执行、不解释、不介入任何被管理 Skill 的业务逻辑。

## 当前状态

**一期已收官**：功能面没有已知的未实现项，交付盘点见 [一期收官盘点](docs/one-summary.md)。当前 **v0.9.0**：内置问题处理能力 + 经验回归自动适配宿主，并修复 v0.8.0 打包内核启动即崩溃的问题。

**v0.9.0**：`pipeline run` 默认使用内核自带的本地生成，不接外部服务也能把问题产出为完整文档包；经验记录携带宿主并在同类问题上自动预填、调整环节。

| 交付面   | 内容                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 指令     | 契约清单的 21 条：17 条管理指令（含 `reconcile` T0~T6 六动作、共享根整组、插件 x-、分类批量）+ `pipeline run` 与 `experience list/search/show`    |
| 内核     | TypeScript，零界面依赖；内置本地问题处理（需求/调研/设计/计划/评审 + UI 四件套）与经验回归画像，编译为独立可执行文件随应用分发                    |
| 桌面外壳 | Electron + Vue 3：仪表盘、详情、安装、校验报告、插件管理、全机盘点与逐条动作预览/确认、盘点 JSON 导出、Skill 更新检查；可打包为安装包与便携单文件 |
| 契约     | 七份规范文档与八份 JSON Schema，字段一致性由测试守住                                                                                              |
| 验证     | 929 项测试（928 通过 + 1 项平台跳过）、构建期检查、慢测试、界面真机冒烟、三平台盘点/写动作/SEA 管道探针                                           |
| 持续集成 | GitHub Actions：推送主干 / 合并请求 / 手工触发，Windows 与 Linux × 声明版本，门禁与本地同口径，产物可下载                                         |
| 宿主分发 | `--host <宿主>` 分发并写 `host_landings.yaml`；`uninstall --host` / `--host all` 清理副本并保留 orphaned 审计                                     |

## 快速开始

内核为 TypeScript，可直接以 Node 运行，无需安装依赖之外的任何环境：

```bash
node kernel/entry/cli.ts init --workspace <工作区路径>   # 建立工作区与索引
node kernel/entry/cli.ts scan --workspace <工作区路径>   # 扫描并把已有 Skill 登记进索引
node kernel/entry/cli.ts list --workspace <工作区路径>   # 列出已管理的 Skill
```

写操作（安装、卸载、启用、禁用、刷新、导入、配置写入）在非交互环境下需要显式给出 `--yes`；
不确定影响范围时先用 `--dry-run` 预演。

分发到宿主真实根（`--host` 与 `--target` **正交**：前者决定分发到哪个宿主，后者决定工作区内的目标位置）：

```bash
node kernel/entry/cli.ts config set host.claude.root ~/.claude/skills   # 可选：覆盖宿主真实根
node kernel/entry/cli.ts install <来源> --host claude --yes            # 分发到 Claude 的技能根
node kernel/entry/cli.ts disable <标识> --host claude --yes            # 在宿主根内切换可见性（目录不动）
```

宿主标识取值来自宿主注册表（含按路径类分条的取值，如 `cursor-rules`）；写工作区之外属高影响操作，非终端环境必须给出 `--yes`。

默认落位根取自注册表与平台惯例：Claude `~/.claude/skills`、**Codex `~/.agents/skills`**（官方文档给出的用户级技能根，同一根也被 Cursor 与 DeepSeek Harness 读取，一次落位多宿主可见）、Cursor `~/.cursor/skills`、豆包 agent 模式工作区的 `.user_skills/`。旧版 Codex 目录 `~/.codex/skills` 作为**遗留兼容根**保留，需要时可 `config set host.codex.root ~/.codex/skills` 切回；默认**不双写**两个根。

桌面外壳：

```bash
npm run dev -w @skill-manager/gui    # 开发模式启动界面
npm run smoke:gui                    # 启动应用并经调试协议校验界面
npm run pack:win -w @skill-manager/gui   # 打包 Windows 安装包与便携单文件
npm run pack:mac -w @skill-manager/gui   # 打包 macOS dmg（arm64；x64 用 pack:mac:x64）
npm run pack:linux -w @skill-manager/gui # 打包 Linux AppImage
```

全机盘点（只读，未初始化工作区也可运行）：

```bash
node kernel/entry/cli.ts scan --inventory --json   # 宿主根清单 + 副本发现 + 双源对账 + 分类统计
```

桌面端侧边导航的「全机盘点」与其空工作区入口展示同一份结果：user 主计数、system/platform/project 折叠、内置 / 第三方宿主分区、共享根消费宿主、分类下钻与未纳管清单。一期不提供导入或修复动作。

三平台盘点探针（CI 与本地同口径，使用临时 HOME/LOCALAPPDATA，不读取真实用户目录）：

```bash
npm run probe:inventory
```

## 问题处理与经验回归

`pipeline run` 是内核自带的问题处理入口：不接外部服务也能把一句问题描述产出为可评审的文档包（需求 / 调研 / 设计 / 计划 / 审批；涉及界面时追加页面、组件、交互、视觉四件套）。

```bash
node kernel/entry/cli.ts pipeline run --problem "做一个数据看板，支持实时刷新和导出" --output-dir ./out
node kernel/entry/cli.ts pipeline run --problem "安装时崩溃并报错" --output-dir ./out --host claude

# 基于真实代码处理：只读探查该仓库，把定位结果写进文档
node kernel/entry/cli.ts pipeline run --problem "安装时崩溃并报错" --output-dir ./out --probe-root D:/my-project

node kernel/entry/cli.ts pipeline run --problem "做一个数据看板" --output-dir ./out --answers q1=运营 --answers q2=实时刷新
```

- **默认本地生成**：按环节的角色与文档骨架产出目标、范围、成功标准、验收标准、方案对比、模块与接口、里程碑与验收映射、评审清单；缺陷类问题走「复现 → 根因假设 → 修复设计 → 回归验证」。需要更强表达力时可切外部 LLM：`--llm-provider doubao|claude|openai --llm-api-key <key>`。
- **按真实代码处理（`--probe-root` / `--probe`）**：给出仓库路径后，内核**只读**探查代码——不建目录、不写缓存、不执行任何命令——把问题描述切成检索词（中文按受控词表最长匹配，英文标识符直接使用），在路径与文件内容中定位相关文件，并把结果写进文档：可疑文件清单（含命中词与行号）、相关测试、仓库自己声明过的检查命令、技术栈与扫描规模。缺陷文档的「根因假设」会指向具体文件，修复设计与回归验证改用可执行命令，不再是通用套话。
  - 探查有界：目录/文件/单文件读取量都有上限，不进入 `node_modules`、`.git`、构建产物；达到上限时在文档与载荷中标注结论可能不完整。
  - 未指定探查根时完全不探查，文档相关章节明确标注「未探查仓库，结论均为推断」并给出开启方式；路径不可访问时同样降级、不报错。
  - 证据缺失时**不编造**定位结果；探查根与 `--workspace` 正交，被探查的仓库不会被写入任何文件。
- **症状类描述会被正确判为缺陷**：崩溃、报错、失败、超时、丢数据、很慢/卡顿等一律归为 bugfix（此前「更新失败」会落进新功能口径）；同时「性能优化」「重构」这类改造意图优先判为 refactor，不误判。
- **草案优先**：没有回答也会产出完整文档包，推断内容与「待确认问题」分开标注，不再阻塞在问卷待答；`--answers` 越完整，文档越具体。`--dry-run` 可只预演文档包与经验适配、不写任何文件。
- **经验回归与宿主适配**：每次处理自动记录经验（含宿主、环节计划、决策记录，探查过仓库时还带证据摘要）；同类问题再次处理时自动预填高频回答、在文档中注入历史经验提示，样本足够时按历史多数调整环节，`experience_adapted` 字段列出依据。`experience list / search / show` 可查询；`--host` 或 `SKILL_MANAGER_HOST` 指定画像归属，识别不到时记为 `unspecified`，旧记录作为通用证据继续生效。
- **结果可直接读**：`pipeline run` 与 `experience list / show` 都会打印人类可读摘要（产出了哪些文档、依据什么证据、经验如何适配），不再只显示「无变更」。

## Skill 更新检查

桌面外壳顶部提供「检查更新」入口。检查只读取索引中已登记的来源，不引入独立远端清单服务，也不采集遥测：

- **可更新**：显示当前基线、目标标签、来源、引用与校验信息；用户可预览影响范围并确认后调用 `update <id> --ref <tag> --yes`，更新前先生成可恢复备份。
- **已是最新**：远端没有更高的 semver 正式版。
- **不可检查**：本地来源、归档、分支/提交或非正式版标签会给出具体原因；本地来源请用 `update <id> --check` 查看漂移。
- **检查失败**：认证/限流、离线、超时与协议问题保留 `E-SRC-*` 可读说明，不阻断应用其他功能。

定期检查与即时检查**默认关闭**。定期检查固定 6 小时，只在应用运行期间存在，且只点亮提示角标、不自动下载或安装；即时检查默认关闭，开启后启动时执行一次只读检查。应用不注册系统计划任务、登录项或启动项。

远端标签检查/更新可使用 CLI：

```bash
node kernel/entry/cli.ts update <标识> --ref v1.1.0 --dry-run
node kernel/entry/cli.ts update <标识> --ref v1.1.0 --yes
```

## 插件（扩展）

插件是**能力扩展载体**，不是 Skill。本期只接受声明式 host-profile manifest，不加载或执行任何第三方代码；插件默认 `disabled`，安装不等于启用。

插件包放在工作区级 `<workspace>/plugins/<plugin_id>/plugin.json`，第三方宿主使用 canonical `x-<plugin_id>-<host_key>` 命名空间。内置宿主与第三方宿主在 GUI 中分区显示，内置 7 宿主不可被插件覆盖。插件可复用 `skill` / `rules` / `entry` 三种形态；global 作用域必须显式配置 `plugin.<plugin_id>.<host_key>.root` 或 `.rules_root`，不会默认写入用户主目录。

```bash
# 安装并登记，默认 disabled
node kernel/entry/cli.ts install ./my-plugin --kind plugin --yes
node kernel/entry/cli.ts enable my-plugin --kind plugin
node kernel/entry/cli.ts list --kind plugin

# 查看详情；详情包含 canonical 宿主与 landings 副本账本
node kernel/entry/cli.ts inspect my-plugin --kind plugin

# 停用与卸载；停用不删除既有宿主副本，卸载会保留孤儿账本提示
node kernel/entry/cli.ts disable my-plugin --kind plugin
node kernel/entry/cli.ts uninstall my-plugin --kind plugin --yes
```

最小 manifest 示例：

```json
{
  "manifest_version": "1",
  "plugin_id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "compatibility": {
    "skill_manager": ">=0.2.0 <1.0.0",
    "plugin_api": "1"
  },
  "capabilities": ["host_profile"],
  "hosts": [
    {
      "host_key": "myhost",
      "display_name": "My Host",
      "form": "rules",
      "roots": [
        {
          "kind": "rules",
          "path_template": ".myhost/rules/<skill_id>.md",
          "scope": "project"
        }
      ],
      "render_policy": { "field_mode": "standard6" }
    }
  ]
}
```

插件视图提供安装、启用、停用、卸载、候选与 `landings` 账本；**不包含插件更新检查**。应用自更新（M4a-2）、代码插件、全局插件与插件市场均不在本期范围。

## 仓库结构

| 目录       | 内容                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `docs/`    | 需求、架构、界面设计与七份契约规范，另有调研与评审记录                   |
| `kernel/`  | 元数据内核。承载指令调度、领域服务与文件存储三层，**不依赖任何界面框架** |
| `gui/`     | Electron 桌面外壳。只承担视图职责，所有操作通过调用内核指令完成          |
| `schemas/` | JSON Schema，供校验能力与编辑器提示使用                                  |
| `scripts/` | 构建、打包与构建期强制检查脚本                                           |
| `tests/`   | 单元、契约与端到端测试                                                   |

## 常用命令

```bash
npm test              # 单元、契约与端到端测试
npm run check         # 契约校验与分层校验
npm run typecheck     # 类型检查
npm run lint          # 静态检查
npm run format        # 格式化
npm run format:check  # 格式检查
npm run build         # 构建内核可执行文件与桌面外壳
npm run smoke:kernel  # 内核侧缩减冒烟（不启动 Electron）
npm run check:node    # 版本声明守卫（与 .nvmrc 比对）
npm run smoke:gui     # 界面冒烟（需图形会话）
```

## 持续集成

每次推送到 `main` / `release/**` / `hotfix/**`、以及针对 `main` 的合并请求（打开 / 同步 / 重新打开）和手工触发时，GitHub Actions 会运行同一套门禁；同一分支的连续提交只以最新一次结论为准。

| 项目     | 内容                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| 任务矩阵 | `ubuntu-24.04` 与 `windows-latest`，Node 版本由前置任务读取 `.nvmrc` 生成并断言与声明一致      |
| 步骤     | 版本守卫 → 依赖安装 → 契约与分层校验 → 类型检查 → 代码规范 → 格式检查 → 测试 → 构建 → 缩减冒烟 |
| 产物     | 内核可执行文件与桌面构建产物，命名含平台 / 架构 / 运行标识，保留 14 天；失败时另附诊断产物     |
| 失败口径 | 任一组合失败即整次运行失败；失败可定位到具体步骤与原因，后续步骤不再执行、不产出产物           |

运行入口与产物下载都在仓库的 Actions 页：进入某次运行后可在 **Artifacts** 区下载产物，在 **Summary** 区查看各 job 的步骤耗时与失败定位；本地复现只需按上表顺序执行「常用命令」中的同名命令。

## 跨平台分发与安装

产物随 GitHub Releases 发布：当前版本 **v0.9.0**，下载入口 —— [最新 Release](https://github.com/LuZhong-Li/skill-manager/releases/latest)（或仓库 **Releases** 页选择版本后在 Assets 下载）。

| 平台        | 产物                                                                | 形态                                          |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------- |
| Windows x64 | `skill-manager-<版本>-x64.exe`、`skill-manager-<版本>-portable.exe` | NSIS 安装包 / 便携单文件                      |
| macOS arm64 | `skill-manager-<版本>-arm64.dmg`                                    | 打开 dmg，把应用拖入「应用程序」              |
| macOS x64   | `skill-manager-<版本>-x64.dmg`                                      | 同上（Intel 机器）                            |
| Linux x64   | `skill-manager-<版本>-x86_64.AppImage`                              | 赋可执行位后直接运行                          |
| 全部        | `SHA256SUMS.txt`                                                    | 校验清单（`sha256sum -c` 或 `shasum -a 256`） |

**当前的 macOS 与 Linux 产物未做代码签名与公证**（证书尚未接入），因此 macOS 首次打开会被 Gatekeeper 拦下，这是预期行为。放行方式二选一：

1. 在「应用程序」中**右键点应用 → 打开**，再在弹窗里确认一次「打开」；
2. 或清除隔离属性：`xattr -cr "/Applications/skill-manager.app"`（路径换成实际安装位置）。

Linux 产物以 **ubuntu-24.04** 为打包基座，**glibc 下界 2.39**——更老的发行版无法直接运行该 AppImage，可改为从源码使用（内核只需 Node ≥ 22：`node kernel/entry/cli.ts <指令>`；界面用 `npm run dev -w @skill-manager/gui` 就地启动）。AppImage 依赖 FUSE，若系统未安装（Ubuntu 24.04 起包名为 `libfuse2t64`），可用 `./skill-manager-<版本>-x86_64.AppImage --appimage-extract-and-run` 运行。

自行打包需要对应平台与网络（打包器要下载平台运行时）：macOS 用 `pack:mac` / `pack:mac:x64`，Linux 用 `pack:linux`，Windows 沿用 `pack:win`；打包入口会自动先生成图标（`icon.iconset/`、`icons/`、`icon.icns` 属构建期产物，不入库）。

## 文档入口

- [需求规格](docs/requirements.md)
- [系统架构](docs/architecture.md)
- [界面设计](docs/ui-design.md)
- [契约规范](docs/specification/)
- [一期收官盘点](docs/one-summary.md)
- [文档阶段小结](docs/reviews/2026-10-13-documentation-milestone.md)

## 许可证

[MIT](LICENSE)
