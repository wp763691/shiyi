import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scanAllSessions, trashSession } from './lib/sessions.mjs';
import { listTerminalWindows, runningClaudeProcs, focusWindow, resumeSession } from './lib/terminal.mjs';
import { attachTmuxSession } from './lib/terminal.mjs';
import { scanSkills, trashSkill } from './lib/skills.mjs';
import {
  scanRules,
  scanMcp,
  scanAgents,
  scanCommands,
  scanHooks,
  trashRuleFile,
  checkMcp,
} from './lib/registry.mjs';
import { listTmuxAgents } from './lib/tmux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const execFileP = promisify(execFile);

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}

// 把运行中的 claude 进程（按 cwd）关联到最近的会话文件
async function buildState() {
  const scan = await scanAllSessions();
  const errors = scan.errors || [];
  const sessions = scan.sessions;

  // 项目技能候选目录 = 历史会话的工作目录（去重，限制规模）
  const home = os.homedir();
  const projectDirs = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))]
    .filter((p) => p && p !== home && !p.startsWith(home + path.sep + '.'))
    .slice(0, 300);
  const [term, procsRes, skills, rules, mcp, agents, commands, hooks, tmuxAgents] = await Promise.all([
    listTerminalWindows(),
    runningClaudeProcs(),
    scanSkills(projectDirs),
    scanRules(projectDirs),
    scanMcp(projectDirs),
    scanAgents(projectDirs),
    scanCommands(projectDirs),
    scanHooks(projectDirs),
    listTmuxAgents(),
  ]);
  if (term.error) errors.push({ scope: 'windows', detail: term.error });
  if (procsRes.error) errors.push({ scope: 'processes', detail: procsRes.error });
  if (tmuxAgents.error) errors.push({ scope: 'tmux', detail: tmuxAgents.error });

  // 工具 + cwd -> 最新会话
  const byCwd = new Map();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const key = `${s.tool}::${s.cwd}`;
    if (!byCwd.has(key)) byCwd.set(key, s);
  }

  const windows = (term.windows || []).map((w) => {
    const proc = (procsRes.procs || []).find((p) => normalizeTty(p.tty) === normalizeTty(w.tty));
    const tool = proc?.tool || null;
    const active = tool && proc?.cwd && byCwd.get(`${tool}::${proc.cwd}`);
    return {
      win: w.win,
      tab: w.tab,
      wname: w.wname || '',
      title: w.title || '',
      tty: w.tty,
      tool,
      running: Boolean(proc),
      session: active
        ? { sessionId: active.sessionId, tool: active.tool, title: active.title, lastTs: active.lastTs, cwd: active.cwd }
        : null,
    };
  });

  // iTerm 不可控时的兜底：无法关联到窗口的 claude 进程也展示出来
  const matchedTtys = new Set(windows.map((w) => normalizeTty(w.tty)).filter(Boolean));
  for (const p of procsRes.procs || []) {
    if (matchedTtys.has(normalizeTty(p.tty))) continue;
    const tool = p.tool || null;
    const active = tool && p.cwd && byCwd.get(`${tool}::${p.cwd}`);
    windows.push({
      win: null,
      tab: null,
      wname: '',
      title: p.command.slice(0, 80),
      tty: p.tty,
      tool,
      running: true,
      procPid: p.pid,
      session: active
        ? { sessionId: active.sessionId, tool: active.tool, title: active.title, lastTs: active.lastTs, cwd: active.cwd }
        : null,
    });
  }

  return {
    sessions,
    windows: windows.filter((w) => w.running || w.session),
    skills,
    rules,
    mcp,
    agents,
    commands,
    hooks,
    tmuxSessions: tmuxAgents.items || [],
    errors,
    now: Date.now(),
  };
}

function normalizeTty(t) {
  if (!t) return '';
  return String(t).replace(/^\/dev\//, '');
}


async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const state = await buildState();
      sendJson(res, 200, { ok: true, ...state });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      if (body.action === 'focus') {
        const out = await focusWindow(body.win, body.tab);
        sendJson(res, out.ok ? 200 : 500, out);
        return;
      }
      if (body.action === 'resume') {
        const out = await resumeSession(body.sessionId, body.cwd, body.tool || 'claude');
        if (out.detail) out.error = out.detail;
        sendJson(res, out.ok ? 200 : 500, out);
        return;
      }
      if (body.action === 'delete') {
        try {
          const out = await trashSession({ tool: body.tool, sessionId: body.sessionId, path: body.path });
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'delete-skill') {
        try {
          const out = await trashSkill(body.tool, body.path);
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'delete-rule') {
        try {
          const out = await trashRuleFile(body.path);
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'open') {
        try {
          const args = body.reveal ? ['-R', body.path] : [body.path];
          await execFileP('/usr/bin/open', args, { timeout: 8000 });
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'mcp-check') {
        try {
          const out = await checkMcp({
            name: body.name,
            tool: body.tool,
            scope: body.scope,
            project: body.project || '',
          });
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, state: 'error', detail: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'tmux-attach') {
        try {
          const out = await attachTmuxSession(body.name);
          sendJson(res, out.ok ? 200 : 500, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      sendJson(res, 400, { ok: false, error: '未知动作' });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`拾忆服务已启动: http://${HOST}:${PORT}`);
  console.log('按 Ctrl+C 停止');
});
