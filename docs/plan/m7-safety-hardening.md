# M7 并发、归档与路径安全硬化实施计划

| 项目 | 内容 |
|---|---|
| 文档状态 | 已规划，尚未开始实现 |
| 分支 | `safety/m7-concurrency-archive-hardening` |
| 起点 | `main` 的 v0.9.0 发布收口后提交 `3c5b6b0` |
| 范围 | 跨进程写锁、写入原子性 / TOCTOU、防 ZIP/TAR 资源耗尽、Windows 路径规范化 |
| 不在本批范围 | pipeline / experience 的 GUI 产品化、命令注册表单一事实源、全仓覆盖率门槛 |

## 1. 背景与目标

v0.9.0 已将问题处理、经验回归与只读代码探查发布到主干，但核心写路径仍只具备进程内互斥；归档解压也尚未限制解压后的资源消耗。本批在不改变现有 CLI 契约、Result 八字段封装和已有工作区数据格式的前提下，补齐写盘安全边界。

目标：

1. 同一工作区被 GUI、CLI 或多个 CLI 进程同时写入时，所有写操作串行化；
2. 任何落位 / 安装 / 更新 / 恢复写入失败后，都只回滚本次操作拥有的内容；
3. 本地和远端 ZIP / TAR 归档均受条目数、单条大小、累计解压大小和压缩比约束；
4. Windows 上同一路径的大小写、分隔符和可解析短路径形式不会导致宿主归属误判；
5. 每项修复均有竞争、故障注入或恶意归档测试，不只验证正常路径。

## 2. 约束

- 不得静默删除不属于本次事务创建的文件；遇到外部变化必须返回可读冲突问题码。
- 锁获取、等待、超时与 stale-lock 恢复必须可观察，不能无限挂起。
- 归档预算必须在写入前和写入过程中都执行；不得再对不受限条目使用整条 `entryData()` 物化。
- 继续拒绝 archive 路径穿越、符号链接和硬链接；本批新增资源限制不降低既有防护。
- Windows 路径修正不得将不存在的计划目标错误解析为外部路径。
- 常规测试不得纳入 N=5000 慢测试；保持现有 `npm test` 入口。

## 3. 任务序列

### T0：建立安全回归夹具与当前行为基线

**目标**：先把当前缺口以可重复的失败测试固定，不先写实现。

**执行状态**：**已完成（2026-11-06）**。双进程 CLI 竞态、落位故障注入（第三方文件不随回滚删除）、归档预算、陈旧锁回收、活锁超时诊断、只读零工作区写与 Windows 路径夹具均已覆盖。

- [x] 新增双进程竞争测试：两个子进程同时对一个工作区 install / update / reconcile，复现索引覆盖或写入竞态。
- [x] 新增落位故障注入：检查后由第二参与方创建目标，第一参与方失败后不得删掉第二参与方文件。
- [x] 新增 ZIP / TAR 夹具：超条目数、超单条、超累计、超压缩比，以及安全边界内归档。
- [x] 新增 Windows 路径夹具：盘符与路径大小写变化；短名测试只在系统支持 8.3 名称时运行，否则显式 skip。
- [x] 记录每条测试当前为何失败，避免把已有正确行为误标为漏洞。

**验收**：测试可稳定区分当前失败的安全行为与已有正确保护，夹具不依赖真实用户目录。

### T1：跨进程工作区锁

**目标**：以工作区为粒度实现可恢复的独占写锁。

**执行状态**：**已完成（2026-11-06）**。实现在 `kernel/store/locking/index.ts`：`open(...,'wx')` 原子建锁、owner token 校验释放、PID 存活判定回收、超时诊断；加锁统一收口在路由层 `kernel/dispatch/registry/index.ts`，避免逐个处理器加锁漏掉插件/导入/恢复/宿主卸载等路径。锁文件位于系统临时目录（按工作区绝对路径哈希命名），因此预览与只读路径不会在工作区留下任何痕迹。验收见 `tests/unit/locking.test.ts`（12 项）与 `tests/e2e/cli-concurrency.test.ts`（3 项，真实双进程）。

- [x] 定义 lock 文件格式：schema/version、pid、进程启动时间、随机 owner token、创建时间。
- [x] 用原子创建实现获取；同一进程 `withLock` 保留为排队优化，不能替代跨进程锁。
- [x] 明确等待策略：固定超时、可读 `E-LOCK-001` 诊断、持有者信息脱敏展示。
- [x] 支持 stale lock 判定：仅在 PID 已不存在或锁超过明确的安全阈值且二次确认后回收；禁止盲删活锁。
- [x] 将所有会写工作区或宿主副本的路径纳入锁：init、install、uninstall、update、restore、toggle、reconcile、scan 的索引写入、插件写操作。
- [x] 只读命令及 pipeline 的 `--probe-root` 保持无锁、零写入。

**验收**：两个独立 Node 进程竞争同一 workspace 时，结果串行、索引可解析、账本与副本一致；故意残留 lock 时给出可操作诊断而非卡死。

### T2：事务归属、TOCTOU 与回滚

**目标**：使写入和回滚仅影响本次事务拥有的文件。

**执行状态**：**已完成（2026-11-06）**。实现在 `kernel/core/adapters/land.ts`：目录类落位改为「同父 staging 组装 → 校验目标未变 → `renameWithRetry` 原子切换」；`LandWrite` 显式记录 `transaction_id` / `owned_entries` / `created_dirs`，回滚改为按归属清理而非按路径递归删除。逐文件三方合并未做（目录级原子切换已覆盖本期风险），作为后续可选项记录在此。回归见 `tests/unit/land-transaction.test.ts`（5 项）。

- [x] 为每次写入生成 transaction id，并在 staging / 回滚记录中保存写前快照、创建项与替换项。
- [x] 中心库和目录类宿主副本采用同父目录 staging + 原子切换；切换前再次验证预期状态。
- [x] 对 `file_map` 写入记录逐文件归属；冲突或外部变化时拒绝，而不是 `force` 覆盖或按路径递归删除。
- [x] 回滚不再用“当前路径存在性”推断所有权；无备份分支只能删除本事务创建的条目。
- [x] 保持既有完整备份恢复语义：已有副本写前备份仍通过 `replaceTree` 整体恢复。

**验收**：外部进程在检查后创建文件时，操作返回冲突，外部文件保留；账本保存失败、复制失败、原子切换失败三类注入均恢复到一致状态。

### T3：归档资源预算与流式解压

**目标**：本地与远端归档都有统一资源上限。

**执行状态**：**已完成（2026-11-06）**。预算逻辑集中在 `kernel/core/lifecycle/source-archive-budget.ts`；`extractZip` / `extractTar` 默认接入 `DEFAULT_ARCHIVE_LIMITS`，因此本地归档（`source.ts`）与远端下载归档（`source-remote.ts`）自动同受约束。回归见 `tests/unit/source-archive-limits.test.ts`（7 项）。

- [x] 在单一模块定义可配置常量：archive 文件大小、条目数、单条解压大小、累计解压大小、压缩比、写入时间预算。
- [x] 本地 archive 在解析前检查文件体积；远端继续保留下载字节上限，并接入同一预算。
- [x] ZIP 改为流式读取并在每个 chunk 计数；禁止对无上限内容直接调用 `entryData()`。
- [x] TAR 过滤器 / 写入路径同样检查条目与累计预算。
- [x] 超限时使用已有安全来源问题码或新增已登记问题码，消息说明命中的预算、实际值与上限。
- [x] 清理失败的 scratch 目录，且不得误删调用方提供的 archive 文件。

**验收**：每一类超限归档在达到资源上限前失败；安全小归档正常安装；错误不泄露机器绝对 home 路径。

### T4：统一路径规范化与宿主归属比较

**目标**：移除审计 / reconcile 中直接字符串前缀比较。

**执行状态**：**已完成（2026-11-06）**。共享助手在 `kernel/store/paths/index.ts`：`physicalKey()`（realpath + 最近存在祖先回填 + Windows 大小写折叠）与 `isPhysicallyWithin()`；`inventoryPhysicalKey` 改为委托同一实现，审计投影、reconcile 候选/选择/插件反查、批量 adopt 与 `adapters/roots` 的归属判定全部迁移到该 API。回归见 `tests/unit/paths-physical.test.ts`（10 项，含盘符、大小写、分隔符与 8.3 短名条件测试）。

- [x] 提取共享路径助手，统一 `resolve`、separator 和 Windows case folding。
- [x] 对存在路径使用 `realpath.native()`；对不存在路径从最近存在祖先规范化后拼接剩余段，避免把计划目标错误视为外部路径。
- [x] 将 audit projection、reconcile candidates 等 `startsWith(root)` 迁移到共享 containment API。
- [x] 保持 `store/paths` 和 `adapters/roots` 已有 `relative()` 防护的一致语义。
- [x] 添加 Windows 特定大小写 / 盘符 / separator 测试；8.3 短名仅在可复现实机上作为条件测试。

**验收**：等价路径不会产生不同 external / shared-root 结论；`/workspace-evil`、盘符不同路径、UNC 越界仍被拒绝。

### T5：全量验收与发布门槛

- [ ] `npm test`、`npm run check`、`npm run typecheck`、`npm run lint`、`npm run format:check` 全绿。
- [ ] 新增安全测试均在常规或明确独立的安全测试入口中可复现；不会误把慢基准纳入常规套件。
- [ ] 完成 Windows 打包内核与 GUI 冒烟；运行 GUI 时清除 `ELECTRON_RUN_AS_NODE`。
- [ ] 若触及文件复制、归档解压、内核打包或 Node 运行时，按 `docs/benchmark/report-0.1.0.md` 的新规则补当前版本性能基线；否则发布 checklist 明确记录不适用理由。
- [ ] 安全设计、CLI 契约、CHANGELOG 与风险登记同步更新。

## 4. 依赖关系

```text
T0 ─┬─> T1 ─> T2 ─┐
    ├─> T3 ──────┼─> T5
    └─> T4 ──────┘
```

T1 与 T3 / T4 可以并行；T2 依赖 T1，因为回滚所有权必须建立在锁模型之上。

## 5. 退出标准

本批只有在以下条件同时满足时才能标记完成：

1. `withProcessLock()` 不再是占位抛错，真实写路径已采用它；
2. 恶意 ZIP / TAR 不能耗尽内存或磁盘预算；
3. 故障注入证明 TOCTOU 下不删除外部文件；
4. Windows 等价路径的审计 / reconcile 归属结论一致；
5. 所有现有契约、打包和 GUI 冒烟回归通过；
6. release 说明明确列出并发、归档和路径安全边界。
