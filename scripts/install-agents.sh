#!/usr/bin/env bash
# Installs the GhostLap multi-agent toolchain inside WSL2 Ubuntu:
#   git, gh, tmux, jq, Node.js 22, Claude Code, Gemini CLI, Firstmate.
# Safe to re-run. Does NOT log you in anywhere — you do that afterwards.
set -euo pipefail

FIRSTMATE_DIR="${FIRSTMATE_DIR:-$HOME/firstmate}"
CREW_HARNESS="${CREW_HARNESS:-gemini}"   # harness Firstmate uses for worker agents

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "Base packages (git, gh, tmux, curl, jq, build tools)"
sudo apt update
sudo apt install -y git gh tmux curl ca-certificates build-essential jq python3

step "Node.js (needed by Gemini CLI and Firstmate helpers)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node --version

# Let npm -g install without sudo
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
grep -q 'npm-global/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

step "Claude Code (supervisor)"
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash

step "Gemini CLI (workers)"
npm install -g @google/gemini-cli

step "Firstmate"
if [ -d "$FIRSTMATE_DIR/.git" ]; then
  git -C "$FIRSTMATE_DIR" pull --ff-only
else
  git clone https://github.com/kunchenguid/firstmate.git "$FIRSTMATE_DIR"
fi
mkdir -p "$FIRSTMATE_DIR/config"
echo "$CREW_HARNESS" > "$FIRSTMATE_DIR/config/crew-harness"
echo "Firstmate crew harness set to: $(cat "$FIRSTMATE_DIR/config/crew-harness")"

step "Done. Next steps"
cat <<EOF
  1. source ~/.bashrc
  2. gh auth login          # GitHub.com -> HTTPS -> browser
  3. claude                 # sign in with your Anthropic account, then /exit
  4. gemini                 # choose "Login with Google" (or set GEMINI_API_KEY), then /quit
  5. ./scripts/ghostlap-tmux.sh
EOF
