# Gate Protocol v1 — 资料门禁协议

Diamond-Marketing 系统「资料补齐」的唯一约定。**只有第一阶段（diamond-information）可以触发门禁等待**，其余阶段一律不得调用门禁或等待用户。

## 角色

- **Diamond Marketing 应用后台**（下称「后台」）：Express 本地服务，端口 **3330**，负责人机交互（资料输入、补资料表单、进度、仪表板）。
- **Antfarm 工作流**：六个 agent 依序执行研究/分析/报告，端口 3333 的 antfarm dashboard 仅显示原生进度。
- **业务数据库**：后台维护的 SQLite。**工作流 agent 一律不得直接写这个数据库**，只输出 `data/*.json`（见 data-contracts.md），由后台 Importer 入库。

## 项目目录约定

```
<PROJECT_ROOT> = backend/data/projects/<project_id>/
├── input.json            # 当前有效输入（含 version 字段；补件后 version 递增）
├── gate.json             # 门禁状态文件（仅第一阶段可写）
├── uploads/              # 用户上传的补充资料
└── Output/<run_id>/      # 各阶段产出（STAGE_DIR 即此目录的绝对路径）
    ├── information.html / insights.html / goal.html / initiative.html / implementation.html / Master.html
    ├── handoffs/*.md
    └── data/*.json
```

`project_id` 由后台生成（格式 `dm-YYYYMMDD-xxxx`），通过任务文本的 `PROJECT_ID:` 约定行传给工作流。

## 任务文本约定（后台 → workflow run）

```
PROJECT_ID: dm-20261022-ab12
INPUTS_JSON: /abs/path/backend/data/projects/dm-20261022-ab12/input.json
GATE_URL: http://localhost:3330/api/gate
任务：为 <公司>（产品：<产品>）制定钻石营销方案
```

## 门禁流程（第一阶段）

1. **检查输入充分性**（读取 INPUTS_JSON 指向的文件）。判断标准见 diamond-information 的 AGENTS.md。
2. **资料充分** → 正常完成研究，`step complete`。
3. **资料不足** → 依次做三件事：
   a. 写 `<PROJECT_ROOT>/gate.json`：
   ```json
   {
     "status": "waiting",
     "project_id": "dm-...",
     "run_id": "<run_id>",
     "generated_at": "<ISO8601>",
     "known_info": [{"field": "company", "value": "...", "source": "user_input|public|estimate"}],
     "missing_fields": [{
       "field": "unit_price",
       "label": "产品单价",
       "required": true,
       "format": "number",
       "unit": "CNY",
       "range": [0.01, null],
       "reason": "缺少价格无法计算贡献利润与 ROI",
       "impact": ["第三阶段 ROI 三情境", "第四阶段预算"],
       "allow_unknown": true,
       "unknown_handling": "以行业均价估算并标记为估算参数"
     }]
   }
   ```
   b. `curl -s -X POST http://localhost:3330/api/gate -H 'Content-Type: application/json' -d '{"project_id":"...","run_id":"...","status":"waiting"}'`（后台不可达时不阻塞：gate.json 已落地，后台会轮询兜底）。
   c. 调用 `antfarm step fail <step-id> "waiting_data: 缺少 <字段列表>，已生成补资料表单"`。
   **绝对不要调用 step complete，不要伪造成功，不要空等。**
4. **后台侧**：收到 gate 通知（或轮询发现 gate.json）→ 项目状态置为 `waiting_data` → 在 3330 渲染动态补资料表单（内容完全来自 missing_fields）→ 用户提交 → 服务端逐字段校验 → 合并写入 input.json（version+1）→ `gate.json.status` 改为 `"fulfilled"`（记录 fulfilled_at）→ 调用 `antfarm workflow resume <run-id>` **一次**（幂等：同一 gate 版本只 resume 一次）。
5. **resume 后**第一阶段重新执行：读到 `gate.json.status=="fulfilled"` 且 input.json 版本已更新 → 继续正常研究。

**注意：gate.json 存在且 `status:"waiting"` 但 input.json 版本未更新时，视为资料未到位，立即再次 `step fail "waiting_data: ..."`，不要重复研究。**

## 红线

- 等待用户**不消耗**技术重试预算：`waiting_data` 失败由后台在补件后才 resume，不会连续触发。
- 不修改 antfarm 内部状态表来伪造暂停/成功。
- 「表单已生成」≠「第一阶段完成」：门禁触发时第一阶段处于 failed(waiting_data) 状态。
- 除第一阶段外无人工门禁；其余阶段靠 expects 质量检查 + 有限重试（max_retries），无法修复时如实失败。