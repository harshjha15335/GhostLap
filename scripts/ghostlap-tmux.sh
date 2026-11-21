#!/usr/bin/env bash
# Starts (or reattaches to) the "ghostlap" tmux session:
#   window 1 "firstmate" -> Claude Code supervisor in the Firstmate checkout
#   window 2 "claude"    -> Claude Code directly in GhostLap (solo tasks)
#   window 3 "gemini"    -> Gemini CLI directly in GhostLap (solo tasks)
#   window 4 "shell"     -> plain shell for git / tests
# Firstmate opens its own windows for crewmates when it spawns workers.
set -euo pipefail

SESSION="${SESSION:-ghostlap}"
FIRSTMATE_DIR="${FIRSTMATE_DIR:-$HOME/firstmate}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  exec tmux attach -t "$SESSION"
fi

tmux new-session  -d -s "$SESSION" -n firstmate -c "$FIRSTMATE_DIR"
tmux send-keys    -t "$SESSION:firstmate" 'claude' C-m
tmux new-window   -t "$SESSION" -n claude -c "$PROJECT_DIR"
tmux new-window   -t "$SESSION" -n gemini -c "$PROJECT_DIR"
tmux new-window   -t "$SESSION" -n shell  -c "$PROJECT_DIR"
tmux select-window -t "$SESSION:firstmate"
exec tmux attach -t "$SESSION"
