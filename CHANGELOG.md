# 变更记录

## 0.9.2

> 发布日期：2026-11-06

### 新增

- **界面补齐问题处理与经验库**：内核早已具备 `pipeline run` / `experience list|search|show`，但界面完全没有入口，只能命令行用。现在侧边导航新增两页：
  - **问题处理页**：填写问题描述、可选指定仓库路径与输出目录，支持「仅预览（不写文件、不记经验）」；结果展示文档包清单、提供方与宿主、代码证据（可疑文件、仓库自称的检查命令、相关测试、探查告警）以及经验回归归因（样本数、预填问题、跳过环节）。
  - **经验库页**：列出最近经验、按关键词检索、查看单条详情（类别/宿主/提供方/环节/决策记录/代码证据），并可从处理结果一键跳到对应经验。
  - 两个视图只经既有内核指令取数，不新增指令、不直读工作区；写盘行为仍由内核决定，界面不推导影响范围。
  - 连续检索时增加请求令牌，避免先发后到的旧响应覆盖新结果。
  - 新增 12 项界面冒烟用例（全部用 `data-*` 选择器，语言切换不会失效），界面冒烟累计 106 项全通过。

## 未发布

### 新增

- **主列表检索、排序与组合筛选**：此前主列表只有状态筛选、只能按标识升序，Skill 一多就只能靠肉眼翻。现在工具栏右侧依次是检索框、排序下拉、状态筛选下拉，三者组合生效：
  - **检索**：去空白后大小写折叠，按子串匹配标识、名称、版本、来源类型与落位目标；空串即不筛选。
  - **排序**：标识 / 名称 / 最近变更 / 状态四种，同键值一律回落到标识升序，顺序稳定不抖动。
  - **组合筛选**：检索与状态是「与」关系，状态仍按 `失效 > 禁用 > 启用` 取自内核结论，界面不自行推导。
  - 全部为纯前端展示层：只过滤已由内核 `list` 返回的记录，不发额外内核调用、不写工作区。
  - 排序与筛选用**码位比较而非 locale 排序**，`zh-CN` 与 `en` 下顺序完全一致（M6-R19 要求以原始稳定值为准）。
  - 筛选无结果时进入独立的「没有符合当前筛选条件的 Skill」空态并给出清除筛选，不再落到「还没有已管理的 Skill」扫描引导——两者需要的下一步动作完全不同。
  - 新增 8 项单元测试覆盖检索、排序稳定性、状态优先级、组合与空态；GUI 冒烟新增 12 项断言（全用 `data-testid`，双语切换不影响），界面冒烟 106 → **118 项全通过**。

### 修复

- **`W-DRIFT-001` 更新后语义收口（M6-R6）**：`update` 成功刷新后本就不再用更新前旧快照报漂移，但 `update --check` 的提示仍是一句泛化的「本地内容与记录不一致」，既没说明差异来自哪一侧，也没给出下一步动作。现在按动作给出精确语义：
  - 本地来源 `--check`：文案明确是「中心库内容已被改动」，并同时给出「`scan` 刷新基线」与「`update` 覆盖本地改动」两条相反方向的出路，由用户选择；
  - 远端来源 `--check`：预览只对比来源新内容与本地基线、不落盘，远端有新提交不等于本地漂移，不再用漂移码冒充预览结论；
  - 成功刷新：抑制旧基线告警，真实漂移由刷新后的 `validate` 按文件级摘要报告，`target` 可定位到 `<标识>/<相对路径>`；
  - 刷新后副本重分发失败：补一条说明「刷新未生效、索引基线仍为旧值」，避免用户误以为已经更新。
  - 问题码、JSON 字段、退出码与索引语义均不变；新增 5 项端到端回归覆盖上述四条路径与只读性，`delivery` 单测补重分发失败的漂移说明断言。

### 安全加固

- **归档解压总耗时预算**：归档预算补齐第五个维度：`SKILL_MANAGER_ARCHIVE_MAX_EXTRACT_MS`，默认 60 秒，只计算本地归档解析与解压、不把远端下载时间混入。ZIP 在目录读取、每条目和每个流 chunk 检查；TAR 在预检、条目过滤和归档输入块检查。超时会用 `tar.Unpack.abort()` 中止完整解析器或中止 ZIP 条目流、清理半截文件，并统一返回 `E-SRC-008`，不会出现外层超时已返回但后台仍持续写盘的情况。新增 ZIP/TAR 预检与流中超时的确定性回归测试（注入单调时钟，不依赖 sleep）。

### 验证与性能

- **完整性能再基线**：新增 `baseline-0.9.2.json`、`report-0.9.2.md` 与三平台 `ci-smoke-0.9.2.json`。本机 Windows 在源码 / SEA 双线完成 N=100、1000、5000 三档、每场景 3 次运行，并独立复测 N=5000（同样 3 次）；N=1000 全部硬阈值通过，无显著超线性项。GitHub Actions run `42198856481` 的 Linux / Windows / macOS 全部通过，macOS 同时补齐双线三档 runs=1 数据。
- **CI 工作区依赖修复**：同步 `kernel/gui` 对 `@skill-manager/contract` 的内部依赖声明和 `package-lock.json`。此前仍声明 0.7.0，导致 0.9.2 后的 `npm ci` 把工作区包误当作 npm 远端包下载并 404；修复后 CI 三平台 Bench 重新绿灯。

### 修复

- **`--help` 退出码修正**：此前 `skill-manager --help` 会返回退出码 `2`——解析器把「未给出指令名」当成参数问题，虽然仍打印了帮助，但这个非零退出码会让调用脚本误判为失败，且与 `--version`、无参数调用（都为 `0`）互相矛盾。帮助是信息性输出，不执行任何指令，现在恒以 `0` 退出；新增 3 项入口层回归测试锁定 `--help` / 无参数 / `--version` 的退出码。

## 0.9.1

> 发布日期：2026-11-06

### 安全加固

- **归档解压资源预算（M7-T0 ~ T3）**：此前 ZIP / TAR 解压只校验条目路径与符号链接，不限制条目数、解压后大小与压缩比——一个几十 KB 的压缩包就能声明并写出数 GB 内容。现在解压前先校验归档文件自身大小，再按「条目数 / 单条解压大小 / 累计解压大小 / 压缩比」四道预算逐条拦截，超限统一归入 `E-SRC-008`（`SRC_TOO_LARGE`）并点名命中的预算与实际值。
  - ZIP 不再整条 `entryData()` 物化，改为流式写出并按**实际流出字节**计数：中心目录声明的未压缩大小可被伪造，只有实际字节数才可信；越界时中止并删除半截文件。
  - TAR 的头部大小即实际读取长度，因此在条目遍历阶段即计入预算。
  - 预算可用环境变量按需收紧：`SKILL_MANAGER_ARCHIVE_MAX_BYTES`、`..._MAX_ENTRIES`、`..._MAX_ENTRY_BYTES`、`..._MAX_TOTAL_BYTES`、`..._MAX_RATIO`。
  - 新增 7 项回归测试，覆盖条目数、单条、累计、压缩比、伪造声明与预算内正常解压。

- **跨进程工作区写锁（M7-T1）**：此前只有进程内的 Promise 链互斥，跨进程并发写同一工作区没有任何保护——GUI 与 CLI 同时运行、或两个 CLI 同时在装/卸时，索引可能被互相覆盖，落位账本与副本也可能不一致。现在以工作区为粒度实现独占写锁：
  - 用 `open(..., 'wx')` 原子建锁，写入 pid、随机 owner token 与创建时间；释放前校验 token，绝不删除不是自己持有的锁。
  - 陈旧锁只在持有者进程已不存在（或锁文件不可解析且二次确认）时回收，活锁一律不删，避免把正在写的进程锁踢掉。
  - 等待超时抛出 `E-LOCK-001` 并点名持有者 pid，不静默继续写；超时时间可用 `SKILL_MANAGER_LOCK_TIMEOUT_MS` 调整。
  - 加锁统一收口在指令路由层：按「会写索引/中心库/宿主副本/账本」的指令清单加锁，预演、盘点与只读指令不入表，避免逐个处理器加锁时漏掉插件、导入、恢复、宿主卸载等路径。
  - 锁文件位于系统临时目录（按工作区绝对路径哈希命名），因此加锁不会改动工作区内容——预览与只读路径「零工作区写入」的既有契约保持不变。
  - 同一进程嵌套调用可重入，不会自锁。新增 12 项锁单元测试与 3 项真实双进程 CLI 并发验收（并发安装不同 Skill、并发安装同一 Skill 只成功一次、并发安装与卸载）。

- **落位事务归属与原子切换（M7-T2）**：此前宿主副本是「先建目录再往里写」，中途失败会留下半成品；回滚则按「路径当前是否存在」推断归属，首次落位失败时直接递归删除整个副本目录——若第三方（另一个进程、用户自己、另一个工具）在这期间往该目录放了文件，会一并被删。现在：
  - 目录类落位先在**同父 staging 目录**组装完整副本，再确认目标状态未变，用 `renameWithRetry` 原子切换；宿主可见路径要么是旧内容，要么是新内容，不会出现半成品。
  - 每次写入生成 transaction id，并显式记录归属：写前备份、本事务写入的条目（`owned_entries`）与新建的父目录（`created_dirs`）。
  - 回滚改为按归属清理：有完整备份时整体恢复（保持原语义）；无备份时只删除本事务写过的文件、清理本事务新建的空目录，绝不递归删除他人内容。第三方文件因此始终保留。
  - 新增 5 项事务归属回归测试：第三方文件保留、组装失败不留半成品、原子切换后既有未映射文件保留、事务标识归属、规则文件路径的目录层级清理。

- **统一路径规范化与归属比较（M7-T4）**：审计投影、reconcile 候选与宿主根归属此前用字符串前缀比较，`workspace-evil` 与 `workspace` 只差一个前缀、盘符或大小写不同的等价路径、以及「尚未创建的计划目标」（`realpath` 失败后退化成字符串比较）都可能得出错误的 external / shared-root 结论。现在统一到 `kernel/store/paths` 的共享助手：
  - `physicalKey()` 对已存在路径取 `realpath.native()`，对尚不存在的路径从最近存在祖先规范化后拼回剩余段；Windows 统一折叠大小写。
  - `isPhysicallyWithin()` 按物理键判断归属，替代各处手写的 `startsWith(root)`。
  - 审计投影、reconcile 候选/选择/插件反查、批量 adopt 重写、`adapters/roots` 的工作区归属判定全部迁移；`inventoryPhysicalKey` 委托同一实现，避免两套语义。
  - `isWithin` 的越界判定改为精确识别 `..` 与 `../`，不再误伤名为 `..foo` 的普通子目录。
  - 新增 10 项路径测试，覆盖前缀相似兄弟目录、未创建目标、分隔符混用、盘符与大小写、8.3 短名（不支持则显式跳过）。

### 验收

- M7 全量验收结果见 `docs/plan/m7-acceptance.md`：961 项常规测试 960 通过 / 1 平台跳过，门禁全绿；内核与桌面构建、界面冒烟 94/94、生产内核探测与 Windows portable 打包通过；性能为冒烟级刷新（完整再基线留到正式发版）。

## 0.9.0

> 发布日期：2026-11-04

### 中文摘要

- **内置问题处理能力**：`pipeline run` 默认使用内核自带的本地生成（`LocalReasoningProvider`），不接外部服务、不需要密钥即可把问题处理为完整文档包。各环节按元 skill 的角色与文档骨架生成：目标/范围/成功标准/验收标准、候选方案对比、模块与接口、里程碑与验收映射、评审清单与待确认问题；缺陷类问题走「复现 → 根因假设 → 修复设计 → 回归验证」结构，不再输出「待填写」占位。
- **按真实代码处理问题（`--probe-root` / `--probe`）**：给出仓库路径后，内核**只读**探查代码——只做 stat/readdir/readFile，不建目录、不写缓存、不执行任何命令——把问题描述切成检索词（中文按受控词表最长匹配，英文标识符直接使用），展开成代码片段后在路径与文件内容中定位相关文件，并把结果写进文档：可疑文件清单（含命中词与行号）、相关测试、仓库自己声明过的检查命令、技术栈与扫描规模。缺陷文档的「根因假设」指向具体文件，「定位顺序」把检查命令与实际要读的文件排成可执行步骤。探查有界（目录/文件/单文件读取量均有上限，不进入 `node_modules`、`.git`、构建产物），路径不可访问或未指定时降级为「未探查」并如实标注，绝不编造定位结果；探查根与 `--workspace` 正交，被探查的仓库不会被写入任何文件。
- **症状类描述正确归类**：崩溃、报错、失败、超时、丢数据、很慢/卡顿等一律归为 bugfix（此前「更新失败」会落进新功能口径）；「性能优化」「重构」这类改造意图优先判为 refactor。定位排序上，症状词只作佐证（权重低于「安装/导出/搜索」这类功能词），翻译表、测试、文档与构建脚本按角色降权，英文片段按词边界匹配（`search` 不再命中 `research`）。
- **草案优先**：未提供回答也直接产出完整文档包（推断内容 + 待确认问题），不再阻塞在问卷待答状态；回答来源优先级为 `--answers` > `--experience` 相似经验 > 宿主画像高频回答；`--dry-run` 只返回计划载荷，不写文件、不记经验。
- **经验回归自动适配宿主**：经验记录新增宿主、环节计划与问题 id；每次处理自动归纳宿主画像，同类问题自动预填高频回答、在文档中注入历史经验提示，并在样本足够时按「多数跳过」降级环节；结果通过 `experience_adapted`（样本数、预填问题、跳过环节、相似经验）可核对。旧记录（无宿主）作为通用证据继续生效。
- **LLM 路径增强**：提示词改为「元 skill 角色 + 环节指令 + 问题/决策/前置文档」，环节之间传递前置文档；选择外部 provider 但缺密钥时退回本地生成，不静默失败。
- **跨宿主审计与批量采纳（M6）**：审计矩阵补充 frontmatter 字段与 version 漂移明细（仅在 ≥2 个可读副本的组内比较，单副本不比较）；新增报告导出 `scan --inventory --audit --format markdown|html|sarif --output <文件>`，HTML 自包含且全部用户内容转义，SARIF 通过 2.1.0 schema 校验且 artifact URI 不含用户 home 绝对路径；新增 `reconcile --action adopt --bulk` 批量采纳，按确定性排序与冲突策略（rename/skip/force）逐项事务执行，单条失败不污染整批，默认预览。指令总数仍是 21 条，未新增独立 `adopt` 指令。
- **修复 v0.8.0 发布阻断**：打包内核（CJS/SEA）因 `kernel/core/bootstrap/builtin-skills.ts` 模块顶层求值 `import.meta` 而启动即崩溃。改为运行期候选目录探测；构建新增 `empty-import-meta` 硬门与产物 `--version` 自检。
- **修复内置示范技能**：路径多退一级导致 5 个内置模板从未安装成功；模板元数据（`path` 需为 `./skills/<id>`、移除非法 `checksum: ''` 与派生时间戳）修正后 `init → scan → validate` 全链路干净。安装同时改为跟随真实工作区，并只在默认工作区、非只读命令时生效。
- **健壮性与查询一致性**：`experience list/search/show` 正确遵循 `--workspace`（此前只看环境变量/默认工作区）；单个损坏的经验 YAML 不再让 `pipeline run` / `experience list` 抛栈崩溃——列表跳过并在结果中报告 `unreadable_experiences`，`experience show` 返回可读问题码；输出目录非法等写盘失败同样转为问题码，不再输出崩溃栈。
- **版本与文档**：README 状态更新；契约 4.18 同步草案优先、`--host`、`--dry-run`、经验适配与输出载荷。

### English Summary

- **Built-in problem handling**: `pipeline run` now defaults to an in-kernel local generator (`LocalReasoningProvider`) that produces complete document packages without any external service or API key. Each stage follows its meta-skill role and document skeleton; bugfix problems use a reproduction → root-cause → fix-design → regression structure instead of placeholder text.
- **Code-grounded problem handling (`--probe-root` / `--probe`)**: given a repository path, the kernel inspects it **read-only** — stat/readdir/readFile only, no directory creation, no cache writes, no command execution. The problem statement is tokenized (Chinese via a controlled lexicon with longest-match, English identifiers as-is) and expanded into code fragments, then matched against file paths and contents. Results are written into the document package: suspect files with matched words and line numbers, related tests, checks the repository itself declares, tech stack and scan size. Root-cause hypotheses point at concrete files, and the "inspection order" turns checks plus files-to-read into executable steps. Probing is bounded (directory/file/per-file read caps, skipping `node_modules`, `.git` and build output); an unreachable or absent root degrades to "not probed" with an explicit note and never fabricates a location. The probe root is orthogonal to `--workspace`, so the inspected repository is never written to.
- **Symptom descriptions classify correctly**: crash, error, failure, timeout, data loss, slowness/hang now map to bugfix (previously "update failed" landed in the new-feature lane); refactor intent such as "performance tuning" or "refactor" takes precedence. For ranking, symptom words are corroborating only (weighted below domain words such as install/export/search), translation tables, tests, docs and build scripts are down-weighted by role, and English fragments match on word boundaries so `search` no longer hits `research`.
- **Draft-first**: runs without answers still produce a full package (inferred content plus open questions) instead of blocking on the questionnaire; answer precedence is `--answers` > `--experience` > host-profile suggestions.
- **Host-adaptive experience regression**: experience records now carry host, stage plan and question ids. Each run derives a host profile, prefills high-frequency answers for similar problems, injects historical hints into documents, and downgrades stages that history mostly skipped when enough samples exist. `experience_adapted` reports the evidence. Legacy records without a host remain usable as generic evidence.
- **Stronger LLM path**: prompts combine meta-skill role, stage instruction, problem, decisions and prior documents; a missing API key falls back to local generation instead of failing silently.
- **Cross-host audit and bulk adoption (M6)**: the audit matrix now reports frontmatter field and version drift (compared only within groups of ≥2 readable copies; single copies are not compared). New report export via `scan --inventory --audit --format markdown|html|sarif --output <file>`: HTML is self-contained with every user value escaped, SARIF validates against the 2.1.0 schema and never embeds absolute home paths in artifact URIs. New `reconcile --action adopt --bulk` performs batch adoption with deterministic ordering and conflict policies (rename/skip/force), executing item by item so one failure cannot pollute the batch, and previews by default. The command count stays at 21 — adopt remains an action of `reconcile`, not a separate command.
- **Fixed v0.8.0 release blocker**: the packaged CJS/SEA kernel crashed at startup because `kernel/core/bootstrap/builtin-skills.ts` evaluated `import.meta` at module scope. Replaced with runtime directory probing; the build now fails on `empty-import-meta` and self-checks the executable with `--version`.
- **Fixed built-in demo skills**: a wrong relative path meant the five templates were never installed; template metadata (`path` must be `./skills/<id>`, invalid empty `checksum`, derived timestamps) is corrected so `init → scan → validate` is clean. Installation now follows the real workspace and only runs for the default workspace on non-read-only commands.
- **Robustness and query consistency**: `experience list/search/show` now honor `--workspace`; a single corrupt experience YAML no longer crashes `pipeline run` or `experience list` (list skips it and reports `unreadable_experiences`, `experience show` returns a readable problem code), and write failures such as an invalid output directory become problem codes instead of stack traces.

### Verification

- Regular tests: **929 items** (928 pass + 1 platform-specific skip).
- `check` / `typecheck` / `lint` / `format` / `build` / `smoke:kernel` / `probe:inventory` / `probe:reconcile` all green.
- `probe:production-kernel`: SEA executable boots, six reconcile actions, 302 piped copies large-JSON intact, built-in skills shipped and installed.

## 0.8.0

> 发布日期：2026-10-31

### 中文摘要

- **经验回归**：每次 `pipeline run` 处理完一个问题后自动累计一条经验（问题、分类、环节、决策、文档类型、耗时），存入工作区 `experiences/`；新增 `experience list` / `search` / `show` 三个查询命令；`pipeline run --experience <关键词>` 可预填相似经验问答，复用历史决策。
- **内置技能模板**：首次运行 CLI 时自动安装 5 个演示技能，包含需求文档、设计文档、里程碑计划、代码审查清单和 Git 提交规范模板；已有技能不会被覆盖，用户可自主管理。
- **LLM 提供商支持**：新增 OpenAI 兼容、豆包（Doubao）、Claude 三种 LLM 提供商适配器，统一接口抽象，支持灵活切换和配置。
- **安全加固**：修复文件映射路径遍历漏洞，阻止 git ext:: 协议，禁止纯 HTTP 下载，只允许 HTTPS 协议。
- **管道引擎**：实现 M0-M5 完整的管道引擎，包括元技能注册表、提供者抽象、人工回退、需求问卷状态机、决策记录、收敛门、文档包写入器、CLI 管道命令等。
- **Windows 中文路径崩溃修复**：修复 Node `fs.cpSync` 在中文源路径下原生崩溃（退出码 0xC0000409）的问题，改为逐文件递归复制；上游 PR 61950 于 Node v24.15.0 修复，升级 Node ≥24.15.0 亦可解决。

### English Summary

- **Experience regression**: every `pipeline run` now auto-records one experience (problem, kind, stages, decisions, doc types, duration) into the workspace `experiences/` directory; new `experience list` / `search` / `show` commands query the accumulated records; `pipeline run --experience <keyword>` prefills answers from similar past experiences.
- **Built-in skill templates**: 5 demo skills auto-install on first CLI run, including requirements doc, design doc, milestone plan, code review checklist, and Git commit spec templates; existing skills are never overwritten, users can manage them freely.
- **LLM provider support**: added OpenAI-compatible, Doubao, and Claude LLM provider adapters with unified interface abstraction for flexible switching and configuration.
- **Security hardening**: fixed file_map path traversal vulnerability, blocked git ext:: protocol, disabled plain HTTP downloads, only HTTPS allowed.
- **Pipeline engine**: implemented complete M0-M5 pipeline engine including meta-skill registry, provider abstraction, human fallback, requirements questionnaire state machine, decision records, convergence gate, document package writer, and CLI pipeline command.
- **Windows Chinese-path crash fix**: fixed the native crash (exit code 0xC0000409) of Node `fs.cpSync` on Chinese source paths by switching to recursive file-by-file copy; upstream PR 61950 fixed it in Node v24.15.0, so upgrading to Node ≥24.15.0 also resolves it.

### Verification

- Regular tests: **879 items** (878 pass + 1 platform-specific skip).
- Experience regression: 5 unit + 5 e2e tests, including auto-record, list/search/show, and `--experience` prefill.
- All check gates passed: contract, architecture, complexity, test fixtures, typecheck, lint, format, and build.

## 0.7.0

> 发布日期：2026-10-23

### 中文摘要

- **批量采纳**：未纳管清单支持多选、根级全选与批量预览；一次预览显示源路径、目标、frontmatter 摘要与冲突，随后逐 item 展示进度和成功/失败/取消汇总。CLI 提供 `--rename` / `--force` 冲突策略，采纳成功后 GUI 自动刷新并切换到跨宿主审计。
- **审计报告导出**：`scan --inventory --audit` 支持导出 Markdown、HTML 与 SARIF 2.1.0；HTML 为无脚本、无外部资源的自包含单文件，SARIF 可直接接入 GitHub Code Scanning。
- **漂移细分**：审计漂移细分 checksum / frontmatter / version 三类；frontmatter 与版本只在同一 Skill 的多副本组内比较，单副本及全部缺失版本不会误报漂移。
- **审计矩阵 GUI**：新增 Skill × Host 审计矩阵、drift 子类型和字段差异详情，以及 Markdown / HTML / SARIF 导出菜单。

### English Summary

- **Bulk adoption**: unmanaged copies now support multi-select, root select-all, one consolidated preview, and per-item progress with succeeded/failed/cancelled summaries. Preview includes source path, target, frontmatter summary, and conflict policy; the CLI provides `--rename` and `--force`. Successful adoption refreshes and switches to the cross-host audit view.
- **Audit report export**: `scan --inventory --audit` can export Markdown, HTML, and SARIF 2.1.0. HTML is a self-contained single file with no scripts or external resources, while SARIF is compatible with GitHub Code Scanning.
- **Drift breakdown**: audit drift is classified as checksum, frontmatter, or version drift. Frontmatter and version fields are compared only within multi-copy groups, so single copies and all-missing versions do not produce false drift.
- **Audit matrix GUI**: added a Skill × Host matrix, drift subtype and field-difference details, plus Markdown / HTML / SARIF export controls.

### Known Issues

- `npm audit` currently reports 0 findings. The 8 moderate findings from
  v0.6.0 (electron-builder packaging chain, sprintf-js GHSA-hp3w-g68c-fv3c)
  have been resolved by upstream dependency updates.

### Verification

- Regular tests: **834 items** (833 pass + 1 platform-specific skip).
- GUI smoke: **94/94**, including bulk adoption, stale-plan isolation, cancellation boundaries, audit refresh, and bilingual rendering.
- Report gates include Markdown/HTML/SARIF golden snapshots, SARIF 2.1.0 schema validation, reject external HTML resources, `<workspace>` PII redaction, and the five R22 conflict scenarios.

## 0.6.0

> 发布日期：2026-10-21

### 中文摘要

- **批量治理**：盘点支持多选、根级全选与批量 reconcile；一次汇总预览后逐副本执行，展示真实进度、成功/失败/取消汇总和单项 `stage/reason`，单副本失败不污染整批。
- **跨宿主审计**：`scan --inventory --audit` 按 `skill_meta.targets[]` 建立 skill × host 审计矩阵，区分 distributed / missing / drift / visibility mismatch / undeclared / insufficient。
- **元数据归一化**：adopt 解析 Agent Skills 六字段；`author/version` 从 `metadata` 提升到工作区 `skill_meta.yaml` 顶层，未知字段只读保留到 `extensions`。
- **跨宿主修复**：已纳管 Skill 可通过 reconcile repair 的 `not_distributed` 场景补发到声明的新 target，复用既有渲染与账本通道。
- **更新措辞修复**：成功 update 后不再使用更新前旧快照误报 `W-DRIFT-001`；真实篡改仍会被检出。
- **中英双语**：GUI 支持 en / zh-CN，跟随系统并持久化手动选择；CLI 输出、问题码、JSON 键与枚举保持英文契约。
- **界面优化**：盘点角色分组、根状态标签、空根提示、长路径/host/Skill 标识截断与 tooltip 统一，布局不横向溢出。

### English Summary

- **Batch governance**: inventory now supports multi-select, root-level select-all, consolidated preview, sequential per-copy execution, live progress, and succeeded/failed/skipped/cancelled summaries with per-item `stage/reason`.
- **Cross-host audit**: `scan --inventory --audit` builds a skill × host matrix from `skill_meta.targets[]`, distinguishing distributed, missing, drift, visibility mismatch, undeclared, and insufficient evidence.
- **Metadata normalization**: adopt reads the six Agent Skills frontmatter fields, promotes `author/version` from `metadata` into top-level workspace metadata, and preserves unknown fields read-only under `extensions`.
- **New-target repair**: managed Skills can be distributed to newly declared targets through reconcile repair's `not_distributed` path.
- **Update warning fix**: successful updates no longer emit stale `W-DRIFT-001` warnings from pre-update snapshots; real post-update tampering is still reported.
- **Bilingual GUI**: en and zh-CN resources support system-following and persisted manual selection. CLI output, problem codes, JSON keys, enums, and exit codes remain stable English contracts.
- **Inventory polish**: consistent role and root-state presentation, explicit empty-root guidance, and ellipsis + tooltip handling for long paths, host IDs, and Skill IDs.

### Known Issues

- `npm audit` reports 8 moderate findings inherited from the `electron-builder` packaging chain (`@electron/get` → `global-agent` → `roarr` → `sprintf-js`, GHSA-hp3w-g68c-fv3c). This release intentionally does not change the packaging toolchain; tracked as a known issue.

### Verification

- Regular tests: **786 items** (785 pass + 1 platform-specific skip).
- GUI smoke: **88/88**, including bilingual batch copy and production-rendered inventory presentation.
- Contract / e2e / three-platform inventory audit probe, lint, typecheck, formatting, build, architecture graph, and complexity ratchets are release gates.

## 0.5.2

> **已发布**：tag `v0.5.2` → `ea4e6ed`；角色写保护 + GUI 盘点导出。

### v0.5.2 范围

- **修复**：`reconcile` 写动作增加角色写保护；system / platform / project 与混合角色共享根一律只读（`non_user_role_read_only`），防止误纳管、覆盖或删除内置技能。缺失记录的根归属改为最长路径优先。
- **新增**：全机盘点结果可导出 JSON；主进程保存对话框只写用户显式选择的文件，取消零写入，不触碰工作区 / settings / 宿主 / 账本。
- **口径**：非标准嵌套 `metadata` 统一不解析；`agent-skill-creator` 1/20 使用该私有格式，其余 19 个 user 技能不使用。完整 SKILL.md 内容仍原样进入中心库。
- **targets 来源**：`adopt` 的 `targets[0]` 来自 `--target` → 工作区 `config.default_target` → `claude` 兜底，不读取 SKILL.md；源宿主记录在 `host_landings`。本次从 codex 采纳时工作区默认 target 为 claude；如需 codex 目标可显式 `--target codex` 或修改 `default_target`。

### 验证

- Pack [39369569286](https://github.com/LuZhong-Li/skill-manager/actions/runs/39369569286) 四 leg + Release job Success；Release Verify [39370720855](https://github.com/LuZhong-Li/skill-manager/actions/runs/39370720855) 四 job 全 Success。
- 生产 GUI（Windows portable + app.asar）：`smoke:gui` **69/69**，含导出读回/取消零写入、盘点只读、非 user 副本无动作。
- 发布物内核：Windows / macOS arm64 / macOS x64 均 `actions=6`、`pipe_copies=302`、约 1.03MB JSON 完整解析；system/project（Windows 另含 platform）角色写保护全部 skipped/零写入。
- 常规 732 项（731 通过 + 1 平台跳过）；慢测试 1；写探针 102；`check` / typecheck / lint / format / build 全绿。

### Dogfood 修正：reconcile 角色写保护（2026-10-20）

- **核查**：六动作此前没有角色门槛，system / platform / project 副本在分类允许时会生成 `planned`；本机 141 个平台 + 5 个系统副本存在误操作风险。
- **内核**：候选携带 `root_roles`；只有全部消费角色为 `user` 才允许写动作。非 user（含混合角色共享根）一律 `skipped` / `non_user_role_read_only`，`writes` 与 `ledger_changes` 为空；执行层另有防御性拒绝。缺失记录的根归属改为最长路径优先，避免 `~/.codex/skills/.system` 被外层 user 根误归。
- **GUI**：未纳管清单只列 user 副本；system / platform / project 不显示动作按钮，标注「由对应工具管理」，角色折叠区只读展示。
- **插件**：写动作测试改用 global 作用域（映射 user 角色）；project 作用域插件副本同样只读。
- **验证**：新增 system/platform/project × 六动作 e2e、混合角色共享根 e2e、三平台探针角色断言、GUI smoke 角色隔离；常规 **727 → 731 项**（730 通过 + 1 平台跳过）；写探针 87 → **102** 项；`smoke:gui` 61 → **64/64**；依赖图 238 文件 / **914** 边 / 0 循环；complexity 94；超阈值文件 0。
- **边界**：未发版，随下一补丁或下一版本；不改变指令数、问题码或 schema。

### 全机盘点结果导出（2026-10-20）

- **入口**：盘点工具栏「重新盘点」旁新增「导出」，默认文件名 `skill-inventory.json`。
- **流程**：渲染层把当前 `scan --inventory --json` 的 data 纯化后交主进程；主进程经保存对话框写入用户显式选择的路径，取消零写入。
- **内容**：summary / roles / hosts / copies / missing / corrupt / degradation / workspace 与账本状态，字段沿用 contract。
- **边界**：不写工作区、`settings.json`、宿主或账本；导出与 reconcile 写动作严格区分，不改变盘点结果。
- **验证**：新增 1MB 级序列化单测与 GUI 导出冒烟（669KB / 204 副本完整解析、取消零写入、工作区/宿主/settings 字节不变）；`smoke:gui` 64 → **69/69**；常规 **731 → 732 项**（731 通过 + 1 平台跳过）。

## 0.5.1

> **已发布**：tag `v0.5.1` → `433b3e4`；修复 v0.5.0 发布物在 macOS 管道上的大 JSON 截断。

### 修复

- **SEA 入口 stdout 排空**：`kernel/entry/exe.ts` 从 `process.exit(code)` 改为 `process.exitCode = code`，与源码入口一致。v0.5.0 的 macOS 发布物在 `scan --inventory --json` 输出约 64KB 后截断，六动作本身均通过；该缺陷由 Release Verify 的 macOS C 组真实捕获。
- **回归守卫**：`verify.yml` 新增 `sea-pipe-probe`（Windows / macOS / Linux），构建 SEA 内核后执行六动作、只读盘点与 300 副本大 JSON 管道解析；契约测试锁定 `exe.ts` 不得直接 `process.exit`。
- **GUI 冒烟稳健性**：动作入口点击前等待目标按钮就绪，消除生产形态较慢刷新时的时序抖动；产品行为不变。
- **入口审计**：`kernel/entry` 仅有 `cli.ts` / `exe.ts`，均使用 `exitCode`；`kernel/` 与 `gui/` 源码中不存在 `process.exit(`，其余命中全部在构建/检查/冒烟脚本中。
- **缺陷版本标记**：v0.5.0 Release notes 已幂等前置「macOS 大 JSON 管道约 64KB 截断」提示并指向 v0.5.1；v0.1.0 提示同步指向 v0.5.1；v0.1.1~v0.4.0 保持不动。

### 验证

- Pack [39272915140](https://github.com/LuZhong-Li/skill-manager/actions/runs/39272915140) 四 leg + Release job Success；Release Verify [39275887751](https://github.com/LuZhong-Li/skill-manager/actions/runs/39275887751) 四 job 全 Success。
- 生产 GUI（Windows portable + app.asar）：`smoke:gui` **61/61**；动作按钮就绪等待后 accept 等动作稳定走通。
- 发布物内核：Windows / macOS arm64 / macOS x64 均 `actions=6`、`pipe_copies=302`、约 1.03MB JSON 完整解析；v0.5.0 的 65,378 字节失败点已通过。
- 常规测试 727 项（726 通过 + 1 平台跳过）；修复不改变 v0.5.0 的 CLI 契约、指令数、问题码或 schema。

## 0.5.0

> **已发布**：tag `v0.5.0` → `e156ec0`。Release notes 已标记 macOS SEA 大 JSON 管道已知问题，建议升级 v0.5.1。

### v0.5.0 范围

- **新增 `reconcile` 指令（第 17 条）**：默认只读预览，`--apply --yes` 才执行；支持 `adopt / track / repair / accept / clean / forget` 六动作。
- **安全边界**：工作区是 repair 默认基线；accept 只接受内容 / 可见性，不猜 source/version；clean 只处理无工作区基线的 orphaned / unreadable；未纳管不自动删除。
- **共享根与插件**：共享根按物理副本整组事务；插件 `x-` 写独立 `plugin_index.landings`，adopt / accept 明确拒绝。
- **GUI**：盘点视图逐副本动作入口、默认预览、显式确认、执行后重新盘点；不做一键全修 / 全删。
- **跨平台**：三平台 reconcile 写动作探针；目录级原子换名统一走有限退避重试，覆盖 Windows 瞬时 EPERM / EACCES / EBUSY。
- **可维护性**：contract 包、check:arch、复杂度与规模 ratchet、宿主三处合一、scan / lifecycle / manifest 拆分随版本收录。

### M4c 二期 T6：三平台写探针、失败矩阵与 EPERM 收口（2026-10-19）

- **三平台写探针**：新增 `probe:reconcile` 与独立 `reconcile-probe` verify job（Windows / macOS / Linux）；隔离 HOME + 显式 config 根，87 项断言覆盖六动作、预览零写入、共享根整组、插件 x- 四动作、分类批量、POSIX symlink 与目标占用失败隔离；CI [39264446848](https://github.com/LuZhong-Li/skill-manager/actions/runs/39264446848) 三平台全 Success。
- **失败矩阵**：新增 4 项 e2e，覆盖 track / forget 账本损坏、accept 计划过期（E-RECONCILE-002）与 accept 账本写入失败后的中心库 / 索引回滚；既有 repair 占用、clean 删除/账本失败、共享组账本失败继续保留。
- **EPERM**：T5 观察到 Windows 临时目录目录级 `renameSync` 瞬时 EPERM；根因是 adopt / accept / clean 绕过了原子写的退避策略。现统一为 `renameWithRetry`（5 次、线性退避 10/20/30/40ms），覆盖 EPERM / EACCES / EBUSY；重试耗尽仍原样抛出，不掩盖真实占用。
- **静态守卫**：`tests/contract/rename-single-source.test.ts` 断言 kernel 内只有 `store/atomic` 直接调用 `renameSync`，reconcile 的目录移动全部走 `renameWithRetry`。
- **验证**：常规 **714 → 726 项**（725 通过 + 1 平台跳过）；`smoke:gui` 61/61；依赖图 238 源文件 / 913 边 / 0 循环；complexity 94；超阈值文件 0；不发版。

### M4c 二期动作文档（2026-10-19）

- **需求**：新增 9.3.8（M4c2-R1 ~ R10），明确 `scan --inventory` 永远只读；动作限定为 `adopt / track / repair / accept / clean / forget`。
- **调研**：盘点一期可复用的 `landPlan` / 账本 / 备份 / 原子写 / 锁；登记 `update --host` 契约与实现之间“是否创建缺失副本”的边界漂移；对照 chezmoi、GNU Stow、pacman、dpkg 的检查 / 预览 / adopt / 重装惯例。
- **设计**：推荐新增第 17 条 `reconcile`，默认预览、`--apply` 才写；工作区是 `repair` 默认基线，`accept` 只接受内容 / 可见性，不猜 source/ref；共享根按物理副本组事务处理。
- **计划**：T0 契约与只读计划，T1 repair + forget，T2 adopt + track，T3 accept + clean，T4 插件 / 批量，T5 GUI，T6 跨平台收口。
- **边界**：纯文档批次，不改代码、schema 或契约；常规测试保持 **668 项**；等待评审后再进入实现。

### M4c 二期 T0：reconcile 注册与只读预览（2026-10-19）

- **指令**：新增第 17 条 `reconcile`，接入路由、帮助、确认表与选项解析；`scan --inventory` 继续只读。
- **计划类型**：`contract/src/reconcile.ts` 定义动作、选择器、前后分类、三轴证据、写入、账本变化、共享根事务组与预览汇总。
- **只读预览**：复用盘点快照与 L-4 对账，按 path / id+host / classification 选择；预览前后工作区与宿主字节不变。
- **apply 边界**：T0 的 `--apply` 返回 `E-RECONCILE-001` 与 `applied: false`，不执行写入。
- **update 对齐**：`update --host` 目标缺失时返回 `E-PATH-001` 并引导 `reconcile --action repair`，不再隐式创建副本。
- **契约**：CLI 17 条、新增 `E-RECONCILE-001/002/003`；七份规范 / 八份 schema 不变。
- **验证**：常规 **676 项**（675 通过 + 1 平台跳过）；`check:arch` 218 文件 / 778 边 / 0 循环；complexity 94；超阈值文件 0。
- **边界**：T0 只读骨架，不发版；T1 再实现 `repair + forget`。

### M4c 二期 T1：repair 与 forget（2026-10-19）

- **repair**：支持 missing / not_distributed 创建、content / visibility drift 恢复、orphaned 再激活与有工作区基线的 corrupt 修复；从中心库本地重渲染，不访问网络。
- **执行事务**：`--apply` 使用工作区锁、计划签名复查和标准确认；单副本逐项返回结果，失败不留下“有账本无副本”或“有副本无账本”。
- **forget**：只把确认不存在的 active 账本转 orphaned，不改 skill 索引与物理磁盘。
- **边界**：共享根与插件 `x-` 项标 `shared_root_t4` / `plugin_host_t4` 跳过；目标被文件占用时失败并保留原账本与占用文件。
- **验证**：新增 8 项 T1 e2e；常规 **684 项**（683 通过 + 1 平台跳过）；全门禁与 smoke 保持绿；不发版。

### M4c 二期 T2：adopt 与 track（2026-10-19）

- **adopt**：从宿主实际内容建立 `skills/<skill_id>`，合成 `source.type: unknown` 的 `skill_meta.yaml`，写索引与 `origin: adopted` 账本；不反向解渲染，不修改源宿主副本。
- **ID / 目标**：`--target` 只声明工作区目标，中心库目录始终按 `skill_id`；目录名与 frontmatter `name` 不一致时以 `name` 为 ID。同 ID 内容一致引导 `track`，不一致引导 `accept` / `repair`；未登记同名中心库目录拒绝覆盖。
- **track**：只对 `inferred_consistent` 补 adopted 账本；工作区、宿主与索引字节不变；drift / untracked 拒绝。
- **事务**：中心库同卷暂存 + 原子改名；索引或账本失败恢复索引、移除中心库；损坏账本在写盘前中止。
- **边界**：共享根 `shared_root_t4` 与插件 `plugin_host_t4` 跳过；`accept` / `clean` 仍返回 `E-RECONCILE-001`。
- **验证**：新增 12 项 T2 e2e；常规 **684 → 696 项**（695 通过 + 1 平台跳过）；`check:arch` 225 文件 / 839 边 / 0 循环；complexity 94；超阈值文件 0；不发版。

### M4c 二期 T3：accept 与 clean（2026-10-19）

- **accept content**：宿主内容覆盖中心库，保留工作区 `skill_meta.yaml`；重算 checksum / digests，更新索引与账本；覆盖前创建标准备份。
- **accept visibility**：只同步索引状态与账本可见性，不改中心库或宿主内容。
- **source 边界**：source/version 漂移拒绝 accept 并引导 repair；不改 source 声明；结果提示下次 update 可能被远端覆盖。
- **clean**：仅处理无工作区 orphaned 与无基线 corrupt/unreadable；同卷临时快照移走 → 账本提交 → 删除，失败恢复副本与账本，成功无快照残留。
- **安全**：clean 禁止分类批量；未纳管副本不被 clean；共享根与插件 x- 留 T4。
- **验证**：新增 7 项 T3 e2e（含备份失败、账本失败、删除失败注入）；常规 **696 → 703 项**（702 通过 + 1 平台跳过）；`check:arch` 228 文件 / 864 边 / 0 循环；complexity 94；超阈值文件 0；不发版。

### M4c 二期 T4：共享根、插件 x- 与分类批量（2026-10-19）

- **共享根**：realpath + casefold 事务组；repair/accept 一次物理写、全部 active 账本同步；adopt 一份中心库；track 全部消费宿主补账；form/ledger 冲突拒绝。
- **引用计数**：forget 单宿主只转选中记录；clean 有 active 消费时只清选中 orphaned 账本并保留物理，全部 orphaned 才删除物理与全部记录。
- **插件 x-**：track/repair/clean/forget 写独立 `plugin_index.landings`；repair 复用插件 profile/adapter；插件禁用后的 orphaned 副本可从账本发现并 clean；插件包保留；adopt/accept 拒绝。
- **批量**：classification 必须 host/root；逐项结果，单副本失败不回滚成功项；共享组内原子。
- **验证**：新增 7 项 T4 e2e + 1 项单元；常规 **703 → 711 项**（710 通过 + 1 平台跳过）；`check:arch` 232 文件 / 896 边 / 0 循环；complexity 94；超阈值文件 0；不发版。

### M4c 二期 T5：GUI 动作预览与确认（2026-10-19）

- **动作入口**：盘点明细按分类给出推荐动作——untracked → adopt，inferred → track，drift → repair / accept，missing → repair / forget，orphaned → repair 或 adopt / clean，unreadable → repair / clean，not_distributed → repair；managed 无动作。
- **预览事务**：点击动作即挂载对话框并只读生成计划；展示写入项、账本变化、备份根、执行后分类与共享根全部消费宿主。对话框自持预览 / 执行状态，按钮只使用本组件已就绪的计划。
- **确认边界**：只有显式确认才附带 `--apply --yes`；accept / clean 增加破坏性二次确认；取消零写入；不做一键全修 / 全删，clean 不提供分类批量。
- **插件限制**：x- 宿主副本禁用 adopt / accept，保留 track / repair / clean / forget；repair 仅写 `plugin_index`。
- **执行与刷新**：逐项 succeeded / failed / skipped 与问题码可读；成功后重新盘点，分类与未纳管清单即时更新；计划过期或占用错误原样呈现。
- **组件**：新增 `inventory-actions.ts`、`InventoryActionMenu.vue`、`InventoryActionDialog.vue`；App.vue 保持 785 行不增。
- **验证**：新增 3 项动作映射单元与 21 项界面冒烟；常规 **711 → 714 项**（713 通过 + 1 平台跳过）；`smoke:gui` **61/61**；依赖图 236 源文件 / 905 边 / 0 循环；complexity 94；超阈值文件 0；不发版。

### P1-c：lifecycle 拆分（2026-10-19）

- **入口**：`kernel/core/lifecycle/index.ts` 1738 → **19 行**，只保留公共导出；实现按 `install` / `uninstall` / `toggle` / `update` / `restore` 拆分，共享工具进 `shared.ts`、稳定类型进 `types.ts`。
- **行为**：16 指令输出、退出码、落位、备份、锁与失败原子性不变；lifecycle 单测 58、CLI/update/host-uninstall e2e 70 全绿。
- **结构**：`check:arch` 176 文件 / 570 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；超阈值文件 12 → **11**；新模块均低于 500 行。
- **测试**：新增 1 项结构断言；常规 661 → **662 项**（单元 412、契约 134、端到端 116；661 通过 + 1 平台跳过）。
- **边界**：纯重构，不发版；P1-d plugins/manifest 拆分仍在后续批次。

### P1-d：plugins/manifest 拆分（2026-10-19）

- **入口**：`kernel/core/plugins/manifest.ts` 636 → **9 行**，只保留公共导出；实现拆为 `manifest-shared` / `manifest-root` / `manifest-host` / `manifest-validate`。
- **行为**：插件 T0/T1/T2/T3 与 schema / 宿主单一来源测试 31 项全绿；安全字段拒绝、canonical `x-` 命名、config 隔离、E-ID/E-VER/E-CONFLICT 与 M4c x- 盘点不变。
- **结构**：`check:arch` 180 文件 / 583 边 / 0 循环 / 0 allowlist；complexity 保持 **94**；超阈值文件 11 → **10**。
- **测试**：新增 1 项结构断言；常规 662 → **663 项**（单元 412、契约 135、端到端 116；662 通过 + 1 平台跳过）。
- **边界**：纯重构，不发版；下一批 P2 收口。

### P2-1：内核超阈值文件清零（2026-10-19）

- **registry**：2172 → **106 行**；命令处理器拆到 `registry/commands/*`，宿主切换在 `host-toggle.ts`，确认/索引工具在 `shared.ts`。
- **source**：722 → **196 行**；`source-shared` / `source-remote` / `source-archive` 分担协议、远端获取与解包安全。
- **validation / backup / metadata / hosts**：分别拆为 shared+record+drift、backup/export/import、meta/dependency、shared/roots/policy/core；全部 <500 行。
- **行为**：16 指令、插件、盘点全链路等价；registry、source、backup、validation、metadata、hosts 相关单测与 CLI/update/host-uninstall e2e 全绿。
- **结构**：`check:arch` 210 文件 / 792 边 / 0 循环 / 0 allowlist；超阈值文件 **10 → 4**；complexity 保持 **94**。
- **测试**：新增 1 项 kernel 规模结构断言；常规 663 → **664 项**（单元 412、契约 136、端到端 116；663 通过 + 1 平台跳过）。
- **边界**：纯重构，不发版；剩余 App.vue / e2e / bench / gui-smoke 进入 P2-2/P2-3。

### P2-2：最后四个超阈值文件清零（2026-10-19）

- **App.vue**：844 → **785 行**；设置页拆为 `SettingsPanel.vue`，外壳只保留导航、视图路由与弹窗挂载。
- **e2e CLI**：1148 行拆为 `cli-core` / `cli-backup` / `cli-import-restore` / `cli-runtime`，共享 `tests/helpers/cli.ts`；61 项用例与断言不变。
- **bench runner**：534 → **421 行**；参数解析拆到 `bench/args.mjs`，`parseArgs` 仍从 runner 导出。
- **gui-smoke**：660 → **495 行**；插件流程与进程收尾拆为独立模块。
- **结构**：超阈值文件 **4 → 0**；`check:arch` 214 文件 / 800 边 / 0 循环 / 0 allowlist；complexity 保持 **94**。
- **验证**：664 项测试、`smoke:gui` 40/40、bench 实跑通过。
- **边界**：纯重构，不发版；下一批 P2-3。

### P2-3：TD-06、依赖图与死代码收口（2026-10-19）

- **TD-06**：删除 `kernel/store/contract.ts`、`kernel/core/plugins/types.ts`；`metadata/constants.ts` 的 contract re-export 清零，`scan/types.ts` 不再转出盘点类型；finding helper 独立到 `store/findings.ts`。
- **引用迁移**：内核 / GUI / scripts / tests 直接引用 `@skill-manager/contract`；仅 `kernel/index.ts` 与 `kernel/dispatch/result/index.ts` 保留公共入口 re-export。
- **依赖图**：新增 `docs/architecture/dependency-graph.json` 与 `npm run arch:graph`；`check:arch-graph` 接入 `npm run check`，逐字节比较入库图与源码生成结果。当前 214 源文件 + 1 资产节点、761 条相对 import、0 循环、0 allowlist。
- **死代码**：删除定义文件外零引用的 `HostRootModelId`、`SecurityControlField`、`isDigestMap`、`makeHostSkill`；143 个仅文件内使用的 export 与公共契约保留。
- **孤立文件**：除 7 个声明入口外，结构测试确认不存在无入边的源码文件。
- **结构**：complexity 保持 **94**；超阈值文件保持 **0**；无新增复杂函数。
- **验证**：新增 4 项结构/契约测试；常规 **668 项**（667 通过 + 1 平台跳过）、慢测试、`smoke:kernel`、`smoke:gui` 与全门禁通过。
- **边界**：纯重构，不发版；第 10 章 MNT-R1 ~ R9 全部闭环。

## 0.4.0

> 状态：**已发布为 latest**（[v0.4.0](https://github.com/LuZhong-Li/skill-manager/releases/tag/v0.4.0)）。范围见 [`docs/plan/v0.4.0-acceptance.md`](docs/plan/v0.4.0-acceptance.md)。

### 【新增】全机盘点

- **`scan --inventory`**：只读盘点本机内置宿主与已启用 `x-` 宿主根；未初始化工作区可运行，不写索引、锁或 `last_scan_at`。
- **发现与对账**：识别 skill / rules、`.disabled`、损坏与不可读；共享根按物理路径去重；双源账本合并，输出 managed / drift / missing / untracked / undetermined / orphaned 与权威等级。
- **统计口径**：user 主计数（安装副本 / 不同技能）置顶；system / platform / project 独立折叠，不污染用户安装数；损坏只入 corrupt 计数。
- **GUI**：新增只读「全机盘点」视图与空工作区入口；内置 / 第三方宿主分区、共享根 `consumed_by`、分类下钻、未纳管清单；一期无导入 / 修复动作。

### 【新增】内置宿主分发账本

- **`host_landings.yaml`**：第七份规范与第八份 schema，记录内置宿主副本的路径、形态、可见性、摘要与状态；摘要复用 integrity 单一哈希。
- **生命周期**：`install/update/enable/disable --host` 落账；`uninstall --host <id>` 与 `--host all` 清理副本并保留 orphaned 审计；原件卸载遇 active 副本以 `E-LANDING-002` 阻断，清理后才允许删除。
- **兼容**：v0.3.0 旧工作区缺少账本时视为空账本，历史副本走 inferred；不批量迁移、不覆盖损坏账本；export / restore 不携带本机账本。

### 【可维护性】

- **单一来源**：新增零依赖 `contract/` workspace 包；内核与 GUI 共用类型、错误码与常量；P0-a 的 3 条跨层违例清零。
- **机械护栏**：`check:arch` 锁定依赖方向与 0 循环；complexity / 文件规模 ratchet 只减不增；共享测试夹具收编直接 `mkdtemp` 82 → 0。
- **结构拆分**：宿主三处合一（M5-R7 成立）、`dispatch/scan` 拆分、`App.vue` 858 → 844、`gui-smoke` 743 → 660；lifecycle / plugins manifest 拆分留待 P1-c/P1-d。

### 【修复】

- **大 `--json` 管道截断**：CLI 入口改用 `process.exitCode`，等待 stdout 自然排空后退出；macOS CI 首次复现并验证修复。
- **x- 宿主 rules `.md`**：内置 Cursor 仍只识别 `.mdc`，插件宿主 rules 根兼容 `.md`，修复第三方副本在盘点中显示为 0。

### 【验证】

- 常规测试 **661 项**（660 通过 + 1 平台跳过）；Windows / Ubuntu 全量 verify；Windows / macOS / Linux 三平台 `inventory-probe` 35 项断言/平台；Bench 三平台通过。
- 慢测试 1 项、`smoke:kernel`、`smoke:gui` 40/40、check / typecheck / lint / format / build 全绿。
- 发布 run [39194534164](https://github.com/LuZhong-Li/skill-manager/actions/runs/39194534164) 四 leg + release job 全部 Success；Release 资产回下载验证 run [39195860498](https://github.com/LuZhong-Li/skill-manager/actions/runs/39195860498) 通过 SHA 复算、Windows portable 40/40、发布物内核盘点与 macOS arm64/x64 C 组。

### 【明确不做】

- 二期导入 / 修复 / 批量纳管动作；
- 双源账本统一（TD-01）；
- 加载 / 执行第三方代码插件；
- 真实 macOS / Linux 工具目录与 Codex 官方分发根口径（TD-02 / TD-07）。

### L-1：第七份规范与第八份 schema（2026-10-18）

- **需求**：9.3.7 增补账本前置与 `uninstall --host <宿主|all>` 分发生命周期；指令总数仍 16，`--host` 是选项扩展。
- **规范**：新增 `docs/specification/host-landings.spec.md`，定义 `<workspace>/host_landings.yaml` 作为内置宿主分发副本的唯一权威账本；`skill_index.targets[]` 仍只是工作区目标，插件宿主继续使用 `plugin_index.landings`。
- **Schema**：新增 `schemas/host_landings.schema.json`，覆盖顶层字段、落位记录、绝对路径、摘要格式、`skill` / `rules` 形态与 `visible` / `disabled` 可见性；字段表与 schema 由契约测试逐项比对。
- **摘要口径**：`content_digest` 复用 `kernel/core/integrity` 的 `collectHashEntries` / `computeChecksum`：相对路径 UTF-8 字节序、`路径 + NUL + 文件字节` 单次 SHA-256；禁用标记规范化，可见性切换不改变摘要；不引入第二套哈希。
- **共享根**：同一物理路径按 `host_id` 各记一条，账本不去重；读取层按真实路径去重。共享副本的可见性 / 重渲染同步全部活跃记录；单宿主卸载遇其他活跃消费方拒绝 `E-LANDING-001`，`--host all` 一次清理。
- **状态机**：`uninstall --host` 与 `--host all` 把记录标为 `orphaned` 并保留审计；原件卸载在无 active 记录后物理清除该 Skill 的 `orphaned` 记录；`E-LANDING-002` 同时检查 `host_landings` 与 `plugin_index.landings`。
- **问题码**：`result-and-exit-codes.md` 新增 `LANDING` 类别与 `E-LANDING-001` / `E-LANDING-002`；`contract/src/codes.ts` 同步常量；`check:contract` 锁定 **7 份规范 / 8 份 schema** 与两码同源。
- **兼容**：v0.3.0 及更早工作区缺少账本时按空账本读取，不自动创建、不批量回填；首次 `--host` 写入时创建；历史副本只走 inferred。
- **技术债 TD-01**：双源账本（`host_landings` + `plugin_index.landings`）是 v0.4.0 过渡态；触发 plugin_index v2 或下一次分发契约变更时统一为单账本，升级路径保留。
- **测试**：新增 4 项契约测试；常规套件 569 → **573 项**（单元 371、契约 116、端到端 86；572 通过 + 1 项平台条件跳过）；typecheck / lint / format:check / check / build 全绿，`smoke:kernel` 通过，`smoke:gui` 28/28，慢测试 1 项通过。
- **边界**：本批只落规范、schema、问题码与契约测试；落账、卸载、init 建空文件由 L-2 / L-3 实现。

### L-2：内置宿主账本写路径（2026-10-18）

- **Store**：新增 `kernel/store/host-landings/`，负责 `host_landings.yaml` 的原子读写、主键 CRUD、共享物理路径同步与结构校验；损坏、主键重复、坏枚举统一返回 `E-LANDING-001`。
- **初始化**：`init` 幂等创建空 `host_landings.yaml`，与 `skill_index.yaml` / `plugin_index.yaml` 同级；已有账本不覆盖。
- **四命令落账**：`install` / `update --host` 在物理落位成功后写 active 记录；`enable` / `disable --host` 改名后更新 visibility；账本写入失败时恢复副本或反向改名，不留半截状态。
- **摘要同源**：新增 `computeLandingChecksum`，复用 `collectHashEntries` / `computeChecksum` 的「相对路径 + NUL + 文件字节」单次 SHA-256；`.disabled` 规范化；单测断言可见副本摘要与 `computeChecksum` 完全相同。
- **共享根**：同一物理路径按宿主各记一条；codex/cursor 同路径 e2e 验证一次写盘、多记录同步；enable/disable/update 不只改一条。
- **adopted**：历史副本 enable/disable 时以 `origin: adopted` 入账，结果数据可见 `adopted: true`，不误记为 distributed。
- **形态边界**：entry 不产生物理副本与账本记录；rules 只允许 visible，规则形态 enable/disable 返回参数类错误。
- **回滚矩阵**：单测覆盖已有技能副本恢复、首次落位删除、规则文件恢复/删除、既有账本字节不变、共享根两记录整体回滚；e2e 覆盖损坏账本前置中止与目标路径冲突。
- **结构**：宿主通道从 `dispatch/registry` 拆到 `dispatch/host/`（channel / landing-result / index）；复杂函数基线 99 → **96**，`dispatch/registry` 2621 → **2419** 行，新文件均低于 500 行。
- **测试**：新增 18 项（11 unit + 7 e2e）；常规套件 573 → **591 项**（单元 382、契约 116、端到端 93；590 通过 + 1 项平台条件跳过）；check / typecheck / lint / format:check / build / smoke:kernel / smoke:gui 28/28 / 慢测试 1 项均通过。
- **边界**：本批不实现 `uninstall --host`、`--host all` 与原件卸载闭环，不实现 `scan --inventory`；不带 `--host` 的既有行为保持不变。

### L-3：宿主副本卸载与原件闭环（2026-10-18）

- **单宿主卸载**：`uninstall <id> --host <host>` 路由内置宿主到 `host_landings`、`x-` 宿主到 `plugin_index.landings`；物理副本删除后账本标 `orphaned`，不创建 Skill 备份。
- **共享根保护**：同一 `target_path` 仍被其他 active 宿主消费时拒绝 `E-LANDING-001` 并引导 `--host all`，不破坏其余宿主。
- **全宿主清理**：`uninstall <id> --host all` 按物理副本分组，共享副本只删一次；两账本相关记录一起转 orphaned，插件包与插件安装状态不动。
- **原子性与部分失败**：每组先临时移走副本，再写两账本，再删除；账本失败恢复副本与账本，删除失败恢复副本并保留 orphaned。多组逐组提交，结果列出每个宿主的 `removed` / `missing` / `unchanged` / `failed`。
- **原件卸载闭环**：`uninstall` / `--hard` 前检查两账本 active，命中 `E-LANDING-002` 并列出 host / path / ledger_source 与逐宿主 / `--host all` 引导；成功后清除 `host_landings` 孤儿记录，`plugin_index.landings` 孤儿按 M4b 保留。
- **互斥与再激活**：`--host` 与 `--hard` / `--kind plugin` 互斥；非法宿主 / 无记录不误删；orphaned 后 `update --host` 复用同主键回到 active。
- **测试**：新增 12 项（6 unit + 6 e2e）；常规套件 591 → **603 项**（单元 388、契约 116、端到端 99；602 通过 + 1 项平台条件跳过）；共享根、双宿主、x- 宿主、原件阻断、dry-run、再激活与部分失败均有用例。
- **结构**：`dispatch/host/uninstall*` 拆为 options / types / plan / execute 四文件，均低于 500 行；复杂函数基线 96 → **95**，`dispatch/registry` 保持 2419 行；`check:arch` 139 文件 / 407 边 / 0 循环。
- **边界**：本批不实现 `scan --inventory`、历史副本 inferred / export 边界（L-4）与旧工作区兼容（L-5）；现有插件包卸载行为保持不变。

### L-4：对账纯函数与 export 边界（2026-10-18）

- **契约类型**：新增 `contract/src/host-reconciliation.ts`，定义观察副本、host/plugin 账本记录、工作区基线、三轴证据与分类输出。
- **纯函数**：新增 `reconcileHostCopy`，只消费调用方已枚举/读取的事实，不访问文件系统；按 host active、plugin active、orphaned、无账本四条路径分类。
- **host 判定**：active 一致 / 内容漂移 / 可见性漂移 / 来源漂移 / 版本漂移 / 缺失 / 不可读；渲染基线变化不判漂移，content 降 inferred。
- **无账本**：inferred_consistent / inferred_drift / untracked / not_distributed；任何无账本场景不判 missing；无工作区或根不可读只出 undetermined。
- **orphaned**：副本残留且工作区有记录时保留 `orphaned` 分类并标 content/source inferred，区分推断一致 / 漂移；工作区无记录时 all insufficient + `untracked_candidate`；副本不存在时 `copy_present:false`。
- **插件证据**：managed / missing 权威；content 与 source 最多 inferred；无重渲染基线时 undetermined，反向断言禁止出现 authoritative content/source。
- **降级**：`ledger_state: missing|unreadable` 安全降级到无账本推断，带 `ledger_unavailable_degraded`，不抛崩、不伪造权威。
- **export / restore**：`host_landings` 属本机派生状态，不进入 export 包；restore 不恢复账本。契约测试断言导出文档无 `host_landings`/`landings`，restore 前后账本字节一致；恢复后的历史副本继续走 inferred。
- **测试**：新增 13 项（12 unit / 1 contract）；常规套件 603 → **616 项**（单元 400、契约 117、端到端 99；615 通过 + 1 项平台条件跳过）。
- **结构**：complexity 基线保持 **95**；`reconcile.ts` ≤ 500 行；`check:arch` 141 文件 / 408 边 / 0 循环。
- **边界**：本批不做宿主扫描 IO（M4c）、不做旧工作区迁移（L-5）。

### L-5：v0.3.0 旧工作区兼容（2026-10-18）

- **缺失视为空**：无 `host_landings.yaml` 的旧工作区按空账本读取，`exists:false` / `index:null` / 无 findings，不报错、不归类损坏。
- **损坏才报错**：文件存在但 YAML / schema / 版本不合规返回 `E-LANDING-001`，不静默重置或覆盖损坏字节。
- **懒初始化**：install/update/enable/disable 首次遇到缺失账本时幂等补建空文件；dry-run 与被拒确认不写。补建发生在物理副本操作之前。
- **不批量迁移**：升级不扫描宿主、不批量写 `host_landing` 记录；只读路径保持文件缺失，历史副本继续走 inferred，不伪造 distributed。
- **adopted / distributed**：首次 `disable --host` 以 `origin: adopted` 入账；首次 `update/install --host` 正常 `distributed`。
- **字节不变**：只读 / enable-disable 前后 `skill_index.yaml`、`plugin_index.yaml` 字节一致；update 只改 skill 索引，插件索引字节不变。
- **版本**：新账本 `schema_version: "1"`、`tool_version` 取当前工具版本；后续演进按 schema 版本递增。
- **测试**：新增 5 项 e2e；常规套件 616 → **621 项**（单元 400、契约 117、端到端 104；620 通过 + 1 项平台条件跳过）。
- **结构**：complexity 基线保持 **95**；`dispatch/registry` 保持 2419 行；`check:arch` 141 文件 / 408 边 / 0 循环。
- **收口**：L-1 ~ L-5 账本批次全部完成；下一阶段 P1-a 宿主三处合一 + `inventory_roots`。

### P1-a：宿主三处合一与盘点根（2026-10-19）

- **单一来源**：新增 `kernel/core/hosts/host-root-models.ts`，每个内置宿主只引用一份 `adapter_forms` / `landing_roots` / `inventory_roots` 数据；`registry-data.ts` 不再复制形态与默认根。
- **形态 selector**：删除 `FORM_BY_HOST`；`formImplementationOf` 从注册表 `adapter_forms` 派生并复用通用形态实现，新增宿主不再需要 selector 分支。
- **默认根**：`defaultRootFor` 改为展开 `landing_roots`；六宿主默认分发根保持等价。Codex 仍分发到 `~/.agents/skills`，豆包仍为 `.user_skills`。
- **盘点根**：新增 `inventoryRootsForHost` / `inventoryRootsForAll`；Codex 覆盖 agents user、`.codex/skills` legacy user、`.system` system 与 project；豆包按 `.user_skills` user / `.skills` platform；Cursor 技能根递归、规则根顶层。
- **配置与插件**：`host.<id>.root` / `.rules_root` 作为额外 `origin: config` 的 user 根；已启用插件 catalog 的 `x-` 根输出同一 `InventoryRootView`，未配置 global 根时显式 `configured:false`。
- **契约**：`host-registry.spec.md` 新增 3.5.1 ~ 3.5.3 与 HR-14 / HR-15；schema 要求非 `not_applicable` 宿主提供三组字段、`not_applicable` 宿主不得提供，`base: env` 必须给出 `env_var`。`plugin-format.md` 的 P-04 与隔离条款改指 `adapter_forms` 单一来源。规范仍 7 份 / schema 8 份。
- **证据边界**：macOS / Linux 候选根标 `pending_verification`，由 M4c-7 CI fixture 探针验证；Codex / 豆包分发根差异继续待官方口径与多版本证据，本批不修改。
- **测试**：新增 6 项契约测试；常规套件 621 → **627 项**（单元 400、契约 123、端到端 104；626 通过 + 1 项平台条件跳过）。
- **结构**：complexity 基线 95 → **94**；`registry-data.ts` 428 行、`host-root-models.ts` 204 行、`hosts/inventory.ts` 117 行；`check:arch` 146 文件 / 416 边 / 0 循环。
- **边界**：本批不读取宿主目录、不实现 `scan --inventory`；分发输出、退出码与落位路径保持等价。

### P1-b：dispatch scan 段拆分（2026-10-19）

- **模块拆分**：新增 `kernel/dispatch/scan/`（`index` / `types` / `options` / `workspace` / `plugin` / `result`）；Skill 扫描的索引检查、加锁、discovery、索引写入与插件扫描的无锁刷新均移出 registry。
- **共享辅助**：工作区定位与插件选项拒绝进入 `dispatch/shared/options.ts`；插件索引读取状态进入 `dispatch/plugins/state.ts`，由 registry 与 scan 共用，避免第二套实现。
- **registry 收口**：`dispatch/registry/index.ts` 只保留 `scanHandler` 导入与注册；规模 2419 → **2172** 行，其他指令实现未改写。
- **M4c 分流点**：`scan/index.ts` 在索引存在性检查前形成扫描计划，并明确 inventory 未来分支不锁、不写 `last_scan_at`、允许未初始化；本批不注册 `--inventory` 占位参数。
- **行为等价**：现有 scan 输出、索引更新、`last_scan_at`、退出码与锁行为不变；Skill / 插件 scan 全量用例通过。
- **测试**：新增 2 项结构测试；常规套件 627 → **629 项**（单元 400、契约 125、端到端 104；628 通过 + 1 项平台条件跳过）。
- **结构**：complexity 保持 **94**；`dispatch/scan` 最大文件 121 行；`check:arch` 154 文件 / 462 边 / 0 循环。
- **收口**：P0 + L-1 ~ L-5 + P1-a/P1-b 全部完成；下一批 M4c-1。

### M4c-1：`scan --inventory` 命令骨架（2026-10-19）

- **参数**：新增 `--inventory` 布尔选项；与 `--kind`、`--root`、`--dry-run` 及位置参数互斥，统一 `E-INPUT-002`。允许 `--workspace` 与 `--json` / `--machine` / `--no-color` / `--verbose`。
- **只读分流**：`scanPlanOf` 后、workspace 索引检查前进入 `inventoryScanCommand`；不加锁、不写 `last_scan_at`、不调用 `scanWorkspace`，未初始化工作区 exit 0。
- **根清单**：输出 `data.mode = inventory`、`data.workspace` 与 `data.roots[]`；内置根与已启用 `x-` 宿主根统一为 root_role / recursive / origin / is_x_host / consumed_by / configured 字段，无法展开的根带 reason。
- **配置与插件**：`host.<id>.root` / `.rules_root` 覆盖根展开；未启用插件不进入清单；共享根的消费宿主由 `consumed_by` 标注。
- **契约**：`cli-contract.md` 第 4.4 节登记 inventory 语法、互斥、允许项与输出字段；指令仍 16，规范 / schema 仍 7 / 8。
- **测试**：新增 5 项（2 unit / 3 e2e）；常规 629 → **634 项**（单元 402、契约 125、端到端 107；633 通过 + 1 平台条件跳过）。
- **结构**：`inventory.ts` 低于 500 行；complexity 保持 **94**；`check:arch` 155 文件 / 474 边 / 0 循环。
- **边界**：本批不读宿主目录、不发现技能、不做对账；M4c-2 / M4c-3 分别承接。

### M4c-2：宿主目录发现与物理去重（2026-10-19）

- **发现**：新增 `kernel/core/inventory/discover.ts`；direct 只枚举一级子目录，recursive 任意深度查找；references/examples 等无 SKILL.md 目录不计独立技能。
- **识别**：skill 要求 SKILL.md frontmatter 的 name/description；`.disabled` 为 disabled；bad YAML / 缺字段 / 可见性冲突进入 corrupt；rules 只识别 `.mdc`；agents-md entry 根为 not_applicable。
- **观察**：`copies[]` 输出根、宿主、role、format、visibility、recursive、skill_id/version、content_digest、可读性与消费方；digest 复用 `computeLandingChecksum`。
- **去重**：realpath + Windows casefold；共享根和父子根重叠合并，`consumed_by` / `root_ids` / `sources` 聚合；同一 skill_id 的不同物理根分别保留。
- **输出**：`roots[]` 增加 state / readable / copy_count / corrupt_count；新增 `copies[]`、`corrupt[]`、`summary`（去重前后与重复数）。不做 M4c-3 对账分类。
- **只读与性能**：未初始化工作区照常发现；宿主与工作区字节不变。200 技能 × 10 references 文件（2200 文件）Windows 本机 **214 ms**，无缓存。
- **测试**：新增 5 项（4 unit / 1 e2e）；常规 634 → **639 项**（单元 406、契约 125、端到端 108；638 通过 + 1 平台条件跳过）。
- **结构**：complexity 保持 **94**；`discover.ts` 457 行；`check:arch` 157 文件 / 480 边 / 0 循环。
- **收口**：M4c-1/M4c-2 完成；下一批 M4c-3。

### M4c-3：双源双向对账（2026-10-19）

- **正向对账**：`kernel/dispatch/scan/reconcile.ts` 将 M4c-2 的 copies/corrupt 接入 L-4 `reconcileHostCopy`；输出 classification、ledger_source、evidence、reasons、drift_reasons。
- **反向 missing**：遍历 `host_landings` 与 `plugin_index.landings` 的 active 记录，规范化 target_path 不在 observed 集合时列出 `missing[]`；orphaned 不反查。
- **工作区基线**：只读 `skill_index` 与工作区源文件，构造 checksum/version/source_ref/expected_content_digest/expected_visibility；未初始化、索引不可读、根不可读进入降级标记。
- **插件**：managed / missing 权威；content/source 通过现有 profile 与渲染核心重渲染为 inferred，无基线时 undetermined；测试断言不得出现 authoritative content/source。
- **共享根**：一个物理副本可匹配多条 active 记录；副本删除时按宿主账本逐条进入 missing。
- **测试**：新增 5 项（2 unit / 3 e2e）；常规 639 → **644 项**（单元 408、契约 125、端到端 111；643 通过 + 1 平台条件跳过）。
- **结构**：`reconcile.ts` 474 行；complexity 保持 **94**；`check:arch` 158 文件 / 496 边 / 0 循环。
- **边界**：只读，不写任何文件；主计数与最终分组归 M4c-4。

### M4c-4：结构化聚合与最终统计（2026-10-19）

- **主计数**：`summary.main` 输出 `user` role 的去重有效副本数与 `unique_skills`；system/platform/project 独立分组，不污染主计数。
- **分类聚合**：`by_classification` 保留 L-4 原分类，`groups` 将 managed/drift 聚合并保留 authoritative/inferred；missing、untracked、undetermined、unreadable、not_distributed、orphaned 单列，orphaned 区分工作区在/不在。
- **层级**：新增 `hosts → roots → copies/corrupt/missing`；扁平 copies/missing/corrupt 保留可下钻证据。
- **人类输出**：默认突出 user 主计数与 role/分类/宿主摘要；`--verbose` 展示副本明细，`--json` 保留完整结构。
- **计数边界**：共享根只算一份；corrupt 只入 corrupt_count；missing 不增加有效副本；同 skill_id 多物理根分别计副本、合并计 `unique_skills`。
- **测试**：新增 3 项（2 unit / 1 e2e）；常规 644 → **647 项**（单元 410、契约 125、端到端 112；646 通过 + 1 平台条件跳过）。
- **结构**：complexity 94 → **93**；`aggregate.ts` 253 行；`check:arch` 159 文件 / 498 边 / 0 循环。
- **收口**：M4c-4 完成；下一批 M4c-5 只读系统化。

### M4c-5：只读保证系统化（2026-10-19）

- **静态守卫**：`scripts/check-layer.mjs` 新增盘点只读审计，只允许只读 fs API，拒绝写调用、锁、索引写入、落位与账本提交；synthetic `writeFileSync` / `saveIndex` 反例可捕获。
- **动态快照**：新增 `tests/helpers/snapshot.ts`，递归记录路径、类型、mtime、大小与 SHA-256；工作区与全部宿主根盘点前后逐项比较。
- **场景覆盖**：多宿主/共享根/x- 宿主、未初始化工作区、损坏 `host_landings`、缺失/非目录根、100 副本规模；损坏账本字节不变，无锁/临时/缓存残留。
- **契约**：CLI 第 4.4 节增加只读验证条款；9.3.7 M4c-R5 验收补齐静态守卫与动态快照。
- **测试**：新增 5 项（1 contract / 4 e2e）；常规 647 → **652 项**（单元 410、契约 126、端到端 116；651 通过 + 1 平台条件跳过）。
- **结构**：`check:arch` 159 文件 / 498 边 / 0 循环；complexity 保持 **93**。
- **收口**：M4c-5 完成；下一批 M4c-6 GUI 盘点视图。

### M4c-6：GUI 全机盘点视图（2026-10-19）

- **入口**：侧边导航新增「全机盘点」；空工作区与已初始化空列表均提供「盘点这台电脑上已安装的 Skill」，未初始化即可运行。
- **只读通道**：复用通用 `kernel:invoke` 调用 `scan --inventory`；不新增 IPC、不走预览/确认，不写工作区、settings 或账本。
- **主计数与分组**：user「安装副本 / 不同技能」置顶；system/platform/project 默认折叠并标注平台/系统内置；内置宿主与第三方 `x-` 宿主分区，共享根标注 `consumed_by`。
- **分类与下钻**：managed/drift 保留 authoritative/inferred；missing/untracked/undetermined/unreadable/not_distributed/orphaned 分项；副本表展示 id、版本、路径、可见性、分类、账本来源与判定依据；损坏、缺失、未纳管各自可查看。
- **只读边界**：视图无安装/卸载/启用/更新/导入/修复执行入口；二期动作仅禁用占位；冒烟断言盘点前后工作区与 settings 字节一致。
- **发现修正**：插件 rules 根兼容 `.md`，内置 Cursor 规则仍只识别 `.mdc`；修复 x- 宿主副本在盘点中显示为 0。
- **组件与规模**：新增 `HostInventoryView` 与 3 个盘点子组件、纯展示映射；`App.vue` 858 → **844** 行，新组件均低于 800 行；`scripts/gui-smoke.mjs` 743 → **660** 行。
- **测试**：新增 6 项（2 unit / 4 contract）；常规套件 652 → **658 项**（单元 412、契约 130、端到端 116；657 通过 + 1 项平台条件跳过）；`smoke:gui` 28 → **40/40**。
- **结构**：`check:arch` 167 文件 / 511 边 / 0 循环 / 0 allowlist；complexity 保持 **94**。
- **收口**：M4c-6 完成；下一批 M4c-7 三平台 CI fixture 探针。

### M4c-7：三平台 CI fixture 探针（2026-10-19）

- **探针**：新增 `scripts/probe-host-inventory.mjs`，真实执行 `scan --inventory --json`；临时 HOME/LOCALAPPDATA 夹具，不读取真实用户目录，35 项断言/平台。
- **CI**：`verify.yml` 新增独立 `inventory-probe` job，矩阵 ubuntu-24.04 / windows-latest / macos-15，`fail-fast: false`；由 `ci.yml` 与 `pack.yml` 共同消费。
- **覆盖**：HOME 展开与平台分隔符、config 根追加、有效技能 / `.disabled` / 坏 YAML / 缺 name / 无 SKILL.md 忽略 / references 不计数、共享根 realpath 去重、Cursor 递归、managed/drift/missing/untracked、未初始化工作区。
- **symlink**：macOS / Linux 用目录符号链接指向共享根验证去重；Windows 条件跳过并在输出中标注。
- **插件规则**：x- 宿主 `.zed/rules/<id>.md` 作为 rules 发现，验证 `.md` 兼容与 skill_id 识别。
- **pending 精确处理**：移除 `claude/user`、`cursor/user-skills`、`cursor/user-rules`；保留 `codex/agents-user`、`codex/legacy-user`、`codex/system`，原因是 Codex 官方 / 遗留根口径仍待真机证据。
- **真机遗留**：TD-02 真实安装环境默认布局；TD-07 Codex 官方 vs 遗留分发根口径。
- **测试**：新增 3 项契约测试；常规套件 658 → **661 项**（单元 412、契约 133、端到端 116；660 通过 + 1 项平台条件跳过）。
- **结构**：`check:arch` 168 文件 / 511 边 / 0 循环 / 0 allowlist；complexity 保持 **94**。
- **收口**：M4c-7 完成，M4c 功能与验证全部收口；下一批 v0.4.0 总验收与发版准备。

## 0.3.0

M4b 声明式插件生态。未签名交付口径不变。

### 【新增】

- **声明式插件生态**：第三方通过 `plugin.json` manifest 声明新宿主 profile，复用 `skill` / `rules` / `entry` 三种渲染形态；第三方宿主使用 canonical `x-<plugin_id>-<host_key>` 命名空间。
- **七个既有指令接入 `--kind plugin`**：`scan` / `list` / `inspect` / `install` / `uninstall` / `enable` / `disable`；省略时仍为 Skill，指令总数保持 16。
- **独立插件索引与副本账本**：`plugin_index.yaml` 记录插件状态与配置，`landings` 记录插件宿主副本（含 `active` / `orphaned`）；插件卸载删除插件包但保留 Skill 索引与既有副本。
- **GUI 插件管理**：列表/详情/安装/启停/卸载、未登记候选、canonical 宿主与 `landings` 视图；内置 7 宿主与第三方 `x-` 宿主分区，global 根提供 `plugin.*` 配置引导。
- **配置路由**：`config set/get plugin.<id>.<host>.root` / `.rules_root` 路由到插件索引；`host.*` 仍只认内置注册表。

### 【安全边界】

- 不加载、不执行第三方代码：拒绝 JS/原生库/可执行文件，插件路径不使用 `import` / `require` / `eval`。
- 插件默认 `disabled`（安装≠启用）；启用前重新校验；内置 7 宿主不可覆盖；安全控制字段整插件拒绝；global 根必须显式配置。

### 【明确不做】

- 代码插件与沙箱、全局插件、插件更新检查（本期手动 uninstall/install）、应用自更新 M4a-2（待签名/公证与 `latest*.yml`）。

### 【不变】

- 指令数 16；Skill 索引格式版本不变；内置宿主与既有 Skill 行为不变。

## 0.3.0 开发记录

### 发布与发布后复核（v0.3.0）

- **发布**：tag `v0.3.0`（`7a1aed6`）→ Pack run **39055521608 Success**（四 leg 打包 + 发布 job + 资产级冒烟）。Release 为 **latest、非 draft、非 prerelease**，6 项资产齐备：[v0.3.0](https://github.com/LuZhong-Li/skill-manager/releases/tag/v0.3.0)。
- **生产形态 GUI（本批关键）**：回下载 `skill-manager-0.3.0-portable.exe` 并以生产 `app.asar` 路径启动，`smoke:gui` **28/28 通过**——插件安装默认 disabled、enable 后 `x-` 宿主出现、规则落位、`landings` 详情、disable 后宿主消失、uninstall 列出路径/文件数/孤儿副本、内置宿主分区不变。
- **发布物内核 `--kind plugin`**：从同一便携资产解包 `resources/kernel/skill-manager.exe`（`--version=0.3.0`），完成最小闭环：插件安装 → enable → Skill 分发到 `x-released-tools-zed` → inspect → uninstall；落位副本保留，`plugin_index.yaml` 的 `landings` 为 `orphaned`。
- **macOS C 组**：CI run **39056883084** 两架构成功——arm64/x64 dmg 内内核 `--version` exit=0（`0.3.0`）、`init → scan` exit=0/0、签名校验 exit=0。
- **校验与清理**：回下载 portable 与 x64.exe，按 `SHA256SUMS.txt` 复算均一致；CI run **39055518482**（Windows/Linux）与 Bench run **39055518502**（Windows/Linux/macOS）Success；v0.1.0 已知问题提示已幂等改写为指向 v0.3.0，旧版保留；远端仅 `main` + `v0.1.0/v0.1.1/v0.1.2/v0.2.0/v0.3.0`，临时 probe 分支已删除。

### M4b T0：第六份规范、插件 schema 与加载合并纯函数

- **第六份规范**：新增 `docs/specification/plugin-format.md`，定义声明式 host-profile 插件 manifest、独立 `plugin_index.yaml`、canonical `x-<plugin_id>-<host_key>` 命名空间、默认 disabled 生命周期、安全约束与四个新问题码（`E-ID-004` / `E-ID-005` / `E-VER-002` / `E-CONFLICT-004`；不新增类别或退出码）。
- **schema**：新增 `schemas/plugin_manifest.schema.json` 与 `schemas/plugin_index.schema.json`，与规范字段表逐项一致；manifest 拒绝代码入口与 `security_control_evidence` 等安全控制字段。
- **存储与发现**：新增 `kernel/store/plugin-registry/` 与 `kernel/core/plugins/`：插件索引原子读写、manifest 哈希、目录发现、代码文件/符号链接拒绝、插件记录默认 disabled。
- **合并隔离**：`buildHostCatalog()` 为纯函数；六条机械保证与三条审计落地（内置 registry 深比较、`FORM_BY_HOST` 键集合、canonical 冲突整插件拒绝、schema 非法拒绝、disabled 不加载、安全字段拒绝、无 import/require/eval、`x-` 与内置不相交、`host.*` 拒绝插件 id）。
- **契约与初始化**：七个既有指令登记 `--kind <skill|plugin>`；`init` 建立 `plugins/` 与空 `plugin_index.yaml`；Skill 索引结构不变，插件使用独立事实源。
- **测试**：常规套件 525 → **541 项**（单元 361、契约 107、端到端 73；540 通过 + 1 项符号链接平台条件跳过），慢测试 1 项通过；`check` / `typecheck` / `lint` / `format:check` 全绿。

### M4b T1：七个指令插件分支、生命周期与插件宿主落位

- **指令分支**：`scan` / `list` / `inspect` / `install` / `uninstall` / `enable` / `disable` 接入显式 `--kind plugin`；省略仍为 Skill；其他指令与重复 `--kind` 返回 `E-INPUT-002`。
- **生命周期**：插件安装复用 `acquireFromPath`（`plugin.json` 内容根、既有协议/超时/体积口径），默认 `disabled`；enable 重新校验 manifest、哈希、代码文件与 canonical 冲突；disable 只停用 profile；uninstall 删除插件包并保留 Skill 索引。
- **宿主落位**：`--host x-<plugin>-<host_key>` 仅在插件 enabled 时可用；复用 `skill` / `rules` / `entry` 渲染与 `landPlan`；global 根必须显式配置 `plugin.<id>.<host>.root` / `.rules_root`。
- **副本账本**：`plugin_index.yaml` 新增独立 `landings` 区，记录 plugin/skill/host/target/时间/状态；插入、停用、卸载（标记 `orphaned`）与重新落位口径写入 `plugin-format.md` 4.6。
- **配置**：`config set plugin.*` 路由到插件索引，`config get` 附加 `plugin_config`；`host.*` 继续只认内置注册表。
- **测试**：常规套件 541 → **547 项**（单元 361、契约 107、端到端 79；546 通过 + 1 项符号链接平台条件跳过）；新增真实 CLI 生命周期、账本、孤儿副本、global/local 落位、`--kind` 门禁与 enable 重校验用例。

### M4b T2：插件管理 GUI 与宿主分区

- **插件视图**：新增「插件（扩展）」页面，与 Skill 视图物理分区；列表展示 id/版本/状态/宿主数，未登记候选单独分区，详情展示 manifest、canonical 宿主、校验结论、`landings` 账本与根配置来源。
- **操作接线**：安装、启用、停用、卸载均继续经既有 `KernelBridge` 的 preview/confirm/execute 链路，带 `--kind plugin`；安装后明确提示默认 disabled。
- **宿主分区**：主进程 `plugins:hosts` 消费内核 `list --kind plugin` 的 `builtin_hosts` / `plugin_hosts`，区分内置 7 宿主与第三方 `x-` 宿主；停用、失效、global 根未配置的第三方宿主不可选并给出 `config set plugin.*` 引导。
- **交互安全**：插件视图没有更新检查入口/角标；卸载确认展示插件路径、文件数、将保留的孤儿副本路径；插件安装/启停/卸载不复制内核逻辑。
- **冒烟修复**：`update --host` 之前会被 M4a 的 update 专用通道截走并丢弃 `--host`；现已改为仅无 `--host` 的 update 走专用通道，插件宿主分发走通用执行通道，并新增回归断言。
- **测试**：常规套件 547 → **552 项**（单元 365、契约 107、端到端 80；551 通过 + 1 项符号链接平台条件跳过）；`smoke:gui` **28/28 通过**，覆盖安装→启用→x- 宿主分发→账本→停用→卸载与内置宿主分区不变。

### M4b T3：失败矩阵、隔离复核、验收映射与收官准备

- **失败矩阵**：新增 `tests/e2e/plugin-matrix.test.ts`（6 项真实 CLI 子进程）：非法 manifest/安全字段/代码文件/API 不兼容、canonical 冲突与重复/非法 id、disabled/global 未配置/未登记宿主、来源协议与远端失败、运行期 manifest 损坏、多个坏插件候选下的 Skill 主路径与卸载孤儿账本。
- **隔离复核**：真实 CLI 前后 `loadHostRegistry()` 深比较、`allAdapters()` 键集合、`x-` 与内置不相交、`skill_index.yaml` 逐字节不变；T0 的六条机械断言与三条审计继续覆盖。
- **验收与文档**：9.3.5 R1~R5、高层目标 6/7 映射回填计划；README 增加插件章节与最小 manifest 示例；明确无代码执行、默认 disabled、内置不可覆盖、global 根显式配置。
- **测试**：常规套件 552 → **558 项**（单元 365、契约 107、端到端 86；557 通过 + 1 项符号链接平台条件跳过）；`smoke:gui` **28/28 通过**；CI run **39053919194**（Windows/Linux）与 Bench run **39053919195**（Windows/Linux/macOS）均 Success。
- **v0.3.0 发布准备（待授权，未发版）**：建议 minor `v0.3.0`；CHANGELOG 版本段要点为声明式插件 manifest/新宿主 profile/三渲染形态/七指令 `--kind plugin`/独立 `plugin_index` 与 `landings`/GUI 插件管理；明确不做代码形态/沙箱、全局插件、插件更新检查、应用自更新 M4a-2。

## 0.2.0

M4a Skill 更新检查与远端目标标签更新。未签名交付口径不变。

### 【新增】

- **GUI Skill 更新检查**：工具栏手动入口与更新角标；四态提示（可更新 / 已是最新 / 不可检查 / 检查失败）；「预览 → 确认 → 逐项更新」流程；本地来源明确引导使用 `update --check`。
- **远端专用 `update <id> --ref <tag>`**：更新到已确认的目标标签；支持目标预览、更新前备份，并把中心库 `source.ref` 与已安装版本持久化为目标标签。仅远端来源有效，本地来源传 `--ref` 返回参数类错误。
- **检查频率**：定期与即时检查默认关闭；定期最短 6 小时、仅应用运行期间、只提示不执行；无远端清单服务、无遥测、不自动下载或安装。

### 【修正】

- **`update --dry-run` 严格只读**：修复预览可能进入实际刷新的路径；远端目标预览读取目标版本并给出前后版本差异。

### 【未实现 / 边界】

- **应用自更新（M4a-2）**：需签名/公证接入并发布 `latest*.yml`；当前三平台仍为手动打开 Release 页。

### 【不变】

- 指令数保持 **16**；本地来源 `update` 的语法、行为与输出契约不变；结果封装仍为既有 8 字段。

## 0.2.0 开发记录

### 发布与发布后复核（v0.2.0）

- **发布**：tag `v0.2.0`（指向 `98edd1f`）→ pack run `39035763901` **Success**（四 leg 打包 + 版本守卫 + 校验清单 + 发布 + 资产级冒烟 + 历史版本提示）。Release 为 **latest、非 draft、非 prerelease**，6 项资产齐备：[v0.2.0](https://github.com/LuZhong-Li/skill-manager/releases/tag/v0.2.0)。
- **Windows 生产形态 GUI（本批关键）**：回下载 `skill-manager-0.2.0-portable.exe` 并直接启动（页面来自 `resources/app.asar/out/renderer`，非开发目录），`smoke:gui` **18/18 通过**——更新检查入口、四态视图、即时角标、预览确认、目标更新、`source.ref` 持久化、更新前备份、再检查最新、设置落盘全部通过。
- **发布物内核 `update --ref`**：从同一便携资产解出内核（`--version = 0.2.0`），回环 git 场景 `v1.0.0 → v1.1.0` 实测：dry-run 目标预览 `1.1.0` 且不写盘；确认更新后内容为 `# v2`、`source.ref: v1.1.0`、版本 `1.1.0`、索引指纹变化、生成 1 份更新前备份。
- **macOS C 组**：probe run `39037968484` 两架构独立复核——arm64 与 x64 均为 `version=0.2.0`、`version_exit=0`、`init_scan=0/0`；非正式代码签名口径不变。
- **校验与清理**：回下载 5 个交付物与 `SHA256SUMS.txt`，SHA256 **5/5 一致**；v0.1.0 已知问题提示已幂等改写为指向 v0.2.0（v0.1.1 / v0.1.2 保持不动）；远端仅 `main` + `v0.1.0` / `v0.1.1` / `v0.1.2` / `v0.2.0`。
- **CI / Bench**：`98edd1f` 的 CI run `39035748585` 与 Bench run `39035748633` 均 Success；发布前常规套件 525 项全绿、慢测试 1 项通过。

### M4a T3：全链路收口与 `update --ref` 目标标签闭环

- **目标标签闭环**：新增远端专用 `update <id> --ref <tag>`；更新前先生成可恢复备份，按目标标签获取后持久化中心库元文件 `source.ref`，再检查为 `up-to-date`。本地来源、`--check --ref`、非法 ref 返回参数类错误；目标不存在返回来源类错误且不写索引/原件；无 `--ref` 时语义不变。
- **预览修复**：`update --dry-run` 明确走只读预览路径，不再进入实际刷新；远端目标预览读取目标内容并给出版本前后值。
- **全链路证据**：真实 CLI + 回环 `git daemon` + 主进程 coordinator 完成「v1.0.0 → 检查可更新 → 预览 → 确认 → v1.1.0 → 内容/版本/ref 更新 → 再检查已最新」；本地/归档/分支/非正式标签/认证/超时/离线等失败矩阵沿用 T1/T2 断言。
- **测试与真机**：新增 6 项（单元 2、契约 1、端到端 3），常规套件 519 → **525 项全绿**；慢测试 1 项通过；`smoke:gui` **18/18** 通过（角标、四态、预览确认、目标更新、ref 持久化、再检查最新、设置落盘）。
- **文档**：README 增加用户可见更新检查说明；one-summary 登记 M4a 收官、M4a-2 证据矩阵与 `W-DRIFT-001` 后续措辞批次；契约 4.11、设计与计划同步。

### 发布准备：v0.2.0（已完成四处版本定版）

- **版本**：`v0.2.0`。M4a 是用户可见 GUI 新功能（四态检查、角标、设置项），同时包含远端 `update --ref` 契约扩展；保持当前未签名交付口径。
- **发布说明要点**：五份契约/16 条指令不变；新增 Skill 更新检查与 `update --ref`；四态含义；定期/即时默认关闭、6 小时、只提示不执行；本地来源使用 `update --check`；无远端清单服务、不自动下载安装；应用自更新 M4a-2 未实现。
- **定版**：三处 `package.json`、`TOOL_VERSION` 与 CHANGELOG 顶部均为 `0.2.0`。

### M4a T2：GUI 更新检查接线（IPC、四态交互、确认执行、频率开关）

- **主进程 IPC**：新增 `updates:check` / `updates:settings:get` / `updates:settings:set` / `updates:update` / `updates:latest` 与 `updates:report` 事件；preload 只暴露白名单方法。`updates:update` 内部调用既有 `KernelBridge.execute(['update', id])`，没有新增指令或第二套写入路径。
- **设置与调度**：开关保存到 `userData/settings.json`，默认均为关闭，只有用户切换开关时写入；检查动作零写入。定期检查固定 6 小时、仅在应用运行期间存在，启动前退出即停止；定期/即时路径只发提示事件，不执行更新；无可更新项时不提示。
- **四态界面**：工具栏新增「检查更新」与更新角标；结果弹窗按 `update-available` / `up-to-date` / `not-checkable` / `failed` 分组，展示基线 → 目标、来源/引用/校验、备份提示、不可检查原因与 `E-SRC-*` 可读说明。本地来源明确引导 `update --check`。
- **确认执行**：单项和「全部更新」都走既有「预览 → 确认 → `update --yes`」链路；用户取消时执行通道零调用，单条失败继续其余条目，完成后刷新列表并重新检查。
- **测试**：新增 16 项（单元 12、契约 4），常规套件 503 → **519 项全绿**，慢测试 1 项通过；`smoke:gui` **13/13 通过**（检查入口、四态视图、本地来源引导、默认关闭、`settings.json` 写入）。
- **边界不变**：不新增指令（仍 16 条）与运行时依赖；不注册系统计划任务、登录项或启动项；应用自更新 M4a-2 仍未实现。

### M4a T1：Skill 更新检查能力（纯逻辑与只读探测）

- **四态判定**：新增 `gui/main/update-check/`，输出 `update-available` / `up-to-date` / `not-checkable` / `failed`；只有远端 git 且 `ref` 为 semver 正式版标签才进入检查，本地、归档、未知、分支/提交/非正式标签均返回带具体原因的 `not-checkable`。
- **比较规则**：`v1.2.0` 与 `1.2.0` 同口径；排除 prerelease 与非 semver 标签；远端最高正式版高于基线才报可更新。基线标签在远端消失时判 `not-checkable / baseline-tag-missing`，不伪造网络失败。annotated tag 的 peeled 引用用于确定目标 commit。
- **只读探测**：唯一命令为 `git ls-remote --tags --refs <url>`；60 秒超时、128 MiB 输出上限、`GIT_TERMINAL_PROMPT=0`；协议白名单与内核一致（`file://` 与非回环 `http://` 归 `E-SRC-009`），401/403 归 `E-SRC-010`，超时归 `E-SRC-006`，命令缺失归 `E-SRC-005`，其余远端失败归 `E-SRC-007`。含内嵌凭据的地址在启动子进程前拒绝。
- **数据与聚合**：逐项调用 `inspect <id> --json` 取登记来源，顺序检查避免并发触发限流；单条失败不阻断其余条目，失败项同时进入结果 `findings`。
- **测试**：新增 15 项（单元 11、契约 3、端到端 1），常规套件 488 → **503 项全绿**；端到端用真实内核子进程取 `inspect`，并断言检查前后索引与工作区文件逐字节不变。网络探测均可注入，T1 不依赖真实网络。
- **边界不变**：不新增指令（仍 16 条）与运行时依赖；不改 `update` CLI 契约；不接线 GUI/IPC（T2）；应用自更新 M4a-2 仍未实现。

### M4a T0：`update` 远端来源表述纠偏与测试补齐

- **纠偏**：契约 4.11 删除了「远端拉取属二期 / 返回 `E-SRC-001`」的占位说明；远端来源（`url` + `ref`）与本地来源（`location`）走**同一套重新获取路径**（克隆/下载口径、60 秒超时、128 MiB 上限、`E-SRC-*` 失败不写索引）；**本地来源的语法、参数、行为、输出载荷与退出码保持不变的声明显式保留**。
- **实现未改**：拆机实测确认远端 refetch **早已实现**（`readDeclaredSource` 把 `url` 折进 `location`，`acquireSource` 按 `looksRemote()` 走远端分支）；本批只更正 `source.ts` 的两处过期注释，**不改任何 refetch 逻辑**。
- **测试补齐**（此前该路径零覆盖）：新增 `tests/e2e/update-remote.test.ts`（独立子进程 + 回环 `git daemon`）——远端推进提交后 `update` 使**原件内容与索引指纹同时更新**；`--check` 不替换原件、不写索引；远端不可达时退出码 **4** 且索引与原件不变；契约正文无「二期/占位」残留。

## 0.1.2

内核正确性补丁：修复依赖环的结论错误、退出码档位错位与索引重复记录。**指令、选项、索引格式版本与 GUI 契约均未改变**。

### 【修复】

- **依赖环**：`scan` 现按 `DEP` 类返回退出码 **6**；环上每个技能各报 `E-DEP-003`，环外下游报 `E-VALIDATION-002`，环成员的缺失依赖仍报 `E-DEP-001`。修复前：环在结论中**不可见**、结论随技能数量**奇偶翻转**、且 `scan` 后紧随的 `validate` 会误报索引过期（`W-INDEX-002`）。
- **退出码归位**：技能元文件问题（含元文件 YAML 损坏）不再返回 **3**（索引损坏），按技能级返回 **1**；索引文件本身损坏仍返回 **3**（该档位的对象限定为索引或配置文件）。
- **索引完整性**：目录名与 `id` 不一致时不再产生重复记录与误报 `E-ID-002`；索引保持**物理唯一**（一个目录一条记录），逻辑错误照常显式报告（`E-ID-003` / `E-ID-002` / `E-FIELD-002`）。

### 【升级提示（重要）】

**`scan` 的退出码语义发生变化**：依赖退出码做流程判断的脚本，应改为读取结果封装的 `findings` 字段（契约本就如此要求），不要对 `scan` 退出码做硬分档——「扫描完成但环境存在不合格项」不等于「指令执行失败」，具体档位由派生规则决定（依赖环 → 6、技能级问题 → 1、索引/配置损坏 → 3）。

### 【规范】

四份规范补文（各附变更记录行）：依赖环的报告形态与环成员不叠加语义（skill-meta-spec 5.3）、运行期结论一致性（index-format 3.2）、索引不变量改为物理唯一 + 逻辑校验显式报错（index-format 2.3 / skill-meta-spec 5.2）、退出码派生规则的对象限定与扫描口径（result-and-exit-codes 5.2 / cli-contract 4.4）。

### 【不变】

指令数 **16**、选项集合、索引格式版本 **1**、JSON Schema 与 GUI 契约均未改变。

### 内核核查批次（三项正确性修复 + 四份规范补文）

- **依赖环（全量图定环 + 单调传播）**：`validateDependencies` 改为在**全部依赖声明**上一次性检测环（自环与长度 ≥ 2 的环），环上每个技能各带一条 `E-DEP-003`（target 为自身），环成员不再叠加 `E-VALIDATION-002`，环外依赖方带 `E-VALIDATION-002`，环成员的缺失依赖仍报 `E-DEP-001`；扫描的不动点因此恢复单调（只 true→false）。**修复前**：环在「当前轮可用图」上现算 → 环问题码下一轮消失 → 记录被翻回可用 → 振荡，索引结论与紧随的 `validate` 矛盾，且归因随技能数量奇偶翻转（3 个候选归咎 `b/c`、加一个无关 `d` 后归咎 `a`）；**修复后**：三次连续扫描结论一致、加/不加无关技能结论一致、紧随 `validate` 无 `W-INDEX-002`。`scan` 在环场景的退出码由 1 变为 **6**（`DEP` 类，按派生规则）。
- **退出码归位（对象限定）**：`exitCodeFor` 的第 3 步增加对象限定——技能元文件（`source === 'meta'`）的 `YAML` 问题不计入「索引或配置文件损坏」档；技能元文件坏 YAML 的 `scan` 由 3 改为 **1**，与 `validate` 一致；**索引文件本身损坏仍为 3**（反向断言保留）。
- **索引物理归属键**：扫描的 `existing` 改以**实际目录名**（由记录 `path` 推导）为键，一个目录恰好一条记录；`id ≠ 目录名` 只报 `E-ID-003` + `E-FIELD-002`，不再因键不一致在重扫时产生第二条同 id 记录与 `E-INDEX-002`/`E-ID-002` 噪声；两目录使用同一 `id` 时仍显式报 `E-ID-002` 且保留两条记录（物理唯一）。校验侧同时改以物理目录名为上下文、V-17 可达性按声明位置判断，消除「刚扫完就报结论过期」。
- **规范补文（四份）**：skill-meta-spec 5.2（物理唯一 + 逻辑校验显式报错）与 5.3（依赖环的报告形态）；index-format 2.3（不变量第 2 条改为「每个 Skill 目录恰好一条记录」）与 3.2（结论一致性）；cli-contract 4.4（扫描退出码按派生规则，不再另设「固定返回 1」）；result-and-exit-codes 5.2（第 3 步对象限定）。四份规范各附变更记录行。
- **测试**：新增 15 项（单元 9：环矩阵 5 + 退出码 4；端到端 6：全部走独立子进程），既有环断言按新语义重写；常规套件 471 → **486 项**全绿。
- **连带项**：bench 预期码表 `scan` 由 `[0,1,3]` 改为 `[0,1,6]`；修复后小档实测 `scan`=6 / `validate`=1 / `export`=0 / `startup`=0，`npm run bench` 通过；`baseline-0.1.0.json` **原样保留**（0.1.0 真实记录），报告注明退出码口径变化、性能数字无需重录。核查期的只读探针在最小复现全部转为正式用例后删除。

### 发布与发布后复核（v0.1.2）

- **发布**：tag `v0.1.2`（指向 `1e6dd47`）→ pack 流水线 run 39009045246 **Success**（四 leg 打包 + 版本守卫 + 校验清单 + 发布 + 资产级冒烟 + 历史版本提示），Release 为 **latest、非 draft、非 prerelease**，含 6 项资产（5 交付物 + `SHA256SUMS.txt`）。
- **发布资产携带修复后逻辑（本批关键，实测而非只看构建机）**：从新的 Windows 便携包解出内核（`--version` 输出 **0.1.2**）后跑两个最小场景——**含环夹具 `scan` 退出码 6**（`E-DEP-003@a`、`E-DEP-003@b`、`E-VALIDATION-002@c.dependencies`），紧随 `validate` 退出码 1 且**无 `W-INDEX-002`**；**坏元文件夹具 `scan` 退出码 1**（`E-YAML-001`）；**索引文件损坏仍为 3**（反向断言）。
- **macOS C 组复核**：从新 Release 回下载 `arm64.dmg` 与 `x64.dmg`、挂载后执行包内内核——两个架构 `--version` **exit=0（0.1.2）**、`init → scan` 闭环 **0/0**（probe run 39009838853）。
- **资产与页面**：`/releases/latest` 指向 v0.1.2；回下载 `portable.exe` 与 `arm64.dmg` 用 Release 上的 `SHA256SUMS.txt` 复算**一致**；**v0.1.0 的已知问题提示已改为指向最新补丁 v0.1.2**（幂等步骤：先剥离旧提示块再重写），`v0.1.1` 保持不动；Linux 侧由发布 job 的资产级冒烟（AppImage 结构与包内内核闭环）在同一次运行内覆盖。

## 0.1.1

补丁版本：修复 `v0.1.0` 在 macOS 上不可用的缺陷（见下）。Windows / Linux 产物不受该缺陷影响。

### 修复：macOS 内核 SEA 注入缺少 `--macho-segment-name NODE_SEA`（EX-13）

- **现象**：`v0.1.0` 的 macOS 包（arm64 与 x64）内嵌内核**一执行即被系统终止**（`--version` 退出码 **139 = SIGSEGV**），安装后所有依赖内核的功能（扫描 / 校验 / 导出 / 宿主分发等）全部不可用。
- **根因**：Node 官方 SEA 文档要求 macOS 把 blob 注入 `NODE_SEA` 段内的 `NODE_SEA_BLOB` 节（`postject --macho-segment-name NODE_SEA`），构建脚本漏了该参数。**与代码签名无关**——`codesign --verify --deep --strict` 判定签名有效、可执行位正常、裸 `node` 副本可运行、Windows/Linux 同流程正常，这些排除项由 CI 对照实验逐条给出。
- **修复实现**：新增 `scripts/sea-postject.mjs`（postject 参数唯一实现，仅 `darwin` 追加段名）并由 `scripts/build-kernel.mjs` 调用；`kernel/core/index/index.ts` 的 `TOOL_VERSION` 与三处 `package.json` 同步到 `0.1.1`（内核 `--version` 与索引 `tool_version` 随之更新）。
- **顺带修掉的版本号漂移**：`kernel/entry/cli.ts` 的 `--version` 曾写死字面量 `0.1.0`（版本号因此有两份来源），已改为只读 `TOOL_VERSION`；三处 `package.json`、`TOOL_VERSION` 与 CHANGELOG 顶部版本段的一致性由契约测试钉住（发布准备可自查）。
- **验证**（macos-15 arm64 与 macos-15-intel x64 各一遍）：A 构建期产物 `--version` **exit=0**、B electron-builder 打包后 `.app` 内内核 **exit=0**；**C `v0.1.0` 发布 dmg 内内核 exit=139（两个架构）**——即本补丁必须升级才能恢复 macOS 可用性。
- **影响面与升级建议**：**macOS 用户必须升级到 0.1.1**；Windows / Linux 用户不受该缺陷影响（同一代码路径实测正常），可按需升级。
- **登记**：Node 官方文档明示 SEA 在 CI 上仅测 macOS arm64，「x64 目前不支持并在测试中跳过」——本项目的 macOS x64 包属官方未支持形态，修复后实测可执行（登记为已知形态差异，不外推为官方支持）。

### 发布与发布后复核（v0.1.1）

- **发布**：tag `v0.1.1`（指向 `df07a46`）→ pack 流水线 run 38981945186 **Success**（四 leg 打包 + 版本守卫 + 校验清单 + 发布 + 资产级冒烟 + 历史版本提示步骤全绿）；Release 为 **latest、非 draft、非 prerelease**，含 6 项资产（5 交付物 + `SHA256SUMS.txt`）。
- **C 组复核（关键）**：从新 Release 回下载 `arm64.dmg` 与 `x64.dmg`、`hdiutil` 挂载后执行包内 `resources/kernel/skill-manager.exe`——**两个架构均 `--version` exit=0（输出 0.1.1）且 `init → scan` 闭环 0/0**（run 38982866885）。
- **资产与页面**：`/releases/latest` 指向 v0.1.1；回下载 `arm64.dmg` 与 `x64.exe` 用 Release 上的 `SHA256SUMS.txt` 复算**一致**；`v0.1.0` 的 Release notes 顶部已追加 EX-13 已知问题提示（旧版与旧 notes 保留）。
- **macOS 补录**：CI macOS 腿补跑三档曲线（`docs/benchmark/ci-smoke-0.1.1.json`）——N=1000 双线齐全、SEA 线 N=5000 齐全；**源码线 N=5000 在该 runner 上未产出数据**（按裁决降级为「N=1000 为准」并登记）；**SEA 启动开销档的峰值在 macOS 上不可靠**（进程约 84 ms，采样只取到 0.5 MB；该档位不参与阈值判定）——两点均按「不伪造、写清原因」登记。

### M3-T3 基线与报告（并定位/修复发布缺陷 EX-13）

- **基线入库**：`docs/benchmark/baseline-0.1.0.json`（schema `bench-baseline/1`）+ `docs/benchmark/report-0.1.0.md`；基线由 `scripts/bench/baseline.mjs` 从原始报告与 CI 烟测记录合成，**逐次样本随文档入库**（`build/` 不入库，只留中位数会让基线不可复核）；缺失项以 `gaps` 显式登记（macOS SEA 线，EX-13）。
- **阈值判定（N=1000）**：四项全部达标——`scan` 1.154 s（源码）/ 1.118 s（SEA）、`validate` 1.143 / 1.082 s、`export` 0.564 / 0.504 s、峰值 RSS **326.4** / 179.9 MB（阈值 30 / 30 / 15 s、512 MB）。**时间余量 26× 以上，内存余量 1.6× 是唯一需要持续盯的指标**；未触发任何优化项。
- **拐点判定（两轮独立复测）**：四个 scan 场景的单技能平均耗时 1000→5000 为 1.97×~2.45×（两轮一致）→ 按裁决口径归入 **`mild-superlinear`（轻微超线性观察项，不优化）**；`validate` / `export` 为 `none`（`export` 随规模下降），**内存无拐点**（每技能平均内存随规模下降）。判定由 `baseline.mjs` 计算（三条分支），报告与基线由契约测试同源比对。
- **覆盖率随档位上升**：源码线 `scan-cold` 0.44 → 0.71 → 0.78、SEA 线 0.29 → 0.50 → 0.62，支撑「规模工作占主导」；SEA 线阶段归集整体偏低（打包后库帧名改写）→ 阶段构成只在同线内比较。
- **EX-13 定位并修复（发布级缺陷）**：CI 对照实验（macos-15 arm64 / macos-15-intel x64）给出决定性证据——构建期 SEA 内核执行 `--version` **退出码 139（SIGSEGV）**，而**签名校验通过**（`codesign --verify --deep --strict` 有效）、可执行位正常、裸 `node` 副本可运行，故不是签名/授权问题。根因是 **Node 官方文档要求的 macOS 注入参数缺失**：macOS 必须把 blob 注入 `NODE_SEA` 段的 `NODE_SEA_BLOB` 节（`postject --macho-segment-name NODE_SEA`），构建脚本漏了该参数。修复：新增 `scripts/sea-postject.mjs`（postject 参数唯一实现，仅 darwin 加段名）+ `build-kernel.mjs` 改用它 + 单测；**验证矩阵：A 构建期产物与 B electron-builder 打包后 `.app` 内内核在 arm64 与 x64 均 `exit=0`；C `v0.1.0` 发布 dmg 内内核 `exit=139`（两个架构）——已发布包的内嵌内核不可执行，是否发 `v0.1.1` 补丁由维护者裁决**（M2 只验过签名可读与架构、从未在 macOS 上执行内核）。`bench.yml` 已解禁 macOS 双线，修复后首个 run 38942732908 三平台双线全绿（macOS SEA 首次取得真机数据：`scan-cold` 329 ms / 77 MB）。
- **附带登记**：官方文档明示 SEA 在 macOS 只测 arm64、x64「目前不支持并在测试中跳过」——本流水线仍产出 x64 dmg 且其内核同样受 EX-13 影响（修复后 x64 实测可执行）；macOS 的取证工作流（`probe-ex13.yml` + 两个探针脚本）保留为后续发布物复验入口。

### M3-T2 双线三档跑测（本机全矩阵 + CI 三平台烟测）

- **SEA 线取发布资产**（不是本机构建）：从 `v0.1.0` Release 的 `skill-manager-0.1.0-portable.exe` 解包出 `resources/kernel/skill-manager.exe`（`7z x`：SFX → `app-64.7z` → 内核），资产 SHA256 与同 Release 的 `SHA256SUMS.txt` **一致**；内核 SHA256 `62fa8785…`、87,928,320 B。发布资产由 CI 的 Node 22 打包、本机构建是 Node 24（内嵌运行时不同），故基线以发布内核为准，来源写进报告的 `kernel_provenance`。
- **BX-01 关闭（SEA 线剖面）**：单文件可执行**不接受** Node 命令行参数（`--cpu-prof` 被 CLI 判 `E-INPUT-002`、退出码 2、无剖面），但 **`NODE_OPTIONS` 生效**——实测产出含内核帧的剖面，SEA 线 31 个剖面全部落地。**副产品**：SEA 是打包产物、库内部帧名被改写，`parse_yaml` 归集系统性偏低（同档 N=1000 `scan-cold`：源码线 257 ms vs SEA 线 25 ms）→ 跨线只比总墙钟与峰值内存。
- **本机全矩阵**（Windows 11 / Node v24.14.1 / runs=3；N=5000 显式 `--runs 3` 以给拐点判定提供中位数）：源码线 `scan-cold` 100/1000/5000 = 329 / 1154 / 11370 ms，SEA 线 253 / 1118 / 12747 ms；`startup` 源码 193 ms vs SEA **85 ms**。**N=1000 阈值初步对照全部达标**（`scan` 1.15 / `validate` 1.14 / `export` 0.56 s、峰值 RSS 326.4 MB，阈值 30 / 30 / 15 s 与 512 MB）。拐点预判：`scan-cold` 单技能 1000→5000 源码线 1.97×、SEA 线 2.28×（阈值 2×）→ **临界，交 T3 复测判定**。
- **归集覆盖率随档位上升**：源码线 `scan-cold` 0.44 → 0.71 → 0.78、SEA 线 0.29 → 0.50 → 0.62（验证「规模工作占主导」）。
- **CI 三平台 N=100 烟测**（`.github/workflows/bench.yml` + `scripts/bench/annotate.mjs`，run 38938465443 三 leg 全绿）：Linux / Windows / macOS 各跑双线（macOS 暂只源码线，原因见下）；**两条 T1 遗留的真机路径就此验证**——Linux 直读 `/proc` 的 `VmHWM`（`scan-cold` 376 ms / 124 MB）、macOS `ps` 重采样（438 ms / 110.7 MB）；结论以运行页注解公开、原始 JSON 随 artifact 留存，**性能数值不作门禁**（采样失败才红）。
- **发现发布缺陷 EX-13**：**macOS arm64 上本流水线产出的 SEA 内核一执行就被系统 SIGKILL**（进程 close 无退出码 → 记为 -1，shell 侧实测 137）；同 runner 源码线正常、Linux/Windows 的 SEA 正常、显式赋可执行位仍复现。Node 官方 SEA 文档对 macOS 只要求 `codesign --sign -`，故候选方向是 arm64 代码签名/授权完整性，需对照实验定位。**影响面**：`v0.1.0` 的 macOS arm64 dmg 内携带的内核可能是同一问题（M2 只验证过签名可读与架构，从未在 macOS 执行过内核）——这是本次烟测最重要的产出。M3 不修（属发布链路），登记待另立批次；macOS 的 bench 腿暂只跑源码线并保留取证步骤。
- **失败自证通道**：runner 接住子进程 `error` 事件、剖面解析异常与整线中断（写 `failure-<form>.txt`），注解脚本把诊断原文打成 `::error::`——macOS 首跑失败不可匿名定位（日志需登录、注解只有「exit code 1」）的教训就此闭环，本轮即靠它定位到「SEA `init` 被信号终止」。

### M3-T1 测量器（独立进程、采样会话、阶段归集、固定 JSON）

- **三平台采样器**（`scripts/bench/rss.mjs`）：Linux 由父进程直接读 `/proc/<pid>/status` 的 `VmHWM` 与 `/proc/<pid>/stat` 的 utime+stime（零外部命令）；macOS 用一个长驻 `sh` 循环读 `ps -o rss=,time=`；Windows 用一个长驻 PowerShell 读 `PeakWorkingSet64` 与 `TotalProcessorTime`。三条硬规则：只在**存活期**采样；**READY = 首次取到合法值（> 0）**；直到退出都没取到合法值即判**测量失败**并记原因——**绝不用 0 兜底**（调研踩到的两个坑即由此消除）。
- **会话与预热（实测校正）**：逐场景启动采样器会把短场景整段漏掉——Windows 上 PowerShell 冷启动约 300 ms，而 N=100 的 `scan` 只有约 200 ms（实测报 `no-sample-before-exit`）。改为**会话级助手 + 预热采样**（stdin 收 `<pid> <迭代数>`，采完回报 `END <pid>`）；等待规则为「存活期一直等 / 退出后只等 2 s 宽限 / 绝对上限兜底」——最后一条是实测踩到「助手卡死把测量挂住」后加的。
- **阶段归集**（`scripts/bench/profile-split.mjs`）：源码线用 `node --cpu-prof` 采集（不改内核，只加 Node 侧启动参数），按调用栈自叶向根归到六阶段（读目录 / 读元文件 / YAML 解析 / 逐文件摘要 / 序列化 / 原子写）+ `other`，并给出**未归集占比**与索引写入延迟（序列化 + 原子写）。真机冒烟显示 N=100 的覆盖率只有 0.02~0.19（剖面含进程启动与模块加载），故报告规范要求必须给出覆盖率，不得只贴六阶段数字。
- **fs 观测**（`scripts/bench/fs-watch.mjs`）：判定改为**尺寸或 mtime 变化**，而不是「尺寸与前一次相同」——冷态下工作区已有一个空索引（`init` 产物），按「首次出现」会立刻误报；热态重写是逐字节相同的文件，只看尺寸则完全观测不到。
- **编排 CLI**（`scripts/bench/runner.mjs`，`npm run bench`）：夹具 → 工作区 → 逐场景 spawn 独立进程 → 采样 → 汇总 → 固定 JSON（`bench/1`，含环境块、档位、线、冷热、逐次明细、阶段、fs 观测、退出码）；`--dry-run` 只打印矩阵。
- **两处实测口径校正**：① **冷态不能删索引**——索引文件是「工作区已初始化」标记，缺它时 `scan` 直接判 `E-ENV-001`，故冷态构造改为「删索引 → 重新 `init` → 扫描」（空索引首跑）；② **退出码不能一律要求 0**——夹具刻意含不合格项，`scan` / `validate` / `export` 非 0 是预期语义，判定改用**预期码表**（实测 `scan` 3、`validate` 1、`export` 0），`export` 目标同时收敛到工作区之内（越界会被 `E-PATH-001` 拒绝）。
- **真机冒烟**（本机 Windows / 源码线 / `--n 100 --runs 2`）：`startup` 207 ms / 77.9 MB、`scan-cold` 347.5 ms / 97.1 MB、`scan-hot` 393 ms / 112.7 MB、`validate` 355.5 ms / 105.2 MB、`export` 278.5 ms / 92.5 MB——采样链路真实取到峰值内存与 CPU 时间，退出码全部落在预期码表内。
- **测试与测试口径**：新增 26 项（单元 24 / 契约 2，含真实子进程的采样端到端断言）；同时按裁决把 T0 的 N=5000 落盘用例**隔离为慢测试**（`tests/slow/`，`npm run test:slow`）——常规套件 432 → **458 项**（约 11 s），慢测试 1 项单独执行，规模验证不删也不降级。
- **登记为观察项（不改内核）**：① 元文件 YAML 错误按 `YAML` 类别落到退出码 3（结果规范 §5.2 第 3 步限定「对象为索引或配置文件」）；② 标识与目录名不一致的技能在索引里出现两条记录（`scanWorkspace` 以目录名删除、以记录 id 为键）。

### M3-T0 性能压测夹具与阈值登记（先文档后实现）

- **阈值登记（文档前置）**：需求 9.4.3 的 N = 1000 档收紧为 `scan` ≤ 30 秒、`validate` ≤ 30 秒、`export` ≤ 15 秒、内存峰值 ≤ 512 MB，并新增说明第 4 条——写明**未测先收紧**、首测接近阈值只登记优化项而**不得放宽**，附**改前值 / 改后值 / 依据**表与沿革（`scan` 与内存曾为 30 秒 / 512 MB → 2026-10-15 批次放宽为 60 秒 / 1.5 GB → 本批次收紧回更严量级）。
- **阈值单一来源 + 契约锁**：`scripts/bench/thresholds.mjs` 集中三档取值（含 `gating` 标记：N=1000 硬判定、N=100 烟测、N=5000 只记录）；契约测试逐项比对需求 9.4.3 表与该常量——**任一侧放宽或分叉都会直接变红**。
- **夹具生成器**：`scripts/bench/fixture.mjs`（结构先行的纯计划 `planFixture` + 落盘 `writeFixture`，确定性 `mulberry32`、精确配额 `allocateExact`、冻结的 `DISTRIBUTION`）与 `scripts/bench/fixture-cli.mjs`（`npm run bench:fixture`）。夹具默认落系统临时目录，**不入库**（`.gitignore` + `git check-ignore` + 仓库内无残留三重断言）。
- **无效样本按内核实测定型**：初版设计的「无效四类」与内核不符——「未知字段」只是警告（`W-FIELD-004`，记录仍判 `ok`）、元文件 `version` 内核**不做格式校验**、「资产缺失声明」在落位复制期才报告——据实测改为**五类**（`E-FIELD-001` / `E-STATUS-001` / `E-ID-003` / `E-HASH-002` / `E-YAML-001`），未知字段降为**合法带警告样本**（5%）。分布：87% 合法 + 5% 合法带警告 + 8% 无效（精确配额），并新增悬空依赖（5%）与有界级联维度。
- **实测发现：依赖可用性是不动点迭代，级联会扩散**。初版构造（依赖目标回绕窗口 + 依赖成环）下 100 个技能中 **48 个**被判无效——起因是少数直接无效样本加上**环检测**命中节点逐轮扩散；「无依赖的技能被判依赖未满足」的怪象追根到初始轮次的环判定（环问题码只在初始轮次产生，而报告只保留**收敛轮**的问题清单）。夹具因此改为 **DAG（依赖一律指向更小序号）＋排除无效目标＋有界级联（深度 3 链 + 2 个叶子依赖方）**，使有效无效数可按序推导并与内核判定**逐条相等**（N=100 18/18、N=1000 134/134，零差异）。该现象登记为 M3 观察项（不改内核行为，M3-R5）。
- **规模实测**（本机 Windows / Node v24.14.1）：N=100 → 298 文件 / 3.7 MiB / 112 ms；N=1000 → 2968 文件 / 32.8 MiB / 1083 ms；**N=5000 → 14840 文件 / 159.7 MiB / 10.6 s**（设计预判 ≤ 14 s 达成）。文件数按公式 `3N − 2 × 内容缺失样本数` 逐档核对一致。
- **测试**：新增 13 项（单元 9 / 契约 4）——确定性、配额分布、有效无效推导、五类问题码与警告锚点、N=1000 与 N=5000 落盘规模、内容差异、命令行失败路径（独立进程断言）、阈值一致性、收紧登记、冻结分布、不入库；总数 420 → **433 项**全绿。**成本登记**：N=5000 落盘用例约 22 s，全量套件由约 10 s 增至约 30 s（CI 不跑该档）。

## 0.1.0

首个公开版本：Skill 元信息管理器的核心功能与三平台分发链路就绪。

### 功能概览

- **指令面**：契约清单的 16 条指令全部实现（环境与配置、登记与查询、生命周期、校验与依赖、备份导出导入与恢复），并提供 `--host <宿主>` 宿主分发入口（与一期 `--target` 语义正交）。
- **契约面**：五份规范文档与五份 JSON Schema（元数据、索引格式、指令契约、结果与退出码、宿主注册表），字段一致性由契约测试守住。
- **内核**：TypeScript，零界面依赖，编译为独立可执行文件随应用分发；宿主适配层含注册表、渲染层与适配器三层。
- **桌面外壳**：Electron + Vue 3，覆盖仪表盘、详情、安装、校验报告与确认流程。
- **工程链路**：GitHub Actions 门禁（Windows / Linux × 声明 Node 版本，`verify.yml` 为唯一实现）＋ 三平台打包矩阵（Windows nsis 与便携版、Linux AppImage、macOS dmg ×2）＋ `SHA256SUMS.txt` 校验清单。

### 平台与安装说明

| 平台        | 产物                                                                                           | 说明                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Windows x64 | `skill-manager-0.1.0-x64.exe`（nsis 安装包）、`skill-manager-0.1.0-portable.exe`（便携单文件） | 双击安装或直接运行                                                                                  |
| macOS arm64 | `skill-manager-0.1.0-arm64.dmg`                                                                | 打开 dmg 拖入「应用程序」                                                                           |
| macOS x64   | `skill-manager-0.1.0-x64.dmg`                                                                  | 同上（Intel 机器）                                                                                  |
| Linux x64   | `skill-manager-0.1.0-x86_64.AppImage`                                                          | 赋可执行位后直接运行；需 FUSE（Ubuntu 24.04 起包名 `libfuse2t64`），或 `--appimage-extract-and-run` |
| 全部        | `SHA256SUMS.txt`                                                                               | `sha256sum -c` 或 `shasum -a 256` 校验                                                              |

- **未签名交付**：macOS 与 Linux 产物**不携带开发者身份证书、不做公证**。macOS 首次打开会被 Gatekeeper 拦下（预期行为）：右键点应用 → 打开，或 `xattr -cr "/Applications/skill-manager.app"`。Apple Silicon 的产物按平台要求保留 ad-hoc 签名（x64 为完全未签名）。
- **glibc 下界**：Linux 产物以 ubuntu-24.04 为打包基座，要求目标机 glibc ≥ **2.39**；更老的发行版请从源码使用（内核只需 Node ≥ 22）。

### 已知限制

- 代码签名与公证尚未接入（证书就位后由预留的签名 job 接管，涉及 `APPLE_CERTIFICATE` 等五个 secrets）。
- Cursor 宿主的标准外字段接受度仍待实测，其渲染保持保守裁剪（不透明传）。
- `AGENTS.md` 合并策略未定稿：`agents-md` 只产出待合并片段、不落盘。
- macOS 完整 GUI 交互冒烟不在 CI 口径内，按设计留在本地执行。

### 变更明细（工程批次）

#### M2-T3 发布机制（版本守卫、资产归位与校验清单、gh 幂等发布）

- **版本守卫**（`scripts/release-guard.mjs`）：tag 号 = CHANGELOG 顶部版本段 = 根与 gui 的 `package.json` 版本，三方一致才发布；同时把该版本段写成 Release notes。**严格自测**：临时 tag `v0.1.0-t3run1` 的矩阵四 leg 全绿后，release job 因守卫中止并公开列出三处不一致，**未创建任何 Release**。
- **资产归位与校验清单**（`scripts/release-publish.mjs`）：交付目录必须恰好含 5 个产物，生成 `SHA256SUMS.txt`。自测即抓出真实差异：Linux 产物实名 `skill-manager-0.1.0-x86_64.AppImage`（`${arch}` 在 Linux 取 `x86_64`），已修正清单与 README / CHANGELOG / 设计表述。
- **发布与幂等**：`gh` 参数按官方手册核对（`create`：`--title/--notes-file/--verify-tag/--latest`；`edit`：`--title/--notes-file/--latest`；`upload`：`--clobber`）；已存在则 edit + 覆盖资产，不打 prerelease 标记；仅 release job 具 `contents: write`。
- **口径修正**：Release notes 写在交付目录之外（写进去会被归位检查判为非交付物）；汇总产物改用 `actions/download-artifact@v8`（v6 面向 Node 20）。
- **干跑自测已全绿**（临时 tag `v0.1.0-t3dryrun5` → run 38893295554，**Success 5m12s**：四个打包 leg + release job 全绿）：资产清单（5 个实名）与 `SHA256SUMS` 以运行页注解公开输出，`--dry-run` 只打印 gh 命令、**未创建任何 Release**（复核：`/releases` 为空、`/releases/tags/<tag>` 404）。此前一次干跑被 mac-x64 的 dmg 构建抖动（`hdiutil: couldn't eject "disk2" - Resource busy`，登记 **EX-10**）打断，重跑即恢复，判定为非确定性失败。临时分支与全部临时 tag 已删除。
- **真实发布完成**（`v0.1.0`，2026-10-16）：tag `v0.1.0` → run 38908935080 **Success**；Release 为 **latest、非 prerelease、非 draft**，含 5 个交付资产与 `SHA256SUMS.txt`；**下载后复核**（Release 页公开下载 arm64 dmg 152 MB 与 x86_64 AppImage 164 MB，用 Release 上的校验清单本地复算）**逐字节一致**。发布过程命中并修掉两处真实缺陷：① 上传资产给裸文件名 → gh 报 `no matches found`（改为「汇总目录 + 文件名」路径）；② 新建的 Release 处于 **draft**，`--latest` 被 GitHub 以 422「Latest release cannot be draft or prerelease」拒绝 → 发布流程收敛为 `create → publish(draft=false,prerelease=false) → edit(title/notes/latest) → upload(--clobber)` 四步（幂等，复跑同 tag 亦收敛）。

#### M2-T4 冒烟验收收口（M2 收官）

- **Release 资产级冒烟**（验证发布物而非构建目录）：从 Release 回下载 5 个资产并用其自带的 `SHA256SUMS.txt` 复算——一致；AppImage 解包（12 目录 / 31 文件）确认 `resources/kernel/skill-manager.exe` 为 **ELF64 x86-64**、`resources/app.asar` 与 `AppRun` 就位；两 dmg 解包确认 `.app` 结构与 `Contents/Resources/kernel/skill-manager.exe` 的 **Mach-O 架构分别为 arm64 与 x86_64**；`Info.plist` 复核 `CFBundleShortVersionString=0.1.0`、`LSApplicationCategoryType=public.app-category.developer-tools`、`LSMinimumSystemVersion=13.0`；AppImage 的 `.desktop` **无 `Maintainer=` 行**（发布物上复核 `not-consumed` 结论）。
- **自动化冒烟写入发布流程**：发布 job 新增「Release 资产级冒烟」步骤——回下载 → `sha256sum -c` → AppImage 结构与包内内核最小闭环（`init → scan → list --json`）→ `xvfb` GUI 尝试（跑不通按设计 8.3 降级口径以注解登记，不写「未验证」）；下次发布自动执行。
- **执行受限于宿主环境**：本机为 Windows 且无 WSL、无已登录浏览器会话，无法执行 Linux/macOS 二进制或触发 `workflow_dispatch`——相关项按降级口径登记（环境限制结论 + 自动执行路径 + EX-08），不计为「未验证」。
- **验收映射与口径单列**：M2 七条逐条回填证据（设计 8.6 的 T4 登记表）；三种口径单列——未签名交付（`unsigned` / `adhoc` 三态，ad-hoc 为 arm64 平台要求）、CI 环境差异（FUSE / `--appimage-extract-and-run` / `--no-sandbox`）、降级项（完整 GUI 交互留本地、dispatch 首跑待会话）。
- **README**：下载入口改为指向 [`/releases/latest`](https://github.com/LuZhong-Li/skill-manager/releases/latest) 并标注当前版本 v0.1.0，安装步骤与资产形态一致。
- **M2 收官**：T0（图标管线）→ T1（构建配置）→ T2（矩阵与真机验证）→ T3（发布机制）→ T4（冒烟验收）全部完成；`v0.1.0` 已发布。

### 修复：EX-07（mac-arm64 打包失败）——内核 SEA 补齐 macOS 签名步骤 + 失败自证

**根因**：Node 官方单文件可执行（SEA）流程要求 macOS 上在 `postject` 注入前后处理签名——注入会改动 Node 运行时副本的 Mach-O 内容、使原签名失效，因此需先 `codesign --remove-signature`、注入后再 `codesign --sign -`（ad-hoc）重建有效签名。`scripts/build-kernel.mjs` 此前缺这两步：x64 宽容通过，而 arm64 在打包期签名校验失败（退出码 1，且命令无任何输出，故早前只能看到「见 job 日志」）。依据：nodejs.org 的 single-executable-applications 文档。

#### 修复

- **`scripts/sea-signing.mjs`（新增，纯函数 + 可注入执行器）**：`codesignArgs(action, executable)` 负责参数拼装（remove → `--remove-signature`；sign → `--sign -`）；`runCodesignAction()` 执行单步，**非 macOS 直接返回 `applied: false` 且不调用任何外部命令**；`removeMacSignature()` / `adHocSignMac()` 供构建脚本按序调用。
- **`scripts/build-kernel.mjs`**：在「复制 Node 副本」之后、「postject 注入」之前调用 `removeMacSignature`；注入之后调用 `adHocSignMac`。Linux / Windows 路径不变（两步均为空操作，本机 Windows 上 `build:kernel` 与 `smoke:kernel` 复跑通过）。
- **macOS 真机断言**：pack 的 mac leg 在产物结构校验里增加「包内内核二进制必须带有效签名」的可失败断言（`codesign -dv "$app/Contents/Resources/kernel/skill-manager.exe"`），并以注解公开签名信息——同类回归会直接让 leg 变红而不是留下哑失败。

#### 诊断增强（防止再次盲飞）

- **阶段自证**：`scripts/pack.mjs` 每步开始/结束写 `build/desktop/pack-stage.txt`（本次运行重开该文件），失败注解带出**最后阶段**。
- **打包器完整输出落盘**：electron-builder 的输出以 tee 方式同时进 `build/desktop/pack-debug.log`；Windows leg 的捕获输出同样追加到该日志。两个文件都在诊断产物（`build/desktop/**`）范围内。
- **注解回落**：打包失败时注解依次取「输出关键词命中行 → 打包器日志末 8 行」，并附退出码、输出字节数与最后阶段——未登录会话也能从运行页定位失败点。

#### 可执行名核查（按提示词要求评估，决定不改）

内核产物在三平台同名 `skill-manager.exe`。核查结论：**codesign 按文件内容（Mach-O）判定，不看扩展名**，本次修复后 arm64 包内该文件可正常读出 ad-hoc 签名（真机注解可证）；GUI 主进程固定按 `resources/kernel/skill-manager.exe` 解析路径，改名会牵动 GUI 路径、CI 产物命名与文档。故本批**不改名**，登记为开放项 EX-09（命名规范化属额外变更，收益仅为命名习惯）。

#### 测试（400 → 406 项；单元 +5 / 契约 +1）

- 单元 `tests/unit/sea-signing.test.ts`（5 项）：参数拼装（remove / sign / 未知动作）；非 macOS 不调用外部命令（`calls === 0`）；macOS 上按参数各调用一次；三类失败（非零退出带 stderr、非零退出但无输出写「(无输出)」、命令无法启动与退出码缺失）；构建脚本的调用顺序断言（`remove` 早于 postject 注入、`sign` 晚于注入）。
- 契约 `tests/contract/ci-workflows.test.ts`（+1 项）：pack 失败路径必须引用 `pack-stage.txt` 与 `pack-debug.log`，且 mac leg 对包内内核有 `codesign -dv` 真机断言与错误级注解。

#### 真机口径修正（同一批次内发现的第二处问题）

SEA 签名修复后重跑矩阵（run 38886354657）：mac-arm64 的**打包已经成功**（阶段文件显示已到「未签名断言」阶段），但 leg 仍红——原因是**断言口径过严**。真机实测：mac-x64 的产物**完全未签名**，而 mac-arm64 的产物带 **ad-hoc 签名**（Apple Silicon 上可执行文件必须至少带 ad-hoc 签名才能运行，属平台要求）。

- **`scripts/unsigned-check.mjs`**：判定扩展为三态可辨——`unsigned`（完全未签名，`code object is not signed at all`）、`adhoc`（`Signature=adhoc` / `flags=0x2(adhoc)`）、`signed`（含 Developer ID 等身份签名）。**`unsigned` 与 `adhoc` 均通过**，`signed` 与 `unknown` 仍拒绝；断言文案改为「应为『未签名或仅 ad-hoc』」。
- **`assert-unsigned.mjs`**：输出带上判定（`（判定：unsigned|adhoc）`），pack 的注解直接引用该文本——**交付口径「未使用开发者证书签名与公证」在运行页即可读**。
- 口径澄清（并回写设计 4.5 / 7.2）：本项目的「未签名交付」= 不携带开发者身份证书、不做公证；**ad-hoc 是 arm64 的运行前提，必须保留**，不是「被签名交付」。

#### 验收状态

- 本机：**408 项测试全绿**、`check` / `typecheck` / `lint` / `format:check` 零告警；`build:kernel` 与 `smoke:kernel` 通过（Windows 上签名步骤为空操作的实证）。
- 矩阵（tag `v0.0.1-t2run5` → run 38887140603）：**四 leg 全绿** —— Windows 238 MB、Linux AppImage 156 MB、macOS x64 dmg 149 MB、**macOS arm64 dmg 145 MB**；验证 job 两条亦绿。真机注解：mac-arm64 与 mac-x64 的包内内核均可读出签名（`EX-07 内核 ad-hoc 签名`），未签名断言分别判定 `adhoc` 与 `unsigned`，两端 `iconutil` 均产出 79768 字节 icns。**EX-07 关闭**。

### 工程：M2-T2 打包矩阵（verify.yml 抽取、pack.yml 四 leg、真机验证与 fail-fast 探测）

M2 的第三个实现批次：把校验步骤收敛为唯一实现，并让打包按 tag 触发四平台矩阵。**未新增指令与选项**（16 条不变）、未新增项目依赖（Linux leg 在 runner 上安装 `libfuse2t64` 属 CI 环境依赖，非项目依赖）。

#### 变更

- **`verify.yml`（可复用，`workflow_call`）**：现有 `ci.yml` 的 `prepare` + `verify` 两个 job 原样抽出（步骤名称与顺序逐条不变）；`ci.yml` 改为 `uses: ./.github/workflows/verify.yml`，其触发与并发口径不变，只保留触发层。
- **`pack.yml`（新增）**：触发 tag `v*` 与 `workflow_dispatch`（可选 `platforms` / `arch` 输入）；`verify` 作为打包前门禁（消费同一份 `verify.yml`）；四 leg 矩阵 `windows-latest` / `ubuntu-24.04` / `macos-15`（arm64）/ `macos-15-intel`（x64），`fail-fast: false`、任务级 60 分钟上限；concurrency 仅对手工/分支运行取消旧运行（tag 运行不打断）；每 leg 打包 → 上传产物（命名含平台 leg 与 run id）→ 失败时另附诊断产物。
- **真机结论以注解输出**：mac leg 的 `iconutil` 产物与 `codesign` 未签名断言、linux leg 的 `maintainer` 消费实测，均以 `::notice` 写到运行页注解——**未登录会话也能读到运行结论**（本批的诊断通道，也是后续无人值守排查的基础）。
- **失败可诊断**：三个打包步骤把失败原因（关键词命中行，或末 3 行回落）折进 `::error` 注解，避免「红 leg 但看不到原因」。
- **Linux 打包依赖**：runner 镜像未预装 FUSE 2，AppImage 工具链需要它——leg 内显式 `apt-get install libfuse2t64`（设计 7.1 的处置顺序）。
- **配置修复**：新增 `linux.executableName: skill-manager`——electron-builder 会从包名 `@skill-manager/gui` 推导可执行名（`@skill-managergui`），AppImage 目标据此报「含非法字符」而构建失败。
- **`linux.maintainer` 注解回写**：T2 真机实测结论为 **not-consumed**（AppImage 不消费该字段），按裁决 ⑨ / T1 口径保留字段并注明用途（deb / rpm 等形态才消费）。

#### 实测结果

| 运行                                        | 结论                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| run 38869061706（ci.yml 抽取后）            | **Success 1m 57s**；job 呈现为「校验 / 读取版本声明」「校验 / 验证（…）」，步骤序列由契约测试逐条钉住                                                        |
| run 38869913530（tag 首跑）                 | Failure：Windows ✓ 238 MB、mac-x64 ✓ 148 MB；Linux ✗、mac-arm64 ✗                                                                                            |
| run 38871300587（修复后重跑）               | Failure：Windows ✓ 238 MB、**Linux ✓ 156 MB AppImage**、mac-x64 ✓ 148 MB、mac-arm64 ✗（517 MB 诊断产物）——三项真机注解全部产出                               |
| run 38869954307（fail-fast 探测，临时分支） | linux leg 按探测步骤红，**同一运行里 Windows 与 mac-x64 仍产出并上传产物**（`fail-fast: false` 实证）；探测分支与四个临时 tag 已删除，正式工作流不含探测代码 |

#### 本批发现并修复的缺陷（如实登记）

1. **job 级 `if` 引用 `matrix`** → GitHub 判 `Invalid workflow file`（run 38868806071）。改为步骤级过滤；并新增契约断言禁止任何 job 级 `if` 出现 `matrix.`。
2. **契约测试使用 `any`** 触发 `@typescript-eslint/no-explicit-any`，**本地门禁因「只看输出末行」漏看、由 CI 抓到**。测试改具名接口解析 YAML；方法学教训：门禁以退出码判定，不以末行判定。
3. **AppImage `executableName` 非法字符**（见上）。
4. 本地编辑工作流文件时用 shell 写导致工作副本 CRLF，触发本地 `format:check` 失败（仓库 blob 仍为 LF，CI 不受影响）；已用格式化工具恢复工作副本为 LF，并复用既有 EOL 结论。

#### 测试（389 → 400 项；单元 +2 / 契约 +9）

- 单元：`maintainer` 单侧判定与 CLI（只给 `--with` 时结出 consumed / not-consumed）。
- 契约（`tests/contract/ci-workflows.test.ts`，7 项）：校验命令只在 `verify.yml` 一处（逐行精确比对，避免 `npm run build` 误命中 `npm run build:kernel`）；`verify.yml` 只被调用触发且步骤名称/命令/顺序与抽取前逐条一致、矩阵与超时不变；`.nvmrc` 同源口径不变；`ci.yml` 触发与并发不变；`pack.yml` 只跑打包不发布（无 `gh release`、只读权限）；四 leg 矩阵与 `fail-fast: false`、tag 不取消旧运行、mac/linux 真机证据步骤与注解；三个工作流动作主版本同口径。另有 2 项回归断言：job 级 `if` 不得引用 `matrix`、`platforms` 过滤必须落在步骤级（含上传步骤）。

#### 未做 / 遗留

- **EX-07**：mac-arm64 leg 失败原因待取证（同配置 mac-x64 全绿，已排除配置与依赖层面原因；被包装命令本次无输出，疑 runner 侧中断或 OOM），四 leg 首跑「全绿」这条验收因此未闭合；
- **EX-08**：`workflow_dispatch` 首跑与输入行为待有已登录会话时补测；
- T3 发布（EX-01 CHANGELOG 定版、版本守卫、`gh` 参数核对、SHA256SUMS、EX-02 真实 tag 授权）与 T4 冒烟验收收口。

### 工程：M2-T1 构建配置（mac/linux 段、未签名断言、打包入口与 README）

M2 的第二个实现批次：让打包链路具备 macOS 与 Linux 目标，并把「未签名交付」从默认结果变成被检查的事实。**未新增指令与选项**（16 条不变），**未新增依赖**（全部用既有工具链与自实现脚本）。

#### 变更

- **配置增量（`gui/packaging/electron-builder.yml`）**：新增 `mac` 段（`target: dmg`、`icon: packaging/icon.icns`、`category: public.app-category.developer-tools`、产物名含 `${arch}`、**不出现任何签名键**）与 `linux` 段（`target: AppImage`、`icon: packaging/icons`、`category: Utility`、`synopsis` / `description`、`maintainer: skill-manager <3338004299@qq.com>`——沿用仓库既有提交身份，不新造个人信息）；`win` / `nsis` / `portable` 段与 `files` / `extraResources` / `electronLanguages` / `directories` 共享骨架未动，三平台段同层组织、共享字段不复制。
- **签名预留（仅文档，不实现）**：配置注释登记五个官方 secrets 名（`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`）与「secrets 存在才运行的签名 job」说明；未签名口径以环境变量 `CSC_IDENTITY_AUTO_DISCOVERY=false` 表达（不写配置键，跨 electron-builder 主版本成立）。
- **打包入口**：`scripts/pack-plan.mjs`（纯函数计划：图标链 → 界面构建 → electron-builder → 未签名断言；平台分支、架构开关、环境变量、只打本平台包）与 `scripts/pack.mjs`（执行器，参数与计划错误给出可读信息并以非零退出）；`gui/package.json` 新增 `pack:mac` / `pack:mac:x64` / `pack:linux`（与既有 `pack:win` 并列，Windows 入口不变）。非 macOS 宿主上 `build:icon:icns` **跳过且不中断**，提示原因。
- **未签名断言**：`scripts/unsigned-check.mjs`（`codesign` 输出解析与执行器可注入，三口径：未签名 → 通过、已签名 → 失败、无输出 → 按无法确认失败）+ `scripts/assert-unsigned.mjs`（事后复核入口）；mac 打包后自动执行，缺 `.app` 或产物目录缺失都明确失败。
- **`maintainer` 消费实测**：`scripts/maintainer-probe.mjs`（目录树文本扫描 + 三态判定 consumed / not-consumed / ambiguous）与 `scripts/check-maintainer.mjs`（参数解析与结论输出）。
- **README**：新增「跨平台分发与安装」——产物清单与 Releases 下载入口（含 Windows 两形态与 `SHA256SUMS.txt`）、macOS 未签名绕行两步（右键打开 / `xattr -cr`）、Linux glibc 下界 2.39 与 `libfuse2t64` / `--appimage-extract-and-run` 前提、自行打包命令与「图标属构建期产物」说明。

#### 测试（370 → 389 项；单元 +12 / 契约 +7）

- **单元（`tests/unit/`）**：打包计划 5 项（mac/arm64 图标链与 `--mac --arm64`、x64 开关、非 macOS 跳过 icns 且后续步骤仍在、linux 无 icns/无未签名口径、默认架构与非法平台/架构拒绝）；未签名断言 4 项（三口径 + 平台与产物缺失时先拒绝且不调用 `codesign`）；`maintainer` 判定 3 项（consumed / not-consumed / ambiguous，含「二进制文件不被扫描」的旁证）。
- **契约（`tests/contract/`）**：配置结构 5 项（mac 段字段齐全且**不含签名键**、linux 段字段与 `maintainer` 形态、win 段与共享骨架未被改动、三平台段同层且共享字段不重复、签名预留与未签名环境变量在配置注释中）；README 文案 2 项（产物清单与 Releases 入口、绕行步骤 + glibc 版本号 + 打包命令）。

#### 未做（明确登记）

- **真机项保留**：`codesign -dv` 未签名断言的 macOS 真机验证、`maintainer` 消费实测的 Linux 真机执行，均登记为 T2 矩阵首跑项——本批只交付可注入/可单测的逻辑与入口，不伪造平台结论；
- T2 矩阵与 `verify.yml` 抽取、T3 发布、T4 冒烟与验收。

### 工程：M2-T0 图标管线扩展（构建期生成、不入库、零图形库）

M2 的第一个实现批次：把程序化图标管线从「Windows 用的 PNG/ICO」扩展到 macOS iconset 与 Linux 图标目录，并保持「图标的唯一来源是脚本」。**未新增指令与选项**（16 条不变），**未新增依赖**。

#### 变更

- **纯函数模块 `scripts/icon-render.mjs`**：渲染（带符号距离场 + 解析抗锯齿，香槟金配色沿用）、PNG/ICO 最小编码器、iconset 与 Linux 档位清单集中一处；**同一份矢量描述按目标尺寸直接渲染**（不做位图缩放），因此 1024 档与 16 档同源可精确重生成；导入该模块不产生任何副作用。
- **命令行入口**：`npm run build:icon`（`scripts/build-icon.mjs`）写 14 个文件——`icon.ico`（7 档）、`icon.png`（256）、`icons/256x256.png`、`icons/512x512.png`（electron-builder 的 `NxN.png` 约定）与 `icon.iconset/` 的 10 个文件（16/32/64/128/256/512/1024 像素，含 `@2x` 两倍关系）；新增 `npm run build:icon:icns`（`scripts/build-icon-icns.mjs`）。
- **`iconutil` 封装 `scripts/icon-icns.mjs`**：参数拼装独立导出；**平台准入先于任何检查与写盘**——非 macOS 直接以明确错误退出（说明「icns 仅 macOS 构建期生成」），不静默跳过、不产生副作用；执行器可注入，使参数与四类失败口径（平台、缺 iconset、非零退出、未产出文件）可在任意平台单测；产出必须存在且非空，避免打包出缺图标的应用。
- **不入库**：`.gitignore` 新增 `gui/packaging/icons/`、`gui/packaging/icon.iconset/`、`gui/packaging/icon.icns`；`icon.ico` 与 `icon.png` 维持入库（Windows 口径不动）。

#### 实测与证据

- **既有产物零漂移**：重跑 `build:icon` 后 `git status --short gui/packaging` 为空 —— 入库的 `icon.ico` / `icon.png` 与新脚本产出**逐字节一致**（另有哈希相等断言固化）。
- **不入库生效**：`git check-ignore -v` 对三条生成路径均命中新规则（`exit=0`），且生成后 `git status` 只显示源码改动、无生成物。

#### 测试（360 → 370 项；单元 +6 / 契约 +4）

- **单元 `tests/unit/icon-render.test.ts`（6 项）**：各档 PNG 像素尺寸与声明一致（`icon.png` 256、`icons/` 256/512）、iconset 10 文件命名与尺寸完整且 `@2x` 为对应 1x 的两倍、ICO 目录表 7 档与各档负载尺寸匹配、确定性与落盘幂等（两次生成/两次写盘哈希一致）、既有入库 `icon.ico` / `icon.png` 字节不变。
- **契约 `tests/contract/icon-pipeline.test.ts`（4 项）**：生成物不入库（`.gitignore` 文本规则 + `git check-ignore` 双重断言）、`iconutil` 参数拼装与非 macOS 准入（断言未调用外部命令）、macOS 分支以注入执行器校验调用参数与产出（含非零退出、未产出文件、缺 iconset 三种失败口径）、非 macOS 命令行入口以非零退出码拒绝且不写盘。

#### 未做（明确登记）

- T1 构建配置（`mac` / `linux` 段、未签名断言脚本、README 的 Gatekeeper 与 glibc 说明）、T2 矩阵与 `verify.yml` 抽取、T3 发布、T4 冒烟与验收；
- **EX-03 保留**：`iconutil` 真机验证登记为 T2 矩阵首跑项，本批不伪造 macOS 结论。

### 工程：M5 遗留事实点收口（三项裁决 · 规范 + 实现）

把 2026-10-16 取证引出的三项裁决落到契约与实现（**先文档后实现**），并要求 ④ 维持现状。**未新增指令与选项**（16 条不变），**一期 `--target` 语义未动**（其可推导布局不经注册表 `path_template`）。

#### 三项裁定的落地

| #   | 裁定                                                                                                                                      | 落地                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | Codex 默认落位根改 `$HOME/.agents/skills`（官方文档 + 与 Cursor、`dsh` 共享）；`~/.codex/skills` 降为**配置覆盖的遗留兼容根**，不默认双写 | 注册表 `codex.roots[]`（`path_template` = `<用户主目录>/.agents/skills/<Skill 标识>`、`consumed_by` = codex / cursor / dsh、`scope` = global、`platform_notes` 写明官方依据与兼容通道）；`kernel/core/adapters/roots.ts` 默认路径表；README 使用说明                                                                                              |
| ②   | `disable-model-invocation` 由「全宿主禁止」改为**按宿主语义证据准入**；**Codex 纳入**（三处独立证据语义一致），其余宿主维持禁止           | 规范 2.2 第 5 条 / 3.7 / 新增 3.8 / **HR-09 改写**；schema 与 `$defs/securityControlEvidence`；注册表 `codex.render_policy.allowed_extensions` + `security_control_evidence`（`semantics` / 一手 `level` / 三条 `sources` / 残余不确定性 `note`）；准入判据 `isSecurityControlEvidenceComplete`（**唯一实现**，注册表加载期与渲染期共用两条防线） |
| ③   | **不为 `dsh` 新立注册项**：登记为 `~/.agents/skills` 的**外部消费方**（零适配器）；`deepseek` 维持 `not_applicable`                       | 规范 2.2 第 6 条 / 3.8 / **HR-07 放宽** / **新增 HR-13**；schema 顶层 `external_consumers`；注册表顶层 `external_consumers: [dsh]`（含官方来源与「预览期不立注册项、GA 后评估」说明）与 `codex.classification.root_consumed_by` = `[cursor, dsh]`                                                                                                 |
| ④   | Cursor 透传白名单**维持现状**（保守为空）                                                                                                 | 仅登记；待 HD-01 实测（本机无 Cursor）                                                                                                                                                                                                                                                                                                            |

#### 规范与契约

- **第五份契约规范修订记录第 5 条**：HR-09 改写、HR-07 放宽、新增 HR-13、新增 3.8 节（`external_consumers` 与 `security_control_evidence`）；`registry_version` 不递增（注册表随内核同版本交付，本次为可选字段新增与规则放宽，无既有取值语义变更）。
- **机器可读形态同步**：`schemas/host_registry.schema.json` 新增顶层 `external_consumers` 与 `render_policy.security_control_evidence`（含 `$defs/externalConsumer`、`$defs/securityControlEvidence`），并把原「白名单不得含 `disable-model-invocation`」的断言改为「含该字段时必须给出语义证据」的条件断言；规范↔schema 字段集一致性测试通过。

#### 测试（358 → 360 项；契约 55 → 57）

- **语义变更项回看**（按工程约定逐条核对用例语义）：`host-registry.test.ts` 的 HR-09 反例改为「白名单含安全控制字段但未登记语义证据」，并新增「登记了证据却未进白名单（失效登记）」反例与两条 HR-13 反例；`render.test.ts` 的白名单用例改为 Codex 命中透传 + 其余宿主拒绝，原「禁用字段双层防线」改写为「安全控制字段两层准入（注册表语义证据 + 渲染期复核）」，并加一条对照：同一策略补上语义证据后即准入（说明拒绝的原因是证据缺失而非字段本身）；`adapters.test.ts` 字段策略边界的同宿主断言同步改写（规则文件形态无字段映射，不产出字段级问题）。
- **新增用例**：`host-registry.test.ts`「Codex 落位根改为官方 agents 根、`dsh` 仅作为外部消费方登记」（消费集合 codex / cursor / dsh、`hostIds()` 不含 `dsh`、`deepseek` 维持不可落位）；`land.test.ts`「Codex 落位计划重定基到官方 agents 根，遗留根仅经配置生效且不双写」（默认根展开、配置覆盖回 `~/.codex/skills`、两种情形各只有一条落位项且不同时出现两个根）、默认路径表的 Codex 行改为 agents 根。

#### 文档同步

- `docs/research/host-mechanisms.md`：新增「补记（2026-10-16，第二批：裁定与逐处引文）」——三项裁定 + **逐处引文表**（Claude / Cursor / dsh 的 `disable-model-invocation` 语义原文、Codex 官方 agents 根原文、dsh 预览状态原文）。
- `docs/design/m5-host-adapter.md`：3.1 字段表补 `external_consumers` 与 `security_control_evidence`；3.2 首批注册项的 Codex 行改为官方 agents 根 + `host_declared` 白名单；新增 9.6「裁决执行」。
- `docs/plan/m5-host-adapter.md`：新增本批次执行状态。
- `docs/one-summary.md`：7.3 交付现状表补「落位根」一行并更新首批宿主行（`deepseek` 维持不适用、`dsh` 为外部消费方）；M5-L-04 **关闭**、M5-L-07 标为 ①②③ 已执行 / ④ 保持开放；测试计数与盘点结论刷新为 360。
- `README.md`：交付面测试计数刷新；宿主分发一节补默认落位根（含 Codex agents 根与遗留兼容根用法）。
- `docs/requirements.md`：新增本批次回写与计数校验（需求正文未改；第 9 章当前态的契约清单表述由 HR-01 ~ HR-12 更新为 HR-01 ~ HR-13）。

#### 未做（明确登记）

- Cursor 白名单是否放宽（HD-01）仍待 Cursor 环境实测，不阻塞；
- `dsh` 是否升级为宿主条目：GA 后评估（当前为开发者预览且官方明示破坏性变更）；
- HD-02 残余：Codex 官方把同类控制放在 `agents/openai.yaml` 的 `policy.allow_implicit_invocation`，SKILL.md 层该键在 Codex 侧的实际运行期效果未实测。

### 调研：M5 遗留事实点取证（浏览器一手 · 只文档）

把 M5 遗留项中三条**被网络 / 环境卡住**的事实点一次取齐：Codex 官方技能规范（原命令行侧 403）、DeepSeek Harness 线索（原不可达）、Cursor 官方字段表。取证经浏览器会话直接读取官方页面及其 `.md` / `raw` 纯文本形态，证据等级 **[已查证·浏览器一手]**。**本批次不改任何实现、不改需求、不动注册表与契约**（16 条指令、五份规范 / 五份 schema、358 项测试均未变）。

#### 取证结论

- **HD-06 / Q-01 关闭（Codex 官方规范）**：`developers.openai.com/codex/skills/` 现可达并重定向到 `learn.chatgpt.com/docs/build-skills`。要点：`SKILL.md` **必需 `name` + `description`**，扩展元数据在 `agents/openai.yaml`（`interface` / `policy.allow_implicit_invocation` / `dependencies.tools[]`）；加载位置为 `.agents/skills` 链（REPO，自 CWD 逐级向上至仓库根）、`$HOME/.agents/skills`（USER）、`/etc/codex/skills`（ADMIN）与随包 SYSTEM；同名技能**不合并**；禁用走 `~/.codex/config.toml` 的 `[[skills.config]]`；上下文预算 `skills.max_context_tokens`。
- **HD-01 部分更新（Cursor）**：官方 frontmatter 字段表较原记录**新增 `disable-model-invocation` 与 `metadata`**（其余为 `name` 必填且须与父目录同名、`description` 必填、`paths` 可选、`icon` / `color` 可选）；「标准外字段被忽略还是报错」官方文档**未述**，仍需 Cursor 环境实测。
- **Q-03 关闭（DeepSeek Harness）**：`deepseek-ai/deepseek-harness` 为 **DeepSeek 官方开源 agent harness**（公开仓库、开发者预览、everything-is-a-plugin，基于 Cordis），其中**技能是一等子系统**（`docs/subsystems/skills.md` + 本机文件系统 provider，仓库以 `.agents/skills/<名称>/SKILL.md` 组织技能、随 `packages/preset/agent-preset/skills/` 分发）。发现根与优先级：`<projectRoot>/.dsh/skills` → `<projectRoot>/.agents/skills` → `Config.customSkillDirs` → `<dshHome>/skills` → `<agentsHome>/skills` → `Config.bundledSkillDir`；接受目录包与扁平 `<名称>.md`，**不支持嵌套递归 `**/SKILL.md` 发现**；调用策略读取 `disable-model-invocation` 与 `user-invocable`。
- **HD-02 取得部分证据**：`disable-model-invocation` 现有**三处独立证据**（Claude 本机实测、Cursor 官方字段表、`dsh` 官方子系统文档）且语义一致（`true` = 排除模型自动调用）；Codex 侧把同类控制放在 `agents/openai.yaml` 的 `policy.allow_implicit_invocation`，未列入 SKILL.md。

#### 待裁决项（登记，不预判；裁定前保持现实现）

| #   | 事项                                            | 现状                                           | 待裁决内容                                                                                                                                    |
| --- | ----------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | Codex 分发落位根                                | 注册项用 `~/.codex/skills`（本机实测应用读取） | 是否改用 / 追加官方 USER 根 `$HOME/.agents/skills`（与 Cursor、`dsh` 的 `agents` 根同路径，可「一次落位、多宿主可见」），或并存并声明消费关系 |
| ②   | `disable-model-invocation` 透传（DP-04 / D-02） | 已实施「全宿主禁止透传」                       | 证据语义一致后，是否解除禁止、改为按宿主白名单透传并登记语义                                                                                  |
| ③   | DeepSeek 分类                                   | `not_applicable`（模型提供方）                 | 是否改判并新增 `dsh` 注册项（或标 `pending_evidence`），是否纳入后续适配批次                                                                  |
| ④   | Cursor 透传白名单                               | 保守为空                                       | 待 HD-01 实测关闭；本次仅更新文档字段表依据                                                                                                   |

#### 文档同步

- `docs/research/host-mechanisms.md`：新增 6.3 补记（2026-10-16）与附录补记 S-19 ~ S-24；更新可访问性表、事实卡 C（Codex）/ D（Cursor）/ F（DeepSeek）、风险表 HR-02、来源表 S-07 与 S-14。
- `docs/design/m5-host-adapter.md`：2.3 节「仍待确认」、2.5 节 HD-01 / HD-02 / HD-06 状态、9.2 节 Codex 补证行、9.4 节第 1 条，新增 9.5 节「取证更新与待裁决项」。
- `docs/plan/m5-host-adapter.md`：第 5 章 HD-01 / HD-06 行更新，并加本批次执行状态。
- `docs/one-summary.md`：7.3 节 M5-L-01 / M5-L-02 / M5-L-04 状态更新，新增 M5-L-07（四项待裁决）；交付现状表 DeepSeek 行加「待复议」。
- `docs/requirements.md`：新增本批次回写与计数校验（需求正文未改动）。

#### 未做（明确登记）

- 未改动内核注册表、渲染层、适配器与任何测试（四项待裁决裁定前保持现实现）；
- 未变更需求 9.3.6 的验收口径与分类表述；
- Cursor 侧仍需具备环境后实测（HD-01）；`dsh` 若纳入适配，需先裁定 ③。

### 工程：CI 接入（M1-T4 验收闭合）

M1 的收口批次：以真实运行证据闭合 9.3.1 的七条验收标准。**未新增指令与选项**（16 条不变）、未改动需求正文与任何门禁，只补齐验收证据与文档同步。

#### 验收证据（四次真实运行）

- **加固后运行 run 38828716615**（提交 `3995367`）：**Success**，墙钟 1m 58s（读取版本声明 4s、Windows 1m 48s、Linux 49s）；动作主版本升级（`checkout@v5` / `setup-node@v5` / `upload-artifact@v6`）与 Linux runner 固定（`ubuntu-24.04`）后**告警清零**，358 项测试在两平台仍全绿，产物 `…-Linux-X64-run38828716615`（41.1 MB）与 `…-Windows-X64-run38828716615`（32.9 MB）产出。
- **刻意失败探测运行 38829261658**（分支 `hotfix/ci-probe`）：Failure，1m 14s，无产物；失败精确定位到「五、格式检查（只读）」（4s，exit 1），日志给出 `[warn] ci-probe-format-violation.mjs` 与「Code style issues found」，其后「六、测试」「七、构建」「八、缩减冒烟」与产物上传全部 0s 跳过 → **验收 2 与 6 通过**（失败可定位、失败即中止且不产出产物）。
- **合并请求运行 38834451784**（PR #1，`hotfix/ci-probe → main`）：事件 `pull_request`（「Pull request #1 opened」），Failure，1m 4s，无产物，两腿停在同一失败环节（`#step:9`）→ **验收 1 通过**（两条触发路径均可自动运行，且与 push 路径同一失败链路）。
- **探测 PR 与分支处置**：仓库为公开仓库，故 PR 标题与描述自解释（「CI 验收探测 / 不合并 / 观察后关闭」）；观察后追加结束评论（含运行编号与失败定位）→ 关闭 PR（**未合并**）→ 删除分支 `hotfix/ci-probe`（远端与本地均删）。仓库分支只剩 `main`，本地工作区干净，**探测文件未进入 `main`**；已关闭的 PR #1 作为公开记录保留。

#### 缓存条目（验收 4）：机制已验证，时长未达成并附原因

- **机制侧（通过）**：冷 / 热双向确证——首次运行两腿均为 `npm cache is not found`，第二次运行两腿均 `Cache hit for: node-cache-<平台>-x64-npm-16daf9b6…` → `Cache Size: ~56 MB` → `Cache restored successfully`，键含平台、Node 版本与依赖锁文件哈希（两腿键彼此独立）；「清空缓存后结论不变」由冷缓存首次运行与热缓存第二次运行**同结论**佐证（两平台 358 项全绿、产物照常产出）；缓存范围不含任何宿主根路径。
- **时长侧（未达成）**：`npm ci` 自报耗时冷 / 热完全一致（Linux `added 450 packages … in 5s`、Windows `… in 12s`）；`安装 Node` 步骤在 Windows 上由 5s 升至 11s（恢复约 56 MB 缓存的固定开销），Windows 腿墙钟 1m 47s → 1m 48s，无可观测下降，**9.4.1 的「相对首次降低 ≥ 30%」目标值未达成**。
- **原因**：450 个包 / 约 56 MB 的量级下，依赖安装的瓶颈是解包与链接而非下载（缓存恢复日志的传输速率为 116.7 / 132.3 MB/s），网络本就不是瓶颈，缓存没有可节约的空间而恢复开销可见；收益在依赖规模增长前不可观测。Linux 腿 46s → 49s **不可比**（同批次把 Linux runner 由 `ubuntu-latest` 固定为 `ubuntu-24.04`）。
- **处置**：**保留缓存**（M1-R4 要求启用，且消除 registry 网络与限流的波动风险），本项按 9.4.1 原文出口「未达成须说明原因」闭合，**不改需求验收措辞**；复测触发器：依赖规模增长，或 `npm ci` 耗时随规模上升时复测——若届时仍无收益，移除缓存属需求变更，走变更记录批次。

#### 文档同步

- `docs/design/m1-ci.md`：第 14 章补 14.2（加固后运行）、14.3（缓存冷 / 热对照与口径）、14.4（两条触发路径与失败可定位性、PR 与分支处置）、14.5（9.3.1 七条闭合状态）。
- `docs/plan/m1-ci.md`：T4 执行状态、3.1「验收结果（T4 闭合）」、第 5 章阻塞项（DP-A 已定、DP-C 已完成、环境限制改由浏览器会话直接读取运行日志）。
- `README.md`：交付面补「持续集成」一行与测试计数刷新（354 → 358：单元 242、契约 55、端到端 61）；常用命令补 `smoke:kernel`、`check:node`；新增「持续集成」一节（触发、矩阵、步骤、产物下载入口与本地复现方式）。
- `docs/one-summary.md`（活文档）：7.4 节 M1 行改为收官状态并附四次运行证据；测试计数刷新为 358 项；盘点结论补 M1 收官。
- `docs/requirements.md`：新增本批次回写与计数校验（需求正文未改动）。

#### 未做（明确登记）

- 夜间完整流水线（CI-Q-01，按需启用）、macOS runner 与跨平台产物验证（归 M2）、发布与签名；
- 多宿主单次分发（M5-L-05）与其他 M5 遗留项维持登记，不在本批次范围内。

### 工程：CI 接入（M1-T1 ~ T3）

后续阶段 M1 的实现批次：把既有的人工验证集合固化为每次提交自动执行的流水线。**未新面向用户的指令或选项**，只新增 CI 支撑物与两个 npm 脚本。

#### 变更

- **工作流定义 `.github/workflows/ci.yml`**：触发为「推送到主干与长期维护分支」「针对主干的合并请求（打开 / 提交同步 / 重新打开）」与手工触发；同一分支的连续提交取消旧运行，结论只以最新提交为准。矩阵为 `ubuntu-latest` 与 `windows-latest` × **Node 取值取自 `.nvmrc`**（矩阵值由前置任务读取版本声明文件生成，并把「矩阵与声明一致」作为可失败的守卫步骤，而不是靠人工核对）。八步依次为：版本守卫 → 依赖安装（按锁文件）→ 契约与分层校验 → 类型检查 → 代码规范 → 格式检查（只读）→ 测试（含用例数核对）→ 构建 → 缩减冒烟。产物上传命名含平台 / 架构 / 运行标识并保留 14 天；失败时另上传诊断产物。`fail-fast: false` 保证一个组合失败不掩盖其他组合的结果，任一组合失败即整次运行失败；任务级硬上限 60 分钟。
- **缩减冒烟（DP-B，不启动 Electron）**：新增 `scripts/smoke-kernel.mjs` 与 `npm run smoke:kernel`——内核可执行文件存在 → `--version` 可用 → `init` → `scan` → `list --json` 最小闭环，三条检查各自可失败且给出可定位信息；工作区用系统临时目录，**不触碰任何真实宿主目录**。完整三启动方式界面冒烟继续在本地执行。
- **版本声明守卫**：新增 `scripts/check-node-version.mjs` 与 `npm run check:node`——本地检查是否满足 `engines` 下界并与 `.nvmrc` 比对（不一致仅提示，因 `engines` 只声明下界）；流水线以 `--expect <矩阵取值>` 断言一致，不一致即失败。
- **本地预校验**：八步在本机全部通过（契约与分层、类型检查、代码规范、格式检查、358 项测试、构建、缩减冒烟、版本守卫）。提示：本机 Node 为 **24** 而 `.nvmrc` 声明 **22**，因此流水线是该套件**首次在 Node 22 上运行**——若首次运行暴露版本相关差异，按「修版本兼容」处理，**不放宽门禁**。
- **决策点处置**：DP-A 按最小覆盖（两 OS × 最低 Node，**夜间完整流水线默认不启用**，待 CI-Q-01 按需开启）；DP-C 已授权由执行端推送 `main`，验收以该次推送触发的真实运行为准。

#### 未做（明确登记）

- 夜间完整流水线、macOS runner、跨平台产物验证与打包产物验证（后三者归 M2）；产物签名与发布不在本阶段任何里程碑。

#### 首次真实运行（run 38769499271，提交 `1d880b6`）

- **结果**：推送 `main` 自动触发，三个 job 齐备；两个矩阵组合（Windows 与 Linux，均为 Node 22）都执行到产物上传步骤，358 项测试在两平台同时通过；产物 `skill-manager-Linux-X64-run38769499271`（41.1 MB）与 `skill-manager-Windows-X64-run38769499271`（32.9 MB）已产出，命名含平台 / 架构 / 运行标识。
- **告警处置（DP-D：官方动作的运行时）**：三个官方动作面向 Node 20 被强制在 Node 24 上运行。经核实各主版本的实际目标运行时（`action.yml` 的 `runs.using`）与输入兼容性后升级：`checkout@v4 → v5`（其变更记录仅「改用 Node 24」一项）、`setup-node@v4 → v5`、`upload-artifact@v4 → v6`（v5 仍面向 Node 20）。两个 job 的检出步骤同步升级，版本保持一致。
- **告警处置（DP-E：runner 标签漂移）**：`ubuntu-latest` 将于 2026-10-19 迁移到 Ubuntu 26。Linux runner 固定为 `ubuntu-24.04`，让操作系统升级成为**显式决策**而非静默变化；Windows 无同类迁移公告，暂用 `windows-latest`。
- **待补验收**：合并请求触发路径（需一次 PR）、刻意失败的可定位性（需一次构造失败）、缓存命中的时长下降（需两次运行时长对比）。

### 行尾符规范化（独立批次：`docs/architecture.md` 工作副本 CRLF → LF）

收尾工程项：把全库唯一的 CRLF 文档转为 LF。执行后发现实际情况与预判不同，如实记录如下。

#### 实测结论

- **仓库侧本就全是 LF**：`git grep -P -l -e '\r' HEAD` 对全部已跟踪文件的 blob 审计结果为**空**——没有被提交的文本文件含 CR。原因是 `.gitattributes` 的 `* text=auto eol=lf` 在入库时已完成规范化，CRLF 只存在于**工作副本**。
- **预判的「约 1398 行纯空白差异」未出现**：该数字来自工作副本的 CR 计数（1398），而 blob 与工作副本在转换前经 eol 过滤器比较即视为一致，因此 `git diff` 为空。转换后工作副本与 `HEAD` blob **逐字节相同**（76971 字节，逐字节比对通过），stat 缓存刷新后 `git status` 干净。
- **本次实际效果**：工作副本的 CRLF 已转为 LF，与 `.editorconfig`（`end_of_line = lf`）一致；文本类文件的工作副本 EOL 复核只剩两个二进制资源（`.ico` / `.png`）含 CR，属预期。

#### 结论与登记

- **M5 遗留项 M5-L-06（`docs/architecture.md` 的 CRLF）关闭**：该项自始只影响工作副本，不影响仓库内容；现已与仓库一致。
- **无内容变更、无功能变更**：本批没有可提交的代码或文档内容差异（`git diff` 与 `git diff --cached` 均为空），因此**未产生提交**；登记以本条说明承接。
- 方法学备注：本批一度用 PowerShell 捕获 `git show` 输出做 blob 审计，因 PowerShell 会用平台换行重组行而产生**全量误报**；改用 `git grep -P` 与逐字节比对后得到上述结论。

### 解析器：选项重复语义硬化（独立小批次）

`--host` 边界审计发现「重复给出取值选项时静默取最后值」并非 `--host` 独有，而是**所有取值选项共有**的隐性丢弃；本批做通用解析器硬化，而非只修 `--host`。

#### 变更

- **解析器行为**：同一命令中重复出现同一选项按**参数类错误**（`E-INPUT-002`）拒绝，**不再静默取最后值**；布尔选项与取值选项同口径（`--yes --yes` 同样报错），避免误写的参数被悄悄丢弃。重复时既不覆盖既有取值，也不产生任何写入。
- **登记表新增可重复性声明**：`REPEATABLE_OPTIONS` 显式声明设计上可重复的取值选项（默认单值），并导出 `isRepeatableOption()` 供审计与测试逐项核对。审计结论：全量取值选项中**仅 `scan` 的 `--root`** 设计上可重复（契约语法标记 `...`），其余均为单值。
- **`--host` 明确为单值**：多宿主分发维持「多次调用」的口径；该项作为遗留项继续登记（多宿主单次分发是未来能力）。
- **指令契约规范（先文档）**：第 2.2 节新增「重复给出的处理」——重复即按参数类错误拒绝、不静默取最后值、可重复选项按数组聚合且可重复性在登记表中显式声明；第 9 节修订记录新增第 35 条。
- **契约测试（354 → 358 项）**：新增 `tests/contract/option-hardening.test.ts` 四项断言——逐选项审计（每个非可重复取值选项重复即报错，且不覆盖既有取值）、布尔选项同口径、可重复选项仍聚合且**登记表与契约语法中的 `...` 一一对应**、契约写明该规则。同时把 M5 收口用例中「重复 `--host` 取最后值」的断言改为「按参数类错误拒绝且不产生写入」。
- **审计结论**：全库无任何既有用例或实现依赖「重复取最后值」的口径（硬化后既有 354 项全部通过）。

### 后续阶段 M5（宿主适配层）收官（T7 测试收口 + T8 文档同步）

M5 的收口批次：不新增功能、不改既有行为，只做验收映射、边界审计补缺与文档同步。

#### T7 测试收口

- **验收映射**：需求 9.3.6 的十条里程碑验收标准逐条挂载到承载测试（文件 / 用例）与验证方式，见 `docs/plan/m5-host-adapter.md` 第 3 章。
- **边界审计（补缺两项，均为实现缺陷，已修）**：① 落位计划**重定基后未更新 `external` 标记**——注册表模板是工作区相对路径，重定基到宿主真实根后应标记为工作区外写入，否则结果载荷误报；② 外部根解析的「不可创建」判定只看直接父级，**隔层父级为文件时漏报**（如 `<文件>/nested/skills`），改为向上找最近的存在祖先再判定。
- **审计新增用例**：`tests/contract/m5-closure.test.ts` 四项——多宿主分发按调用次数独立完成且单次调用只取一个宿主取值（`--host` 为单值选项，重复给出时后者覆盖前者，已登记为遗留项）；`update --host` 在宿主根尚无副本时创建并报告；外部根解析边界（覆盖根为文件、最近上级不是目录、不适用宿主无根）；重叠消费在详情输出中呈现（`consumed_by`）与 `agents-md` 形态不落盘（含 `enable --host` 对不落盘形态给出明确错误）。
- **全量回归**：**354 项测试全绿**（单元 242、契约 51、端到端 61）；用例数与声明一致（沿用核对约定）。

#### T8 文档同步

- **README**：交付面补「宿主分发」一行；快速开始补宿主分发示例（配置覆盖、`install --host`、`disable --host`）并写明 `--host` 与 `--target` 正交、工作区外写入需 `--yes`；测试计数更新为 354。
- **`docs/one-summary.md`（活文档）**：结论补 M5 收官；新增 7.3 节「M5 状态与遗留项」（交付现状表 + 六项遗留项）；规模表刷新（`kernel/` 50 文件 11874 行、`tests/` 35 文件 8190 行、合计 112 文件 22937 行）；验证手段的测试计数更新为 354。
- **契约体系状态**：README / one-summary / architecture 的当前态表述均为**五份规范 + 五份 schema**（历史记录性条目按例不改写）；T1 已同步，本轮复核无残留。
- **遗留项登记（六项，不关闭）**：M5-L-01 Cursor 标准外字段待确认（HD-01）；M5-L-02 Codex 官方字段全集与技能根优先级待确认（403，白名单依据为本机实测）；M5-L-03 AGENTS.md 合并策略未定稿（片段不落盘）；M5-L-04 DeepSeek Harness 线索待一手确认；M5-L-05 `--host` 为单值选项（多宿主用多次调用）；M5-L-06 `docs/architecture.md` 的 CRLF 行尾符（待独立 EOL 规范化批次）。

#### M5 全链路（T0 ~ T8）

调研（宿主机制事实卡与补记）→ 第五份契约规范与 schema → 内核注册表（K-13）→ 渲染层（K-14）→ 适配器层与落位计划（K-15）→ 外部根解析与落位执行器 → 契约登记（`--host` 入口与两配置键）→ 指令层接线 → 收口（验收映射、边界审计、文档同步）。全程遵循先文档后实现、变更批次登记与快照不改动三条纪律；指令总数始终 16 条。

### 指令层：宿主分发接线（M5-T5β）

M5 的第五个批次后半段：把 `--host` 接到四条指令上。**无 `--host` 时四条指令的执行路径与一期一字不改**（既有 345 项测试零回归）。

#### 变更

- **install / update**：给出 `--host` 时，在中心库就位之后按落位计划把内容分发到宿主真实根——落位计划重定基到解析出的真实根（技能根下建 `<Skill 标识>/` 目录、规则路径直接写文件），写前**备份先行**（备份到工作区 `backups/`），写入走既有原子写原语。预演的渲染输入取自来源目录（此时中心库尚未写入），实装取自中心库副本。
- **enable / disable**：给出 `--host` 时只切换宿主真实根内该副本的可见性——技能元数据文件改名 / 还原，**目录与其余文件一律不动**，且**不写索引**（索引状态描述工作区内的目标）。工作区外写入属高影响操作，确认级别由该两条指令的「无需确认」**提升为轻确认**，非终端环境必须给出 `--yes`（否则按参数类错误拒绝），并支持 `--dry-run` 预览将变更的路径。
- **统一确认入口扩展**：`confirmationGate` 新增可选 `escalateTo`（默认沿用指令自身的确认级别），既有调用方行为不变。
- **结果载荷**：宿主分发的结果在 `data.host` 下给出宿主标识、解析后的真实根、是否写入工作区之外、产生的备份、被跳过的落位项，以及**消费宿主集合**（`consumed_by`，供详情输出呈现重叠消费）；预演时另给 `preview_writes`。
- **落位计划新增重定基原语**：`rebasePlan(plan, hostRoot)` 把注册表模板展开的路径改写到解析出的宿主真实根，并重算重叠声明；目录类与文件类落位根分别处理（后者不再拼接文件名）。
- **契约测试（345 → 350 项）**：新增 `tests/contract/host-wiring.test.ts` 五项端到端断言——`install --host` 分发到宿主真实根且无 `--host` 时不触碰真实根（回归）；`enable` / `disable --host` 改名往返后**文件集合不变**（AMB-01 锚点）且索引状态不变；`update --host` 刷新后重分发；非法 `--host` 取值报错并列出可用取值、非终端缺 `--yes` 被拒且不产生写入；`--dry-run` 预览工作区外路径且不落盘、`--target` 与 `--host` 正交各自生效。全部测试以 `config set host.<宿主>.root` 指向临时目录，**不触碰真实宿主根**。
- **实现期发现的语义澄清（非缺陷）**：本地目录来源的刷新语义是「按磁盘现状刷新记录，不重新获取内容」，只有 git 与归档来源才重新获取（见生命周期模块的处理分支）；测试期望据此修正为「改中心库现状后刷新」。

### 契约：宿主分发入口 `--host`（M5-T6）

M5 的第六个批次：**先文档后实现**的契约登记。T5 实现期发现一期的 `--target` 语义（工作区内可推导布局，属冻结数据模型）与 M5 的落位目标（宿主真实根，工作区外）**撞车**——同一取值两个互斥含义。裁决：`--target` 语义一律不动，宿主分发改用**新增选项 `--host <宿主>`**，指令总数仍为 16。

#### 契约变更（先登记）

- **指令契约规范**：第 2.2 节新增「宿主分发的入口」——`--host <宿主>` 仅 `install` / `enable` / `disable` / `update` 接受，取值来自宿主注册表（含按路径类分条的取值，如 `cursor` 与 `cursor-rules`），与 `--target` **正交**（前者决定分发宿主，后者决定工作区目标，可并用）；写工作区之外的路径属高影响操作，沿用确认机制并支持 `--dry-run` 预览。第 4.7 / 4.9 / 4.10 / 4.11 节语法行与选项表同步补入；第 4.9 与 4.10 节写明 `--host` 时只切换宿主根内副本的可见性，**不修改索引状态**、不新建副本。第 9 节修订记录新增第 34 条。
- **配置键登记**：第 4.3 节登记 `host.<宿主标识>.root`（技能根）与 `host.<宿主标识>.rules_root`（规则路径根）——宿主标识必须是注册表中已登记的标识，取值非空；这两项只影响宿主分发的落点，不影响工作区内的目标位置。
- **需求文档**：9.3.6 的 M5-R9 按裁决重写（标题改为「`--host` 宿主分发入口与两级路径粒度」，要求与验收标准同步），M5-R3 的范围项与要求项、里程碑验收标准第 9 条、约束第 1 条共四处同步；新增「M5-R9 修订批次」与计数校验，明确本次属**选项新增 + 条款修订**而非新增指令。

#### 实现登记

- **`--host` 入取值选项表**（`kernel/dispatch/parsers`）：契约中写明的选项与实现登记的一致性由既有契约测试守住。
- **宿主根配置键**（`kernel/core/index`）：`setConfig` 增加形态校验——宿主标识须在注册表内、不适用宿主（如模型提供方）拒绝、类别须与该宿主登记的落位根一致（Claude 不接受 `rules_root`）、取值非空；既有三个固定配置键行为不变。
- **契约测试（342 → 345 项）**：新增 `tests/contract/host-options.test.ts` 三项断言（`--host` 登记与四条指令语法；宿主根配置键的取值校验含五类反例；需求文档修订完成且无旧表述残留）。第三项断言在首次运行即抓到一处遗漏——M5-R3 的范围项与要求项是同一句话的两处，先前只改了一处，已补齐。

#### 未受影响

一期定稿内容（元数据规范 3.5 的落位根不变量、`--target` 语义、附录 A 至 D）、四份既有规范与五份 schema 均未改动；指令总数仍 16，FR-01 至 FR-12 不变。

### 内核：落位扩展（M5-T5α：外部根解析与落位执行器）

M5 的第五个批次按两段推进。本段交付**内核机制**（外部根解析 + 落位执行器 + 宿主根可见性切换）与契约测试；指令层接线（`--target` 绑定、确认与预演入口）留待 T5β，因其依赖 T6 的契约登记与一处语义裁决（见下）。

#### 变更

- **外部根解析器 `kernel/core/adapters/roots.ts`**：宿主落位根 = **默认路径（按宿主惯例与平台展开）+ 配置覆盖**。默认值只在有证据的组合给出（`claude` → `~/.claude/skills`、`codex` → `~/.codex/skills`、`cursor` → `~/.cursor/skills` 与 `~/.cursor/rules`、`doubao` → Windows 的 `%LOCALAPPDATA%\Doubao\...\agent_mode\workspace\.user_skills`）；未列出者（如非 Windows 的豆包、通用标准目标）要求 `config set host.<id>.root|host.<id>.rules_root` 显式给出，**内核不猜测路径**。解析结果做存在性校验（已存在但非目录、父级非目录均报错误级问题），并标记是否位于工作区之外。
- **落位执行器 `kernel/core/adapters/land.ts`**：消费 T4 的落位计划执行写盘，是**本层唯一写盘路径**。写盘纪律：只调用存储层的原子写与备份原语（不新增旁路，检索断言守住）；目录类落位（技能形态）写前**备份先行**，备份失败即中止且不改动环境；同一目标路径**只写一次**（重叠消费不重复产出，M5-R8）；`landable = false` 的落位项（指令文件载体）只登记不落盘；`dryRun` 只产出变更清单。技能形态落位支持按逐文件映射落位中心库资产，随后以渲染产物覆盖元数据文件。
- **宿主根可见性切换**：`setHostSkillVisibility` / `isHostSkillDisabled` 复用受控副本原语——禁用只把宿主副本内的 `SKILL.md` 改名为 `SKILL.md.disabled`，**不移动、不重命名、不删除任何目录**（Q-06 的三端结论）。
- **契约测试（337 → 342 项）**：新增 `tests/contract/land.test.ts` 五项断言（外部根解析的默认值 / 覆盖 / 非法根 / 不适用宿主；落位写盘与原子写无残留；备份先行与失败中止；启用禁用往返且目录不动、文件集合不变；指令文件载体不落盘与预演不落盘）。**测试全程用配置覆盖指向临时目录，绝不触碰真实宿主根**。

#### 待裁决（T5β 前置）

- **`--target` 语义撞车**：一期契约把 `--target` 定义为「目标位置标识」，其落位根是工作区内的可推导布局 `.<目标标识>/skills/<Skill 标识>`（元数据规范 3.5 的不变量、`targets[].path` 不得为绝对路径）；而 T5 的落位目标是**宿主真实根**（工作区之外）。两者使用同一取值，必须裁决其一：① 保留一期语义，宿主分发另立显式通道（如 `--host <宿主>` 或独立指令）；② `--target <宿主>` 在注册表命中的宿主上改指宿主真实根，工作区副本改用非宿主目标标识。该裁决与 T6 的指令契约登记一并处理。

### 内核：首批适配器（M5-T4）

后续阶段 M5 的第四个交付批次：把「形态实现」与「宿主绑定」分离，落地首批六宿主的适配器与落位计划（不含写盘）。

#### 变更

- **新增 `kernel/core/adapters/`**：`types.ts`（`HostAdapter` 接口、`PlacementEntry` / `PlacementPlan` / 重叠声明）、`plan.ts`（落位模板展开、落位项组装、重叠消费声明）、`rules.ts`（Cursor 规则路径形态 `.mdc`）、`index.ts`（形态实现与宿主绑定）。
- **形态与宿主分离（M5-R7 的收益落地）**：复用技能形态的四个宿主（`claude` / `codex` / `doubao` / `agentskills`）**共享同一实现对象**，无任何宿主专有代码；`agents-md` 复用指令文件降级形态；**Cursor 的规则路径形态是本批唯一新增的形态**。形态实现经 `formImplementationOf()` 暴露，供审计与测试断言「同一实现对象」。
- **注册表状态推进**：六个宿主的 `adapter_state` 由 `planned` 置为 `implemented`，可落位集合（HR-10）由空变六项；`deepseek` 保持 `planned` 且无适配器（不适用 / 模型提供方）。
- **落位计划（供 T5 消费）**：落位项含完整目标路径（`.claude/skills/<Skill 标识>/SKILL.md`、`.cursor/rules/<Skill 标识>.mdc`、`AGENTS.md`）、落位根类别、是否位于工作区之外（豆包的用户技能根）、`landable` 与不可落盘原因、消费宿主集合；并在计划层声明**重叠消费**（Claude 技能根被 Claude 与 Cursor 读取；通用指令文件被 Codex 与 Cursor 读取）。
- **只读合规校验**：适配器的 `verify` 解析产物元数据块，断言必填字段齐全且字段集不超过「标准六字段 + 宿主白名单」，并可校验规则文件扩展名与 `alwaysApply` 前置元数据。
- **规范兼容澄清**：明确 `path_template` 的粒度由 `kind` 决定（`skill` / `external` 为技能目录模板，`rules` 为规则文件模板），落位计划据此判定是否需要拼接产物文件名。见 `docs/specification/host-registry.spec.md` 修订记录第 4 条。
- **契约测试扩展（328 → 337 项）**：新增 `tests/contract/adapters.test.ts` 九项断言（六宿主结构合规、字段策略边界、同核验证、降级片段与不落盘、Cursor 规则形态、落位计划结构与重叠声明、不适用宿主、可落位集合生效、适配器层不写盘）；并同步 T2 中因 `adapter_state` 与消费集合变化而语义过期的两条既有断言（改行为回看用例语义）。

### 内核：渲染层核心（M5-T3）

后续阶段 M5 的第三个交付批次：把「内部技能表示 → 宿主可识别产物」渲染为纯函数，接入 T2 的透传白名单，保持渲染与落位解耦。

#### 变更

- **新增 `kernel/core/render/`**：`types.ts`（输入输出类型：`RenderSource` / `RenderOutcome` / `RenderLedger`）、`fields.ts`（内部字段 → 标准六字段的映射与规整）、`index.ts`（共用渲染核心 `renderWithPolicy` 与形态调度 `renderSkill` / `renderEntry` / `renderStandardSkill`）。
- **保守渲染优先**：默认只渲染标准六字段（`name` / `description` / `license` / `compatibility` / `allowed-tools` / `metadata`）；扩展字段仅在宿主策略为 `host_declared` 且命中白名单时渲染。映射细节：触发关键词并入描述（标准无对应字段）、运行时依赖并入兼容性文本、版本 / 作者 / 主页 / 标签 / Skill 依赖落 `metadata`（列表转字符串）。
- **白名单接入（DP-04）**：透传判定收敛为**唯一实现** `resolveDeclaredExtensions`，注册表查询路径与渲染层共用；命中即透传，未命中忽略并回报 `W-FIELD-004` 警告且点名被忽略字段（不静默丢弃）。
- **禁用字段双层防线**：注册表加载期拒绝白名单登记该字段（T2 校验），渲染期无论白名单如何一律拒绝——两层防线相互独立，任何宿主的产物中都不会出现该字段。
- **共用渲染核心**：通用 Agent Skills 标准目标（`renderStandardSkill`）与逐宿主适配器走同一实现，差异只是策略（`standard6` / `host_declared`），不设两套渲染代码；同一策略下两条路径产物深度相等（契约测试守住）。
- **降级形态**：指令文件载体产出 AGENTS.md 条目化片段（无 YAML 元数据块），`degraded = true` 并声明缺少的三项能力（自动发现 / 按需加载 / 工具预授权）；只产出片段、不落盘（合并策略未定稿）。
- **渲染与落位解耦**：本层只返回内存中的文本与结构，不写盘；契约测试以源码检索断言渲染层不得出现写盘 API，落盘属 T5 的落位扩展。
- **契约测试扩展（320 → 328 项）**：新增 `tests/contract/render.test.ts` 八项断言（标准六字段与标准一致、确定性、白名单命中与未命中警告、保守渲染、禁用字段双层防线、同核验证、降级片段、不写盘）。

### 内核：宿主注册表（M5-T2）

后续阶段 M5 的第二个交付批次：把宿主差异收敛为一份可校验的注册表数据，内核侧只保留加载、校验与查询，不含渲染与落位。

#### 变更

- **新增 `kernel/core/hosts/`**：`types.ts`（条目类型与取值域常量）、`registry-data.ts`（首批 7 条注册项）、`validate.ts`（宿主注册表规范第 5 章的 HR-01 ~ HR-12 校验，产出标准问题条目）、`index.ts`（加载与查询接口）。注册表**随内核交付、不位于工作区**，工作区布局不变；加载结果被冻结，作为宿主差异的只读事实源。
- **首批 7 条注册项**：`claude`、`codex`、`cursor`、`doubao`、`agentskills`（通用标准目标）、`agents-md`（通用指令文件载体）、`deepseek`（不适用 / 模型提供方）。每条含证据等级、三维分类（是否支持 skill 机制 / 是否仅支持规则文件 / 落位根被哪些宿主消费）、落位根、能力声明、渲染与透传策略、适配器实现状态（本批均为 `planned`，T4 落地适配器后置为 `implemented`）。落位根重叠消费据实登记（`.claude/skills/` 与 `.codex/skills/` 同为 Cursor 兼容读取）。
- **透传白名单按 DP-04 落位**：白名单只登记标准 6 字段之外的字段（Codex 20 项、豆包 15 项）；命中即透传，未命中忽略并回报 `W-FIELD-004` 警告（不静默丢弃）；`disable-model-invocation` 在任何宿主下都被拒绝（HR-09 兜底，加载校验同时防止白名单误登记该字段）。
- **契约测试扩展（314 → 320 项）**：新增 `tests/contract/host-registry.test.ts` 六项断言——注册表数据同时通过 schema 校验与 HR 校验、字段完整性、HR 反例（HR-01/02/03/04/05/06/07/08/09/11）、白名单行为（含禁用字段全宿主拒绝）、查询接口（按标识与三维分类）、新增宿主零内核改动与事实源只读。
- **实测复核修正**：Codex 的 frontmatter 字段实测量由 26 种更正为 **27 种**（白名单取标准字段之外的 20 项），设计与计划的对应表述同步更正；审批记录以补记承接。
- **规范兼容澄清三处**（见 `docs/specification/host-registry.spec.md` 修订记录第 2、3 条）：① `support_state = not_applicable` 的宿主豁免 HR-05 / HR-06（`roots` 与 `adapter_ref` 改为条件必填）；② HR-06 的技能根判定同时接受 `skill` 与 `external` 类落位根（工作区外技能根此前会被误判为缺技能根）；③ 载体形态补充「类型化数据模块」一档——内核以单文件可执行交付，本期实现用 `kernel/core/hosts/registry-data.ts` 而不引入构建期资源加载，字段契约与 `host_registry.yaml` 等价。

#### 已知项

- **`docs/architecture.md` 的行尾符（EOL）**：该文件是全库唯一的 CRLF 文档（其余文档为 LF），属既有状态、非本批引入。当前处置为**登记已知项、推迟处理**：不在功能批次中混入整文件空白差异，待 M5 收尾后作为独立的 EOL 规范化批次一次完成；若后续某批次必须触碰该文件，可顺势自然转为 LF。`git blame` 可用 `-w` 忽略空白，但整文件 diff 噪声是实际成本，故不提前做。

### 契约：第五份规范（宿主注册表）

后续阶段 M5 的第一个交付批次，按「先文档后实现」推进：只建立契约资产与测试断言，不含内核实现。

#### 变更

- **新增第五份契约规范 `docs/specification/host-registry.spec.md`（规范版本 1）**：宿主注册表成为独立契约资产（设计决策 DP-03）。规范定义载体与全局不变量、条目字段（宿主标识、展示名、适配器实现状态、支持状态、证据、三维分类、落位根、能力声明、渲染与透传策略、适配器引用、待确认项）、证据等级分级、12 条校验规则（HR-01 ~ HR-12）、最小合法示例与版本兼容策略。注册表**随内核交付、不位于工作区**，既有工作区布局不变；透传白名单**禁止**包含 `disable-model-invocation`。
- **新增机器可读形态 `schemas/host_registry.schema.json`**：与规范逐字段对齐，并把「状态与证据绑定」（HR-04）、「三维分类自洽」（HR-05）、「渲染模式与白名单一致」（HR-08）、「透传禁列」（HR-09）编码为可机器校验的约束。
- **契约测试扩展（312 → 314 项）**：新增宿主注册表的功能断言（合法样本通过；缺少必填、状态与证据不符、三维分类两项同假、落位根为空、透传模式缺白名单、白名单含禁止字段、出现未登记字段、版本不受支持均被拒）与「规范文档示例可通过校验」断言；字段集一致性断言扩展至第五份，含顶层与条目的必填集合比对。
- **文档表述同步**：`README.md`、`docs/one-summary.md` 的契约份数与测试计数由「四份 / 312 项」更新为「五份 / 314 项」；`docs/architecture.md` 的头部信息表、仓库树与目录用途同步，并以**新增补充记录**承接（不改写历史条目）；需求文档附录 C 补登新规范，同时修正「指令契约规范」一行残留的「十五条指令」为十六条（表述修正，指令总数自 restore 裁决批次起即为 16）。
- **既有契约未受影响**：原四份规范与四份 JSON Schema 的内容与版本均未改动；指令总数仍为 16、未新增选项。

### 工程：已知选项登记与冒烟脚本可用性

#### 变更

- **内核分发形态的换法登记为已知选项（`N-13`）**：随包产物已在不改架构的前提下下降 7.7%（安装包 119.7 MiB、便携 119.5 MiB）。进一步的空间来自把内核改成随包分发单个脚本包、由 Electron 以 Node 模式运行——实测可省约 23 MB/产物（119.7 → 97.8 MiB）与 92 MB/解包目录。评估结论：**不采用**。AD-09 当初选定独立可执行文件的根本理由是内核与界面框架解耦，为约 19% 的分发体积牺牲架构边界不划算；且体积已由零风险手段达成主要收益，边际收益递减。第 7.3 节标题相应改为「已知缺口与选项登记」，并新增一段说明该类条目的性质：不是缺口，记录以便日后按指标重新评估，不关闭讨论。
- 界面冒烟脚本的 `--app` 支持相对路径：路径在脚本内解析为绝对路径后再交给 Electron 子进程（子进程以 `gui/` 为工作目录，相对路径直接传给 `spawn` 会得到「明明存在却 ENOENT」的假象）；缺取值时给出明确用法提示并以退出码 `2` 结束。

### 工程：内核与随包产物体积优化

纯工程批次：不动任何指令语义、校验、问题码与契约，只做体积构成分析与有依据的裁剪。

#### 体积构成分析（优化前）

**内核可执行文件 `build/kernel/skill-manager.exe` = 88.0 MiB**：Node 运行时副本 87.2 MiB（99.2%）+ SEA 代码块。代码块是由 esbuild 打出的单个 CommonJS 包 **737 KB**（自有代码 326 KB，依赖 479 KB；依赖占比：`tar` 84 KB、`node-stream-zip` 40 KB、`yaml` 约 190 KB、`semver` 约 90 KB）。结论：**内核侧没有可裁剪空间**——产物就是 Node 运行时本体，误打包源码/测试/开发依赖的情况不存在（esbuild 只沿静态引用打包）。

**随包产物 `win-unpacked` = 469.2 MiB**（按顶层项）：

| 项                                                                   | 体积     | 占比  | 说明                                                             |
| -------------------------------------------------------------------- | -------- | ----- | ---------------------------------------------------------------- |
| `skill-manager.exe`                                                  | 245.6 MB | 49.9% | Electron 本体                                                    |
| `resources/`                                                         | 107.3 MB | 21.8% | 其中内核可执行 92.0 MB、`app.asar` 15.2 MB、`elevate.exe` 0.1 MB |
| `locales/`                                                           | 50.6 MB  | 10.3% | 55 个语言包                                                      |
| `dxcompiler.dll`                                                     | 25.7 MB  | 5.2%  | Chromium GPU 组件                                                |
| `LICENSES.chromium.html`                                             | 20.5 MB  | 4.2%  | Chromium 许可全文                                                |
| `resources.pak`                                                      | 12.4 MB  | 2.5%  | Chromium 资源                                                    |
| `icudtl.dat`                                                         | 10.9 MB  | 2.2%  | ICU 数据                                                         |
| 其余（vk_swiftshader、d3dcompiler_47、ffmpeg、dxil、pak、vulkan 等） | 约 26 MB | 5.5%  | Chromium 运行组件                                                |

关键发现：`app.asar` 里 601 个条目有 590 个是 `node_modules`（`vue`、`@vue/*`、`@babel/*`、`postcss` 等），全是**构建期依赖**——渲染层已由 Vite 把 Vue 内联进产物，主进程与预加载只引用 `electron` 与 Node 内置模块（已逐一核对 `out/main/index.js`、`out/preload/index.cjs` 的引用）。这 15 MB 是白带的。

#### 优化清单（有依据的两项）

1. **随包排除构建期依赖**：`files` 增加 `'!node_modules/**'`。`app.asar` 15.2 MB → **239 KB**。
2. **裁剪语言包**：`electronLanguages: [zh-CN, en-US]`。`locales/` 55 个 50.6 MB → **2 个 1.12 MB**（系统语言不在列表时 Chromium 回退 en-US，中文与英文之外的语言包对界面无影响——界面文案是本项目自己的 Vue 组件）。

#### 体积对比（优化前后）

| 产物                    | 优化前                    | 优化后                        | 变化                |
| ----------------------- | ------------------------- | ----------------------------- | ------------------- |
| 内核可执行文件          | 88.0 MiB                  | 88.0 MiB                      | 不变（无内容可裁）  |
| 安装包（NSIS）          | 135,924,849 B / 129.6 MiB | **125,519,722 B / 119.7 MiB** | −10.4 MB（−7.7%）   |
| 便携单文件              | 135,710,634 B / 129.4 MiB | **125,305,517 B / 119.5 MiB** | −10.4 MB（−7.7%）   |
| 解包目录 `win-unpacked` | 469.2 MiB                 | **408.0 MiB**                 | −61.2 MiB（−13.0%） |

#### 评估后未采用的项（附数据与理由）

- **`compression: maximum`**：实测安装包 125,519,722 → 125,519,785 B（相差 63 字节），收益为零而打包耗时增加，**已回退**为默认档位。载荷以已压缩的二进制为主，7z 高压缩档榨不出空间。
- **内核改用「Electron 以 Node 模式运行 .cjs」形态**：实测内核可执行文件在安装包与便携产物中各占 **约 23 MB**（临时移除内核后 119.7 → 97.8 MiB），解包后占 92 MB，换成 0.7 MB 的脚本包可省下这些体积。但这会改变 AD-09 已选定的「独立可执行文件形态」，属架构决议变更，**不在本批次擅动**，留待裁决。
- **裁剪 `dxcompiler.dll`（25.7 MB）、`vk_swiftshader.dll`、`dxil.dll`**：Chromium 的 GPU 组件，裁剪可能在部分显卡/驱动路径上崩溃，属功能风险，不做。
- **移除 `LICENSES.chromium.html`（20.5 MB）**：Chromium 分发所需的许可全文，属合规要求，不做。
- **自建 Node 运行时（small-icu）或对内核可执行去符号**：需要自建工具链，且会牺牲可诊断性，不做。

#### 说明

- **行为零变更**：本批次未改动任何内核或界面源码（`git status` 只有打包配置、冒烟脚本与文档），312 项测试与全部校验口径不变。
- **等价抽查**：同一工作区上，`list`、`inspect <id>`、`validate` 三条指令在「随包内核可执行文件」与「源码入口 `node kernel/entry/cli.ts`」两侧的 JSON 输出**逐字节一致**（799 / 2162 / 445 字节）。
- **三种启动方式回归**：开发产物、免安装目录、便携单文件各跑一遍界面冒烟，均为 **9/9**。
- **打包环境注意**：本机 electron-builder 下载工具链时报证书验证失败（根证书只在系统存储中），需以 `NODE_OPTIONS=--use-system-ca` 打包。属环境事实，未写入仓库配置以免影响其他环境。

#### 界面冒烟扩充（2 项）

- 恢复确认弹窗展示预演的覆盖提示与逐文件清单。
- 确认后恢复执行并写回原件（夹具在造好备份后改写原件，断言磁盘内容真的回到备份取值——这条链路无法被「只点了按钮」蒙混过关）。

### 二期：界面恢复入口（N-12 收口，二期功能面全清）

#### 新增

- `restore --list [<Skill 标识>]`：备份列表的**读取出口**。界面不得直读工作区文件（含备份目录），因此列表由内核读取各载体清单产出——每项给出 Skill 标识、时间戳、载体类型、文件数与载体位置，并给出 `total` 与 `filtered_by`；只读清单、不校验载体内容，工作区未初始化或备份目录不存在时返回空列表（退出码恒为 `0`，空列表是正常结果）。给出标识时按参数类问题校验命名规范，不做路径拼接。
- 备份管理页的**恢复流程**：列出可用备份（标识、时间戳、载体类型、文件数）→ 点「恢复」→ 确认弹窗展示内核 `--dry-run` 的真实预览（将写回的文件清单、目标位置现状与结论提示）→ 确认后由桥接器带 `--yes` 执行 → 结果与问题码进状态栏。取消时不发写请求。
- 确认弹窗新增**逐文件清单**区块（读预演载荷里的 `files`），恢复与安装类预览共用。
- 界面冒烟新增一项检查（共 7 项）：备份管理页经内核列出真实备份并给出恢复入口。

#### 变更

- `restore` 的预演载荷补 `notes`：写明目标位置现状（覆盖现有原件 / 按备份重建）、该标识是否已登记，以及「恢复只读消费备份载体」。确认弹窗只展示内核给出的影响范围，不自行编造。
- 备份管理页移除「一期没有列出既有备份的指令、备份载体目录需要自行查看」的过期提示。
- 桥接层新增 `restoreList(id?)` 门面（`restore` 至此有两条门面方法：恢复与列表）。
- 契约回写：第 4.16 节补 `--list` 的语法、行为、载荷与退出码；第 7.3 节 `N-12` 标记为已完成。
- **固化第四条工程约定**：含子进程的指令断言走独立进程取退出码与标准输出。由来：端到端测试的 `capture()` 就地替换标准输出，被测指令一旦内部 `spawn` 子进程，测试框架自己写往同一管道的协议消息会被一并捕获，表现为「断言无故失败」；`runCli()` 用真实子进程隔离这条路径。

#### 说明

- 内核业务逻辑零改动：本批次只扩展了参数解析（`--list` 登记为布尔选项）与载荷（列表载荷、预演提示），恢复的写路径、原子性与确认级别都沿用既有实现。
- 界面仍遵守「数据源唯一」：备份列表、预览与执行全部经内核子进程与标准输出，渲染层不接触 Node，也不读 `backups/` 目录。
- GUI 侧改动集中在渲染层与桥接门面（备份管理页、确认弹窗、`restoreList`），内核分层校验照常通过。

### 二期：运行时探测与版本比较（N-10 收口）

#### 新增

- `deps` 的**运行时维度**：按平台解析声明的外部运行时（POSIX 用 `command -v`，Windows 用 `where`），执行其 `--version` 并把输出解析为语义化版本，再按元文件里的范围表达式判定；载荷新增运行时条目——运行时名称、期望的约束原文、探测到的版本、命中命令的位置与结论。
- 问题码新增**运行时类**：`E-RUN-001` 运行时不可用、`E-RUN-002` 版本不满足、`E-RUN-003` 版本无法解析、`E-RUN-004` 约束无效、`E-RUN-005` 探测失败；该类与依赖类一并归入退出码 `6`。依赖类中原有的 `W-DEP-005` 标记为已由该类取代（保留编码不复用，不再产出）。
- 探测支持 **PATH 注入与执行器注入**：测试可完全脱离真实外部运行时，分别覆盖 `command -v` 与 `where` 两个分支。

#### 变更

- 内核对第三方依赖新增 `semver`（纯 JS，语义化版本范围判定）与 `@types/semver`（仅构建期类型）。理由：`^1.2.3`、`~1.2.3`、`>=1.0.0 <2.0.0`、`1.2.x` 这类范围表达式自研解析易错，而判定正确性直接影响依赖结论。内核第三方依赖此后为四个：`yaml`、`tar`、`node-stream-zip`、`semver`。
- **探测结果不入索引、不入运行期结论**：运行时是否可用取决于执行环境，索引保持环境无关，同一份索引在不同机器上含义一致。`scan` 与 `validate` 的结论仍只取决于 Skill 自身的内容与声明——运行时缺失不会把内容完好的 Skill 判为校验不通过。
- 文档回写：元数据规范 3.3（`runtime` 的约束写法与「运行时依赖的边界」）、5.3（新增「判定边界」一行，明确本项只判定 Skill 之间的依赖）；指令契约 4.13（行为 1/2 由「一期未实现」改为正式语义，补探测边界、输出载荷与退出码）；结果规范 4.2/4.3/5.2/5.3（新增运行时类与依赖档映射）；需求文档新增「运行时依赖的探测边界」裁决批次条目；`skill_meta.schema.json` 的 `runtime` 描述同步；缺口登记表 `N-10` 关闭。
- 交付盘点文档 `docs/one-summary.md` **整体刷新为二期现状**（标题与文档状态、指令表补第 16 条、问题码与写入权限边界、关键机制、规模与测试计数、缺口登记表、二期 backlog），并注明一期收官时点的快照以 `CHANGELOG.md` 的「一期收官」条目为准。

#### 说明

- 失败面**收窄而非吞掉**：约束不可解析时直接报错且不再探测（拿非法约束去比版本没有意义）；命令解析失败、`--version` 超时或无法执行、输出解析不出语义化版本各归明确问题码。`--version` 输出兼容 `v22.1.0`、`git version 2.43.0.windows.1`、`Python 3.12.1` 等写法，解析不出时不猜版本。
- 命令一律以参数数组调用、**不经 shell**；运行时名称只作为参数传递（POSIX 侧用 `command -v "$1"` 的位置参数，不做文本拼接）。
- 本批次未改动界面：`deps` 载荷只新增字段，对既有消费方向后兼容。

### 二期：内容漂移定位（N-07 收口）与备份时间戳唯一化

#### 新增

- 索引派生区新增**逐文件内容摘要** `digests`：键为文件相对 Skill 目录的路径，值为该文件字节流的摘要，与聚合指纹共用同一参与范围与排除规则（排除元文件、版本控制目录、临时文件与符号链接）。登记、安装、更新、恢复与导入都会写入。
- 内容一致性校验（V-07）由聚合级报告升级为**逐文件定位**：内容变化、新增与删除三种情形各成一条，每条给出文件相对路径与新旧摘要，仍是警告级、不改变退出码。
- 备份载体清单的 `timestamp` 具备**唯一性**：同一 Skill 在同一秒内产出多份备份时，从第二份起按毫秒精度扩展（`.001` 起），清单取值与目录名一一对应；备份枚举按真实先后排序（纯秒级取值等价于该秒的 `.000`，避免字符串比较把毫秒形式误排在前面）。

#### 变更

- 备份载体清单在 schema 中补登 `type` 为必填字段（上一批次已写入该取值，schema 未声明必填），`timestamp` 模式允许毫秒后缀。
- 导出物不含逐文件摘要，且**不计入被剥离项清单**：它是内核内部派生数据，既非敏感信息也非用户自研字段，列入清单只会掩盖真正的剥离项。导出记录的字段集不变，聚合指纹仍在导出物中；导入时按磁盘现状重算两级取值。
- `inspect` 的记录载荷随索引原样带出 `digests`，便于宿主在内容漂移时定位。
- 契约与规范回写：元数据规范 2.2（时间戳唯一性）、2.3（逐文件摘要规范）、4.4（派生区新增可选字段与必填性说明）、5.4（输出要求改为必须逐文件列出）、5.5（说明 `digests` 不参与派生区篡改检测）；索引格式规范 3.2 与 5.3；指令契约 4.6、4.8.1、4.12、4.14 与 7.3（N-07 关闭，新增 N-12）。

#### 说明

- 新增可选字段属**向后兼容**变更，索引规范版本保持为 `1`：旧索引缺 `digests` 照常读取，扫描一次即回填，回填之前内容一致性校验退化为聚合级报告，不猜测具体文件、不误报。
- 时间戳唯一化选择在**写入侧**落地（而非读取侧去重）：时间戳是备份的对外标识与 `restore --timestamp` 的寻址依据，唯一化才让它真正可寻址；目录名与清单取值一一对应，不再出现「一个取值对应多份载体」。毫秒形式只出现在备份载体清单，其余时间字段仍为秒级精度。
- 本批次未引入新的第三方依赖，内核依赖仍为 `yaml`、`tar`、`node-stream-zip`。

### 二期：备份恢复与载体枚举（N-08 收口）

#### 新增

- 第 16 条指令 `restore <标识> [--timestamp <时间戳>] [--dry-run] [--yes]`：从备份载体把内容写回中心库、按落位计划重分发副本、刷新或重建索引记录；省略 `--timestamp` 时取该标识最新的一份备份。载荷给出逐文件路径与文件数量、备份位置与时间戳与载体类型、各目标的重分发结果，以及「请执行扫描」的提示。
- 备份载体枚举：S-08 新增按标识枚举载体（按清单声明的时间戳升序）与载体自身完整性校验（类型是否受支持、内容目录是否存在、文件数与载体摘要是否与清单一致）。
- 备份载体清单新增 `type` 字段，本批次取值域仅 `full`（完整文件载体）；不支持的取值拒绝恢复，扩展留给后续。
- 问题码新增 `E-BAK-003`（没有可恢复的备份）、`E-BAK-004`（载体损坏）、`E-BAK-005`（载体类型不受支持），结果规范同步登记。
- 调度层新增 `restore` 的确认级别（常规确认，目标已有原件时确认内容写明将覆盖）+ 动作标签与预演载荷；命令行帮助新增该指令；`--timestamp` 登记为取值选项。界面桥接层新增 `restore` 门面，指令门面增至十六条。

#### 变更

- **指令清单由 15 条增至 16 条**：契约第 3 节总表新增第 16 行、新增第 4.16 节完整契约（用途、与 `import` 的分工、语法、七条行为、选项语义、输出载荷、退出码、预演与确认）；需求文档 5.2 节、架构文档附录 A、交付盘点文档与 README 同步；构建期契约校验的指令数断言由 15 改为 16。
- 契约第 4.8.1 节载体清单把 `type` 列为必填字段，写明取值域与「不支持的取值拒绝恢复」的语义。
- 缺口登记表 `N-08` 标记为已完成：备份载体的恢复与载体枚举一并收口。备份保留策略不变——不自动清理，恢复只读消费。

#### 说明

- 恢复不判定校验结论：已登记的记录保持原运行期结论不动；未登记时重建记录并取保守值（`invalid` 加 `E-INDEX-002`），两种情况都在载荷里提示执行扫描——判定权仍归扫描。
- 恢复保持副本原有可见性：已存在的副本按磁盘现状保留启用或禁用，不存在的副本按元文件声明创建；载体内容在恢复全过程中不被改动。
- 本批次未引入新的第三方依赖，内核依赖仍为 `yaml`、`tar`、`node-stream-zip`。

### 二期：来源扩展（本地部分）

### 二期：来源扩展（远端部分，N-05 收尾）

### 新增

- 远端来源支持：安装与刷新都接受远端 Git 地址与远端归档地址。远端仓库克隆后复用本地仓库的读取路径，远端归档下载后复用本地归档的解压路径（含单层自动下钻与全部路径穿越防护）。
- 远端问题码补全：`E-SRC-006` 超时、`E-SRC-007` 下载失败、`E-SRC-008` 体积超限、`E-SRC-009` 协议不在白名单、`E-SRC-010` 需要认证。来源类编码至此覆盖本地与远端两种形态。
- 扫描式安装：`install` 的远端地址按路径形态推断类型——以归档扩展名结尾的按归档处理，其余按仓库处理；`update` 以元文件声明的类型为准。

### 变更

- 归档内容根支持**单层自动下钻**：解压后根目录不含元文件时，若根下恰好存在一个子目录且该子目录内直接含元文件，则下钻一层；多个候选或下钻后仍缺失都按获取失败上报并写明原因。
- 远端获取的安全与稳定性约束：协议白名单（https 与 git，另允许指向本机回环地址的 http）、克隆与下载都有超时、下载有体积上限（响应声明与实际接收两处校验）、克隆与下载都在临时目录内完成且失败不残留。
- 克隆不使用浅克隆（`--depth 1`）：浅克隆在 dumb HTTP 上不被支持，而自建镜像常用该协议；代价是克隆体积更大，由超时上限兜底。
- 克隆时禁用交互提示（`GIT_TERMINAL_PROMPT=0`）：私有仓库立即失败并归入认证类问题，不会挂起等待输入。

### 新增

- 来源扩展的本地部分：安装与刷新都接受**本地 Git 仓库路径**与**本地归档文件**（zip、tar、tar.gz）作为来源，与原有的本地目录来源并存。
- 来源声明扩出本地形式：元文件的 `source` 增加 `location` 字段，指向本机的仓库目录或归档文件；给出它之后不再要求 `url` 与 `ref`。远端形式（Git 地址与下载链接）登记为下一批次，传入时按来源类错误拒绝，不静默忽略。
- 问题码新增 `E-SRC-003`（来源获取失败）、`E-SRC-004`（归档或仓库内容不安全）、`E-SRC-005`（来源所需的外部命令不可用），四条来源类编码路径至此完整。
- 刷新语义扩展：来源为本机仓库或归档时，先按声明重新获取内容并替换中心库原件，再重分发副本、最后写索引；任一步失败即整体失败。

### 变更

- **内核对第三方运行时依赖的策略放宽**：新增 `tar` 与 `node-stream-zip` 两个纯 JavaScript 依赖用于归档解压。理由：归档解压无法在不写一个完整解析器的前提下自研，而这两个库都是纯 JS、无原生扩展，随内核一起打包进单文件可执行产物，不引入编译期负担。`git` 走系统命令而不引入库，缺失时给出明确错误与安装引导。内核的第三方依赖此后为三个：`yaml`、`tar`、`node-stream-zip`。
- 安装与刷新的入口改为异步：来源获取涉及子进程与文件解压，必须等待完成；同步主体保持不变，临时目录由异步外壳统一释放。

### 说明

- 安全边界：归档条目逐条校验（拒绝绝对路径、上级目录跳转与链接条目），解压时逐级确认父目录为真实目录以堵住符号链接穿越，来源标识按白名单校验且禁止以短横线开头，`git` 一律以参数数组调用不经 shell。
- 本地仓库读取的是**已提交内容**（`git archive`），不含版本控制目录与未提交改动。该语义已裁决维持：已提交内容确定、可复现，且天然排除版本控制目录与构建产物——「从来源安装与更新」取的是发布态，不是工作区临时状态；未提交改动不可见是该语义的既定取舍，已写入契约。
- 归档不支持内容根外层再套一层目录：内容根必须直接包含元文件，否则按获取失败上报并给出说明。

### 一期收官（2026-10-15）

一期功能面**没有已知的未实现项**。完整盘点见 [docs/one-summary.md](docs/one-summary.md)，要点如下：

| 交付面 | 结论                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 功能   | 契约清单的 15 条指令全部实现；桌面外壳含仪表盘、详情、安装、校验报告与确认流程，并已打包为安装包与便携单文件                 |
| 契约   | 四份规范文档与四份 JSON Schema 齐备，字段一致性由契约测试守住；问题码 42 个、退出码 7 档，专属优先原则已写入规范             |
| 架构   | 内核零界面依赖由构建期检查硬拦；GUI 只经子进程与标准输出通信；副本按约定推导位置，原件缺失仍可回收                           |
| 工程   | 254 项测试、构建期检查、界面冒烟与打包验证；三条工程约定（用例数核对、改行为回看用例语义、选项登记一致性）均来自实际踩过的坑 |

缺口登记表 11 项中 7 项已实现，其余 4 项（来源扩展、每文件漂移定位、备份恢复、运行时探测与版本比较）归入二期；另有 2 项已知限制（内核可执行文件体积、备份载体枚举）不阻塞。二期规划与优先级建议见盘点文档第 7 节。

### 新增

- 内核 L4 存储层：YAML 序列化、原子写入与事务、文件锁、路径解析与越界防护、工作区布局、索引持久化、中心库受控副本。
- 内核 K-01 元数据模型：元文件与索引的类型定义、字段校验、依赖存在性与环路检测、索引版本校验。
- 内核 K-02 发现与登记服务：扫描技能根目录、组装与更新索引记录、计算运行期结论。
- 内核 K-03 索引服务：初始索引构造、索引载入与写回，未识别字段原样保留。
- 内核 K-04 生命周期编排：安装与卸载两条流程，含元数据校验、依赖检查、冲突检测、写入中心库、创建受控副本、登记索引与失败回滚。
- 内核 K-07 冲突检测：落位映射冲突与目标占用冲突，只报告不处置。
- 内核 K-09 完整性指纹：按契约规则计算内容指纹。
- 内核 K-10 目标适配：把元文件声明的落位目标解析为工作区内的绝对路径。
- 内核 K-05 校验引擎：只读校验元数据、配置与索引，产出分级报告；实现 V-07 内容一致性、V-14 派生区篡改、V-16 跨文件投影一致性、V-17 引用路径可达四条规则，并把 V-01 至 V-06、V-08 至 V-13、V-15、V-18 汇总进同一份报告。
- 内核 K-08 备份服务：卸载前把中心库原件完整备份到工作区的备份目录，并输出备份位置、时间戳与文件数；恢复一侧留待二期。
- 存储层 S-08 备份载体读写：备份目录布局、逐文件校验、备份清单、失败清理。
- 调度层 C-03 确认与预演策略：确认级别登记表（指令到级别的唯一事实源）、确认判定、提示渲染与回答判定；交互通道由宿主注入，便于在无终端环境下测试。
- 内核 K-06 依赖分析服务：依赖条目分级（可用、已登记但不通过、不在索引）、传递影响面、牵涉指定标识的依赖环。
- 内核 K-03 查询能力：列表筛选与分组计数、单个 Skill 的完整信息与指纹比对、配置区原样读取。
- 内核 K-08 导出：备份文档组装、敏感与未知字段剥离并登记、目标路径防护、原子写入。
- 指令：新增 `list`、`inspect`、`config get`、`deps`、`export` 五条只读或导出类指令，全部零写入。
- 内核 K-04 生命周期编排补齐启用、禁用与刷新：受控副本按需补齐、副本内技能元数据文件改名切换可见性、索引状态与目标摘要同步，以及按磁盘现状重投影记录并刷新派生区。
- 指令：新增 `enable`、`disable`、`update`、`config set` 四条写操作指令。
- 指令：新增 `import`，从导出的清单恢复索引记录——整体校验后逐条登记，既有标识一律跳过不覆盖，只作用于索引层不触碰磁盘文件，运行期结论交由后续扫描判定。
- 四份 JSON Schema：元数据、索引、结果封装与备份文档的机器可读形态，逐字段对齐四份规范文档；`schemas/` 不再是空占位。
- 桌面外壳（`gui/`）：Electron 主进程窗口与生命周期、预加载白名单、Vue 3 渲染层、electron-vite 构建配置与 electron-builder 打包配置。
- G-02 内核桥接器：以子进程调用内核指令入口并解析结构化结果，提供十五条指令的具名门面；写操作走「预览 → 确认 → 执行」，取消时不发写请求；通道失败映射为宿主通道问题码并保留原始诊断。
- 渲染层页面：仪表盘卡片列表（状态优先级 失效 > 禁用 > 启用）、详情/安装/校验报告/确认弹窗、空工作区引导、底部操作日志。
- 界面冒烟脚本：经 DevTools 协议校验真实界面，支持开发产物与打包产物两种模式。
- 桥接层测试 6 项：以真实子进程联调十五条指令、预览与取消路径、确认拒绝的原样回传、通道失败映射。
- 内核独立可执行文件：构建脚本把内核连同依赖打成单文件、生成单文件可执行代码块并注入 Node 运行时副本，产出 `build/kernel/skill-manager.exe`；打包时随应用复制到 `resources/kernel/`，打包产物无需任何环境变量覆盖即可自洽运行。
- 内核新增可执行形态入口：与源码形态入口共用同一套指令实现，只去掉「是否作为入口被直接执行」的判定。
- 应用图标：程序化绘制，不依赖任何图形库——形状用带符号距离场加解析抗锯齿，PNG 与 ICO 用最小编码器直接写出；产出七档尺寸（16 至 256）的 ICO 与 PNG，配色沿用界面规范的香槟金强调色。
- 图标生成脚本 `build:icon`：图标的唯一来源是脚本本身，任何尺寸都能精确重生成。
- 目标落位根约定：副本位置改为按「工作区根 + 目标标识 + Skill 标识」推导（落位根为 `.<目标标识>/skills`），元文件声明的落位路径必须与该约定一致；副本定位从此不依赖中心库原件是否存在。
- 逐文件落位：元文件的 `file_map` 提供时按映射逐文件落位（支持目标子目录），缺省时整目录复制；落位计划逐文件进入载荷。
- `install` 的 `--target` 与 `--scope` 真实生效，`--mode` 接受 `copy` 并显式拒绝其他取值。
- 卸载与刷新补齐影响范围：卸载给出逐文件路径列表与数量，刷新按落位计划重分发已存在的副本并保持可见性。
- 索引运行期结论区新增最近扫描时间字段，只由扫描动作维护；`inspect` 的「最近扫描时间」取自该字段。
- 依赖判定的职责边界收敛：判定唯一实现在元数据模型服务（依赖判定与环检测），登记与刷新服务是收敛器，依赖分析服务只做呈现，不得另写判定逻辑。
- 跨层契约词汇表：问题码常量与结果形状的唯一定义处，位于依赖方向最底层。
- 指令调度层：参数解析、指令注册与路由、结果装配与退出码派生、三种输出通道渲染。
- 命令行入口：15 条指令的最小闭环，一期指令清单至此全部可用。
- 测试共 268 项（单元 209、契约 9、端到端 50），覆盖原子写入中断与瞬时占用重试、路径穿越注入、幂等扫描、依赖失效级联、不合格记录生成、安装卸载的幂等与依赖冲突判定、校验的比对规则与只读性、备份的校验失败与失败清理路径、确认级别的跳过与拒绝路径、只读指令的分组计数与导出剥离、启用禁用的幂等与往返一致性、刷新的投影与派生区语义、配置写入的取值域、导入的格式校验与冲突跳过、指纹守卫、桥接层的子进程联调、逐文件落位与目标选项、原件缺失时的副本回收、重分发的失败原子性、本地与远端来源的安装与刷新、归档路径穿越与 `git` 缺失的错误分类、协议白名单与体积超限与超时与认证缺口的归类，以及选项登记、schema 样例校验与 schema 与规范文档的字段一致性。

### 变更

- 根配置新增 `typecheck` 与 `test` 脚本；编译配置改为只做类型检查，不产出编译产物。
- 桌面外壳包暂不引入 Electron 相关依赖。
- `install` 支持 `--dry-run` 预演与 `--library-only` 仅落库；`uninstall` 支持 `--dry-run` 预演与 `--keep-library`。
- 内容指纹改为在写入中心库之前计算，使预演与实装得到同一取值。
- 安装登记时的启用状态由安装动作决定：常规安装置为已启用，仅落库置为已禁用。
- `validate` 退出码按指令专属规定实现：存在错误级问题返回 `1`，仅警告返回 `0`，`--strict` 下警告也返回 `1`，参数类问题返回 `2`。
- `uninstall` 改为卸载前强制备份：备份校验通过才允许删除内容，备份失败即中止且不改动环境；`--hard` 与 `--keep-library` 同样先备份。载荷新增备份位置、时间戳、文件数与载体摘要。
- 投影一致性（V-16）的比对集合收窄：`status` 与 `targets.enabled` 属运行期事实而非元文件投影，移出比对，避免合法操作被报为投影不一致。
- 新增 `BAK` 类别问题码 `E-BAK-001` 与 `E-BAK-002`，并归入退出码 `5`。
- 备份目录名把时间戳中的冒号替换为短横线（冒号在部分文件系统上非法），清单内仍保留契约格式的原始时间戳。
- 确认级别落地：`install` 为轻确认、`uninstall` 为强制二次确认、`--hard` 再升一档；`--yes` 跳过全部级别；无终端环境未给出跳过选项时拒绝执行并返回参数类问题，避免脚本在等待输入上挂起。
- 预演与确认解耦：`--dry-run` 不要求确认、不写盘，载荷给出将发生的变更与文件数量。
- 卸载的影响范围说明补齐文件数量：预演载荷新增逐条明细与合计文件数，执行结果新增已移除文件数（部分收口 N-06）。
- `scan` 的依赖结论改为级联：依赖方在其被依赖对象失效时一并判为校验不通过，且沿依赖链传递。此前只报告了被依赖对象自身的问题，依赖方仍被标为通过，与 CON-09 的配套规则、元数据规范 5.3 以及校验与依赖分析的判定都不一致。
- `deps` 采用指令专属退出码：存在未满足的依赖时返回 `6`，其中「被依赖对象校验不通过」按结果规范 5.2 的专属优先条款一并归入未满足，不再落到通用派生的 `1`。
- 元文件的读取与解析抽到元数据模型服务，登记、校验与单个查看共用同一实现。
- 原子写入在替换目标时对瞬时占用做有限重试（Windows 上覆盖既有文件可能因安全软件或索引服务短暂持有而报 EPERM、EACCES、EBUSY）。实测十轮全量测试可复现一次偶发失败，重试后十二轮连续全绿；重试用尽仍按 E-IO-002 报错，真实占用不会被掩盖。
- 参数解析改为显式登记取值选项：未登记的选项一律按参数类问题拒绝，不再当成取值选项吞掉后面的位置参数。此前 `--check`、`--no-config`、`--no-secrets`、`--all`、`--tree` 都因未登记而报错或悄悄改变语义，现已逐项登记并加契约测试守住「文档写明的选项必须已登记」。
- 确认提示的动作名称改为按指令取表：此前刷新操作会显示成「卸载」。
- 轻确认的提示新增可选的单行摘要，导入用它给出「将登记 N 条记录」，其余指令的单行提示保持原样。
- 指纹计算补上守卫：目标不存在或不是目录时抛错，不再返回空内容哈希。空内容哈希是空文件与空目录的合法指纹，用它表示「目录不存在」等于给调用方一个看似正常的无意义取值。
- 新增开发期依赖 `ajv` 与 `ajv-formats`（仅用于测试中按 JSON Schema 校验样例，内核运行时依赖仍只有 `yaml`）。
- 根脚本调整：`typecheck` 拆成内核与界面两侧分别执行；`build:desktop` 由占位实现改为调用 electron-vite 构建三端产物；新增 `smoke:gui`。
- 静态检查接入 Vue 的正确性规则（模板格式交给 Prettier，避免两套格式化规则互相打架），并禁止渲染层引用 Node 模块与 Electron 运行时。
- 忽略构建输出目录 `gui/out`。
- 界面侧新增依赖：electron、electron-vite、electron-builder、vue、@vitejs/plugin-vue、vue-tsc、eslint-plugin-vue、vue-eslint-parser；内核运行时依赖仍只有 `yaml`。
- `build:kernel` 由占位实现改为真实构建；新增开发期依赖 esbuild（打包内核）与 postject（注入代码块）。
- 内核两个入口的顶层 await 改为等价的 then 链：单文件可执行只支持 CommonJS，而顶层 await 无法打包为 CommonJS；行为与退出码不变。
- `update` 语义扩展：刷新时会重分发受控副本，任一处落位失败则整体失败、索引保持调用前状态；`--target` 由「无可用语义」改为「只重分发指定目标」。为此顺序固定为「先重分发副本，再写索引」，避免出现记录已刷新而副本陈旧的中间态。
- `file_map` 的语义明确化：它从「卸载时的回收清单」变为「落位清单」——回收范围是副本目录本身，与映射内容无关；因此映射只列出 SKILL.md 的元文件，其副本里也只有 SKILL.md。
- 载荷中的位置统一为相对工作区的可移植路径（卸载的副本列表与原件路径由绝对路径改为相对路径）。缺口 `N-02`、`N-03`、`N-06`、`N-09`、`N-11` 一并关闭。
- 打包配置显式指定图标路径：默认只在资源目录下按约定名查找，本项目把图标放在 `packaging/`，因此显式给出以免回落到默认图标。
- 冒烟脚本修两个缺陷：调试端口固定会把探针连到上一次遗留的实例上（那种「连得上但状态不对」的假象比连不上更难排查），改为每次运行取一个空闲端口；结束应用时只杀直接子进程会留下占用端口的实例，改为结束整个进程树。

### 说明

- 已实现 4 条指令，其余 11 条待后续批次。
- 一期指令清单 15 条全部实现，可进入契约规范、JSON Schema 与桌面外壳批次。
- 校验规则 V-01 至 V-18 已全部有实现落点；V-09 由元文件解析阶段承担，V-12、V-13 复用 K-01 的依赖判定。
- 工程约定：端到端测试必须同时核对实际执行的用例数，只断言「无失败」不足以发现用例被静默跳过；改行为时必须回看既有用例的语义，防止用例前提被静默削弱。
- GUI 批次约束（待办）：内核桥接器调用写操作时必须显式给出 `--yes` 或建立真实交互通道，否则 `install` 与 `uninstall` 会被参数校验拦下。
- 已知缺口已逐条登记在指令契约规范第 7.3 节：原 N-01（卸载前备份）本批已实现，其余为 `--target` 与 `--scope` 与 `--mode`、逐文件落位映射与每文件落位计划、确认级别、Git 与归档来源、卸载输出的逐条路径与数量，新增 N-07（内容漂移定位到具体文件）与 N-08（备份载体的恢复），后两项属二期。
- 备份保留策略：一期不自动清理，保留全部备份；恢复能力属二期，见缺口 N-08。
- 遗留限制：中心库原件缺失时，落位路径无从读取，卸载只能移除索引记录而无法回收既有副本；该限制已由生命周期测试固定，回收能力的补全依赖落位路径的存储位置决策。
- 已知缺口更新：N-04（确认级别）本批已实现；新增 N-09（中心库原件缺失时回收受控副本，归逐文件落位批次），解决方向为把受控副本定位改为可推导路径。
- 待回写项：无。上一批登记的两项（非终端拒绝行为、轻确认适用对象）已按裁决回写指令契约第 2.4 节。
- 已知限制：`deps` 不检测外部运行时、也不比较版本约束（已登记为缺口 N-10，归二期）。
- `update` 的一期语义：只按磁盘现状刷新索引记录与派生区字段，不向来源拉取新版本、也不重分发副本；契约第 4.11 节的前置条件（可解析来源）与行为 5（全部目标一并更新）在本地刷新语义下不适用，来源类型非本地的记录一律按来源类问题拒绝。该差异待裁决后回写契约。
- 已知限制：`import` 登记的记录未经磁盘验证，运行期结论取保守值（校验不通过）并提示导入后执行扫描；`--on-conflict` 在一期没有可用语义（冲突一律跳过），传入时按参数类问题拒绝而不静默忽略。
- 界面冒烟检查抓出并修掉两个只在运行时才会暴露的缺陷：主进程以 ES 模块运行却使用了 `__dirname`（窗口创建失败但进程不退出，仅看「进程存活」会误判为通过）；沙箱化的预加载脚本无法加载 ES 模块（渲染层拿不到任何内核接口，界面静默失效）。后者改为输出 CommonJS 预加载以保住沙箱隔离。
- 打包产物：`build/desktop/` 下生成免安装目录、NSIS 安装包与便携单文件（各约 107 MB）。内核可执行文件尚未产出（`build-kernel.mjs` 仍是占位），打包时会跳过该项，运行期找不到内核将报宿主通道异常；打包模式下的界面闭环验证通过环境变量指向内核入口完成。
- 界面侧已知边界：未设置应用图标，使用 Electron 默认图标；备份面板只能按路径导出与导入——一期没有列出既有备份载体的指令，该能力尚未在契约中定义。
- 网络受限时 Electron 运行时二进制需指定镜像后安装，做法记在 `gui/README.md`。
- 内核可执行文件已验证可用范围：版本、初始化、扫描、列表、校验、卸载（写操作带跳过确认）、导出，退出码与源码形态一致。
- 打包产物验证已去掉环境变量：免安装目录与便携单文件都在**不设置任何内核路径变量**的情况下跑通「初始化 → 扫描 → 列表」并渲染真实卡片。
- 打包产物体积：安装包与便携单文件各约 129 MB，其中内核可执行文件约 88 MB——它是 Node 运行时的副本，体积偏大是该分发形态的固有代价。
- 图标验证：ICO 结构含七档尺寸、PNG 为 256×256 RGBA 且签名正确；从可执行文件提取的关联图标中心像素与「标记色以 0.82 不透明度叠加香槟金」的计算值一致，证明图标确已内嵌；打包日志中的「使用默认 Electron 图标」提示消失。图标外观另经外部视觉工具读回确认：圆角方形香槟金底板、三条居中横杠长度与明度递减、无锯齿与偏色，语义读作「条目列表」。
- 三种启动方式（开发产物、免安装目录、便携单文件）的界面冒烟均为 6/6 通过，运行结束后无遗留进程。
- 已知限制：目标落位根约定使副本位置不再由元文件自由指定，偏离约定的声明会被拒绝登记；这是为「原件缺失仍可回收副本」付出的代价，已写入元数据规范 3.5 节。
- 已知限制：契约的问题码 `E-CONFLICT-002`（落位映射冲突）在约定下不再可能由「两个目标指向同一路径」触发，只可能来自 `file_map` 内部冲突；该码的登记含义未变，触发面收窄。
- 缺口登记更新：`N-05` 的本地部分已实现，远端部分（Git 地址与下载链接）登记为下一批次；二期剩余项为远端来源、每文件漂移定位、备份恢复、运行时探测与版本比较。
- 缺口登记更新：`N-05` 全部实现并关闭；二期剩余项为每文件漂移定位、备份恢复与载体枚举、运行时探测与版本比较、内核体积优化。
- 远端来源的测试方式：不依赖真实外网，用本地 HTTP 服务器模拟远端——归档用静态文件服务，Git 仓库用 dumb HTTP（裸仓库加 `update-server-info` 后静态服务）验证真实的克隆路径。

## 0.1.0

### 新增

- 文档基线：需求规格、系统架构、界面设计与四份契约规范。
- 仓库骨架：工作区配置、两个包的清单与编译配置、静态检查与格式化配置、四个构建与校验脚本、目录结构。

### 说明

- 一期功能清单已冻结，详见需求规格附录 D。
- 本版本不含业务逻辑实现。
