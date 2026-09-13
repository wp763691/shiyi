# Shiyi (拾忆)

> Pick up every Claude Code / Codex session and skill, in one place.

[![Download](https://img.shields.io/badge/Download-v1.0.3-blue)](https://github.com/wp763691/shiyi/releases/latest)

**Shiyi** is a local-first macOS desktop tool that gives you a bird's-eye view of your AI coding sessions. It maps running terminal/tmux sessions, searches full history, restores any conversation in one click, and manages skills, rules, MCP servers, agents, commands and hooks across both Claude Code and Codex — all on your own machine.

## Highlights

- **Sessions** — live window & tmux mapping, full-text history, one-click resume (iTerm → Terminal.app → copied command), create/terminate sessions
- **Built-in terminal** — tmux + xterm.js workbench with tabs, auto-fit, clear, copy/paste
- **Skills** — global vs project scope, search/edit/recycle
- **Config** — CLAUDE.md/AGENTS.md, MCP (with connectivity checks), agents, slash commands, hooks, and syntax-highlighted settings editor with backups
- **Privacy** — listens on `127.0.0.1` only; deletes go to a local recycle folder

## Screenshots

### Session Workbench

![Session Workbench](docs/screenshots/sessions.png)

### Skills

![Skills](docs/screenshots/skills.png)

### Config Center

![Config Center](docs/screenshots/config.png)

## Requirements

- macOS 12+ (Apple Silicon)
- Node.js 18+
- tmux (built-in terminal)
- Claude Code / Codex CLI (optional per feature)
- iTerm2 (optional; enable **Enable Python API** for one-click iTerm resume)

## Quick Start

```bash
# Development mode
bash scripts/setup.sh
cd app && node server.mjs   # open http://127.0.0.1:8787

# Build the macOS app
bash app/macos/build_app.sh
open "app/macos/.build/拾忆.app"
```

For other Macs see [docs/安装说明.md](docs/安装说明.md).

## License

[MIT](./LICENSE)
