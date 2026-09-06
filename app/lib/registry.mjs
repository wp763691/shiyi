import { readdir, readFile, stat, mkdir, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const fileCache = new Map(); // 路径 -> {mtimeMs, size, data}

async function cachedJson(file, parse) {
  let st;
  try {
    st = await stat(file);
  } catch {
    return null;
  }
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
  let data = null;
  try {
    const raw = await readFile(file, 'utf8');
    data = parse ? parse(raw) : JSON.parse(raw);
  } catch {
    data = null;
  }
  if (data !== null) fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
}

function shortPath(dir) {
  const parts = String(dir).split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : dir || '';
}

function summaryFromMd(raw, max = 260) {
  const body = raw.replace(/^---[\s\S]*?---/, '').trim();
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('<!--'));
  let text = lines.slice(0, 3).join(' ');
  if (text.length > max) text = text.slice(0, max - 1) + '…';
  return text || '(空文件)';
}

// ---------- 规则：CLAUDE.md / AGENTS.md ----------
export async function scanRules(projectDirs = []) {
  const out = [];
  const globalFiles = [
    { tool: 'claude', label: 'CLAUDE.md', scope: 'global', name: '用户全局 CLAUDE.md', file: path.join(HOME, '.claude', 'CLAUDE.md') },
    { tool: 'codex', label: 'AGENTS.md', scope: 'global', name: 'Codex 全局 AGENTS.md', file: path.join(HOME, '.codex', 'AGENTS.md') },
  ];
  for (const g of globalFiles) {
    const item = await statRule(g.file, g.name, g.tool, g.scope, '', g.label);
    if (item) out.push(item);
  }

  const seen = new Set();
  for (const proj of projectDirs) {
    if (!proj || seen.has(proj)) continue;
    seen.add(proj);
    const cands = [
      { tool: 'claude', label: 'CLAUDE.md', file: path.join(proj, 'CLAUDE.md') },
      { tool: 'claude', label: 'CLAUDE.md（.claude）', file: path.join(proj, '.claude', 'CLAUDE.md') },
      { tool: 'codex', label: 'AGENTS.md', file: path.join(proj, 'AGENTS.md') },
    ];
    for (const c of cands) {
      const item = await statRule(c.file, c.label, c.tool, 'project', proj, c.label);
      if (item) out.push(item);
    }
  }
  out.sort((a, b) => (a.scope === b.scope ? b.mtime - a.mtime : a.scope === 'global' ? -1 : 1));
  return out;
}

async function statRule(file, name, tool, scope, project, label) {
  let st;
  let raw;
  try {
    st = await stat(file);
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').length;
  return {
    kind: 'rule',
    name,
    label,
    tool,
    scope,
    project,
    projectName: project ? shortPath(project) : '',
    path: file,
    lines,
    bytes: st.size,
    mtime: st.mtimeMs,
    preview: summaryFromMd(raw),
  };
}

// ---------- MCP 服务器 ----------
export async function scanMcp(projectDirs = []) {
  const out = [];

  // Claude 用户全局：~/.claude.json 的 mcpServers
  const userJson = await cachedJson(path.join(HOME, '.claude.json'), null);
  if (userJson && userJson.mcpServers && typeof userJson.mcpServers === 'object') {
    for (const [name, cfg] of Object.entries(userJson.mcpServers)) {
      out.push(mcpItem('claude', 'global', '', path.join(HOME, '.claude.json'), name, cfg));
    }
  }

  // Codex 全局：~/.codex/config.toml 里的 mcp_servers
  const toml = await cachedJson(path.join(HOME, '.codex', 'config.toml'), (raw) => raw);
  if (typeof toml === 'string') {
    for (const mcp of parseTomlMcp(toml)) {
      if (!mcp.command && !mcp.url) continue; // 跳过空配置节
      out.push({
        kind: 'mcp',
        name: mcp.name,
        tool: 'codex',
        scope: 'global',
        project: '',
        projectName: '',
        sourceFile: path.join(HOME, '.codex', 'config.toml'),
        type: 'codex-toml',
        command: mcp.command || '',
        url: mcp.url || '',
        args: mcp.args || [],
        envKeys: mcp.envKeys || [],
      });
    }
  }

  // 项目级：<proj>/.mcp.json
  const seen = new Set();
  for (const proj of projectDirs) {
    if (!proj || seen.has(proj)) continue;
    seen.add(proj);
    const file = path.join(proj, '.mcp.json');
    const data = await cachedJson(file, null);
    if (data && data.mcpServers && typeof data.mcpServers === 'object') {
      for (const [name, cfg] of Object.entries(data.mcpServers)) {
        out.push(mcpItem('claude', 'project', proj, file, name, cfg));
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

function mcpItem(tool, scope, project, sourceFile, name, cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const envKeys = c.env && typeof c.env === 'object' ? Object.keys(c.env) : [];
  return {
    kind: 'mcp',
    name,
    tool,
    scope,
    project,
    projectName: project ? shortPath(project) : '',
    sourceFile,
    type: typeof c.type === 'string' ? c.type : c.command ? 'stdio' : c.url ? 'http' : '未知',
    command: typeof c.command === 'string' ? c.command : '',
    url: typeof c.url === 'string' ? c.url : '',
    args: Array.isArray(c.args) ? c.args : [],
    envKeys,
  };
}

function parseTomlMcp(raw) {
  const out = [];
  const lines = raw.split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(/^\s*\[mcp_servers\.([^\]]+)\]\s*$/);
    if (m) {
      current = { name: m[1].trim().replace(/^"|"$/g, ''), command: '', url: '', args: [], envKeys: [] };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"\s*$/);
    if (kv) {
      if (kv[1] === 'command') current.command = kv[2];
      else if (kv[1] === 'url') current.url = kv[2];
    }
  }
  return out;
}

// ---------- MCP 连通性检测 ----------
export async function checkMcp(item) {
  const cfg = await resolveMcpConfig(item);
  if (!cfg) return { ok: false, state: 'error', detail: '找不到该服务器配置' };
  const start = Date.now();
  if (cfg.url) {
    const r = await checkMcpHttp(cfg.url);
    return { ...r, latencyMs: Date.now() - start };
  }
  if (cfg.command) {
    const r = await checkMcpStdio(cfg.command, cfg.args, cfg.env);
    return { ...r, latencyMs: Date.now() - start };
  }
  return { ok: false, state: 'skip', detail: '没有可检测的命令或地址', latencyMs: 0 };
}

async function resolveMcpConfig(item) {
  if (item.tool === 'codex') {
    const raw = await cachedJson(path.join(HOME, '.codex', 'config.toml'), (s) => s);
    if (typeof raw !== 'string') return null;
    for (const mcp of parseTomlMcp(raw)) {
      if (mcp.name === item.name) return { command: mcp.command, args: mcp.args, env: {}, url: mcp.url };
    }
    return null;
  }
  const jsonFile = item.scope === 'project' && item.project
    ? path.join(item.project, '.mcp.json')
    : path.join(HOME, '.claude.json');
  const data = await cachedJson(jsonFile, null);
  if (data && data.mcpServers && data.mcpServers[item.name]) {
    const c = data.mcpServers[item.name] || {};
    return {
      command: c.command || '',
      args: Array.isArray(c.args) ? c.args : [],
      env: c.env && typeof c.env === 'object' ? c.env : {},
      url: c.url || '',
    };
  }
  return null;
}

function checkMcpStdio(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args || [], {
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => finish(false, '连接超时（服务器未应答 initialize）'), 6000);
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* 忽略 */ }
      resolve({ ok, state: ok ? 'ok' : 'fail', detail });
    };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('serverInfo') || buf.includes('"jsonrpc"')) {
        finish(true, 'initialize 握手成功');
      }
    });
    child.on('error', (e) => finish(false, `无法启动：${e.message}`));
    child.on('exit', (code) => {
      if (!settled) finish(false, code === 0 ? '进程立即退出' : `进程退出码 ${code}`);
    });
    // 等子进程就绪后发送 initialize
    setTimeout(() => {
      if (!settled) {
        const req = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'shiyi-check', version: '1.0' },
          },
        };
        try { child.stdin.write(JSON.stringify(req) + '\n'); } catch { /* 子进程已退出 */ }
      }
    }, 250);
  });
}

async function checkMcpHttp(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'shiyi-check', version: '1.0' },
        },
      }),
    });
    const text = await res.text();
    const okText = text.includes('serverInfo') || text.includes('"jsonrpc"');
    if (res.ok && okText) return { ok: true, state: 'ok', detail: 'HTTP initialize 成功' };
    if (okText) return { ok: true, state: 'ok', detail: `HTTP ${res.status}（含 MCP 响应）` };
    return { ok: false, state: 'fail', detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, state: 'fail', detail: e.name === 'AbortError' ? '连接超时' : `连接失败：${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Agents（自定义角色） ----------
export async function scanAgents(projectDirs = []) {
  const out = [];
  const roots = [
    { tool: 'claude', scope: 'global', dir: path.join(HOME, '.claude', 'agents') },
    { tool: 'codex', scope: 'global', dir: path.join(HOME, '.codex', 'agents') },
  ];
  for (const r of roots) {
    for (const item of await scanMdDir(r.dir, r.tool, r.scope, '', 'agent')) {
      out.push(item);
    }
  }
  for (const proj of projectDirs) {
    if (!proj) continue;
    for (const item of await scanMdDir(path.join(proj, '.claude', 'agents'), 'claude', 'project', proj, 'agent')) {
      out.push(item);
    }
  }
  return out;
}

// ---------- 斜杠命令 ----------
export async function scanCommands(projectDirs = []) {
  const out = [];
  for (const item of await scanMdDir(path.join(HOME, '.claude', 'commands'), 'claude', 'global', '', 'command')) {
    out.push(item);
  }
  for (const proj of projectDirs) {
    if (!proj) continue;
    for (const item of await scanMdDir(path.join(proj, '.claude', 'commands'), 'claude', 'project', proj, 'command')) {
      out.push(item);
    }
  }
  return out;
}

async function scanMdDir(dir, tool, scope, project, kind) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const file = path.join(dir, e.name);
    let st, raw;
    try {
      st = await stat(file);
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseSkill(raw, e.name.replace(/\.md$/, ''));
    const lines = raw.split('\n').length;
    out.push({
      kind,
      name: parsed.name,
      tool,
      scope,
      project,
      projectName: project ? shortPath(project) : '',
      path: file,
      lines,
      bytes: st.size,
      mtime: st.mtimeMs,
      preview: summaryFromMd(raw),
    });
  }
  return out;
}

// ---------- Hooks（只读总览） ----------
export async function scanHooks(projectDirs = []) {
  const out = [];
  await collectHooks(path.join(HOME, '.claude', 'settings.json'), 'global', '', out);
  for (const proj of projectDirs) {
    if (!proj) continue;
    await collectHooks(path.join(proj, '.claude', 'settings.json'), 'project', proj, out);
  }
  return out;
}

async function collectHooks(file, scope, project, out) {
  const data = await cachedJson(file, null);
  if (!data || typeof data.hooks !== 'object') return;
  let st;
  try {
    st = await stat(file);
  } catch {
    return;
  }
  for (const [event, matchers] of Object.entries(data.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) {
      const hooks = Array.isArray(m.hooks) ? m.hooks : [];
      for (const h of hooks) {
        out.push({
          kind: 'hook',
          name: event,
          event,
          matcher: typeof m.matcher === 'string' ? m.matcher : '',
          command: typeof h.command === 'string' ? h.command : '',
          timeout: h.timeout,
          statusMessage: typeof h.statusMessage === 'string' ? h.statusMessage : '',
          tool: 'claude',
          scope,
          project,
          projectName: project ? shortPath(project) : '',
          path: file,
          mtime: st.mtimeMs,
        });
      }
    }
  }
}

// ---------- 删除到回收（仅规则文件） ----------
export async function trashRuleFile(file) {
  let trashBase;
  if (file.startsWith(path.join(HOME, '.claude') + path.sep)) {
    trashBase = path.join(HOME, '.claude', 'trash-zyin');
  } else if (file.startsWith(path.join(HOME, '.codex') + path.sep)) {
    trashBase = path.join(HOME, '.codex', 'trash-zyin');
  } else {
    const m = file.match(/^(.+?)\/(?:\.claude|\.codex)\//);
    if (!m) throw new Error('非法路径，拒绝删除');
    trashBase = path.join(m[1], '.trash-zyin');
  }
  await mkdir(trashBase, { recursive: true });
  const target = path.join(trashBase, path.basename(file));
  if (target !== file) await rename(file, target);
  return { ok: true, moved: target };
}
