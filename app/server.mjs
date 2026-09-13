import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scanAllSessions, trashSession } from './lib/sessions.mjs';
import { listTerminalWindows, runningClaudeProcs, focusWindow, resumeSession } from './lib/terminal.mjs';
import { attachTmuxSession, terminateProcess } from './lib/terminal.mjs';
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
import { listTmuxAgents, normalizeSessionName, renameTmuxSession, tmuxBin } from './lib/tmux.mjs';
import { scanConfigFiles, readConfigFile, saveConfigFile } from './lib/configfiles.mjs';
import {
  loadTranslations,
  translateSkills,
  setManualTranslation,
  translationStats,
  clearTranslations,
  translationStorePath,
} from './lib/translations.mjs';
import { loadSessionNames, setSessionName } from './lib/names.mjs';
import {
  openTmuxTerminal,
  writeTerminalInput,
  resizeTerminal,
  closeTerminal,
  attachStream,
} from './lib/termproxy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const debugLogs = [];

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
  if (process.env.SHIYI_DEMO === '1') return demoState();
  const scan = await scanAllSessions();
  const errors = scan.errors || [];
  const sessions = scan.sessions;

  // 项目技能候选目录 = 历史会话的工作目录（去重，限制规模）
  const home = os.homedir();
  const projectDirs = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))]
    .filter((p) => p && p !== home && !p.startsWith(home + path.sep + '.'))
    .slice(0, 300);
  const [term, procsRes, skills, rules, mcp, agents, commands, hooks, tmuxAgents, configFiles] = await Promise.all([
    listTerminalWindows(),
    runningClaudeProcs(),
    scanSkills(projectDirs),
    scanRules(projectDirs),
    scanMcp(projectDirs),
    scanAgents(projectDirs),
    scanCommands(projectDirs),
    scanHooks(projectDirs),
    listTmuxAgents(),
    scanConfigFiles(),
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
  const sessionsById = new Map(sessions.map((s) => [String(s.sessionId).toLowerCase(), s]));
  const activeForProc = (proc, tool) => {
    if (proc?.sessionId) {
      const hit = sessionsById.get(String(proc.sessionId).toLowerCase());
      if (hit) return hit;
    }
    if (proc?.sessionFile) {
      const base = path.basename(proc.sessionFile, '.jsonl');
      const uuid = (base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
      const hit = sessionsById.get(base.toLowerCase()) || (uuid ? sessionsById.get(uuid.toLowerCase()) : null);
      if (hit) return hit;
    }
    return tool && proc?.cwd ? byCwd.get(`${tool}::${proc.cwd}`) : null;
  };

  const windows = (term.windows || []).map((w) => {
    const sameTty = (procsRes.procs || []).filter((p) => normalizeTty(p.tty) === normalizeTty(w.tty));
    const proc = sameTty.find((p) => p.sessionFile) || sameTty[0];
    const tool = proc?.tool || null;
    const active = activeForProc(proc, tool);
    return {
      win: w.win,
      tab: w.tab,
      wname: w.wname || '',
      title: w.title || '',
      tty: w.tty,
      procPid: proc?.pid || null,
      tool,
      running: Boolean(proc),
      session: active
        ? { sessionId: active.sessionId, tool: active.tool, title: active.title, lastTs: active.lastTs, cwd: active.cwd }
        : null,
    };
  });

  // iTerm 不可控时的兜底：无法关联到窗口的 claude 进程也展示出来
  const matchedTtys = new Set(windows.map((w) => normalizeTty(w.tty)).filter(Boolean));
  const tmuxTtys = new Set((tmuxAgents.items || []).map((t) => normalizeTty(t.tty)).filter(Boolean));
  for (const p of procsRes.procs || []) {
    const tty = normalizeTty(p.tty);
    if (!tty || matchedTtys.has(tty) || tmuxTtys.has(tty)) continue;
    const tool = p.tool || null;
    const active = activeForProc(p, tool);
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
    matchedTtys.add(tty);
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
    tmuxSessions: (tmuxAgents.items || []).map((t) => {
      const proc = (procsRes.procs || []).find(
        (p) => normalizeTty(p.tty) === normalizeTty(t.tty)
      );
      const s = activeForProc(proc, t.tool);
      return {
        ...t,
        session: s ? { sessionId: s.sessionId, tool: s.tool, title: s.title, lastTs: s.lastTs, cwd: s.cwd } : null,
      };
    }),
    configFiles,
    skillTranslations: await loadTranslations(),
    translationStats: await translationStats(skills),
    sessionNames: await loadSessionNames(),
    errors,
    now: Date.now(),
  };
}

async function projectDirsForTranslate() {
  const scan = await scanAllSessions();
  const home = os.homedir();
  return [...new Set(scan.sessions.map((s) => s.cwd).filter(Boolean))]
    .filter((p) => p && p !== home && !p.startsWith(home + path.sep + '.'))
    .slice(0, 300);
}

function demoState() {
  const now = Date.now();
  return {
    demo: true,
    sessions: [
      {
        sessionId: 'demo-session-0001', tool: 'claude', title: '项目架构重构讨论', cwd: '/Users/demo/code/awesome-app',
        branch: 'main', lastTs: now - 3 * 60000, lastUserText: '先把 auth 模块的依赖梳理一遍', exchanges: 32,
        dirName: '…/code/awesome-app', mb: 0.6,
      },
      {
        sessionId: 'demo-session-0002', tool: 'codex', title: '修 CI 缓存问题', cwd: '/Users/demo/code/awesome-app',
        branch: 'feat/ci', lastTs: now - 2 * 3600000, lastUserText: '看看 GitHub Actions 的缓存 key', exchanges: 18,
        dirName: '…/code/awesome-app', mb: 0.3,
      },
      {
        sessionId: 'demo-session-0003', tool: 'claude', title: 'API 文档整理', cwd: '/Users/demo/code/docs-site',
        branch: 'main', lastTs: now - 26 * 3600000, lastUserText: '把新增的接口补进文档', exchanges: 9,
        dirName: '…/code/docs-site', mb: 0.2,
      },
    ],
    windows: [],
    tmuxSessions: [
      { source: 'tmux', name: 'shiyi-demo', window: '0', pane: '0', tool: 'claude', command: 'claude', cwd: '/Users/demo/code/awesome-app', attached: false, tty: 'ttys010' },
    ],
    skills: [
      { name: 'code-reviewer', description: '按行业惯例审查 Pull Request 的风险与测试覆盖。', tool: 'claude', toolLabel: 'Claude Code', scope: 'global', folder: '/Users/demo/.claude/skills/code-reviewer', mtime: now - 86400000 },
      { name: 'doc-writer', description: '把代码变更整理成清晰的中英文技术文档。', tool: 'codex', toolLabel: 'Codex', scope: 'global', folder: '/Users/demo/.codex/skills/doc-writer', mtime: now - 172800000 },
      { name: 'architect-mentor', description: '项目级架构评审与改进建议。', tool: 'claude', toolLabel: 'Claude Code', scope: 'project', project: '/Users/demo/code/awesome-app', projectName: '…/code/awesome-app', folder: '/Users/demo/code/awesome-app/.claude/skills/architect-mentor', mtime: now - 3600000 },
      { name: 'release-notes', description: '根据提交记录生成面向用户的发布说明。', tool: 'claude', toolLabel: 'Claude Code', scope: 'global', folder: '/Users/demo/.claude/skills/release-notes', mtime: now - 7200000 },
      { name: 'api-designer', description: '设计 REST/GraphQL 接口并输出 OpenAPI 草案。', tool: 'codex', toolLabel: 'Codex', scope: 'global', folder: '/Users/demo/.codex/skills/api-designer', mtime: now - 10800000 },
      { name: 'test-planner', description: '为改动梳理测试矩阵与边界用例。', tool: 'claude', toolLabel: 'Claude Code', scope: 'global', folder: '/Users/demo/.claude/skills/test-planner', mtime: now - 14400000 },
      { name: 'sql-optimizer', description: '分析慢查询并给出索引与改写建议。', tool: 'codex', toolLabel: 'Codex', scope: 'global', folder: '/Users/demo/.codex/skills/sql-optimizer', mtime: now - 18000000 },
      { name: 'ui-review', description: '从可用性与一致性角度评审界面改动。', tool: 'claude', toolLabel: 'Claude Code', scope: 'project', project: '/Users/demo/code/awesome-app', projectName: '…/code/awesome-app', folder: '/Users/demo/code/awesome-app/.claude/skills/ui-review', mtime: now - 21600000 },
    ],
    rules: [
      { kind: 'rule', name: 'CLAUDE.md', tool: 'claude', scope: 'global', path: '/Users/demo/.claude/CLAUDE.md', lines: 42, mtime: now - 3600000, preview: '团队规范：默认英文注释，提交信息遵循 Conventional Commits…' },
      { kind: 'rule', name: 'AGENTS.md', tool: 'codex', scope: 'global', path: '/Users/demo/.codex/AGENTS.md', lines: 20, mtime: now - 7200000, preview: 'Codex 通用守则…' },
    ],
    mcp: [
      { kind: 'mcp', name: 'codegraph', tool: 'claude', scope: 'global', sourceFile: '/Users/demo/.claude.json', type: 'stdio', command: 'codegraph', args: [], envKeys: [], mtime: now - 3600000 },
      { kind: 'mcp', name: 'context7', tool: 'claude', scope: 'global', sourceFile: '/Users/demo/.claude.json', type: 'http', url: 'https://mcp.context7.com/mcp', envKeys: [], mtime: now - 3600000 },
      { kind: 'mcp', name: 'gitnexus', tool: 'codex', scope: 'global', sourceFile: '/Users/demo/.codex/config.toml', type: 'stdio', command: 'gitnexus mcp', args: [], envKeys: [], mtime: now - 3600000 },
    ],
    agents: [
      { kind: 'agent', name: 'reviewer', tool: 'claude', scope: 'global', path: '/Users/demo/.claude/agents/reviewer.md', lines: 24, mtime: now - 7200000, preview: '严格代码审查：关注风险、边界与测试覆盖。' },
      { kind: 'agent', name: 'planner', tool: 'codex', scope: 'global', path: '/Users/demo/.codex/agents/planner.md', lines: 18, mtime: now - 7200000, preview: '把需求拆解为可执行任务清单。' },
    ],
    commands: [
      { kind: 'command', name: 'review', tool: 'claude', scope: 'global', path: '/Users/demo/.claude/commands/review.md', lines: 12, mtime: now - 7200000, preview: '对当前改动做一次结构化 Review。' },
      { kind: 'command', name: 'standup', tool: 'claude', scope: 'global', path: '/Users/demo/.claude/commands/standup.md', lines: 9, mtime: now - 7200000, preview: '汇总昨日进展与今日计划。' },
    ],
    hooks: [
      { kind: 'hook', event: 'PreToolUse', matcher: 'Grep|Glob|Bash', command: 'node ~/.claude/hooks/context.cjs', tool: 'claude', scope: 'global', path: '/Users/demo/.claude/settings.json', mtime: now - 3600000 },
      { kind: 'hook', event: 'PostToolUse', matcher: 'Bash', command: 'node ~/.claude/hooks/audit.cjs', tool: 'claude', scope: 'global', path: '/Users/demo/.claude/settings.json', mtime: now - 3600000 },
    ],
    configFiles: [
      { tool: 'claude', label: 'Claude Code settings', path: '/Users/demo/.claude/settings.json', exists: true, bytes: 1280, mtime: now - 3600000, scope: 'global' },
      { tool: 'codex', label: 'Codex config', path: '/Users/demo/.codex/config.toml', exists: true, bytes: 860, mtime: now - 3600000, scope: 'global' },
    ],
    errors: [],
    now,
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
      if (body.action === 'terminate') {
        try {
          if (body.mode === 'tmux') {
            const tmux = await tmuxBin();
            if (!tmux) throw new Error('未安装 tmux');
            await execFileP(tmux, ['kill-session', '-t', String(body.name)], { timeout: 6000 });
            sendJson(res, 200, { ok: true });
          } else {
            const out = await terminateProcess(body.pid);
            sendJson(res, out.ok ? 200 : 500, out);
          }
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'tmux-new') {
        const name = String(body.name || '').trim();
        let dir = String(body.dir || '').trim();
        if (dir.length > 1 && dir.endsWith('/')) dir = dir.slice(0, -1);
        const tool = ['claude', 'codex', 'bash'].includes(body.tool) ? body.tool : 'bash';
        const perm = String(body.perm || '').trim();
        if (!/^[A-Za-z0-9 _-]*$/.test(perm) || perm.length > 80) {
          sendJson(res, 400, { ok: false, error: '权限参数不合法' });
          return;
        }
        // 支持中文等 Unicode：空格/标点归一为短横，去掉 tmux 不接受的字符
        const safeName = normalizeSessionName(name);
        if (!safeName) {
          sendJson(res, 400, { ok: false, error: '会话名不能为空' });
          return;
        }
        try {
          const st = await stat(dir);
          if (!st.isDirectory()) {
            sendJson(res, 400, { ok: false, error: '工作目录不是文件夹' });
            return;
          }
          const tmux = await tmuxBin();
          if (!tmux) {
            sendJson(res, 400, { ok: false, error: '未安装 tmux，请先运行：brew install tmux' });
            return;
          }
          if (tool !== 'bash') {
            try {
              await execFileP('/bin/bash', ['-lc', `command -v ${tool}`], { timeout: 5000 });
            } catch {
              sendJson(res, 400, {
                ok: false,
                error: tool === 'claude'
                  ? '未检测到 Claude Code CLI，请先运行：npm install -g @anthropic-ai/claude-code'
                  : '未检测到 Codex CLI，请先运行：npm install -g @openai/codex',
              });
              return;
            }
          }
          const cmd = tool === 'bash' ? 'bash' : perm ? `${tool} ${perm}` : tool;
          await execFileP(tmux, ['new-session', '-d', '-s', safeName, '-c', dir, cmd], { timeout: 6000 });
          sendJson(res, 200, { ok: true, name: safeName, dir, tool });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e).slice(0, 200) });
        }
        return;
      }
      if (body.action === 'pick-dir') {
        try {
          const { stdout } = await execFileP('/usr/bin/osascript', [
            '-e',
            'POSIX path of (choose folder with prompt "选择会话工作目录")',
          ], { timeout: 30000 });
          const dir = stdout.trim();
          if (!dir) { sendJson(res, 200, { ok: true, canceled: true }); return; }
          sendJson(res, 200, { ok: true, dir });
        } catch (e) {
          const msg = String(e?.message || e);
          if (/-128|user canceled|User canceled/i.test(msg)) {
            sendJson(res, 200, { ok: true, canceled: true });
          } else {
            sendJson(res, 500, { ok: false, error: msg.slice(0, 200) });
          }
        }
        return;
      }
      if (body.action === 'dbg') {
        debugLogs.push(`${new Date().toISOString().slice(11, 19)} ${String(body.msg || '').slice(0, 500)}`);
        if (debugLogs.length > 200) debugLogs.shift();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (body.action === 'translate-skills') {
        try {
          const skills = await scanSkills(await projectDirsForTranslate());
          const out = await translateSkills(skills, { force: Boolean(body.force) });
          sendJson(res, out.ok ? 200 : 500, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'set-skill-translation') {
        try {
          const out = await setManualTranslation(body.path, body.nameZh || '', body.descZh || '');
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'translate-skill') {
        try {
          const skills = await scanSkills(await projectDirsForTranslate());
          const target = skills.find((s) => s.path === body.path);
          if (!target) {
            sendJson(res, 404, { ok: false, error: '找不到该技能' });
            return;
          }
          const out = await translateSkills([target], { force: true });
          sendJson(res, out.ok ? 200 : 500, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'set-session-name') {
        try {
          const out = await setSessionName(body.key, body.name);
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'clear-skill-translations') {
        try {
          sendJson(res, 200, await clearTranslations());
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'tmux-rename') {
        try {
          const out = await renameTmuxSession(body.from, body.to);
          sendJson(res, 200, out);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      if (body.action === 'open-translation-cache') {
        try {
          await execFileP('/usr/bin/open', ['-R', translationStorePath()], { timeout: 8000 });
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e?.message || e) });
        }
        return;
      }
      sendJson(res, 400, { ok: false, error: '未知动作' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/terminal-open') {
      const body = await readBody(req);
      const out = await openTmuxTerminal(body.name);
      sendJson(res, out.ok ? 200 : 400, out);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/terminal-input') {
      const body = await readBody(req);
      if (body.resize) {
        const out = await resizeTerminal(body.id, body.resize.cols, body.resize.rows);
        if (!body.data) {
          sendJson(res, out.ok ? 200 : 500, out);
          return;
        }
      }
      const out = writeTerminalInput(body.id, body.data || '');
      sendJson(res, out.ok ? 200 : 500, out);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/terminal-close') {
      const body = await readBody(req);
      sendJson(res, 200, closeTerminal(body.id));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/terminal-stream/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/terminal-stream/'.length));
      attachStream(id, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/debug') {
      sendJson(res, 200, { ok: true, logs: debugLogs });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config-file') {
      const tool = url.searchParams.get('tool');
      try {
        const out = await readConfigFile(tool);
        sendJson(res, 200, out);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/config-save') {
      const body = await readBody(req);
      try {
        const out = await saveConfigFile(body.tool, body.content);
        sendJson(res, 200, out);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
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
