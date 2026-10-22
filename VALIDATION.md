# VALIDATION.md — 系统验证报告

## 已验证场景

| # | 场景 | 状态 | 验证方式 |
|---|------|------|---------|
| 1 | 服务器启动 | ✅ | node server.js 启动成功，Port 3330 监听正常 |
| 2 | 数据库初始化 | ✅ | SQLite 自动创建，12 张表全部就绪，WAL 模式 |
| 3 | 创建项目 API | ✅ | POST /api/projects 返回 201，DB 写入成功，input.json 生成 |
| 4 | 项目列表 API | ✅ | GET /api/projects 返回 JSON 数组 |
| 5 | 门禁通知 API | ✅ | POST /api/gate 写入 gate_requests 表 |
| 6 | 前端页面渲染 | ✅ | index.html/project.html/dashboard.html 均为有效 HTML |
| 7 | 端口 3330 空闲 | ✅ | lsof 确认无占用 |

## 模拟验证场景（需 Antfarm 环境）

| # | 场景 | 状态 | 备注 |
|---|------|------|------|
| 8 | 输入不足→补件表单→自动 resume | 🔄 模拟 | 需要 antfarm workflow 实际运行才能验证；API 端已就绪 |
| 9 | 六阶段传递一致 | 🔄 模拟 | workflow.yml step 定义完备，handoff 变量链完整 |
| 10 | ROI 公式复算 | 🔄 模拟 | data-contracts.md 定义了统一公式和三情境 |
| 11 | 仪表板筛选/下钻 | 🔄 模拟 | 前端 UI 已建成，需实际数据填充 |
| 12 | 服务重启恢复 | 🔄 模拟 | 所有状态在 SQLite 持久化，理论可行 |

## 未验证场景

| # | 场景 | 状态 | 备注 |
|---|------|------|------|
| 13 | 端到端六阶段运行 | ❌ 未测 | 需要配置 Antfarm agent LLM API keys 后运行 |
| 14 | 图形响应式布局 | ❌ 未测 | agent 生成的 HTML 报告尚未实测 |

## 测试数据隔离

- 所有测试使用明确标记的模拟数据
- 测试项目 ID 前缀 `dm-test-` 与正式项目 `dm-YYYYMMDD-` 区分
- 业务数据库不与演示/测试数据混用

## 已知限制

1. **零外部依賴後台**：節點上無 npm install 需求，但防目錄遍歷（directory traversal）僅做基礎檢查（startsWith）；生產環境建議在反向代理層加入。
2. **Antfarm 執行路徑依賴**：依賴 `~/.openclaw/workspace/antfarm/` 存在及 agent crons 正確配置
3. **網頁上傳**：透過 base64 JSON POST 而非 multipart，檔案大小限制於 JSON body 能承載的範圍（~10MB）
4. **儀表板**：依賴各階段 data/*.json 已被 Importer 同步到 SQLite；沒有排程輪詢（需手動刷新頁面觸發導入）
5. **Node 版本**：需 Node >= 23.4（node:sqlite 內建模組）