import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const STORE_DIR = path.join(os.homedir(), '.shiyi');
const STORE_FILE = path.join(STORE_DIR, 'skill-translations.json');

export async function loadTranslations() {
  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj.entries === 'object' ? obj.entries : {};
  } catch {
    return {};
  }
}

async function saveTranslations(entries) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify({ version: 1, entries }, null, 2));
}

export async function setManualTranslation(skillPath, nameZh, descZh) {
  const entries = await loadTranslations();
  entries[skillPath] = { ...(entries[skillPath] || {}), nameZh, descZh, locked: true, updatedAt: Date.now() };
  await saveTranslations(entries);
  return { ok: true, entry: entries[skillPath] };
}

async function resolveProviders() {
  const out = [];
  // 优先 Claude Code 正在使用的 Anthropic 兼容端点（如 DeepSeek）
  try {
    const s = JSON.parse(await readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    const env = s.env || {};
    const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
    const base = env.ANTHROPIC_BASE_URL;
    const model = env.ANTHROPIC_MODEL || 'deepseek-v4-flash';
    if (token && base) {
      out.push({ style: 'anthropic', url: base.replace(/\/$/, '') + '/v1/messages', model, key: token });
    }
  } catch { /* 忽略 */ }
  // 回退 Codex 的 OpenAI 兼容端点
  try {
    const cfgRaw = await readFile(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const model = (cfgRaw.match(/^\s*model\s*=\s*"([^"]+)"/m) || [])[1];
    const provider = (cfgRaw.match(/^\s*model_provider\s*=\s*"([^"]+)"/m) || [])[1] || 'deepseek';
    const baseMatch = cfgRaw.match(new RegExp(`\\[model_providers\\.${provider}\\][\\s\\S]*?base_url\\s*=\\s*"([^"]+)"`));
    const base = baseMatch ? baseMatch[1] : 'https://api.deepseek.com/v1';
    const authRaw = await readFile(path.join(os.homedir(), '.codex', 'auth.json'), 'utf8');
    const auth = JSON.parse(authRaw);
    const key = auth.OPENAI_API_KEY || auth.apiKey || Object.values(auth).find((v) => typeof v === 'string' && v.startsWith('sk-'));
    if (key && model && base) {
      out.push({ style: 'openai', url: base.replace(/\/$/, '') + '/chat/completions', model, key });
    }
  } catch { /* 继续尝试 Claude 配置 */ }
  return out;
}

async function callModel(provider, prompt) {
  if (provider.style === 'openai') {
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`空响应: ${JSON.stringify(data).slice(0, 180)}`);
    return text;
  }
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.key,
      Authorization: `Bearer ${provider.key}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const text = (data.content || [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error(`空响应: ${JSON.stringify(data).slice(0, 180)}`);
  return text;
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('模型未返回 JSON 数组');
  return JSON.parse(body.slice(start, end + 1));
}

export async function translateSkills(skills, { force = false } = {}) {
  const entries = await loadTranslations();
  const targets = skills.filter((s) => {
    const e = entries[s.path];
    if (e?.locked && !force) return false;
    if (!force && e && e.mtime === s.mtime && e.size === s.bytes) return false;
    return true;
  });
  if (!targets.length) return { ok: true, translated: 0, total: skills.length, message: '没有需要翻译的技能' };

  const providers = await resolveProviders();
  if (!providers.length) {
    return { ok: false, error: '未找到可用的模型端点（检查 ~/.codex 或 ~/.claude 配置）' };
  }

  const payload = targets.map((s, i) => ({ i, name: s.name, description: s.description || '' }));
  const prompt =
    '你是技术文档翻译。把下面 JSON 数组中每个技能的 name 和 description 翻译成简洁、专业的简体中文。\n' +
    '只输出 JSON 数组，元素格式 {"i":序号,"nameZh":"...","descZh":"..."}，不要输出任何其他文字。\n\n' +
    JSON.stringify(payload, null, 0);

  let text = '';
  const errors = [];
  for (const provider of providers) {
    try {
      text = await callModel(provider, prompt);
      if (text) break;
      errors.push(`${provider.style}: 空响应`);
    } catch (e) {
      errors.push(`${provider.style}: ${String(e?.message || e)}`);
    }
  }
  if (!text) return { ok: false, error: errors.join(' | ') || '模型调用失败' };
  const list = extractJson(text);
  let translated = 0;
  for (const item of list) {
    const src = targets[item.i];
    if (!src) continue;
    entries[src.path] = {
      nameZh: String(item.nameZh || '').slice(0, 120),
      descZh: String(item.descZh || '').slice(0, 400),
      mtime: src.mtime,
      size: src.bytes,
      locked: false,
      updatedAt: Date.now(),
    };
    translated += 1;
  }
  await saveTranslations(entries);
  return { ok: true, translated, total: skills.length };
}

export async function translationStats(skills) {
  const entries = await loadTranslations();
  let fresh = 0;
  for (const s of skills) {
    const e = entries[s.path];
    if (e && (e.locked || (e.mtime === s.mtime && e.size === s.bytes))) fresh += 1;
  }
  return { total: skills.length, translated: fresh };
}
