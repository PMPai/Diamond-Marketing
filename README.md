# 💎 Diamond Marketing

以《智慧公民_AI时代的能力养成》第七章「钻石营销」为方法论的**一套大包**系统：
六个专职 AI Agent 工作流 + 零依赖本地后台 + 资料门禁 + 动态仪表板。

从项目输入到六阶段营销分析报告（信息收集 → 深度分析 → 优先意图 → 沟通策略 → 执行建议 → 汇总仪表板），全流程自动化，中途资料不足时可暂停等待人工补件、补件后自动续跑。

---

## 架构总览

```
一套大包分两部分：

Part 1: 资料补齐后台 (Port 3330) — 零依赖 node:http + node:sqlite
  ├── index.html     — 项目创建 / 列表
  ├── project.html   — 状态查看 + 阶段进度 + 数据缺口管理 + 门禁补件
  ├── dashboard.html — SVG 图形仪表板（钻石结构 / 指标 / ROI）
  └── API: 项目 CRUD / 门禁通知 / 补件校验 / 缺口提交 / kill

Part 2: Antfarm 工作流 (Port 3333 只读进度)
  ├── 6 Agent × 6 Stage（信息→分析→意图→策略→执行→汇总）
  ├── Stage 1 内置资料门禁：
  │     资料不足 → 写 gate 文件 → POST :3330/api/gate
  │     → honest fail (waiting_data) → 用户在后台补件 → workflow resume 接续
  └── Master agent 产出 data/dashboard.json，后台 Importer 同步进 SQLite
```

UI 全站采用 **PI-dashboard-design** 风格（暖纸灰 + 炭绿 + 铁锈橙、零圆角零阴影、等宽数字）。

## 端口

| Port | 用途 |
|------|------|
| 3330 | Diamond 后台（输入 / 补件 / 仪表板） |
| 3333 | Antfarm Dashboard（只读进度参考） |

## 环境需求

- **Node.js ≥ 23.4**（使用内置 `node:sqlite` 模块，后台零 npm 依赖）
- **Antfarm**（OpenClaw workspace 内，`~/.openclaw/workspace/antfarm/`）
- 六个 Diamond Agent 需配置 LLM API（OpenClaw agent 模型）

## 快速启动

```bash
# 方式一：一键安装脚本（复制 workflow + 注册 agent cron）
bash scripts/install.sh

# 方式二：手动
# 1. 安装工作流
cp -R workflow/* ~/.openclaw/workspace/antfarm/workflows/diamond-marketing/
node ~/.openclaw/workspace/antfarm/dist/cli/cli.js workflow install diamond-marketing

# 2. 启动后台
cd backend && node server.js    # 默认 Port 3330

# 3. 打开 http://localhost:3330
```

环境变量（可选）：

```bash
DIAMOND_PORT=3330                     # 后台端口
DIAMOND_DB=<repo>/storage/diamond.db  # SQLite 位置
DIAMOND_DATA=<repo>/backend/data      # 项目数据目录
```

启动一个项目：

```bash
node ~/.openclaw/workspace/antfarm/dist/cli/cli.js workflow run diamond-marketing "<任务描述>"
# 或在 http://localhost:3330 页面创建项目（后台经 workflow-bridge 调 Antfarm）
```

## 六个阶段

| # | Agent | 职责 | 产出 |
|---|-------|------|------|
| 1 | Diamond-Information | 输入检查（**资料门禁**）+ MECE 五类研究、七条线索、证据溯源 | `information.html` + 初步定位 |
| 2 | Diamond-Insights | 市场阶段 / 4P·4C / QBQ 分析 / IMC 说明书 / ARC 系统与十二子任务 | `insights.html` |
| 3 | Diamond-Intention | 优先意图 + SMART KPI + ROI 三情境 | `intention.html` |
| 4 | Diamond-Initiative | IMC 沟通策略 + WBS 任务分解 | `initiative.html` |
| 5 | Diamond-Implementation | 执行建议 + 检查点 + 风险管理 | `implementation.html` |
| 6 | Master | 汇总 `dashboard.json` + 动态仪表板资料层 | `master.html` + `data/*.json` |

各阶段间以 **handoff 文件**（`handoffs/01-information.md` … `06-master.md`）传递，
数据格式由 `workflow/agents/shared/data-contracts.md` 统一约定（含 ROI 公式与三情境定义）。

### 命名沿革：Goal → Intention

第三阶段原名为 Goal（diamond-goal / 优先目标），已全域更名为 **Intention（diamond-intention / 优先意图）**：
产出改为 `intention.html` / `data/intention.json` / `handoffs/03-intention.md`，字段 `smart_goal → smart_intention`、`goal_chain → intention_chain`、`comm_goal → comm_intention`，`stage` 取值改为 `intention`。
历史 Run 产出的旧名文件与字段作为既有资料**原样保留、继续可读**，不得改写或覆盖；新 Run 一律使用新名，不得新旧混用。
方法论原文（chapter7）保留「Goal」措辞，对照说明见 `workflow/resources/chapter7.md` 开头的编者注。

### 修正重跑（Correction Rerun）

用户在仪表板提交修正意见并选择重跑时，后台会：封存来源 Run 成果为只读**参考快照**（`<PROJECT_ROOT>/corrections/<correction_id>/reference/`，含逐档 sha256 清单）、生成**修正任务单** `manifest.json`（schema `diamond-correction/v1`，含意见原文、指定阶段、封存清单），并建立新 Run，任务文本携带 `CORRECTION_MANIFEST:` / `SOURCE_RUN_ID:` / `REFERENCE_DIR:` 约定行。新 Run 六阶段依序完整执行（Antfarm 不支持跳过阶段），每阶段：阅读并采纳用户反馈、核实复用的证据、重新生成受影响的产出，并在交接文档记录采纳决定。详见各 agent `AGENTS.md` 的「修正重跑与参考复用」一节。

## 资料门禁（Gate Protocol）

第一阶段发现输入资料不足时：

1. Agent 依 `gate-protocol.md` 写出缺口清单（缺什么、为什么需要、什么格式）
2. `POST http://localhost:3330/api/gate` 通知后台，项目状态转 `waiting_data`
3. 用户在 `project.html` 看到补件表单，上传/填写补充资料
4. 后台校验通过后触发 workflow **resume**，从第一阶段接续（不重跑已完成部分）

详见 `workflow/agents/shared/gate-protocol.md`。

## 产出目录结构

每个项目运行后的产物（git 忽略，属本地数据）：

```
backend/data/projects/<project_id>/
  ├── input.json                    # 项目输入
  ├── gap-supplement*.json          # 门禁补件
  └── Output/<project_id>/<run_id>/
        ├── information.html … master.html   # 六阶段报告
        ├── handoffs/*.md                    # 阶段交接文件
        └── data/*.json                      # 结构化数据
              ├── dashboard.json             # 仪表板资料层
              ├── roi-scenarios.json / intention.json / insights.json
              ├── wbs.json / schedule.json / checkpoints.json
              └── artifact-manifest.json
```

后台 Importer 会将 `data/*.json` 同步进 SQLite，`dashboard.html` 由此渲染。

## 仓库结构

```
Diamond-Marketing/
├── README.md            # 本文件
├── Prompt.md            # 系统原始设计提示词（完整需求来源）
├── VALIDATION.md        # 系统验证报告（含已知限制）
├── backend/             # Part 1：零依赖后台（Node ≥23.4）
│   ├── server.js        #   HTTP 服务 + API
│   ├── db.js            #   node:sqlite 数据库层（12 张表，WAL 模式）
│   ├── importer.js      #   Output data/*.json → SQLite 同步
│   ├── workflow-bridge.js #  后台 → Antfarm 调用桥
│   └── public/          #   前端页面（PI-dashboard-design 风格）
├── workflow/            # Part 2：Antfarm 工作流
│   ├── workflow.yml     #   6 agent × 6 stage 定义
│   ├── agents/          #   各 agent 的 AGENTS/SOUL/IDENTITY + shared 规范
│   └── resources/       #   chapter7.md 方法论原文
├── scripts/install.sh   # 一键安装
├── storage/             # SQLite 数据库（git 忽略）
└── Output/              # 运行产物（git 忽略）
```

## 验证状态

E2E 测试已完成两轮：修复 4 个 bug（见 `c846ea7`）、修复报告路径解析支持
`Output/<project_id>/<run_id>` 布局（见 `fa096d3`）。完整验证矩阵与已知限制见
[VALIDATION.md](VALIDATION.md)。

已知限制摘要：

1. 目录遍历防护仅基础检查（`startsWith`），生产环境建议反向代理层加固
2. 依赖 Antfarm 环境（`~/.openclaw/workspace/antfarm/`）与 agent cron 正确配置
3. 网页上传走 base64 JSON POST，约 10MB 上限
4. 仪表板无排程轮询，刷新页面触发导入
5. Node ≥ 23.4（`node:sqlite`）

## License

私有项目，仅供个人使用。方法论内容引自《智慧公民_AI时代的能力养成》第七章「钻石营销」。
