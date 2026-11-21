# GhostLap

_Project description — TODO._

## AI agent workflow

This repo is set up for a multi-agent workflow. Claude Code runs as the Firstmate
supervisor and Gemini CLI runs the workers. See [docs/AGENT_SETUP.md](docs/AGENT_SETUP.md).

Quick launch (after setup):

```bash
./scripts/ghostlap-tmux.sh
```

Agent rules live in [AGENTS.md](AGENTS.md). `CLAUDE.md` and `GEMINI.md` import it.
