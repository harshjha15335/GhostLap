# GhostLap Multi-Agent Setup (Claude + Gemini)

**Windows 11 · WSL2 Ubuntu · tmux · Firstmate · Claude Code (supervisor) · Gemini CLI (workers)**

This is the general multi-agent guide adapted for GhostLap: Codex is swapped for
Claude Code and Gemini CLI.

## Who does what

| Role | Tool | Why |
|---|---|---|
| Supervisor ("first mate") | **Claude Code** | Firstmate lists Claude Code as a recommended primary harness. Gemini CLI can't be a primary. |
| Workers (crewmates/scouts) | **Gemini CLI** | Firstmate can run Gemini as a worker/scout harness. Set it in `~/firstmate/config/crew-harness`. |
| Solo work | Claude Code or Gemini CLI | Run either one directly in the GhostLap repo, in its own tmux window. |

```
You → Claude Code (Firstmate supervisor, ~/firstmate)
        └─ spawns Gemini CLI workers → isolated worktrees of GhostLap → PRs → you review
```

Both agents read the same rules: `CLAUDE.md` and `GEMINI.md` import `AGENTS.md`.

**Accounts you need:** GitHub, an Anthropic account with Claude Code access (Pro/Max plan or
API key), and a Google account for Gemini CLI (free tier with Google login, or a
`GEMINI_API_KEY` from Google AI Studio). Limits depend on the plan, so don't count on unlimited usage.

## 1. WSL2 + Ubuntu (PowerShell as Administrator)

```powershell
wsl --install -d Ubuntu
```

```powershell
wsl --update
```

Restart if asked, open Ubuntu and create your Linux user.

## 2. Clone GhostLap into the Linux filesystem (not /mnt/c)

```bash
sudo apt update && sudo apt install -y git gh
```

```bash
gh auth login
```

```bash
mkdir -p ~/projects && cd ~/projects && gh repo clone harshjha15335/GhostLap
```

## 3. Install everything with one script

```bash
cd ~/projects/GhostLap && bash scripts/install-agents.sh
```

```bash
source ~/.bashrc
```

The script installs tmux, jq, Node.js 22, Claude Code and Gemini CLI. It also clones Firstmate
into `~/firstmate` and writes `gemini` to `~/firstmate/config/crew-harness`.

Doing it by hand instead:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

```bash
npm install -g @google/gemini-cli
```

```bash
git clone https://github.com/kunchenguid/firstmate.git ~/firstmate && echo gemini > ~/firstmate/config/crew-harness
```

## 4. Sign in (one time)

```bash
claude
```
Sign in with your Anthropic account, then type `/exit`.

```bash
gemini
```
Choose **Login with Google**, then type `/quit`. To use an API key instead, put
`export GEMINI_API_KEY=...` in `~/.bashrc`, **never in the repo**.

## 5. Launch

```bash
cd ~/projects/GhostLap && ./scripts/ghostlap-tmux.sh
```

This opens a tmux session called `ghostlap` with four windows:
`firstmate` (Claude supervisor, already started), `claude`, `gemini` and `shell`.
On first launch Firstmate may offer to install helper tools (treehouse, no-mistakes,
`*-axi`). Approve only what you understand.

### First assignment (start safe)

Paste this into the `firstmate` window:

```text
Ahoy! Set up my GitHub project.
Repository: https://github.com/harshjha15335/GhostLap

Scout the repo first: summarise the architecture, list existing issues,
and propose ONE low-risk task with a plan. Wait for my approval before
implementing.

When implementing: use Gemini crewmates in isolated worktrees, one task per
worktree, split by module so files don't overlap. Each crewmate reports files
changed, tests run and risks. Open PRs. Do not merge, deploy or delete
anything without my approval.
```

## 6. Switching worker harness

| Want | Do |
|---|---|
| All workers on Gemini (default here) | `echo gemini > ~/firstmate/config/crew-harness` |
| Workers mirror the supervisor (Claude) | `echo default > ~/firstmate/config/crew-harness` |
| Mix per task | Ask the supervisor, e.g. "spawn this crewmate with claude". An explicit harness on a spawn overrides the config file. |

Rule of thumb: use Gemini workers for scouting, tests and well-scoped edits. Use Claude
workers for tricky refactors.

## 7. tmux cheatsheet

| Action | Keys |
|---|---|
| Detach (agents keep running) | `Ctrl+B` `D` |
| Reattach | `tmux attach -t ghostlap` |
| Next / previous window | `Ctrl+B` `N` / `Ctrl+B` `P` |
| Pick window from list | `Ctrl+B` `W` |
| Split pane | `Ctrl+B` `%` or `Ctrl+B` `"` |

## 8. Optional extras

These come from the original guide and are only worth adding once the core setup works.

- **trim-1** (Go 1.23+) filters long logs before you paste them into an agent:
  `go install github.com/caveman-ai/trim-1/cmd/trim@latest`.
- **OmniRoute / FreeLLMAPI** gateways mainly generate *Codex* profiles. You don't need them
  for Claude Code or Gemini CLI, which each sign in on their own.
- **VS Code + WSL extension:** run `code .` inside `~/projects/GhostLap`.

## 9. Safety rules (also in AGENTS.md)

- Start with 1 supervisor and 2–3 workers.
- Agents open PRs. You review and merge.
- Never commit keys or `.env` files (`.gitignore` already blocks the common ones).
- Leave merge, deploy and delete behind your approval.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `claude` / `gemini` not found | `source ~/.bashrc`, then check `ls ~/.local/bin ~/.npm-global/bin` |
| Gemini crewmates don't start | Check `cat ~/firstmate/config/crew-harness` and run `gemini` by hand once to confirm login |
| tmux session gone | `tmux ls`, then rerun `./scripts/ghostlap-tmux.sh` |
| Firstmate missing tools | Let it run its own install check, or read `~/firstmate/docs/configuration.md` |

References: [Firstmate](https://github.com/kunchenguid/firstmate) ·
[Claude Code](https://code.claude.com/docs) ·
[Gemini CLI](https://github.com/google-gemini/gemini-cli) ·
[WSL](https://learn.microsoft.com/windows/wsl/install)
