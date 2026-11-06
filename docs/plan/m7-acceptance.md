# M7 安全硬化 · 全量验收与发布门槛（T5）

> 执行日期：2026-11-06 ｜ 分支：`safety/m7-concurrency-archive-hardening` ｜ 版本基线：0.9.0

## 1. 结论

M7 的四项硬化全部落地并通过全量门禁：跨进程工作区写锁（T1）、落位事务归属与原子切换（T2）、
归档资源预算与流式解压（T3）、统一路径规范化与归属比较（T4）；T0 的回归夹具同时补齐。

**可以合入主干并要求下一次发布前复跑本清单。** 仍待办的两项不阻塞本批：GUI 尚未暴露 pipeline /
experience 能力（审计 P0，属产品化工作），性能基线为「冒烟级刷新」，完整再基线留到正式发版。

## 2. 门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 常规测试 | `npm test` | **961 项 / 960 通过 / 0 失败 / 1 平台跳过** |
| 契约 | `npm run check:contract` | 指令 21 条、结果封装字段 8 项、退出码 7 个、规范 7 份、schema 8 份、宿主账本问题码 2 个 |
| 分层 | `npm run check:layer` | 314 文件、1127 条相对 import 边、0 循环、0 条 allowlist |
| 依赖图 | `npm run check:arch-graph` | 逐字节一致 |
| 复杂度 | `npm run check:complexity` | 95 个复杂函数基线、0 超阈值 |
| 测试夹具 | `npm run check:test-fixtures` | 直接 `mkdtemp` 基线 0、当前 0 |
| 类型 | `typecheck:contract` / `:kernel` / `:gui` | 全部 0 错误 |
| 风格 | `npm run lint` / `format:check` | 全部通过 |
| 内核构建 | `npm run build:kernel` | SEA 产物生成、内置示范 Skill 随产物分发 |
| 内核冒烟 | `npm run smoke:kernel` | 可执行文件可运行，`init → scan → list` 闭环通过 |
| 桌面构建 | `npm run build:desktop` | 120 模块、渲染层产物生成 |
| 界面冒烟 | `npm run smoke:gui` | **94/94 通过**（运行前已清除 `ELECTRON_RUN_AS_NODE`） |
| Windows 打包 | `electron-builder --win portable` | `build/desktop/skill-manager-0.9.0-portable.exe`，114,261,306 字节 |
| 产线内核探测 | `probe-production-kernel.mjs <内核> 0.9.0` | `PRODUCTION_KERNEL_RESULT=ok version=0.9.0 actions=6 pipe_copies=302` |

打包产物 SHA256：`5A0609BA6EADCFBED7D2459B49BB6C5A36F290C8951A04B076FE2AF5E1E37354`
（与仓库内 dev 版本相互独立；用户自用安装包位于 `D:\skill-manager-app\`，不由本批改动覆盖。）

## 3. 安全回归覆盖

| 任务 | 主要测试 | 数量 |
| --- | --- | --- |
| T1 跨进程写锁 | `tests/unit/locking.test.ts`、`tests/e2e/cli-concurrency.test.ts` | 12 + 3 |
| T2 事务归属与原子切换 | `tests/unit/land-transaction.test.ts`、`tests/unit/host-landings-rollback.test.ts` | 5 + 4 |
| T3 归档资源预算 | `tests/unit/source-archive-limits.test.ts` | 7 |
| T4 路径规范化 | `tests/unit/paths-physical.test.ts` | 10 |
| 既有安全回归 | `tests/unit/source.test.ts`、`tests/unit/source-remote.test.ts`、`tests/e2e/reconcile-preview.test.ts` | 保持全绿 |

其中「只读 / 预览不写工作区」的既有契约（`reconcile-preview` 两项快照测试）在接入写锁后
仍然成立——这正是把锁文件放在工作区之外的原因：加锁本身不能改变工作区任何内容。

8.3 短名测试按计划只在本机可复现时运行，否则显式 `skip`，不会伪装通过。

## 4. 性能基线刷新记录

按 `docs/benchmark/report-0.1.0.md` 的《版本适用与刷新规则》：本批改动触及**文件复制**（落位改为
同父 staging 组装）与**归档解压**（改为流式计数），因此需要刷新记录。

本次执行的是**冒烟级刷新**（源码线、N=100、单轮），用于确认没有数量级回退：

| 场景 | N | 墙钟中位（ms） | 峰值 RSS（MB） |
| --- | --- | --- | --- |
| startup | - | 390 | 80.7 |
| scan-cold | 100 | 547 | 97.3 |
| scan-hot | 100 | 643 | 123.2 |
| validate | 100 | 556 | 116.5 |
| export | 100 | 496 | 96.1 |

环境：win32/x64、Node v24.22.0、内核 0.9.0（源码线）。

**口径说明**：这不是《双线三档》完整再基线（需 `--form both --runs 3` 并对照历史表）。
不在此处直接替换 report-0.1.0 的历史数据，避免把冒烟采样当成可比基线；
正式发版前按该报告的规则补完整再基线。

## 4.1 发版记录：v0.9.1

本批以 **v0.9.1** 收口并发布（0.9.1 只含安全硬化与文档，无新增界面功能）。

| 项目 | 值 |
| --- | --- |
| 合并方式 | `main` 快进合并（`8f807bb`），随后版本提交 `24288c3` |
| tag | `v0.9.1`（轻量 tag，指向 `24288c3`） |
| Release | https://github.com/LuZhong-Li/skill-manager/releases/tag/v0.9.1 （非 draft / 非 prerelease） |
| 资产 | `skill-manager-0.9.1-portable.exe`，114,264,366 字节 |
| SHA256 | `374B6ACBCDC4993CE69C16F031FC77FD26C13993A1E36D320B55F63963B4469A`（与 Release digest 一致） |
| 自用测试包 | `D:\skill-manager-app\` 已更新为 0.9.1（启动器指向新产物，旧 0.9.0 产物已移除） |
| 版本守卫 | `release-guard.mjs --tag v0.9.1` 通过（tag / CHANGELOG / package.json 三方一致） |

发布前复跑结果：内核冒烟 `version 0.9.1`、生产内核探测 `PRODUCTION_KERNEL_RESULT=ok version=0.9.1`、
界面冒烟 94/94（连续两次）。

## 5. 契约与文档同步

- **CLI 契约**：指令数、选项与退出码均未变化，`check:contract` 通过；本次只新增环境变量旋钮
  （`SKILL_MANAGER_LOCK_TIMEOUT_MS`、`SKILL_MANAGER_ARCHIVE_*`），不改变对外契约。
- **CHANGELOG**：0.9.0 之后新增「未发布 · 安全加固」四条（T1/T2/T3/T4）。
- **计划文档**：`docs/plan/m7-safety-hardening.md` 的 T0–T4 状态已更新为完成并附验收证据位置。
- **风险登记**：本仓库无独立风险登记文件，风险与缓解在 M7 计划文档中各任务的「目标 / 验收」段落内维护。

## 6. 后续（不阻塞本批）

1. ~~GUI 侧 pipeline / experience 产品化（审计 P0）~~ —— **已完成（2026-11-06）**：新增「问题处理」与「经验库」两页，
   只经既有内核指令取数、不新增指令；界面冒烟新增 12 项闭环用例，累计 106/106 通过。详见 CHANGELOG「未发布 · 新增」。
2. 正式发版前补完整性能再基线（双线三档、三轮），并把结果写回 `docs/benchmark/`。
3. 归档预算的时间维度（解压总耗时上限）尚未实现，当前只有体积/条目/压缩比四道体积类预算。
