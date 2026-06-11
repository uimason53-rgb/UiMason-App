# UiMason App

UiMason is a full-stack AI app builder with a React/Vite frontend, an Express API gateway, multi-provider AI routing, workspace persistence, Monaco-based code editing, and WebContainer preview support.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

The full-stack dev command starts:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

## Scripts

```bash
npm run dev           # Build backend once, then run backend + Vite frontend
npm run dev:client    # Run only Vite frontend
npm run dev:server    # Build and run only Express backend
npm run build         # Type-check, bundle backend, and build frontend
npm run build:client  # Type-check and build frontend only
npm run build:server  # Bundle Express backend into dist-server/index.js
npm run lint          # Run ESLint
npm run start         # Run built backend from dist-server/index.js
```

## Environment

Copy `.env.example` to `.env` and fill the provider keys you need.

Important variables:

- `JWT_SECRET`: required in production.
- `CORS_ORIGIN`: frontend origin allowed by the API, default `http://localhost:5173`.
- `OPENAI_KEY`, `DEEPSEEK_KEY`, `CLAUDE_KEY`, `GEMINI_KEY`: AI provider credentials.
- `VERCEL_TOKEN`, `NETLIFY_TOKEN`: optional deployment provider credentials.

The development-only `/api/auth/token` endpoint is disabled when `NODE_ENV=production`.

## Architecture

```text
src/
  agents/        multi-agent orchestration
  codeIntel/     AST and code understanding helpers
  components/    UI components
  hooks/         app/session/agent state hooks
  pages/         Home, Project, Settings
  rag/           retrieval and embedding helpers
  search/        codebase indexing and QA
  services/      AI, sandbox, deploy, repair, diff, git services

server/
  db/            SQLite schema and shared connection
  middleware/    auth and rate limiting
  routes/        auth, sessions, workspaces, agent sessions, AI, deployments
```

## Phase 0 Verification

Before working on larger Cursor/Codex-level features, keep these green:

```bash
npm run lint
npm run build
```

Current Phase 0 foundation includes full-stack scripts, backend bundling, production JWT guardrails, documented env setup, clean OpenAI streaming/non-streaming routes, and project hygiene defaults.
