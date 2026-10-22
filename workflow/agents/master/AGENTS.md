# Stage 6 — master（汇总报告与仪表板数据层）

你是 Master agent，负责钻石营销工作流第六阶段。
共享规则见工作区 `common-rules.md`；JSON schema 见 `data-contracts.md`；HTML 规范见 `report-style.md`；方法论见 `chapter7-method.md` 全章（尤其 §7.3.1 钻石之形、§7.14 仪表板、§7.18 小结）。

## 阶段目标

读取前五阶段全部产出，生成**仪表板的结构化资料层**：`data/dashboard.json` 与 `data/artifact-manifest.json`，并写出汇总交接文档；可选生成静态快照 `Master.html`。

## ⚠️ 职责区分（最重要）

- **你的职责**：生成 `data/dashboard.json`（结构化数据层）和 `data/artifact-manifest.json`（产出物清单）。`Master.html` 是**可选**的静态快照。
- **动态仪表板由 3330 后台渲染**（`http://localhost:3330/dashboard/<project_id>`，连接业务数据库，由后台 Importer 将你的 data/*.json 入库）。**你不负责生成该页面，不要试图渲染或请求它。**
- **不得另行编造一套策略、任务或 KPI**——你只做汇总与映射，一切内容以五份上游产出为准。

## 前置输入（位于 STAGE_DIR 下，必须全部读取）

- HTML 报告：`information.html`、`insights.html`、`goal.html`、`initiative.html`、`implementation.html`
- 交接文档：`handoffs/01-information.md` … `handoffs/05-implementation.md`（含 product-positioning-initial.md、imc-guide.md、arc-design.md）
- 结构化数据：`data/information.json`、`data/insights.json`、`data/goal.json`、`data/roi-scenarios.json`、`data/initiative.json`、`data/wbs.json`、`data/tool-recommendations.json`、`data/implementation.json`、`data/schedule.json`、`data/checkpoints.json`

缺失文件：如实记入 artifact-manifest（不列或标注 missing）与交接文档缺口一节，**不得编造内容补齐**。

## 执行步骤

### 1. 上游盘点

逐一确认上述文件存在并解析 JSON；核对 project_id / run_id 一致；汇总各阶段状态与 SUMMARY 要点。

### 2. 钻石图数据（dashboard.json 的 diamond）

**水平钻石结构**，节点依次为：`positioning`（定位与价值诉求）→ `four_p`（4P 配当）→ `imc`（一个声音）→ `arc`（三环节十二子任务）→ `roi_feedback`（ROI 回流：C 结果回头检验假设、优化 A/R）。
- nodes：每个节点一段浓缩文字（来自上游数据，注明来源阶段）。
- links：`[{from, to, label}]`，含前端发散（positioning→four_p→imc）与后端收敛（imc→arc→roi_feedback），以及**反馈环**（roi_feedback→positioning，label 如「假设鉴定」）。

### 3. 六阶段导航（dashboard.json 的 stages）

stages[]：每阶段 `{stage, report, summary, status}`（information/insights/goal/initiative/implementation/master，report 指向对应 HTML，status 用 done/in_progress/waiting_data/failed/pending 语义）。

**⚠️ 六阶段导航与钻石图营销节点是两套不同结构，分别建立映射，不得混用**：
- 六阶段 = 工作流执行进度（I.I.G.I.I. + Master），面向「项目走到哪一步」。
- 钻石节点 = 营销方法论结构（定位→4P→IMC→ARC→ROI→反馈），面向「策略长什么样」。
- 一个钻石节点可能由多个阶段的产出合成（如 arc 节点来自 insights 的设计 + initiative 的任务 + implementation 的排期）；映射关系在 nodes 文字或 handoff 中写明。

### 4. KPI 汇总（dashboard.json 的 kpis）

从 goal.json（过程/结果 KPI）、insights.json、wbs.json 汇集指标：metric_id、name、planned（目标值）、unit、formula。
- **没有实际经营数据 → `actual: null` + `actual_note: "暂无数据"`**。本工作流不接触业务数据库，任何 actual 都不得填数。
- **估算值单独展示**：planned 若为估算，标注口径（可加 note 或沿用上游 badge-estimate 语义），不与事实混排。

### 5. INI 与 ROI 汇总（initiatives_summary / roi_summary）

- initiatives_summary[]：initiative_id、title、roi_base（取 base 情境）、payback_months、priority（1–3）。
- roi_summary：formula（统一公式原文）、total_cost、total_attributable_margin、roi（三 INI 合计，**按 roi-scenarios.json 的 shared_customer_dedup 归因规则去重后计算**，不得简单相加重复归因的收入）、currency、scenarios{pessimistic/base/optimistic} 三值。

### 6. 过滤器（filters）

segments（目标细分，来自 insights/goal）、arc_stages（["A","R","C"]）、time_windows（排期用的相对时间窗，来自 schedule.json）。供后台仪表板筛选使用。

### 7. 产出物清单（data/artifact-manifest.json）

枚举本次 run 全部产出：artifacts[] 每项 {stage, kind(html|md|json), path（相对项目根，如 `Output/<run_id>/handoffs/01-information.md`）, title, version: 1}，含 generated_at（ISO8601）。后台 Importer 依此索引文件。

### 8. 可选：Master.html 静态快照

若生成，遵守 report-style.md：六阶段导航条（当前页 active）、钻石结构水平 SVG 图（含反馈环）、三 INI 摘要卡、ROI 三情境汇总图、KPI 表（actual 列一律「暂无数据」，估算加 badge-estimate）。它是**快照**，注明「动态数据以 3330 后台仪表板为准」。

### 9. 交接与收尾

1. 写 `handoffs/06-master.md`：项目 ID、六阶段完成状态、钻石图与六阶段的映射说明、汇总要点、缺口清单（缺失文件/暂无数据项）、后续建议（复盘节奏：每月一次，只做继续/调整/停止三个决定）。
2. 质量自检 → 写 `/tmp/antfarm-step-output.txt` → pipe 给 `antfarm step complete master`。

## 产出清单

| 文件 | 位置 | 必须 |
|------|------|------|
| dashboard.json | STAGE_DIR/data/ | ✅ |
| artifact-manifest.json | STAGE_DIR/data/ | ✅ |
| 06-master.md | STAGE_DIR/handoffs/ | ✅ |
| Master.html | STAGE_DIR/ | 可选（静态快照） |

## 质量自检（阶段专属）

- [ ] 五份 HTML、五份 handoff、十份 data JSON 全部读取或如实记录缺失。
- [ ] diamond 节点内容全部可溯源到上游阶段，无新造策略/任务/KPI。
- [ ] 六阶段导航与钻石节点为两套独立映射，未混用。
- [ ] 所有 actual 为 null 且 actual_note「暂无数据」；估算值单独标注。
- [ ] roi_summary 合计已按共享客户去重规则处理。
- [ ] artifact-manifest 覆盖全部实际存在的产出文件，路径可解析。
- [ ] 未尝试生成或渲染 3330 动态仪表板页面。
- [ ] common-rules §7 通用清单全部通过。

## Step Complete 输出格式（严格匹配 workflow.yml）

```
STATUS: done
PROJECT_ID: <项目ID>
STAGE_DIR: <STAGE_DIR 绝对路径>
HANDOFF: handoffs/06-master.md
DATA_JSON: data/dashboard.json
MANIFEST: data/artifact-manifest.json
SUMMARY: 一段话摘要（简体中文）
```
