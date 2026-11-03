## v0.9.0：内置问题处理 + 按真实代码诊断 + 经验回归适配宿主

### 本版主题

`pipeline run` 不再只是套模板：默认用内核自带的本地生成产出完整文档包（不接外部服务、
不需要密钥），并且在给出仓库路径时**只读**探查真实代码，把定位结果写进文档。

### 里程碑完成情况

- ✅ **M0**: 领域模型 + 问题分类 + 流水线规划
- ✅ **M1**: IntelligenceProvider 抽象 + Meta-Skill 注册表 + Pipeline Runner
- ✅ **M2**: 需求追问状态机 + 决策记录 + 收敛门
- ✅ **M3**: 文档包写出器 + CLI `pipeline run`
- ✅ **M4**: LLM Provider 支持（OpenAI 兼容 / Doubao / Claude）
- ✅ **M5**: 内置 5 个示范 Skill 模板（可删可留，不复活）
- ✅ **M6**: 跨宿主审计漂移 + 报告导出（markdown/html/sarif）+ 批量采纳
- ✅ **经验回归**: 自动累计经验 + `experience list/search/show` + `--experience` 预填
- ✅ **经验适配宿主**: 归纳宿主画像，自动预填高频回答、按历史多数调整环节计划
- ✅ **内置本地问题处理**: `LocalReasoningProvider` 逐环节按元 skill 骨架生成，不再输出「待填写」
- ✅ **按真实代码诊断**: `--probe-root` / `--probe` 只读探查仓库，定位可疑文件与相关测试
- ✅ **安全修复**: file_map 路径穿越、git `ext::` 协议、明文 HTTP 下载
- ✅ **cpSync 崩溃修复**: Windows 中文源路径 0xC0000409 原生崩溃
- ✅ **打包启动修复**: 内置技能模板顶层求值 `import.meta` 导致 CJS/SEA 产物启动即崩溃

### 主要功能

1. 问题智能分类（new-feature/refactor/bugfix/docs/research），症状类描述正确归入 bugfix
2. 自动化流水线规划 + 追问状态机 + 宿主画像自适应
3. 文档包输出（requirements/research/design/plan/approval 逐环节 .md + INDEX；涉及界面追加 UI 四件套）
4. 内置本地生成：无外部依赖即可产出完整文档，缺陷类走「复现 → 根因 → 修复设计 → 回归验证」
5. **只读代码探查**：给出仓库路径即定位可疑文件（含命中词与行号）、相关测试、仓库自述的检查命令
6. 经验回归：每次处理自动记录（含宿主、环节计划、证据摘要），支持检索与相似经验预填
7. 完整 CLI 支持（21 条指令，含 experience 三个子命令）

### 使用示例

```bash
# 默认内置本地生成，无需任何密钥
skill-manager pipeline run --problem "搜索很慢" --output-dir ./out

# 按真实代码诊断：只读探查仓库，证据写进文档
skill-manager pipeline run --problem "安装时崩溃并报错" --output-dir ./out --probe-root D:/my-project

# 直接在当前目录探查
skill-manager pipeline run --problem "导出时丢数据" --output-dir ./out --probe

# 用相似经验预填问答
skill-manager pipeline run --problem "做一个数据看板" --output-dir ./out --experience "数据看板"

# 经验查询
skill-manager experience list
skill-manager experience search --query "看板"
skill-manager experience show <id>
```

### 探查的安全边界

- **只读**：只做 `stat` / `readdir` / `readFile`；不建目录、不写缓存、不执行任何命令
- **有界**：目录数、文件数、单文件读取量均有上限；跳过 `node_modules`、`.git`、构建产物
- **可核查**：每条结论都带文件名、命中词与行号；仅文件名命中时如实标注「未核实内容」
- **不编造**：路径不可访问或未指定时降级为「未探查仓库，结论均为推断」
- **正交**：`--probe-root` 与 `--workspace` 相互独立，被探查的仓库不会被写入任何文件

### 验证

- 常规测试：**929 项**（928 pass + 1 平台相关 skip）
- 打包产物 GUI 冒烟：**94/94 通过**（空工作区 → 初始化 → 扫描 → 卡片 → 插件 → 库存 → 更新/备份 → 双语切换）
- lint / typecheck / check（契约、分层、架构图、复杂度、夹具）：全部通过
  - 分层/架构：313 文件，1111 边，0 循环
  - 复杂度 ratchet：95 个基线函数，0 个超阈值文件，新代码 complexity ≤ 10
- 版本一致性：root / kernel / contract / gui 均为 0.9.0
