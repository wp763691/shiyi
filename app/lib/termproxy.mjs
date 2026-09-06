// 内置终端代理：用系统 script 分配 PTY 运行 tmux attach，通过 SSE 与浏览器通信
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMUX = '/opt/homebrew/bin/tmux';
const sessions = new Map();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.ZYIN_PYTHON || '/usr/bin/python3';

export function openTmuxTerminal(sessionName) {
  if (!sessionName || !/^[\w.-]+$/.test(sessionName)) {
    return { ok: false, error: '非法的 tmux 会话名' };
  }
  const id = randomUUID();
  const bridge = path.join(moduleDir, 'pty_bridge.py');
  const child = spawn(PYTHON, [bridge, '34', '100', TMUX, 'attach', '-t', sessionName], {
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rec = {
    id,
    name: sessionName,
    child,
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
