'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

const db = require('./db');
const bridge = require('./workflow-bridge');
const importer = require('./importer');

const PORT = parseInt(process.env.DIAMOND_PORT || '3330', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT = db.ROOT;
const DATA_DIR = db.DATA_DIR;

const STAGES = ['information', 'insights', 'intention', 'initiative', 'implementation', 'master'];

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
  const headers = { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store, no-cache, must-revalidate' };
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
  if (!db.getRun(projectId, runId) || !/^[\w.-]+$/.test(filename)) return send(res, 404, { error: 'Report not found' });
  const stageDir = importer.resolveRunDir(projectId, runId);
  const filePath = path.join(stageDir, filename);
  serveStatic(res, filePath);
}

function snapshotReference(project, sourceRunId, correctionId) {
  const source = importer.resolveRunDir(project.id, sourceRunId);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error('来源运行没有可封存的输出目录');
  const root = path.resolve(project.project_root);
  const realSource = fs.realpathSync(source);
  if (!realSource.startsWith(root + path.sep)) throw new Error('来源目录不在项目下');
  const base = path.join(root, 'corrections', correctionId);
  const reference = path.join(base, 'reference');
  const artifacts = [];
  let total = 0;
  function copyTree(from, to, prefix) {
    fs.mkdirSync(to, { recursive: true });
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      if (ent.isSymbolicLink() || (!ent.isDirectory() && !ent.isFile())) throw new Error('来源包含不安全的链接或特殊文件');
      const src = path.join(from, ent.name), dst = path.join(to, ent.name);
      const rel = path.join(prefix || '', ent.name);
      if (ent.isDirectory()) copyTree(src, dst, rel);
      else {
        const stat = fs.statSync(src);
        total += stat.size;
        if (total > 1024 * 1024 * 1024) throw new Error('来源资料超过 1 GiB 上限');
        fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
        const copied = fs.statSync(dst);
        if (copied.size !== stat.size) throw new Error('来源在封存期间发生变化');
        const hash = crypto.createHash('sha256');
        const fd = fs.openSync(dst, 'r');
        const buf = Buffer.alloc(1024 * 1024);
        try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n)); }
        finally { fs.closeSync(fd); }
        artifacts.push({ path: rel, bytes: stat.size, sha256: hash.digest('hex') });
      }
    }
  }
  try {
    copyTree(source, reference);
    if (!artifacts.length) throw new Error('来源运行没有可封存的文件');
    // Freeze the current accepted input for this new job. It may have changed
    // since the source run; do not present it as that run's historical input.
    const currentInput = path.join(root, 'input.json');
    if (!fs.statSync(currentInput).isFile() || fs.lstatSync(currentInput).isSymbolicLink()) throw new Error('项目输入不是普通文件');
    const inputPath = path.join(base, 'input.json');
    fs.copyFileSync(currentInput, inputPath, fs.constants.COPYFILE_EXCL);
    JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    return { base, reference, artifacts, inputPath };
  } catch (e) { fs.rmSync(base, { recursive: true, force: true }); throw e; }
}

async function handleCorrections(req, res, projectId, url) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });
  if (req.method === 'GET') {
    const sourceRunId = url.searchParams.get('source_run_id');
    if (!sourceRunId || !db.getRun(projectId, sourceRunId)) return send(res, 400, { error: '需要有效的 source_run_id' });
    return send(res, 200, { source_run_id: sourceRunId, corrections: db.getCorrections(projectId, sourceRunId) });
  }
  const body = await readBody(req);
  const { source_run_id: sourceRunId, stage, text } = body;
  if (!sourceRunId || !db.getRun(projectId, sourceRunId)) return send(res, 400, { error: '来源 Run 不属于本项目' });
  if (!STAGES.includes(stage) || typeof text !== 'string' || !text.trim() || text.length > 20000 || typeof body.rerun !== 'boolean') {
    return send(res, 422, { error: 'stage、text、rerun 格式不正确；rerun 必须为布尔值' });
  }
  if (db.getActiveRun(projectId) || db.hasPendingCorrection(projectId)) {
    return send(res, 409, { error: '项目有进行中的运行或启动任务；不会假装停止 Agent，请等待确认结束' });
  }
  const id = crypto.randomUUID();
  let snapshot = null;
  if (body.rerun) {
    try { snapshot = snapshotReference(project, sourceRunId, id); }
    catch (e) { return send(res, 422, { error: `无法安全封存来源成果：${e.message}` }); }
  }
  const correction = db.createCorrection(projectId, {
    id, sourceRunId, stage, text: text.trim(), rerun: body.rerun,
    manifestPath: snapshot ? path.join(snapshot.base, 'manifest.json') : null
  });
  if (!body.rerun) return send(res, 201, { status: 'saved', correction });
  const priorCorrections = db.getCorrections(projectId, sourceRunId)
    .filter(c => c.id !== id && c.status === 'saved')
    .sort((a, b) => a.version - b.version)
    .map(c => ({ id: c.id, version: c.version, stage: c.stage, text: c.text, created_at: c.created_at }));
  const manifest = {
    schema: 'diamond-correction/v1', correction_id: id, version: correction.version,
    project_id: projectId, source_run_id: sourceRunId, stage, user_text: text.trim(),
    prior_corrections: priorCorrections, input_snapshot: snapshot.inputPath,
    instructions: 'The current correction and prior saved corrections are mandatory review items; the newest correction takes precedence if they conflict. User-submitted gap values in INPUTS_JSON are verified user inputs. Opinions and copied reference artifacts are not automatically verified external facts: check their evidence and mark unresolved claims. Execute all six stages and preserve the source run unchanged.',
    stages: STAGES, reference_dir: snapshot.reference, artifacts: snapshot.artifacts,
    created_at: new Date().toISOString()
  };
  const manifestPath = path.join(snapshot.base, 'manifest.json');
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' }); }
  catch (e) {
    db.updateCorrection(id, 'launch_failed', null);
    return send(res, 500, { error: `无法写入修正任务单：${e.message}`, correction_id: id });
  }
  // ---- Build supplement summary from input.json ----
  const inputPath = snapshot.inputPath;
  let supplementLines = [];
  let inputData = {};
  try {
    inputData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    if (inputData.gap_supplement_at || inputData.version > 1) {
      supplementLines.push('=== 用户已补充的数据（来自 gap 表单，必须采纳为已核实事实） ===');
      const systemFields = ['company', 'product', 'website', 'target_market', 'business_model', 'goals', 'budget_range', 'price_per_sale', 'annual_growth', 'language', 'version', 'created_at', 'gap_supplement_at', '_metric_names'];
      const metricNames = inputData._metric_names || {};
      const supplementEntries = Object.entries(inputData).filter(([k, v]) =>
        !systemFields.includes(k) && v !== null && v !== undefined && v !== ''
      );
      if (supplementEntries.length) {
        supplementLines.push('以下指标值由用户在来源 Run 中提交，视为已核实，不得重新标注为「缺失」：');
        supplementEntries.sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => {
          const nm = metricNames[k] || '';
          supplementLines.push(`  ${k}${nm ? '（' + nm + '）' : ''} = ${v}`);
        });
      }
      supplementLines.push('补充提交时间：' + (inputData.gap_supplement_at || '未知'));
      supplementLines.push('=== 用户补充数据结束 ===');
    }
  } catch (_) { /* input.json 不存在或格式错误，跳过 */ }

  // ---- Build correction directive ----
  const correctionDirectives = [
    `修正要求（指定阶段 ${stage}）：${text.trim()}`,
    ...priorCorrections.map(c => `此前已保存的修正意见（版本 ${c.version}，阶段 ${c.stage}）：${c.text}`),
    '必须逐条处理本次及此前已保存的修正意见；若互相冲突，以本次最新版为准并写明取舍。用户提交的缺口数值视为已核实输入；意见中的外部事实及旧 Run 参考资料仍须核验。'
  ];
  if (text.trim() && text.trim() !== '重新测试' && text.trim() !== '重新测试 -- 这次要重跑' && text.trim() !== '测试修正意见') {
    correctionDirectives.push('⚠️ 以上修正意见为强制性指引。所有后续阶段必须将用户意见纳入 baseline，而非仅作为参考。');
    correctionDirectives.push('如有与用户意见矛盾的分析结论，必须明确标注冲突并解释原因，不得静默忽略。');
  }

  const lang = inputData?.language || 'zh-CN';
  const taskText = [
    `PROJECT_ID: ${projectId}`,
    // The gate flow writes supplements to the live input.json; keep it readable
    // to a paused/restarted agent, while preserving the launch baseline above.
    `INPUTS_JSON: ${path.join(project.project_root, 'input.json')}`,
    `INPUT_SNAPSHOT: ${snapshot.inputPath}`,
    `LANGUAGE: ${lang}（所有输出必须使用简体中文）`,
    `CORRECTION_MANIFEST: ${manifestPath}`,
    `SOURCE_RUN_ID: ${sourceRunId}`,
    `REFERENCE_DIR: ${snapshot.reference}`,
    `GATE_URL: http://localhost:${PORT}/api/gate`,
    ...supplementLines,
    ...correctionDirectives,
    '本次必须新建独立 Run，依序完整重跑 information → insights → intention → initiative → implementation → master 六阶段。参考资料须逐项核实，不得覆盖来源 Run 的报告或数据；无法核实的事实标注待验证，所有新版产物写入新 Run 目录。'
  ].join('\n');
  try {
    const result = await bridge.workflowRun(taskText);
    if (!result.success) {
      db.updateCorrection(id, 'launch_failed', result.runId);
      return send(res, 502, { error: result.stderr || result.stdout || '启动失败', correction_id: id, manifest_path: manifestPath });
    }
    db.createRun(projectId, result.runId, taskText);
    db.updateCorrection(id, 'running', result.runId);
    db.updateProjectStatus(projectId, 'running');
    return send(res, 201, { status: 'started', correction_id: id, source_run_id: sourceRunId, run_id: result.runId, manifest_path: manifestPath });
  } catch (e) {
    db.updateCorrection(id, 'launch_uncertain', null);
    return send(res, 502, { error: `启动状态未知，需人工核对后再试：${e.message}`, correction_id: id });
  }
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
  fs.writeFileSync(inputPath, JSON.stringify({ ...body, language: body.language || 'zh-CN', version: 1, created_at: new Date().toISOString() }, null, 2));
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

  // Build task string with supplement data if available
  const inputPath = path.join(project.project_root, 'input.json');
  let supplementLines = [];
  let inputData = {};
  try {
    if (fs.existsSync(inputPath)) {
      inputData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
      if (inputData.gap_supplement_at || inputData.version > 1) {
        supplementLines.push('=== 用户已补充的数据（来自 gap 表单，必须采纳为已核实事实） ===');
        const systemFields = ['company', 'product', 'website', 'target_market', 'business_model', 'goals', 'budget_range', 'price_per_sale', 'annual_growth', 'language', 'version', 'created_at', 'gap_supplement_at', '_metric_names'];
        const metricNames = inputData._metric_names || {};
        const supplementEntries = Object.entries(inputData).filter(([k, v]) =>
          !systemFields.includes(k) && v !== null && v !== undefined && v !== ''
        );
        if (supplementEntries.length) {
          supplementLines.push('以下指标值由用户提交，视为已核实，不得重新标注为「缺失」：');
          supplementEntries.sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => {
            const nm = metricNames[k] || '';
            supplementLines.push(`  ${k}${nm ? '（' + nm + '）' : ''} = ${v}`);
          });
        }
        supplementLines.push('补充提交时间：' + (inputData.gap_supplement_at || '未知'));
        supplementLines.push('=== 用户补充数据结束 ===');
      }
    }
  } catch (_) {}
  const localRunId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const lang = inputData?.language || 'zh-CN';
  const taskText = [
    `PROJECT_ID: ${projectId}`,
    `INPUTS_JSON: ${inputPath}`,
    `GATE_URL: http://localhost:${PORT}/api/gate`,
    `LANGUAGE: ${lang}（所有输出必须使用简体中文）`,
    ...supplementLines,
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
    latest_run: latestRun,
    gate: gate ? { ...gate, missing_fields: JSON.parse(gate.missing_fields || '[]') } : null,
    stages,
    runs,
    antfarm_dashboard: 'http://localhost:3333'
  });
}

async function handleDashboard(req, res, projectId, url) {
  const project = db.getProject(projectId);
  if (!project) return send(res, 404, { error: '项目不存在' });

  const active = db.getActiveRun(projectId);
  const runs = db.getRuns(projectId);
  const selectedId = (url && url.searchParams) ? url.searchParams.get('run_id') : null;
  const latestRun = selectedId ? db.getRun(projectId, selectedId) : (active || runs[0]);
  if (selectedId && !latestRun) return send(res, 404, { error: 'Run 不属于本项目' });
  if (!latestRun) return send(res, 200, { project, message: '暂无运行，启动项目后仪表板将显示数据' });

  // Try import latest stages
  importer.tryImportAllStages(projectId, latestRun.run_id);

  const data = db.getDashboardData(projectId, latestRun.run_id);
  // Add stage completion data from filesystem
  const stages = importer.checkStageComplete(projectId, latestRun.run_id);
  data.stages = stages;

  // Auto-detect completion: all 6 stages done, run still marked running → mark completed
  const allDone = stages.length === 6 && stages.every(s => s.status === 'done');
  if (allDone && latestRun.status === 'running') {
    db.updateRunStatus(projectId, latestRun.run_id, 'completed', 'master');
    db.finishCorrectionForRun(projectId, latestRun.run_id, 'completed');
    db.updateProjectStatus(projectId, 'completed');
  }
  if (allDone && latestRun.status === 'completed') db.finishCorrectionForRun(projectId, latestRun.run_id, 'completed');

  // Also read dashboard.json for master-level data
  let dashboard = null;
  const dashRunId = latestRun.run_id;
  try {
    const dp = path.join(importer.resolveRunDir(projectId, dashRunId), 'data', 'dashboard.json');
    dashboard = JSON.parse(fs.readFileSync(dp, 'utf-8'));
  } catch {}

  send(res, 200, { ...data, runs, dashboard_json: dashboard });
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
  if (!db.getRun(projectId, runId) || !STAGES.includes(stage)) return send(res, 404, { error: 'Run 或阶段不存在' });
  const stageDir = importer.resolveRunDir(projectId, runId);
  let htmlPath = path.join(stageDir, `${stage}.html`);
  if (stage === 'intention' && !fs.existsSync(htmlPath)) htmlPath = path.join(stageDir, 'goal.html');
  if (stage === 'master' && !fs.existsSync(htmlPath)) htmlPath = path.join(stageDir, 'Master.html');
  if (stage === 'master' && !fs.existsSync(htmlPath) && fs.existsSync(path.join(stageDir, 'data', 'dashboard.json'))) {
    res.writeHead(302, { Location: `/dashboard.html?id=${encodeURIComponent(projectId)}&run_id=${encodeURIComponent(runId)}` });
    return res.end();
  }
  if (!fs.existsSync(htmlPath)) {
    return send(res, 404, { error: '该阶段报告尚未生成' });
  }
  serveStatic(res, htmlPath);
}

// ---- Data Gap handlers ----
function collectGaps(projectId) {
  const project = db.getProject(projectId);
  if (!project) return [];
  const runs = db.getRuns(projectId);
  if (!runs.length) return [];
  // Read user-submitted values from input.json
  let supplementData = {};
  try {
    const inputPath = path.join(project.project_root, 'input.json');
    if (fs.existsSync(inputPath)) {
      const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
      // Extract MET values and any non-system fields
      for (const [k, v] of Object.entries(input)) {
        if (k.startsWith('MET-') && v !== null && v !== undefined) {
          supplementData[k] = v;
        }
      }
    }
  } catch {}
  const runId = runs[0].run_id;
  const stageDir = path.join(importer.resolveRunDir(projectId, runId), 'data');
  const gaps = [];
  for (const stage of ['information','insights','intention','initiative','implementation','master']) {
    const fp = path.join(stageDir, `${stage}.json`);
    if (!fs.existsSync(fp)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const metrics = data.metrics || [];
      for (const m of metrics) {
        if (m.value === null || m.value === undefined || m.data_gap || m.status === 'gap') {
          const metId = m.metric_id || m.met_id;
          gaps.push({
            stage, metric_id: metId, name: m.name,
            definition: m.definition || '', formula: m.formula || '',
            unit: m.unit || '', note: m.note || m.impact || '',
            current_value: supplementData[metId] ?? null
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
  // Extract metric names mapping (sent by frontend) and strip from body
  const metricNames = body._names || {};
  const { _names, ...gapValues } = body;
  // Merge submitted values into input.json
  const inputPath = path.join(project.project_root, 'input.json');
  let input = {};
  try { input = JSON.parse(fs.readFileSync(inputPath, 'utf-8')); } catch {}
  const baseVersion = input.version || 1;
  // Persist metric name mapping for downstream lookups
  input._metric_names = { ...(input._metric_names || {}), ...metricNames };
  // Save submitted gaps to gap_supplements
  const supplement = { ...gapValues, _metric_names: metricNames, version: baseVersion + 1, gap_supplement_at: new Date().toISOString() };
  fs.writeFileSync(
    path.join(project.project_root, `gap-supplement-v${baseVersion + 1}.json`),
    JSON.stringify(supplement, null, 2)
  );
  // Merge into input for downstream stages
  const merged = { ...input, ...gapValues, _metric_names: { ...(input._metric_names || {}), ...metricNames }, version: baseVersion + 1, gap_supplement_at: new Date().toISOString() };
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
    const correctionMatch = p.match(/^\/api\/projects\/([^/]+)\/corrections$/);
    const dashMatch = p.match(/^\/api\/dashboard\/([^/]+)$/);

    // GET /api/projects/:id/report/:stage — serve stage HTML report
    const stageReportMatch = p.match(/^\/api\/projects\/([^/]+)\/report\/([^/]+)$/);
    if (stageReportMatch && req.method === 'GET') {
      const activeRun = db.getActiveRun(stageReportMatch[1]);
      const runs = db.getRuns(stageReportMatch[1]);
      const requested = url.searchParams.get('run_id');
      const runId = requested || (runs.find(r => r.status === 'completed') || activeRun || runs[0])?.run_id;
      if (!runId) return send(res, 404, { error: '无运行记录' });
      return handleStageReport(res, stageReportMatch[1], runId, stageReportMatch[2]);
    }

    if (projMatch && req.method === 'GET') return handleGetProject(req, res, projMatch[1]);
    if (startMatch && req.method === 'POST') return handleStartProject(req, res, startMatch[1]);
    if (killMatch && req.method === 'POST') return handleKillProject(req, res, killMatch[1]);
    if (gapsMatch && req.method === 'GET') return handleGetGaps(req, res, gapsMatch[1]);
    if (gapsMatch && req.method === 'POST') return handleSubmitGaps(req, res, gapsMatch[1]);
    if (correctionMatch && ['GET', 'POST'].includes(req.method)) return handleCorrections(req, res, correctionMatch[1], url);
    if (gateMatch && req.method === 'GET') return handleGetGate(req, res, gateMatch[1]);
    if (gateMatch && req.method === 'POST') return handleSubmitGate(req, res, gateMatch[1]);
    if (dashMatch && req.method === 'GET') return handleDashboard(req, res, dashMatch[1], url);

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
