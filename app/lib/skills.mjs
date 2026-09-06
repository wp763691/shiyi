import { readdir, readFile, stat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const GLOBAL_ROOTS = [
  { tool: 'claude', dir: path.join(os.homedir(), '.claude', 'skills') },
  { tool: 'codex', dir: path.join(os.homedir(), '.codex', 'skills') },
  { tool: 'agents', dir: path.join(os.homedir(), '.agents', 'skills') },
];

const PROJECT_LOCATIONS = [
  { tool: 'claude', dir: '.claude/skills' },
  { tool: 'codex', dir: '.codex/skills' },
];

export async function scanSkills(projectDirs = []) {
  const out = [];

  // 全局技能
  for (const root of GLOBAL_ROOTS) {
    const entries = await safeReaddir(root.dir);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const folder = path.join(root.dir, e.name);
      const skillFile = path.join(folder, 'SKILL.md');
      const item = await parseSkillDir(folder, skillFile, e.name);
      if (item) {
        item.scope = 'global';
        item.project = '';
        item.projectName = '';
        item.toolLabel = toolLabel(root.tool);
        out.push(item);
      }
    }
  }

  // 项目技能：扫描候选项目目录里的 .claude/skills / .codex/skills
  const seen = new Set();
  for (const proj of projectDirs) {
    if (!proj || seen.has(proj)) continue;
    seen.add(proj);
    for (const loc of PROJECT_LOCATIONS) {
      const dir = path.join(proj, loc.dir);
      const entries = await safeReaddir(dir);
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const folder = path.join(dir, e.name);
        const skillFile = path.join(folder, 'SKILL.md');
        const item = await parseSkillDir(folder, skillFile, e.name);
        if (item) {
          item.scope = 'project';
          item.project = proj;
          item.projectName = shortPath(proj);
          item.toolLabel = toolLabel(loc.tool);
          out.push(item);
        }
      }
    }
  }

  out.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return out;
}

function toolLabel(tool) {
  return tool === 'codex' ? 'Codex' : tool === 'agents' ? '本地' : 'Claude Code';
}

function shortPath(dir) {
  const parts = String(dir).split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : dir;
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function parseSkillDir(folder, skillFile, fallbackName) {
  let raw = '';
  let st = null;
  try {
    raw = await readFile(skillFile, 'utf8');
    st = await stat(skillFile);
  } catch {
    return null;
  }
  const parsed = parseSkill(raw, fallbackName);
  return {
    name: parsed.name,
    description: parsed.description,
    tool: toolOf(folder),
    folder,
    path: skillFile,
    mtime: st.mtimeMs,
    bytes: st.size,
    ...parsed,
  };
}

function toolOf(folder) {
  if (folder.includes(path.sep + '.codex' + path.sep)) return 'codex';
  if (folder.includes(path.sep + '.agents' + path.sep)) return 'agents';
  return 'claude';
}

function parseSkill(raw, fallbackName) {
  let name = fallbackName;
  let description = '';
  const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const meta = fm[1];
    const n = meta.match(/^name:\s*["']?([^"'\n]+)["']?/m);
    if (n) name = n[1].trim();
    const d = meta.match(/^description:\s*["']?([^"'\n]+)["']?/m);
    if (d) description = d[1].trim();
  }
  if (!description) {
    const body = raw.replace(/^---[\s\S]*?---/, '').trim();
    const first = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('---'));
    if (first) description = first.slice(0, 180);
  }
  if (description.length > 220) description = description.slice(0, 217) + '…';
  return { name, description };
}

export async function trashSkill(tool, folder) {
  const isGlobal = GLOBAL_ROOTS.some((r) => r.tool === tool && folder.startsWith(r.dir + path.sep));
  let trashBase;
  if (isGlobal) {
    const root = GLOBAL_ROOTS.find((r) => r.tool === tool);
    trashBase = path.join(root.dir, '..', 'trash-zyin');
  } else {
    // 项目技能：移动到项目目录下的 .trash-zyin
    const mark = folder.indexOf('/.claude/skills/');
    const mark2 = folder.indexOf('/.codex/skills/');
    const pos = mark >= 0 ? mark : mark2;
    if (pos < 0) throw new Error('非法路径，拒绝删除');
    trashBase = path.join(folder.slice(0, pos), '.trash-zyin');
  }
  await mkdir(trashBase, { recursive: true });
  const name = path.basename(folder);
  let target = path.join(trashBase, name);
  let i = 1;
  while (true) {
    try {
      await stat(target);
      target = path.join(trashBase, `${name}.${i++}`);
    } catch {
      break;
    }
  }
  await rename(folder, target);
  return { ok: true, moved: target };
}
