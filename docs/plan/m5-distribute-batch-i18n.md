# M6 跨宿主分发与批量治理 + 操作 / 界面 / i18n 计划

| 项目 | 内容 |
|---|---|
| 计划日期 | 2026-10-20 |
| 需求基线 | [`docs/requirements.md`](../requirements.md) 9.3.9（M6；讨论稿称 M5） |
| 设计基线 | [`docs/design/m5-distribute-batch-i18n.md`](../design/m5-distribute-batch-i18n.md) |
| 执行原则 | 先契约后实现、先内核后 GUI；每批独立可测、可回滚 |
| 回归基线 | 732 项常规测试、1 项慢测试、17 条指令、7 份规范 / 8 份 schema、69 个问题码 |
| 不在本计划 | 发布、打 tag、registry / 远程安装、新 `reconcile` 写动作、MCP server 管理、CLI 文案本地化 |

> **编号说明**：9.3.6 已占用 M5，9.3.9 按 M6 登记；本文文件名沿用用户给定的 `m5-distribute-batch-i18n.md`。

## 0. T0~T9 依赖顺序

```text
T0 契约与 schema
├─ T1 批量 selection / execute 隔离
│  ├─ T2 审计矩阵
│  ├─ T4 repair not_distributed（另依赖 T3）
│  └─ T5 W-DRIFT 修正
├─ T3 字段分层 / 元数据归一化
│  └─ T4
└─ T6 GUI i18n
   └─ T7 GUI 批量交互
      └─ T8 GUI 界面优化
         └─ T9 测试与门禁（全部批次后）
```

**顺序说明**：

1. T0 是所有批次的前置；未完成契约登记不得进入 T1~T8。
2. T1 是批量内核骨架；T2、T4、T5 依赖 T1 的扁平 item / summary 语义。
3. T3 是 `adopt` / `install` 字段分层的前置；T4 依赖 T3 的归一化结果。
4. T6 可在 T0 后并行启动，但按“先内核后 GUI”排在 T5 之后；T7 依赖 T1 + T6，T8 依赖 T7。
5. T9 是收口批次，不承载新功能；只补测试、探针、门禁与验收证据。

---

## 1. 批次登记模板

每批完成时必须登记：

| 字段 | 要求 |
|---|---|
| 改动文件 | 文件清单；新增 / 修改 / 删除分开 |
| 公共 API | 新增或变化的指令、选项、contract 类型、schema 字段 |
| 测试数 | 改前 / 改后；新增用例分类；慢测试与 GUI 冒烟是否受影响 |
| 契约影响 | 是否加法；是否改变既有字段语义；是否需要 changelog |
| 回滚方式 | 代码回退边界；是否涉及数据迁移；是否需要 feature gate |
| 验收证据 | 命令、输出摘要、失败注入结果、截图 / JSON 样例 |

**默认规则**：所有新增字段 / 选项必须可选或默认关闭；不得删除既有字段、错误码、退出码或指令。

---

## 2. T0：契约与 schema 地基

### 2.1 目标

先把 T1~T8 所需的跨层类型、schema、CLI 选项与文档契约登记完；T0 不写运行期实现，不改变现有指令行为。

### 2.2 具体改动清单

| 文件 | 改动 | 类型 |
|---|---|---|
| `contract/src/reconcile.ts` | `ReconcileSelectionMode` 增加 `batch`；`ReconcileSelection` 增加 `ids?: string[]`、`roles?: HostRootRole[]`；增加 `selection_summary` 类型；`ReconcilePlanSummary` 增加可选 `succeeded/failed/cancelled/duration_ms`；`ReconcileResultItem` 增加可选 `stage/reason` | 加法 |
| `contract/src/host-inventory.ts` | 新增 `InventoryAuditStatus`、`InventoryAuditRow`、`InventoryAuditSummary`、`InventoryAuditData`；`InventoryScanData` 增加可选 `audit?: InventoryAuditData` | 加法 |
| `schemas/skill_meta.schema.json` | 新增可选 `compatibility`（string）、`allowed_tools`（string）、`metadata`（object）、`extensions`（object）；`required` 不变 | 加法 |
| `schemas/backup.schema.json` | 新增可选 `compatibility`、`allowed_tools`、`metadata`、`extensions`；旧消费者忽略 | 加法 |
| `docs/specification/skill-meta-spec.md` | 同步字段语义、类型、冲突优先级、`metadata` / `extensions` 边界 | 规范 |
| `docs/specification/cli-contract.md` | `reconcile` 的 `--id` / `--role` 可重复；`--path` 与 batch 选择器互斥；`scan --inventory` 增加只读 `--audit`；不新增指令；`clean` 的 role / 全选边界 | 契约 |
| `docs/specification/result-and-exit-codes.md` | 批量结果字段只做加法；`W-DRIFT-001` 只修正时机 / 文案；不新增问题码、退出码 | 规范 |
| `docs/specification/index-format.md` | 明确新增字段默认只进 `skill_meta`，索引不扩字段 | 规范 |
| `docs/specification/host-landings.spec.md` | 账本结构不变；补审计期望集合来自 `targets[]` 的说明 | 规范 |

### 2.3 公共 API / 契约影响

- 不新增指令；17 条指令不变。
- `reconcile` 仅增加 batch 选择器与结果字段，不新增动作。
- `scan --inventory --audit` 是只读选项，不进入写路径。
- 新增 schema 字段全部可选；旧 `skill_meta` / export 继续可读。
- 所有新增 contract 字段为可选或仅在 batch 模式出现；旧选择器行为不变。

### 2.4 测试与门禁

1. `npm run check:contract` 通过；
2. schema 契约测试：旧夹具通过，新增字段正例 / 反例各一组；
3. CLI 契约测试：17 条指令不变，`--id` / `--role` / `--audit` 登记；
4. 不跑实现 e2e（T0 只做契约）。

### 2.5 回滚

T0 只改类型 / schema / 文档，无运行期行为；回滚为撤销对应 diff 即可，不需要数据迁移。

---

## 3. T1：批量 selection flatten + execute 异常隔离

### 3.1 目标

在 plan 层把多 `skill_id[]` / 整 root / 整 role flatten 成扁平 item；execute 保持逐 item 事务，只补逐项异常隔离与 summary。

### 3.2 改动文件

| 文件 | 改动 |
|---|---|
| `kernel/dispatch/parsers/index.ts` | 把 `--id` / `--role` 登记为可重复选项；保持 `--root` 可重复 |
| `kernel/dispatch/reconcile/options.ts` | 解析 batch selection；`--path` 与 batch 互斥；保留 legacy path / id-host / classification |
| `kernel/dispatch/reconcile/plan.ts` 或新增 `selection.ts` | `flattenSelection` 纯函数：并集、physical_key 去重、role 过滤、transaction_group |
| `kernel/dispatch/reconcile/candidates.ts` | `not_distributed` 候选支持 batch ids / role；插件根候选留 T4 |
| `kernel/dispatch/reconcile/execute.ts` | 逐 item `try/catch`；failed/skipped/cancelled；summary 计数 |
| `kernel/dispatch/reconcile/index.ts` | preflight 与 plan signature 适配 batch selection |
| `contract/src/reconcile.ts` | 使用 T0 类型；不在 T1 再扩字段 |

### 3.3 公共 API / 契约影响

- `reconcile` 仍只有一个指令；新增 `--id` / `--role` 可重复语义。
- 不新增 `--all`；GUI 全选展开为显式范围。
- `execute` 的 per-item 事务模型不变；`transaction_group` 继续按 physical key。

### 3.4 测试

1. 20 副本批量 `adopt` / `repair`：1 项失败，其余继续；
2. 多 id / root / role 并集去重；共享根只生成一个 item；
3. 共享组失败整组回滚；组外不受影响；
4. 非 user 角色 skipped；单副本旧选择回归；
5. summary 计数守恒：`succeeded + failed + skipped + cancelled = selected`。

### 3.5 回滚

保留 legacy 选择器；若 batch flatten 有问题，禁用 `mode=batch` 解析即可回到旧行为。execute 的逐项 catch 可独立回退，不改变单副本动作。

---

## 4. T2：跨宿主一致性审计矩阵

### 4.1 目标

实现 `scan --inventory --audit` 的只读投影：期望集合来自 `skill_meta.targets[]`，输出 skill × target × scope 矩阵；不新增审计表。

### 4.2 改动文件

| 文件 | 改动 |
|---|---|
| `contract/src/host-inventory.ts` | 使用 T0 的 audit 类型 |
| `kernel/dispatch/scan/audit.ts`（新增） | 纯投影：target 解析、状态推导、跨格式比较、summary |
| `kernel/dispatch/scan/inventory.ts` | `--audit` 计划与 `data.audit` 输出 |
| `kernel/dispatch/scan/reconcile.ts` | 复用 `reconcileHostCopy` 的 evidence / drift |
| `kernel/dispatch/scan/result.ts` | 只读输出，不写索引 / 时间 |
| `docs/specification/cli-contract.md` | 如 T0 未完全登记，补齐 `--audit` 输出 |

### 4.3 状态与边界

- `missing`：targets 声明、账本无 active，或账本 active、副本无；
- `undeclared`：副本 / 账本有、targets 无；
- `unmapped` / `workspace_only` / `insufficient` 不并入 missing；
- 同 format 比 `content_digest`；跨 format 比 `source_checksum` / `source_version` / `source_ref`；
- `observed_at` = 本次盘点时刻；不新增历史字段。

### 4.4 测试

1. targets 有 / 账本无 → missing；targets 有 / 副本无 → missing；
2. 副本有 / targets 无 → undeclared，不计 missing；
3. 同 format drift 与跨 format 非 drift 正反例；
4. 共享根只计一次；插件 `x-` 进入矩阵；
5. dogfood 166 副本审计结果可解释；审计前后字节不变、无网络。

### 4.5 回滚

`--audit` 是可选项；撤销 `data.audit` 输出与投影模块即可，既有 `scan --inventory` 不受影响。无 schema / 数据迁移。

---

## 5. T3：字段分层与元数据归一化

### 5.1 目标

`adopt` 从 `SKILL.md` 解析官方六字段并归一化到 `skill_meta`；`install` 只消费 `skill_meta`；新增字段进入渲染与导出可选字段。

### 5.2 改动文件

| 文件 | 改动 |
|---|---|
| `kernel/dispatch/reconcile/adopt-source.ts` | 官方六字段、metadata author/version、冲突 warning、`extensions` |
| `kernel/dispatch/reconcile/adopt.ts` | 合成 `skill_meta` 新字段 |
| `kernel/core/inventory/discover.ts` | 盘点读取 metadata author/version；保持只读 |
| `kernel/core/lifecycle/install.ts` | 明确只消费 `skill_meta`；不读裸 `SKILL.md` |
| `kernel/dispatch/host/index.ts` | `renderSourceOf` 读取 compatibility / allowed_tools / metadata / extensions |
| `kernel/core/render/*` | 渲染 metadata 字符串映射；嵌套值保留管理端并告警 |
| `kernel/core/metadata/*` | 类型、常量、schema 对齐 |
| `kernel/core/backup/export.ts` / `import.ts` | 新增字段可选加法 |

### 5.3 公共 API / 契约影响

- `skill_meta` 新增可选字段；`install` 行为不变（仍只读 `skill_meta`）；
- `adopt` 产出新字段；`renderSourceOf` 不再丢字段；
- export / import 只做可选加法，旧消费者可读。

### 5.4 测试

1. 官方六字段 + metadata author/version 正例；
2. 顶层旧 author/version 冲突 warning，metadata 胜出；
3. SKILL.md 与既有 skill_meta 冲突时 SKILL.md 胜出；
4. `install` 对裸 `SKILL.md` 仍拒绝；
5. `metadata` 深比较不变；未知字段 warning；`mcp-server` 只读；
6. `agent-skill-creator` 纳管后 skill_meta 字段正确。

### 5.5 回滚

保留旧 `adopt` 归一化路径；新字段可选，未使用时既有 skill_meta 不受影响。export / import 新增字段可独立回退。

---

## 6. T4：repair not_distributed 新 target 分发

### 6.1 目标

已纳管 skill 通过 `reconcile repair` 的 `not_distributed` 分发到 targets[] 新宿主；不使用 install / restore；不新增指令。

### 6.2 改动文件

| 文件 | 改动 |
|---|---|
| `kernel/dispatch/reconcile/candidates.ts` | 内置 / 插件 `x-` 宿主 `not_distributed` 候选；无法生成时 skipped |
| `kernel/dispatch/reconcile/plan.ts` | repair eligibility 与批量 item |
| `kernel/dispatch/reconcile/execute.ts` | repair 复用 `runHostLanding`；共享根整组 |
| `kernel/dispatch/host/index.ts` | 保持渲染 / 落位 / 账本回滚通道 |

### 6.3 测试

1. 已纳管 skill 分发到新 Claude / Codex / Cursor / 豆包目标；
2. 插件 `x-` 正例或明确 skipped；
3. `install` 重复 ID 仍拒绝；`restore` 无 `--host`；
4. 重复执行 no-op；失败回滚目标 / 索引 / 账本；
5. 共享根只写一次、全部消费宿主账本同步。

### 6.4 回滚

移除新候选生成即可恢复旧 repair 行为；不改变 install / restore 契约。无数据迁移。

---

## 7. T5：W-DRIFT-001 修正

> **执行状态：已完成（2026-11-06）**。落地：`kernel/core/lifecycle/update.ts` 的 `checkDriftOf` 按来源类型与预览模式分派语义，重分发失败路径补「刷新未生效、索引基线仍为旧值」说明；GUI `errors-*.ts` 的 `W-DRIFT-001` 说明改为「磁盘内容与记录基线」，与内核判定条件对齐；`result-and-exit-codes` 新增按动作的触发时机表；测试为 `tests/e2e/update-drift-semantics.test.ts`（5 项）与 `tests/unit/delivery.test.ts` 的重分发失败断言，`update-drift-warning.test.ts` 既有 2 项继续通过。问题码、JSON 字段、退出码与索引语义均未改变。

### 7.1 目标

成功 `update` 后不再显示旧快照导致的误导性 `W-DRIFT-001`；真实漂移保留。

### 7.2 改动文件

| 文件 | 改动 |
|---|---|
| `kernel/core/lifecycle/update.ts` | 成功后基于新状态重算；旧告警抑制 |
| `kernel/core/validation/validation-*` | 更新后漂移原因 / 文案 |
| `kernel/dispatch/registry/commands/mutate.ts` | 结果不要混入旧快照 warning |
| `docs/specification/result-and-exit-codes.md` | 文案 / 时机说明；问题码不变 |
| GUI 结果呈现 | 不复用旧缓存 |

### 7.3 测试

1. 来源变化后 update 成功，无 `W-DRIFT-001`；
2. 更新后篡改副本仍产生 `W-DRIFT-001`；
3. 部分失败时警告准确；问题码 / 退出码不变。

### 7.4 回滚

仅回退告警触发时机与文案；问题码与 JSON 字段不动。

---

## 8. T6：GUI i18n 接入

### 8.1 目标

引入 `vue-i18n`，建立 `en` / `zh-CN` 资源与 `useI18n`；语言存 app 配置；错误保留 code 再本地化；CLI / JSON 不变。

### 8.2 改动文件

| 文件 | 改动 |
|---|---|
| `gui/package.json` | 增加 `vue-i18n`（MIT） |
| `gui/renderer/src/i18n/index.ts` | `createI18n` 实例 |
| `gui/renderer/src/i18n/messages/en.ts` / `zh-CN.ts` | 资源 |
| `gui/renderer/src/i18n/error-text.ts` | 按问题码映射 |
| `gui/main/index.ts` / preload | 暴露系统 locale（如需要） |
| `gui/main/updates/settings.ts` | `language.mode` / `language.value`；迁移保留更新设置 |
| `App.vue` / 组件 | 使用 `useI18n().t` |

### 8.3 边界

- 指令名 / 选项 / 问题码 / JSON / 枚举 / 退出码不译；
- CLI 人类可读提示保持现状；
- 日期 / 数字用 `Intl`；路径不改写；
- 未知 code 回退原始 message，并保留 code。

### 8.4 测试

1. `en` / `zh-CN` 键集合一致；无硬编码中文；
2. 系统默认 / 手动切换 / 持久化 / 重启；
3. 错误按 code 本地化，原始详情可展开；
4. 中英切换不调用内核、不写工作区。

### 8.5 回滚

移除 `vue-i18n` 依赖与资源，恢复现有中文模板；settings 新增字段可保留但忽略。无内核契约影响。

---

## 9. T7：GUI 批量交互

### 9.1 目标

盘点多选 / 全选；一次预览、一次确认、逐 item apply 显示真实进度；三区块预览、失败汇总与重试。

### 9.2 改动文件

| 文件 | 改动 |
|---|---|
| `gui/renderer/src/components/HostInventoryView.vue` | checkbox、全选、批量动作栏 |
| `InventoryActionMenu.vue` | 单条 / 批量入口 |
| `InventoryActionDialog.vue` | 三区块、进度、汇总、取消、重试 |
| `host-inventory-presentation.ts` | 状态 / 分组 / 计数展示 |
| `inventory-actions.ts` | 批量动作可用性 |
| `useKernel.ts` / `types.ts` | batch 结果类型与进度状态 |

### 9.3 流程

1. 复选当前筛选的 user 可执行项；
2. 一次 batch 预览；
3. 一次确认；
4. 逐 item apply，更新 `已完成 / 总数`；
5. 失败项保留，提供仅重试失败；
6. 取消在 item 边界停止，显示 cancelled。

### 9.4 测试

1. 多选 / 全选范围正确；`clean` 整组提示；
2. 进度、成功 / 失败 / 跳过 / 取消汇总；
3. 失败项可定位、可重试；成功项不重复；
4. 取消零后续写入；过期 item 标 failed。

### 9.5 回滚

回退组件与 batch UI 状态即可；内核 batch 能力保留但 GUI 回到单条动作。

---

## 10. T8：GUI 界面优化

### 10.1 目标

盘点角色分组、状态标签、空根 / 缺失根 / 不可读根、12 状态、布局与间距；保持手写组件，不全量引入组件库。

### 10.2 改动文件

| 文件 | 改动 |
|---|---|
| `HostInventoryView.vue` | 角色分组、状态区域、空根 |
| `InventoryHostGroups.vue` / `InventoryCopyDetails.vue` | 分组、标签、长路径 |
| `InventoryActionDialog.vue` | 三区块层次、滚动 |
| `InventorySummary.vue` | 汇总信息层次 |
| `styles.css` / 组件样式 | 设计令牌、间距、响应式 |

### 10.3 测试

1. 900×600 / 1180×760 / 125% 无横向溢出；
2. 长路径 / 长名称 / 大数字可读；
3. 12 状态互斥，空 / 加载 / 完成态正确；
4. 生产与开发布局一致；超阈值文件数 0。

### 10.4 回滚

UI 改动可独立回退；不影响内核 / 契约 / 数据。

---

## 11. T9：测试与门禁收口

### 11.1 目标

补齐 contract、e2e、三平台 probe、GUI 冒烟与全量门禁，形成 v0.6.0 候选证据。

### 11.2 改动文件

| 文件 | 改动 |
|---|---|
| `tests/contract/*` | batch selection、audit、schema 加法、CLI 契约 |
| `tests/unit/*` | flatten、execute catch、metadata normalizer、W-DRIFT |
| `tests/e2e/*` | 批量失败、审计矩阵、新 target、i18n |
| `scripts/probe-reconcile-actions.mjs` | 批量 / 新 target / 共享根 |
| `scripts/gui-smoke.mjs` | 双语、批量、取消、部分失败 |
| `.github/workflows/verify.yml` | 复用现有 job；不新增指令 |

### 11.3 验收

1. 常规 732+ 测试全通过；慢测试与 GUI 冒烟通过；
2. 三平台 probe 扩展通过；
3. `check:contract` / `check:layer` / `check:arch` / `check:complexity` / typecheck / lint / format / build 全绿；
4. `docs/reviews/` 不改动；
5. 17 条指令、八字段封装、69 个问题码、退出码不变。

### 11.4 回滚

测试与探针可独立回退；不得通过删除 / 跳过既有测试换取绿色。

---

## 12. 里程碑依赖与并行建议

| 批次 | 依赖 | 可并行 | 主要风险 |
|---|---|---|---|
| T0 | 设计评审通过 | 无 | 契约字段命名 / 兼容性 |
| T1 | T0 | 可与 T3 并行 | 选择器并集 / 共享组 |
| T2 | T0、T1 | 可与 T3 并行 | target→host 映射 / 状态误报 |
| T3 | T0 | 可与 T1 / T2 并行 | metadata 冲突 / 渲染丢字段 |
| T4 | T1、T3 | 可与 T5 并行 | `x-` 候选 / 幂等 |
| T5 | T0、T1 | 可与 T4 并行 | 误抑制真实 drift |
| T6 | T0 | 可与 T2/T3 并行 | 文案遗漏 / 体积 |
| T7 | T1、T6 | 不建议 | 进度与 plan 过期 |
| T8 | T6、T7 | 不建议 | 布局 / 视觉回归 |
| T9 | T0~T8 | 无 | 测试预算 / 三平台 |

**测试数下限**（执行时按 §1 模板登记实际值；基线 732，不得以删除 / 跳过旧测试换取绿色）：

| 批次 | 新增测试目标下限 | 重点 |
|---|---:|---|
| T0 | +6 | contract / schema / CLI 契约 |
| T1 | +8 | flatten / 逐项隔离 / summary |
| T2 | +8 | 审计状态 / 跨格式 / 只读 |
| T3 | +8 | 六字段 / 冲突 / 渲染 |
| T4 | +5 | repair not_distributed / x- |
| T5 | +3 | W-DRIFT 成功 / 篡改 |
| T6 | +8 | 双语键 / 错误码 / 持久化 |
| T7 | +8 | 多选 / 进度 / 取消 / 重试 |
| T8 | +6 | 12 状态 / 布局 / 溢出 |
| T9 | 全量收口 | 732+、慢测试、GUI 冒烟、三平台 probe |

---

## 13. 首批 T0 的执行清单（可直接交给执行端）

### 13.1 改动顺序

1. `contract/src/reconcile.ts`：先加类型，不接运行期；
2. `contract/src/host-inventory.ts`：加 audit 类型与 `InventoryScanData.audit?`；
3. `schemas/skill_meta.schema.json`：加四个可选字段；
4. `schemas/backup.schema.json`：加可选导出字段；
5. `docs/specification/skill-meta-spec.md`：同步字段表；
6. `docs/specification/cli-contract.md`：同步 `--id` / `--role` / `--audit`；
7. `docs/specification/result-and-exit-codes.md`：批量结果加法 / W-DRIFT 时机；
8. `docs/specification/index-format.md` / `host-landings.spec.md`：补边界说明；
9. 更新契约测试与 changelog。

### 13.2 T0 完成判定

- `npm run check:contract` 通过；
- 旧 schema 夹具 / 旧 CLI 契约全部通过；
- 新增字段全部可选；
- 17 条指令数量不变；
- 无运行期行为变化；
- `git diff` 仅涉及 T0 列出的契约 / schema / 文档 / 测试。

### 13.3 T0 回滚

撤销 T0 diff；无数据迁移、无运行期 feature gate。
