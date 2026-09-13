import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';

const execFileP = promisify(execFile);
const TMUX_CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
let tmuxPathCache = null;
const scrollConfigured = new Set();

// 让滚轮滚动 tmux 窗格历史（copy-mode），而不是被 TUI 吃掉
export async function ensureTmuxScrollOptions(sessionName) {
  const bin = await tmuxBin();
  if (!bin || !sessionName) return;
  if (scrollConfigured.has('global')) {
    // 只对每个会话设置一次 mouse
  } else {
    try { await execFileP(bin, ['set-option', '-g', 'history-limit', '50000'], { timeout: 5000 }); } catch { /* 忽略 */ }
    scrollConfigured.add('global');
  }
  if (scrollConfigured.has(sessionName)) return;
  try {
    await execFileP(bin, ['set-option', '-t', sessionName, 'mouse', 'on'], { timeout: 5000 });
    scrollConfigured.add(sessionName);
  } catch { /* 会话可能已不存在 */ }
}

export async function tmuxBin() {
  if (tmuxPathCache) return tmuxPathCache;
  for (const p of TMUX_CANDIDATES) {
    try { await access(p); tmuxPathCache = p; return p; } catch { /* 继续 */ }
  }
  try {
    const { stdout } = await execFileP('/bin/bash', ['-lc', 'command -v tmux'], { timeout: 5000 });
    const p = stdout.trim();
    if (p) { tmuxPathCache = p; return p; }
  } catch { /* 未安装 */ }
  return null;
}

// 规范化会话名：支持中文等 Unicode，空格/标点转短横
export function normalizeSessionName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function renameTmuxSession(fromName, toName) {
  const bin = await tmuxBin();
  if (!bin) throw new Error('未安装 tmux');
  const clean = normalizeSessionName(toName);
  if (!clean) throw new Error('会话名不能为空');
  await execFileP(bin, ['rename-session', '-t', fromName, clean], { timeout: 6000 });
  return { ok: true, name: clean };
}

// 列出 tmux 里正在运行的 claude / codex 会话
export async function listTmuxAgents() {
  try {
    const bin = await tmuxBin();
    if (!bin) return { ok: true, items: [], error: null };
    const { stdout } = await execFileP(bin, [
      'list-panes', '-a',
      '-F', '#{session_name}|#{window_index}|#{pane_index}|#{pane_current_command}|#{pane_current_path}|#{session_attached}|#{pane_tty}|#{pane_start_command}|#{session_created}|#{pane_pid}',
    ], { timeout: 5000 });
    const rows = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [session, win, pane, command, cwd, attached, tty, startCommand, created, panePid] = line.split('|');
      const tool = classify(`${command} ${startCommand || ''}`);
      if (!tool) continue;
      rows.push({
        source: 'tmux',
        name: session,
        window: win,
        pane,
        tool,
        command: command || '',
        cwd: cwd || '',
        attached: attached === '1',
        tty: tty || '',
        createdMs: created ? Number(created) * 1000 : 0,
        panePid: panePid ? Number(panePid) : null,
      });
    }
    return { ok: true, items: rows, error: null };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/error connecting|No such file|no server running|not running/i.test(msg)) {
      return { ok: true, items: [], error: null };
    }
    return { ok: false, items: [], error: msg.slice(0, 160) };
  }
}

function classify(command) {
  const c = String(command || '').toLowerCase();
  if (!c) return null;
  if (c.includes('claude') || c.includes('claude-code')) return 'claude';
  if (c.includes('codex')) return 'codex';
  if (/(^|[\/\s])(bash|zsh|sh|fish)(\s|$)/.test(c)) return 'bash';
  return null;
}
