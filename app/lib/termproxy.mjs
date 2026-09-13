// 内置终端代理：用系统 script 分配 PTY 运行 tmux attach，通过 SSE 与浏览器通信
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { tmuxBin } from './tmux.mjs';

const sessions = new Map();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.ZYIN_PYTHON || '/usr/bin/python3';

export async function openTmuxTerminal(sessionName) {
  if (!sessionName || sessionName.startsWith('-') || !/^[\p{L}\p{N}_ .-]+$/u.test(sessionName)) {
    return { ok: false, error: '非法的 tmux 会话名' };
  }
  const tmux = await tmuxBin();
  if (!tmux) return { ok: false, error: '未安装 tmux，请先运行：brew install tmux' };
  const id = randomUUID();
  const bridge = path.join(moduleDir, 'pty_bridge.py');
  const ctrl = path.join(os.tmpdir(), `zyin-ctrl-${id}`);
  const child = spawn(PYTHON, [bridge, '34', '100', tmux, 'attach', '-t', sessionName], {
    env: { ...process.env, TERM: 'xterm-256color', ZYIN_CTRL: ctrl },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rec = {
    id,
    name: sessionName,
    child,
    ctrl,
    res: null,
    queue: [],
    alive: true,
  };
  sessions.set(id, rec);

  child.stdout.on('data', (chunk) => {
    const b64 = chunk.toString('base64');
    if (rec.res && rec.res.writableEnded === false) {
      rec.res.write(`data: ${b64}\n\n`);
    } else {
      rec.queue.push(b64);
      if (rec.queue.length > 2000) rec.queue.shift();
    }
  });
  child.on('error', () => rec.alive = false);
  child.on('close', () => {
    rec.alive = false;
    if (rec.res && rec.res.writableEnded === false) {
      rec.res.write(`event: close\ndata: {}\n\n`);
      rec.res.end();
    }
    sessions.delete(id);
  });
  return { ok: true, id, name: sessionName };
}

export async function resizeTerminal(id, cols, rows) {
  const rec = sessions.get(id);
  if (!rec || !rec.alive) return { ok: false, error: '终端已结束' };
  const c = Math.max(20, Math.min(500, Math.floor(Number(cols) || 80)));
  const r = Math.max(5, Math.min(200, Math.floor(Number(rows) || 24)));
  try {
    await writeFile(rec.ctrl, `${r} ${c}`);
    process.kill(rec.child.pid, 'SIGWINCH');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function writeTerminalInput(id, b64) {
  const rec = sessions.get(id);
  if (!rec || !rec.alive) return { ok: false, error: '终端已结束' };
  try {
    rec.child.stdin.write(Buffer.from(b64, 'base64'));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function closeTerminal(id) {
  const rec = sessions.get(id);
  if (!rec) return { ok: true };
  try { rec.child.kill('SIGTERM'); } catch { /* 忽略 */ }
  return { ok: true };
}

export function closeAllTerminals() {
  for (const rec of sessions.values()) {
    try { rec.child.kill('SIGKILL'); } catch { /* 忽略 */ }
  }
  sessions.clear();
}

export function attachStream(id, res) {
  const rec = sessions.get(id);
  if (!rec || !rec.alive) {
    res.writeHead(410, { 'Content-Type': 'text/event-stream' });
    res.end('event: close\ndata: {}\n\n');
    return false;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  rec.res = res;
  for (const b64 of rec.queue.splice(0)) {
    if (res.writableEnded === false) res.write(`data: ${b64}\n\n`);
  }
  res.on('close', () => {
    rec.res = null;
  });
  return true;
}
