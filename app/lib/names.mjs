import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), '.shiyi');
const FILE = path.join(DIR, 'session-names.json');

export async function loadSessionNames() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj.entries === 'object' ? obj.entries : {};
  } catch {
    return {};
  }
}

export async function setSessionName(key, name) {
  if (!key) throw new Error('缺少 key');
  const entries = await loadSessionNames();
  const clean = String(name || '').trim().slice(0, 60);
  if (clean) entries[key] = clean;
  else delete entries[key];
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify({ version: 1, entries }, null, 2));
  return { ok: true, key, name: clean || null };
}
