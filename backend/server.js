'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const db = require('./db');
const bridge = require('./workflow-bridge');
const importer = require('./importer');

const PORT = parseInt(process.env.DIAMOND_PORT || '3330', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT = db.ROOT;
const DATA_DIR = db.DATA_DIR;

// ---- MIME map ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif'
};

// ---- Helpers ----
function send(res, code, data, contentType = 'application/json') {
  const headers = { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' };
  if (Buffer.isBuffer(data)) {
    headers['Content-Length'] = data.length;
    res.writeHead(code, headers);
    res.end(data);
  } else {
    res.writeHead(code, headers);
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({ raw: body }); } });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  try {
    const content = fs.readFileSync(filePath);
    send(res, 200, content, MIME[ext] || 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

function serveReportFile(res, projectId, runId, filename) {
  const stageDir = path.join(DATA_DIR, 'projects', projectId, 'Output', runId);
  const filePath = path.join(stageDir, filename);
  serveStatic(res, filePath);
}

// ---- Route handlers ----
async function handleCreateProject(req, res) {
  const body = await readBody(req);
  if (!body.company || !body.product) {
    return send(res, 400, { error: '缺少必填字段：company、product' });
  }
  const project = db.createProject(body);
  // Write initial input.json
  const inputPath = path.join(project.project_root, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ ...body, version: 1, created_at: new Date().toISOString() }, null, 2));
  send(res, 201, project);
}

async function handleStartProject(req, res, projectId) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });

  const active = db.getActiveRun(projectId);
  if (active) {
    // Check if gate is waiting — allow resume instead
    const gate = db.getGate(projectId);
    if (gate && gate.status === 'waiting') {
      return send(res, 200, { status: 'waiting_data', gate, message: '项目正在等待补资料，请先提交补件' });
    }
    return send(res, 200, { status: 'running', run: active, message: '项目已有进行中的运行' });
  }

  // Build task string
  const localRunId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const taskText = [
    `PROJECT_ID: ${projectId}`,
    `INPUTS_JSON: ${path.join(project.project_root, 'input.json')}`,
    `GATE_URL: http://localhost:${PORT}/api/gate`,
    `任务：为${project.company}（产品：${project.product}）制定钻石营销方案`
  ].join('\n');

  const result = await bridge.workflowRun(taskText);
  const runId = result.runId || localRunId;
  if (result.success) {
    db.createRun(projectId, runId, taskText);
    db.updateProjectStatus(projectId, 'running');
    send(res, 200, { status: 'started', run_id: runId, antfarm: result });
  } else {
    // Record the failed run attempt — mark as failed so it doesn't block restarts
    db.createRun(projectId, runId, taskText);
    db.updateRunStatus(projectId, runId, 'failed', null);
    send(res, 500, { status: 'error', run_id: runId, error: result.stderr || result.stdout });
  }
}

async function handleGateNotification(req, res) {
  const body = await readBody(req);
  const { project_id, run_id, status, missing_fields, known_info } = body;
  if (!project_id) return send(res, 400, { error: '缺少 project_id' });

  const project = db.getProject(project_id);
  if (!project) return send(res, 404, { error: '项目不存在' });

  db.upsertGate(project_id, run_id || '', {
    status: status || 'waiting',
    missing_fields: missing_fields || [],
    known_info: known_info || []
  });
  db.updateProjectStatus(project_id, 'waiting_data');
  send(res, 200, { status: 'ok', message: '门禁已记录，等待用户补件' });
}

async function handleGetGate(req, res, projectId) {
  const gate = db.getGate(projectId);
  if (!gate) return send(res, 200, { status: 'no_gate', message: '暂无门禁请求' });

  const parsed = {
    ...gate,
    missing_fields: JSON.parse(gate.missing_fields || '[]'),
    known_info: JSON.parse(gate.known_info || '[]')
  };
  send(res, 200, parsed);
}

async function handleSubmitGate(req, res, projectId) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 400, { error: '项目不存在' });

  const gate = db.getGate(projectId);
  if (!gate || gate.status !== 'waiting') {
    return send(res, 400, { error: '当前无等待中的门禁请求' });
  }

  const body = await readBody(req);
  // Validate: at minimum, all required fields must have a value
  const missingFields = JSON.parse(gate.missing_fields || '[]');
  const errors = [];
  for (const f of missingFields) {
    if (f.required) {
      const val = body[f.field];
      if (val === undefined || val === null || val === '') {
        if (!f.allow_unknown) {
          errors.push({ field: f.field, label: f.label, error: '此字段为必填' });
        }
      }
    }
  }
  if (errors.length > 0) {
    return send(res, 422, { status: 'invalid', errors, message: '请修正以下字段' });
  }

  // Merge into input.json
  const inputPath = path.join(project.project_root, 'input.json');
  let input = {};
  try { input = JSON.parse(fs.readFileSync(inputPath, 'utf-8')); } catch {}
  const newVersion = (input.version || 1) + 1;
  const merged = { ...input, ...body, version: newVersion, supplement_at: new Date().toISOString() };
  fs.writeFileSync(inputPath, JSON.stringify(merged, null, 2));

  // Record submission
  db.recordGateSubmission(projectId, body);
  db.fulfillGate(projectId);

  // Auto-resume the workflow
  const gateRunId = gate.run_id;
  const resumeResult = await bridge.workflowResume(gateRunId);
  if (resumeResult.success) {
    db.updateProjectStatus(projectId, 'running');
    send(res, 200, { status: 'fulfilled', resumed: true, run_id: gateRunId, message: '补件已保存，工作流已接续' });
  } else {
    send(res, 200, { status: 'fulfilled', resumed: false, run_id: gateRunId, message: '补件已保存，但工作流接续失败（run可能在Antfarm中不存在），请手动启动或resume', error: resumeResult.stderr });
  }
}

async function handleGetProject(req, res, projectId) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });

  const gate = db.getGate(projectId);
  const active = db.getActiveRun(projectId);
  const runs = db.getRuns(projectId);
  const latestRun = active || (runs.length > 0 ? runs[0] : null);
  let stages = [];
  if (latestRun) {
    stages = importer.checkStageComplete(projectId, latestRun.run_id);
  }

  send(res, 200, {
    project,
    active_run: active,
    gate: gate ? { ...gate, missing_fields: JSON.parse(gate.missing_fields || '[]') } : null,
    stages,
    runs,
    antfarm_dashboard: 'http://localhost:3333'
  });
}

async function handleDashboard(req, res, projectId) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });

  const active = db.getActiveRun(projectId);
  const runs = db.getRuns(projectId);
  const latestRun = active || (runs.length > 0 ? runs[0] : null);
  if (!latestRun) return send(res, 200, { project, message: '暂无运行，启动项目后仪表板将显示数据' });

  // Try import latest stages
  importer.tryImportAllStages(projectId, latestRun.run_id);

  const data = db.getDashboardData(projectId, latestRun.run_id);
  // Add stage completion data from filesystem
  data.stages = importer.checkStageComplete(projectId, latestRun.run_id);
  // Also read dashboard.json for master-level data
  let dashboard = null;
  const dashRunId = active ? active.run_id : latestRun.run_id;
  try {
    const dp = path.join(DATA_DIR, 'projects', projectId, 'Output', dashRunId, 'data', 'dashboard.json');
    dashboard = JSON.parse(fs.readFileSync(dp, 'utf-8'));
  } catch {}

  send(res, 200, { ...data, dashboard_json: dashboard });
}

async function handleKillProject(req, res, projectId) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });
  const body = await readBody(req);
  const action = body.action || 'pause';

  if (action === 'terminate') {
    // Hard kill: stop workflow + delete all runs + reset project
    const active = db.getActiveRun(projectId);
    if (active) {
      await bridge.workflowStop(active.run_id);
      db.updateRunStatus(projectId, active.run_id, 'cancelled', null);
    }
    db.updateProjectStatus(projectId, 'draft');
    send(res, 200, { status: 'terminated', message: '所有运行已终止，项目已重置' });
  } else {
    // Pause: stop current run but keep state
    const active = db.getActiveRun(projectId);
    if (active) {
      await bridge.workflowStop(active.run_id);
      db.updateRunStatus(projectId, active.run_id, 'paused', null);
    }
    db.updateProjectStatus(projectId, 'paused');
    send(res, 200, { status: 'paused', message: '工作流已暂停，可随时 resume 继续' });
  }
}

function handleStageReport(res, projectId, runId, stage) {
  const stageDir = path.join(DATA_DIR, 'projects', projectId, 'Output', runId);
  const htmlPath = path.join(stageDir, `${stage}.html`);
  if (!fs.existsSync(htmlPath)) {
    return send(res, 404, { error: '该阶段报告尚未生成' });
  }
  serveStatic(res, htmlPath);
}

// ---- Data Gap handlers ----
function collectGaps(projectId) {
  const runs = db.getRuns(projectId);
  if (!runs.length) return [];
  const runId = runs[0].run_id;
  const stageDir = path.join(DATA_DIR, 'projects', projectId, 'Output', runId, 'data');
  const gaps = [];
  for (const stage of ['information','insights','goal','initiative','implementation','master']) {
    const fp = path.join(stageDir, `${stage}.json`);
    if (!fs.existsSync(fp)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const metrics = data.metrics || [];
      for (const m of metrics) {
        if (m.value === null || m.value === undefined || m.data_gap || m.status === 'gap') {
          gaps.push({
            stage, metric_id: m.metric_id, name: m.name,
            definition: m.definition || '', formula: m.formula || '',
            unit: m.unit || '', note: m.note || m.impact || ''
          });
        }
      }
    } catch {}
  }
  return gaps;
}

async function handleGetGaps(req, res, projectId) {
  const gaps = collectGaps(projectId);
  send(res, 200, { gaps, count: gaps.length });
}

async function handleSubmitGaps(req, res, projectId) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });
  const body = await readBody(req);
  // Merge submitted values into input.json
  const inputPath = path.join(project.project_root, 'input.json');
  let input = {};
  try { input = JSON.parse(fs.readFileSync(inputPath, 'utf-8')); } catch {}
  const baseVersion = input.version || 1;
  // Save submitted gaps to gap_supplements
  const supplement = { ...body, version: baseVersion + 1, gap_supplement_at: new Date().toISOString() };
  fs.writeFileSync(
    path.join(project.project_root, `gap-supplement-v${baseVersion + 1}.json`),
    JSON.stringify(supplement, null, 2)
  );
  // Merge into input for downstream stages
  const merged = { ...input, ...body, version: baseVersion + 1, gap_supplement_at: new Date().toISOString() };
  fs.writeFileSync(inputPath, JSON.stringify(merged, null, 2));

  // Try to resume workflow
  const active = db.getActiveRun(projectId);
  if (active) {
    const resumeResult = await bridge.workflowResume(active.run_id);
    if (resumeResult.success) {
      db.updateProjectStatus(projectId, 'running');
      send(res, 200, { status: 'submitted', resumed: true, message: '缺口数据已保存，工作流已接续' });
    } else {
      send(res, 200, { status: 'submitted', resumed: false, message: '缺口数据已保存', error: resumeResult.stderr });
    }
  } else {
    send(res, 200, { status: 'submitted', message: '缺口数据已保存，无活跃运行' });
  }
}

// ---- Static file routes ----
function handleStatic(req, res) {
  let reqPath = new URL(req.url, `http://localhost`).pathname;
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  serveStatic(res, filePath);
}

// ---- Router ----
const server = http.createServer(async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost`);
  const p = url.pathname;

  // Static files (HTML pages, CSS, JS)
  if (req.method === 'GET' && /^\/($|css\/|js\/|index\.html|project\.html|dashboard\.html|favicon\.ico)/.test(p)) {
    return handleStatic(req, res);
  }

  // API routes
  try {
    // POST /api/projects
    if (req.method === 'POST' && p === '/api/projects') return handleCreateProject(req, res);

    // GET /api/projects
    if (req.method === 'GET' && p === '/api/projects') {
      return send(res, 200, db.listProjects());
    }

    // POST /api/gate
    if (req.method === 'POST' && p === '/api/gate') return handleGateNotification(req, res);

    // /api/projects/:id routes
    const projMatch = p.match(/^\/api\/projects\/([^/]+)$/);
    const gateMatch = p.match(/^\/api\/projects\/([^/]+)\/gate$/);
    const startMatch = p.match(/^\/api\/projects\/([^/]+)\/start$/);
    const killMatch = p.match(/^\/api\/projects\/([^/]+)\/kill$/);
    const gapsMatch = p.match(/^\/api\/projects\/([^/]+)\/gaps$/);
    const dashMatch = p.match(/^\/api\/dashboard\/([^/]+)$/);

    // GET /api/projects/:id/report/:stage — serve stage HTML report
    const stageReportMatch = p.match(/^\/api\/projects\/([^/]+)\/report\/([^/]+)$/);
    if (stageReportMatch && req.method === 'GET') {
      const activeRun = db.getActiveRun(stageReportMatch[1]);
      const runs = db.getRuns(stageReportMatch[1]);
      const runId = activeRun ? activeRun.run_id : (runs.length > 0 ? runs[0].run_id : null);
      if (!runId) return send(res, 404, { error: '无运行记录' });
      return handleStageReport(res, stageReportMatch[1], runId, stageReportMatch[2]);
    }

    if (projMatch && req.method === 'GET') return handleGetProject(req, res, projMatch[1]);
    if (startMatch && req.method === 'POST') return handleStartProject(req, res, startMatch[1]);
    if (killMatch && req.method === 'POST') return handleKillProject(req, res, killMatch[1]);
    if (gapsMatch && req.method === 'GET') return handleGetGaps(req, res, gapsMatch[1]);
    if (gapsMatch && req.method === 'POST') return handleSubmitGaps(req, res, gapsMatch[1]);
    if (gateMatch && req.method === 'GET') return handleGetGate(req, res, gateMatch[1]);
    if (gateMatch && req.method === 'POST') return handleSubmitGate(req, res, gateMatch[1]);
    if (dashMatch && req.method === 'GET') return handleDashboard(req, res, dashMatch[1]);

    // GET /reports/:project_id/:run_id/:file
    const reportMatch = p.match(/^\/reports\/([^/]+)\/([^/]+)\/(.+)$/);
    if (reportMatch && req.method === 'GET') return serveReportFile(res, reportMatch[1], reportMatch[2], reportMatch[3]);

    send(res, 404, { error: 'Not found', path: p });
  } catch (err) {
    console.error('Server error:', err);
    send(res, 500, { error: err.message });
  }
});

// ---- Init & Start ----
db.init();
console.log(`[Diamond] DB: ${db.DB_PATH}`);
console.log(`[Diamond] Data: ${DATA_DIR}`);

server.listen(PORT, () => {
  console.log(`[Diamond] Server: http://localhost:${PORT}`);
  console.log(`[Diamond] Workflow: ${bridge.WORKFLOW_ID}`);
  console.log(`[Diamond] Antfarm CLI: ${process.env.ANTFARM_CLI || 'default'}`);
});