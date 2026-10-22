'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const ANTFARM_CLI = process.env.ANTFARM_CLI || path.join(os.homedir(), '.openclaw/workspace/antfarm/dist/cli/cli.js');
const NODE_BIN = process.env.DIAMOND_NODE_BIN || process.execPath;
const WORKFLOW_ID = process.env.DIAMOND_WORKFLOW_ID || 'diamond-marketing';

function runAntfarm(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_BIN, [ANTFARM_CLI, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', err => reject(err));
  });
}

async function workflowRun(taskText) {
  const result = await runAntfarm(['workflow', 'run', WORKFLOW_ID, taskText], 15000);
  // antfarm output: "Run: #17 (UUID)" — extract UUID directly
  const uuidMatch = result.stdout.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  const runId = uuidMatch ? uuidMatch[1] : null;
  return { success: result.code === 0, runId, stdout: result.stdout, stderr: result.stderr };
}

async function workflowStatus(query) {
  const result = await runAntfarm(['workflow', 'status', query], 10000);
  return { success: result.code === 0, status: result.stdout, stderr: result.stderr };
}

async function workflowResume(runId) {
  const result = await runAntfarm(['workflow', 'resume', runId], 15000);
  return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}

async function workflowStop(runId) {
  const result = await runAntfarm(['workflow', 'stop', runId], 10000);
  return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}

module.exports = { workflowRun, workflowStatus, workflowResume, workflowStop, WORKFLOW_ID };