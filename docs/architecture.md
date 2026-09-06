# 拾忆 · 架构说明

## 概览

拾忆 = **零依赖 Node 本地服务** + **单页 Web 前端**，可选包一层 **Swift + WKWebView 原生壳**。

```text
┌──────────────────────────────┐
│  macOS 应用壳（WKWebView）    │
└──────────────┬───────────────┘
               │ http://127.0.0.1:8787
┌──────────────▼───────────────┐
│ server.mjs（Node, 仅内置模块） │
│  ├─ 静态资源（public/）        │
│  └─ /api/state + /api/action  │
└───┬────────┬────────┬────────┘
    │        │        │
 lib/sessions lib/skills lib/registry
（Claude/Codex  （技能扫描    （规则/MCP/
  会话与进程）    全局+项目）    Agent/命令/Hooks）
```

## 数据源（全部只读本机文件）

| 模块 | 扫描路径 |
|---|---|
| Claude Code 会话 | `~/.claude/projects/**/*.jsonl` |
| Codex 会话 | `~/.codex/sessions`、`~/.codex/archived_sessions`（rollout-*.jsonl） |
| 运行中进程 | `ps` + `lsof`（仅带 TTY 的 claude/codex 进程） |
| 技能 | `~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills`，以及项目目录下 `.claude/skills`、`.codex/skills` |
| 规则 | `~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`、项目级 `CLAUDE.md`/`AGENTS.md` |
| MCP | `~/.claude.json`、`~/.codex/config.toml`、项目 `.mcp.json` |
| Agents / 命令 | `.claude/agents`、`.claude/commands`（全局与项目） |
| Hooks | `.claude/settings.json`（用户与项目） |

## API

- `GET /api/state` — 会话、运行窗口、技能、规则、MCP、Agents、命令、Hooks 与错误信息
- `POST /api/action`
  - `focus`：聚焦 iTerm 窗口
  - `resume`：iTerm（Python API）→ Terminal.app → 复制命令 三级降级恢复
  - `open`：Finder 定位 / 默认编辑器打开
  - `delete` / `delete-skill` / `delete-rule`：移入对应回收目录
  - `mcp-check`：MCP initialize 握手连通性检测

## 设计要点

- **读优先、写谨慎**：管理操作以查看/编辑原文件为主，不做 JSON/TOML 可视化写入
- **删除可恢复**：统一移动到 `trash-zyin` 目录而非物理删除
- **密钥不回流**：MCP env 等敏感配置只在检测进程内使用
- **iTerm 自动化**：AppleScript 在新环境下常被静默拦截，优先走 iTerm2 Python API（需要 iTerm 开启 Enable Python API），失败降级
- **增量缓存**：会话/配置按文件 mtime+size 缓存，避免高频轮询时重复解析大文件

## 测试

```bash
cd app
node --check server.mjs
node --check lib/*.mjs
```
