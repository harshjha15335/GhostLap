# GhostLap — Agent Instructions

Shared rules for every AI coding agent working on this repo (Claude Code, Gemini CLI,
and Firstmate crewmates). `CLAUDE.md` and `GEMINI.md` both import this file, so edit
rules here only.

## Project
- Name: GhostLap
- What: GhostLap 2026, a kinetic 3D F1 debrief and "What If?" ghost-car strategy simulator (offline-first, real OpenF1 data)
- Stack: React 18 + TypeScript (strict) + Vite + Tailwind + three.js via @react-three/fiber/drei + GSAP + Zustand + React Router; Vitest; Python 3 (stdlib) data script
- Install deps: `npm install`
- Run app: `npm run dev`
- Type check: `npm run typecheck` · Tests: `npm test` · Production build: `npm run build`
- Refresh data: `npm run fetch-data` (needs network access to api.openf1.org; uses scripts/.cache)

## Architecture contracts
- `src/types/index.ts` is the shared data contract. Don't change existing field meanings. Add optional fields only, and report them.
- `src/store/*` (Zustand) and `src/components/three/F1Car.tsx` (shared procedural car, 8 explodable sub-assemblies) are integrator-owned.
- The browser never calls api.openf1.org. Data comes from `public/data/2026/` with `src/data/seed/` as the embedded fallback.
- One WebGL context at a time: each route owns at most one `<Canvas>`, and routes are lazy-loaded and unmount on navigation.
- Never fabricate real-world facts (results, upgrades, PU usage). Use the data, or show "no data".

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
