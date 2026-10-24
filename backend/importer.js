'use strict';
const path = require('path');
const fs = require('fs');

const { importSources, importClaims, importMetrics, importInitiatives, importRoiScenarios, importWbsTasks, importCheckpoints, recordImport, updateRunStage } = require('./db');

const DATA_DIR = process.env.DIAMOND_DATA || path.resolve(__dirname, 'data');

// Resolve run output dir, supporting both layouts:
//   new: Output/<project_id>/<run_id>/  (per common-rules.md STAGE_DIR)
//   old: Output/<run_id>/               (legacy demo runs)
function resolveRunDir(projectId, runId) {
  const base = path.join(DATA_DIR, 'projects', projectId, 'Output');
  const newLayout = path.join(base, projectId, runId);
  if (fs.existsSync(newLayout)) return newLayout;
  return path.join(base, runId);
}

// Back-compat alias
function getStageDir(projectId, runId) {
  return resolveRunDir(projectId, runId);
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

function importStage(projectId, runId, stage) {
  const stageDir = getStageDir(projectId, runId);
  const dataDir = path.join(stageDir, 'data');
  const results = [];

  switch (stage) {
    case 'information': {
      const json = readJsonSafe(path.join(dataDir, 'information.json'));
      if (!json) break;
      if (json.sources?.length) { importSources(projectId, runId, json.sources); results.push(`sources: ${json.sources.length}`); }
      if (json.claims?.length) { importClaims(projectId, runId, 'information', json.claims); results.push(`claims: ${json.claims.length}`); }
      if (json.metrics?.length) { importMetrics(projectId, runId, json.metrics); results.push(`metrics: ${json.metrics.length}`); }
      break;
    }
    case 'insights': {
      const json = readJsonSafe(path.join(dataDir, 'insights.json'));
      if (!json) break;
      if (json.metrics?.length) { importMetrics(projectId, runId, json.metrics); results.push(`metrics: ${json.metrics.length}`); }
      // ARC subtasks can be imported as wbs-like entries
      break;
    }
    case 'intention': {
      const json = readJsonSafe(path.join(dataDir, 'intention.json')) || readJsonSafe(path.join(dataDir, 'goal.json'));
      if (json?.selected?.length) { importInitiatives(projectId, runId, json.selected); results.push(`initiatives: ${json.selected.length}`); }
      const roi = readJsonSafe(path.join(dataDir, 'roi-scenarios.json'));
      if (roi?.scenarios_by_initiative?.length) { importRoiScenarios(projectId, runId, roi.scenarios_by_initiative); results.push(`roi_scenarios: ${roi.scenarios_by_initiative.length}`); }
      break;
    }
    case 'initiative': {
      const wbs = readJsonSafe(path.join(dataDir, 'wbs.json'));
      if (wbs?.tasks?.length) { importWbsTasks(projectId, runId, wbs.tasks); results.push(`wbs_tasks: ${wbs.tasks.length}`); }
      break;
    }
    case 'implementation': {
      const cp = readJsonSafe(path.join(dataDir, 'checkpoints.json'));
      if (cp?.checkpoints?.length) { importCheckpoints(projectId, runId, cp.checkpoints); results.push(`checkpoints: ${cp.checkpoints.length}`); }
      break;
    }
    case 'master':
      // dashboard.json is read by the dashboard endpoint directly
      results.push('dashboard.json available');
      break;
  }

  if (results.length) {
    const file = stage === 'intention' && !fs.existsSync(path.join(dataDir, 'intention.json')) ? 'goal.json' : `${stage}.json`;
    recordImport(projectId, runId, stage, path.join(dataDir, file));
    updateRunStage(projectId, runId, stage);
  }

  return { stage, results };
}

function tryImportAllStages(projectId, runId) {
  const stages = ['information', 'insights', 'intention', 'initiative', 'implementation', 'master'];
  const allResults = [];
  for (const stage of stages) {
    try {
      const r = importStage(projectId, runId, stage);
      if (r.results?.length) allResults.push(r);
    } catch (e) {
      // Stage not yet available — skip
    }
  }
  return allResults;
}

function checkStageComplete(projectId, runId) {
  const stageDir = getStageDir(projectId, runId);
  const handoffsDir = path.join(stageDir, 'handoffs');
  const stages = [];
  const stageFiles = {
    information: '01-information.md', insights: '02-insights.md', intention: '03-intention.md',
    initiative: '04-initiative.md', implementation: '05-implementation.md', master: '06-master.md'
  };
  for (const [stage, file] of Object.entries(stageFiles)) {
    const legacy = stage === 'intention' && !fs.existsSync(path.join(handoffsDir, file));
    const actualFile = legacy && fs.existsSync(path.join(handoffsDir, '03-goal.md')) ? '03-goal.md' : file;
    const handoff = path.join(handoffsDir, actualFile);
    const reportName = legacy && fs.existsSync(path.join(stageDir, 'goal.html')) ? 'goal' : stage;
    const html = path.join(stageDir, `${reportName}.html`);
    stages.push({
      stage,
      status: fs.existsSync(handoff) ? 'done' : 'pending',
      handoff: fs.existsSync(handoff) ? `handoffs/${actualFile}` : null,
      report: fs.existsSync(html) ? `${reportName}.html` : null
    });
  }
  return stages;
}

module.exports = { importStage, tryImportAllStages, checkStageComplete, getStageDir, resolveRunDir, readJsonSafe };