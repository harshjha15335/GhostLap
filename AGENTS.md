# GhostLap — Agent Instructions

Shared rules for every AI coding agent working on this repo (Claude Code, Gemini CLI,
and Firstmate crewmates). `CLAUDE.md` and `GEMINI.md` both import this file, so edit
rules here only.

## Project
- Name: GhostLap
- Stack: _TODO — fill in (language, framework, package manager)_
- Install deps: _TODO_
- Run tests: _TODO_
- Run app: _TODO_

## Workflow rules
1. Scout first. Before changing code, read the relevant files and state a short plan.
2. One task = one branch = one git worktree. Never work directly on `main`.
3. Stay inside the files your task owns. If you need to touch another module, report it
   to the supervisor instead of editing it.
4. Run the tests (and linters, if configured) before reporting a task as done.
5. Open a pull request for finished work. **Never merge, deploy, force-push or delete
   branches/files outside your task without explicit human approval.**
6. Finish every task with a report:
   - Files changed
   - Commands/tests run and their results
   - Open risks or follow-ups

## Safety
- Never commit secrets: API keys, tokens, `.env` files, credentials. Check `git diff --staged`
  before every commit.
- Do not install global tools or change system config without asking.
- Keep large logs out of your context; summarise or filter them (e.g. with `trim`) and keep
  the original file.
