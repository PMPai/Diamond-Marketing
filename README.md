# 💎 Diamond Marketing

以《智慧公民_AI时代的能力养成》第七章「钻石营销」为方法论，**一套大包**内含六个专职 Agent 的工作流 + 本地后台 + 动态仪表板。

## 架构

```
一套大包分两部分：
Part 1: 资料补齐后台 (Port 3330) — 零依賴 node:http + node:sqlite
  ├── project.html — 状态查看 + 阶段进度 + 数据缺口管理 + 门禁补件
  ├── dashboard.html — SVG 图形仪表板（钻石结构 / 指标 / ROI）
  └── API: 项目 CRUD / 门禁通知 / 补件校验 / 缺口提交 / kill

Part 2: Antfarm 工作流 (Port 3333 进度参考)
  ├── 6 Agent × 6 Stage（信息→分析→目标→策略→执行→汇总）
  └── Stage 1 内置资料门禁（不足 → POST :3330/api/gate → 用户补件 → resume）
```

## 端口

| Port | 用途 |
|------|------|
| 3330 | Diamond 后台（输入/补件/仪表板） |
| 3333 | Antfarm Dashboard（只读进度） |

## 快速启动

```bash
# 1. 安装工作流
cp -R workflow/ ~/.openclaw/workspace/antfarm/workflows/diamond-marketing/
node ~/.openclaw/workspace/antfarm/dist/cli/cli.js workflow install diamond-marketing

# 2. 启动后台
cd backend && node server.js   # 零依赖，Node ≥23.4

# 3. 打开 http://localhost:3330
```

## 六个阶段

| # | Agent | 职责 |
|---|-------|------|
| 1 | Diamond-Information | 输入检查（资料门禁）+ MECE 五类研究 |
| 2 | Diamond-Insights | 市场阶段 / 4P·4C / QBQ / ARC 系统 |
| 3 | Diamond-Goal | 优先目标 + SMART KPI + ROI 情境 |
| 4 | Diamond-Initiative | IMC 沟通策略 + WBS 任务分解 |
| 5 | Diamond-Implementation | 执行建议 + 检查点 + 风险 |
| 6 | Master | 汇总 dashboard.json + 动态仪表板渲染 |