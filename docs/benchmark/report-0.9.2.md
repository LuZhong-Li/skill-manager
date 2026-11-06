# v0.9.2 性能再基线报告

| 项目 | 内容 |
| --- | --- |
| 文档状态 | **正式再基线（0.9.2）**；不改写 [0.1.0 历史基线](baseline-0.1.0.json) |
| 数据基线 | [baseline-0.9.2.json](baseline-0.9.2.json)，含本机所有逐次样本与两轮 N=5000 复测 |
| 本机口径 | Windows / x64 / Node v24.22.0 / Core i5-13500H / runs=3；源码线 + 本地构建 SEA 线 |
| CI 口径 | [ci-smoke-0.9.2.json](ci-smoke-0.9.2.json)：GitHub Actions run [42198856481](https://github.com/LuZhong-Li/skill-manager/actions/runs/42198856481)，Linux、Windows、macOS 双线 N=100；macOS 额外双线 N=1000 / 5000，均 runs=1，仅验证采样链路、不作性能门禁 |
| 触发原因 | v0.9.1 的同父 staging 文件复制、跨进程锁、流式受限归档解压与 v0.9.2 的内核/打包更新触及性能敏感路径；按历史报告的刷新规则完整重跑 |

## 1. 结论

1. **N=1000 硬阈值八项全部通过**：两条线的 `scan`、`validate`、`export` 均远低于 30 s / 30 s / 15 s；四场景最高 RSS 也均低于 512 MB。
2. **无显著超线性项**：两轮 N=5000 独立复测中，源码热扫描、SEA 冷/热扫描为 `mild-superlinear`（均不超过 2.5×），其余为 `none`。按既有裁决只登记观察、不为 N=5000 压力档改架构。
3. **安全硬化没有数量级回退**：N=1000 首轮中，源码线 / SEA 线的冷扫描分别 1.532 s / 1.133 s；索引写入分别 70.29 ms / 36.34 ms。
4. **CI 采样链路三平台恢复且全绿**：此前 v0.9.2 的三个 Bench job 在 `npm ci` 就失败，原因是 `kernel/gui` 仍把工作区 `@skill-manager/contract` 声明为 `0.7.0`；同步到 0.9.2 与 lockfile 后，run `42198856481` 三平台成功，且 macOS 补充三档也产出数据。

## 2. N=1000 硬阈值判定

| 指标 | 阈值 | 源码线 | SEA 线 | 判定 |
| --- | ---: | ---: | ---: | --- |
| `scan-cold` 端到端 | ≤ 30 s | 1.532 s | 1.133 s | **通过** |
| `validate` 端到端 | ≤ 30 s | 1.306 s | 1.065 s | **通过** |
| `export` 端到端 | ≤ 15 s | 0.750 s | 0.497 s | **通过** |
| 四场景峰值 RSS 上界 | ≤ 512 MB | 339.2 MB | 294.0 MB | **通过** |

阈值仍取自 `scripts/bench/thresholds.mjs` 的唯一来源（需求 9.4.3 的“未测先收紧”口径），本轮未放宽任何阈值。最紧项是源码线 RSS，仍有约 **1.51×** 余量。

## 3. 三档完整数据（中位墙钟 / 三次样本峰值 RSS）

| 场景 | N=100 源码 / SEA | N=1000 源码 / SEA | N=5000 源码 / SEA |
| --- | --- | --- | --- |
| `startup` | 394 / 113 ms | — | — |
| `scan-cold` | 562 / 288 ms；101.7 / 70.7 MB | 1532 / 1133 ms；194.9 / 153.9 MB | 12454 / 11872 ms；351.6 / 336.1 MB |
| `scan-hot` | 628 / 328 ms；124.0 / 84.1 MB | 1656 / 1392 ms；339.2 / 294.0 MB | 17192 / 15733 ms；577.8 / 619.1 MB |
| `validate` | 499 / 260 ms；118.7 / 80.9 MB | 1306 / 1065 ms；304.2 / 291.8 MB | 9571 / 9589 ms；567.5 / 604.1 MB |
| `export` | 461 / 202 ms；104.7 / 78.4 MB | 750 / 497 ms；232.1 / 202.6 MB | 2106 / 1746 ms；483.1 / 461.3 MB |

N=5000 是压力记录档，适用阈值为 scan 360 s、validate 600 s、export 180 s、RSS 4096 MB；因此该档的 577.8 / 619.1 MB 峰值并不构成 N=1000 硬门禁失败。

### 索引与写入成本

| N | 索引体积 | 导出体积 | 源码冷 / 热索引写入 | SEA 冷 / 热索引写入 |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 117,979 B | 98,422 B | 9.90 / 10.99 ms | 2.81 / 8.63 ms |
| 1000 | 1,159,869 B | 964,842 B | 70.29 / 58.66 ms | 36.34 / 39.99 ms |
| 5000 | 5,861,369 B | 4,885,990 B | 825.13 / 937.34 ms | 691.85 / 606.76 ms |

索引与导出体积随规模近似线性；N=5000 热扫描中的写入约占源码线墙钟 5.5%、SEA 线 3.9%，不是主导瓶颈。

## 4. 拐点判定（两轮独立 N=5000，均 runs=3）

| 场景 | 线 | 单 Skill N=1000 → N=5000（首轮 / 复测） | 分类 |
| --- | --- | --- | --- |
| `scan-cold` | 源码 | 1.532 → 2.491 / 2.474 ms（1.626× / 1.615×） | `none` |
| `scan-hot` | 源码 | 1.656 → 3.438 / 3.345 ms（2.076× / 2.020×） | `mild-superlinear` |
| `scan-cold` | SEA | 1.133 → 2.374 / 2.391 ms（2.095× / 2.110×） | `mild-superlinear` |
| `scan-hot` | SEA | 1.392 → 3.147 / 3.232 ms（2.261× / 2.322×） | `mild-superlinear` |
| `validate` | 源码 / SEA | 1.408×~1.801× | `none` |
| `export` | 源码 / SEA | 0.516×~0.702× | `none` |

分类规则未变：两轮都 ≤2.0 为 `none`；任一轮 >2.0 且两轮均 ≤2.5 为 `mild-superlinear`；任一轮 >2.5 才是 `significant`。三个观察项的绝对值都在 17.2 s 内，未达到触发优化批次的条件。

## 5. CI 三平台记录与边界

run `42198856481` 的 Linux、Windows、macOS 全部通过。macOS 的 runs=1 补充数据已经覆盖源码与 SEA 的 N=100 / 1000 / 5000；它可以证明发布形态、RSS 采样器与场景矩阵在真机可用，但共享 runner 不用于同机绝对性能判定。

本机没有 macOS，因此“macOS 三档 × 双线 × runs=3 的同机可比较曲线”仍是显式环境缺口；对应证据与后续条件写在 [baseline-0.9.2.json](baseline-0.9.2.json) 的 `gaps`。这不是假装由 CI 单轮数据填平。

## 6. 后续监控

- N=1000 的源码 RSS 仍是最紧的硬阈值指标，后续若再引入全量缓存、更多索引字段或大归档，优先复跑本报告的 N=1000 档。
- 三个 `mild-superlinear` scan 观察项保留；若任一轮超过 2.5×，按 `docs/design/m3-benchmark.md` §7 建立定位/优化批次。
- `ci-record.mjs` 把 CI artifact 固化为版本化记录；CI artifact 14 天后会失效，因此报告的摘要、run URL 与本机原始样本均随仓库保留。

<!-- baseline-summary：与 baseline-0.9.2.json 同源比对（契约测试） -->

```json
{
  "thresholds_n1000": {
    "source": { "scan_ms": 1532, "validate_ms": 1306, "export_ms": 750, "peak_rss_mb": 339.2 },
    "sea": { "scan_ms": 1133, "validate_ms": 1065, "export_ms": 497, "peak_rss_mb": 294 }
  },
  "inflection": {
    "source": {
      "scan-cold": "none",
      "scan-hot": "mild-superlinear",
      "validate": "none",
      "export": "none"
    },
    "sea": {
      "scan-cold": "mild-superlinear",
      "scan-hot": "mild-superlinear",
      "validate": "none",
      "export": "none"
    }
  },
  "gaps": ["darwin-arm64:local-matrix"],
  "ci_run": 42198856481
}
```
