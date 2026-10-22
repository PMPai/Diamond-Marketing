'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let db;

const ROOT = process.env.DIAMOND_ROOT || path.resolve(__dirname, '..');
const DB_PATH = process.env.DIAMOND_DB || path.join(ROOT, 'storage', 'diamond.db');
const DATA_DIR = process.env.DIAMOND_DATA || path.join(ROOT, 'backend', 'data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  product TEXT NOT NULL,
  website TEXT DEFAULT '',
  target_market TEXT DEFAULT '',
  business_model TEXT DEFAULT '',
  goals TEXT DEFAULT '',
  budget_range TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  project_root TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  project_id TEXT REFERENCES projects(id),
  run_id TEXT NOT NULL,
  task_text TEXT,
  status TEXT DEFAULT 'pending',
  started_at TEXT,
  finished_at TEXT,
  stage_reached TEXT,
  PRIMARY KEY (project_id, run_id)
);

CREATE TABLE IF NOT EXISTS gate_requests (
  project_id TEXT REFERENCES projects(id),
  run_id TEXT NOT NULL,
  status TEXT DEFAULT 'waiting',
  missing_fields TEXT DEFAULT '[]',
  known_info TEXT DEFAULT '[]',
  generated_at TEXT,
  fulfilled_at TEXT,
  PRIMARY KEY (project_id)
);

CREATE TABLE IF NOT EXISTS gate_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id),
  data TEXT NOT NULL,
  validated INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  run_id TEXT,
  source_id TEXT,
  title TEXT,
  provider TEXT,
  url TEXT,
  published TEXT,
  fetched TEXT,
  scope TEXT,
  cited_in TEXT DEFAULT '[]',
  verification TEXT DEFAULT 'unverified'
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  run_id TEXT,
  stage TEXT,
  claim_id TEXT,
  text TEXT,
  evidence_refs TEXT DEFAULT '[]',
  confidence TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'fact'
);

CREATE TABLE IF NOT EXISTS metrics (
  project_id TEXT,
  metric_id TEXT,
  name TEXT,
  definition TEXT,
  formula TEXT,
  unit TEXT,
  window TEXT,
  PRIMARY KEY (project_id, metric_id)
);

CREATE TABLE IF NOT EXISTS roi_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  run_id TEXT,
  initiative_id TEXT,
  name TEXT,
  cost REAL,
  benefit REAL,
  roi REAL,
  payback_months REAL,
  assumptions TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS initiatives (
  project_id TEXT,
  run_id TEXT,
  initiative_id TEXT,
  title TEXT,
  arc_focus TEXT,
  target_segment TEXT,
  smart_goal TEXT DEFAULT '{}',
  kpis TEXT DEFAULT '{}',
  priority_status TEXT DEFAULT 'confirmed',
  PRIMARY KEY (project_id, run_id, initiative_id)
);

CREATE TABLE IF NOT EXISTS wbs_tasks (
  project_id TEXT,
  run_id TEXT,
  task_id TEXT,
  parent_id TEXT DEFAULT NULL,
  initiative_id TEXT,
  arc_stage TEXT,
  title TEXT,
  owner_role TEXT,
  resources TEXT DEFAULT '{}',
  depends_on TEXT DEFAULT '[]',
  duration_days INTEGER DEFAULT 0,
  done_criteria TEXT,
  kpi TEXT,
  status TEXT DEFAULT 'planned',
  PRIMARY KEY (project_id, run_id, task_id)
);

CREATE TABLE IF NOT EXISTS schedule_checkpoints (
  project_id TEXT,
  run_id TEXT,
  checkpoint_id TEXT,
  task_ref TEXT,
  due TEXT,
  criteria TEXT,
  owner_role TEXT,
  status TEXT DEFAULT 'pending',
  PRIMARY KEY (project_id, run_id, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS deliverables (
  project_id TEXT,
  run_id TEXT,
  stage TEXT,
  artifact TEXT,
  path TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imports (
  project_id TEXT,
  run_id TEXT,
  stage TEXT,
  imported_at TEXT DEFAULT (datetime('now')),
  source_path TEXT,
  PRIMARY KEY (project_id, run_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);
CREATE INDEX IF NOT EXISTS idx_claims_project_stage ON claims(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_wbs_project ON wbs_tasks(project_id, run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_dedup ON sources(project_id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_dedup ON claims(project_id, claim_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roi_dedup ON roi_scenarios(project_id, run_id, initiative_id, name);
`;

function init() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SCHEMA);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const projectsDir = path.join(DATA_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
  return db;
}

function getDb() { return db; }

function getProject(projectId) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
}

function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
}

function createProject(project) {
  const now = new Date().toISOString();
  const id = project.id || `dm-${now.slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6)}`;
  const projectRoot = path.join(DATA_DIR, 'projects', id);
  fs.mkdirSync(projectRoot, { recursive: true });
  db.prepare(`INSERT INTO projects (id, company, product, website, target_market, business_model, goals, budget_range, status, project_root, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`).run(
    id, project.company, project.product, project.website || '', project.target_market || '',
    project.business_model || '', project.goals || '', project.budget_range || '',
    projectRoot, now, now
  );
  return getProject(id);
}

function updateProjectStatus(id, status) {
  db.prepare('UPDATE projects SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
}

function createRun(projectId, runId, taskText) {
  db.prepare('INSERT INTO runs (project_id, run_id, task_text, status, started_at) VALUES (?, ?, ?, \'running\', datetime(\'now\'))')
    .run(projectId, runId, taskText);
}

function updateRunStatus(projectId, runId, status, stageReached) {
  const updates = ['status = ?'];
  const params = [status];
  if (stageReached) { updates.push('stage_reached = ?'); params.push(stageReached); }
  if (status === 'completed' || status === 'failed') { updates.push('finished_at = datetime(\'now\')'); }
  params.push(projectId, runId);
  db.prepare(`UPDATE runs SET ${updates.join(', ')} WHERE project_id = ? AND run_id = ?`).run(...params);
}

function updateRunStage(projectId, runId, stageReached) {
  db.prepare('UPDATE runs SET stage_reached = ? WHERE project_id = ? AND run_id = ?')
    .run(stageReached, projectId, runId);
}

function getActiveRun(projectId) {
  return db.prepare('SELECT * FROM runs WHERE project_id = ? AND status NOT IN (\'completed\', \'failed\', \'cancelled\') ORDER BY started_at DESC LIMIT 1').get(projectId);
}

function getRuns(projectId) {
  return db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC').all(projectId);
}

function upsertGate(projectId, runId, data) {
  const existing = db.prepare('SELECT * FROM gate_requests WHERE project_id = ?').get(projectId);
  if (existing) {
    db.prepare('UPDATE gate_requests SET run_id = ?, status = ?, missing_fields = ?, known_info = ?, generated_at = ? WHERE project_id = ?')
      .run(runId, data.status || 'waiting', JSON.stringify(data.missing_fields || []), JSON.stringify(data.known_info || []), data.generated_at || new Date().toISOString(), projectId);
  } else {
    db.prepare('INSERT INTO gate_requests (project_id, run_id, status, missing_fields, known_info, generated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, runId, data.status || 'waiting', JSON.stringify(data.missing_fields || []), JSON.stringify(data.known_info || []), data.generated_at || new Date().toISOString());
  }
}

function fulfillGate(projectId) {
  db.prepare('UPDATE gate_requests SET status = \'fulfilled\', fulfilled_at = datetime(\'now\') WHERE project_id = ?').run(projectId);
}

function getGate(projectId) {
  return db.prepare('SELECT * FROM gate_requests WHERE project_id = ?').get(projectId);
}

function recordGateSubmission(projectId, data) {
  db.prepare('INSERT INTO gate_submissions (project_id, data) VALUES (?, ?)').run(projectId, JSON.stringify(data));
}

// Importer helpers — upsert data from stage JSON files
function importSources(projectId, runId, sources) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO sources (project_id, run_id, source_id, title, provider, url, published, fetched, scope, cited_in, verification) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const s of sources) {
    stmt.run(projectId, runId, s.source_id, s.title, s.provider, s.url, s.published, s.fetched, s.scope, JSON.stringify(s.cited_in || []), s.verification || 'unverified');
  }
}

function importClaims(projectId, runId, stage, claims) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO claims (project_id, run_id, stage, claim_id, text, evidence_refs, confidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const c of claims) {
    stmt.run(projectId, runId, stage, c.claim_id, c.text, JSON.stringify(c.evidence || []), c.confidence || 'medium', c.status || 'fact');
  }
}

function importMetrics(projectId, metrics) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO metrics (project_id, metric_id, name, definition, formula, unit, window) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const m of metrics) {
    stmt.run(projectId, m.metric_id, m.name, m.definition, m.formula, m.unit, m.window);
  }
}

function importInitiatives(projectId, runId, selected) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO initiatives (project_id, run_id, initiative_id, title, arc_focus, target_segment, smart_goal, kpis, priority_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const ini of selected) {
    stmt.run(projectId, runId, ini.initiative_id, ini.title, ini.arc_focus || '', ini.segment || '',
      JSON.stringify(ini.smart_goal || {}), JSON.stringify(ini.kpis || {}), ini.priority_status || 'confirmed');
  }
}

function importRoiScenarios(projectId, runId, scenariosByInitiative) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO roi_scenarios (project_id, run_id, initiative_id, name, cost, benefit, roi, payback_months, assumptions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const group of scenariosByInitiative) {
    for (const row of (group.rows || [])) {
      stmt.run(projectId, runId, group.initiative_id, row.name, row.cost || 0, row.attributable_margin || row.benefit || 0, row.roi || 0, row.payback_months || 0, JSON.stringify(row.assumptions || []));
    }
  }
}

function importWbsTasks(projectId, runId, tasks) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO wbs_tasks (project_id, run_id, task_id, parent_id, initiative_id, arc_stage, title, owner_role, resources, depends_on, duration_days, done_criteria, kpi, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const t of tasks) {
    stmt.run(projectId, runId, t.task_id, t.parent_id || null, t.initiative_id, t.arc_stage || '', t.title,
      t.owner_role || '', JSON.stringify(t.resources || {}), JSON.stringify(t.depends_on || []), t.duration_days || 0, t.done_criteria || '', t.kpi || '', t.status || 'planned');
  }
}

function importCheckpoints(projectId, runId, checkpoints) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  const stmt = d.prepare('INSERT OR REPLACE INTO schedule_checkpoints (project_id, run_id, checkpoint_id, task_ref, due, criteria, owner_role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const cp of checkpoints) {
    stmt.run(projectId, runId, cp.checkpoint_id, cp.task_ref, cp.due, cp.criteria, cp.owner_role || '', cp.status || 'pending');
  }
}

function recordImport(projectId, runId, stage, sourcePath) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  d.prepare('INSERT OR REPLACE INTO imports (project_id, run_id, stage, source_path) VALUES (?, ?, ?, ?)').run(projectId, runId, stage, sourcePath);
}

// Dashboard data query
function getDashboardData(projectId, runId) {
  const d = getDb(); if (!d) throw new Error('DB not initialized');
  return {
    project: getProject(projectId),
    run: d.prepare('SELECT * FROM runs WHERE project_id = ? AND run_id = ?').get(projectId, runId),
    stages: d.prepare('SELECT * FROM imports WHERE project_id = ? AND run_id = ? ORDER BY stage').all(projectId, runId),
    initiatives: d.prepare('SELECT * FROM initiatives WHERE project_id = ? AND run_id = ?').all(projectId, runId),
    scenarios: d.prepare('SELECT * FROM roi_scenarios WHERE project_id = ? AND run_id = ?').all(projectId, runId),
    tasks: d.prepare('SELECT * FROM wbs_tasks WHERE project_id = ? AND run_id = ? ORDER BY task_id').all(projectId, runId),
    checkpoints: d.prepare('SELECT * FROM schedule_checkpoints WHERE project_id = ? AND run_id = ?').all(projectId, runId),
    metrics: d.prepare('SELECT * FROM metrics WHERE project_id = ?').all(projectId),
    sources: d.prepare('SELECT * FROM sources WHERE project_id = ?').all(projectId),
    claims: d.prepare('SELECT * FROM claims WHERE project_id = ? ORDER BY stage, claim_id').all(projectId),
    gate: getGate(projectId)
  };
}

module.exports = { init, getDb, getProject, listProjects, createProject, updateProjectStatus,
  createRun, updateRunStatus, updateRunStage, getActiveRun, getRuns,
  upsertGate, fulfillGate, getGate, recordGateSubmission,
  importSources, importClaims, importMetrics, importInitiatives, importRoiScenarios, importWbsTasks, importCheckpoints, recordImport,
  getDashboardData,
  ROOT, DB_PATH, DATA_DIR
};