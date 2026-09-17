# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Nostraxis is a local-first observability dashboard for Codex, Claude Code and GitHub Copilot CLI sessions. It discovers existing local agent histories read-only, can launch managed runs, normalizes everything into a single event stream, stores it in SQLite, and renders a dense dark developer UI.

No build step for the server: plain ESM on Node.js 22.5+, zero runtime dependencies beyond React/Recharts/Phosphor on the client. Vite builds only the client.

## Commands

```bash
npm ci                      # install
npm run dev                 # dev server + Vite middleware at http://localhost:4173
npm start                   # production server (needs npm run build first)
npm run build               # vite build + scripts/prepare-sites-build.mjs
npm test                    # node --test tests/*.test.mjs
npm run test:sites          # Sites-handoff contract test only
npm run check               # npm test && npm run build — run before any PR
```

Run a single test file: `node --test tests/dashboard.test.mjs`.

Useful env for local work: `NOSTRAXIS_SEED=1` (demo data), `NOSTRAXIS_EXPERIMENTS_ENABLED=1` (R&D Lab), `NOSTRAXIS_DATA_DIR` (SQLite location, default `.nostraxis/`). Full table in [README.md](README.md).

## Architecture

```text
src/ (React)  ->  server/api.mjs (JSON + SSE)  ->  services  ->  server/persistence/database.mjs (SQLite)
```

| Boundary | Location | Contract |
| --- | --- | --- |
| HTTP entry | `server/start.mjs` | Binds `127.0.0.1`, Host allowlist, static `dist/client` in production |
| API guard | `server/api.mjs` | Same-origin browser check on every API request; JSON required for unsafe methods |
| API | `server/api.mjs` | All `/api/*` routes and `/api/stream` SSE |
| Providers | `server/providers/` | Adapter with `build`, `parse`, capabilities; registered in `index.mjs` |
| Events | `server/core/normalized-events.mjs` | Stable `agent.*` names; all provider payloads pass through here |
| Runtime | `server/runtime/run-manager.mjs` | Managed run lifecycle, cancellation, persistence |
| Discovery | `server/sources/` | Read-only import of local histories, Copilot OTel, dedup |
| Metrics | `server/metrics/` | Nullable metric definitions, aggregation, comparison, cost |
| Storage | `server/persistence/database.mjs` | Schema + store methods (`node:sqlite`) |
| Frontend | `src/` | Consumes only the public API via `src/api.js` |

Read [docs/architecture.md](docs/architecture.md) before changing a boundary. [AGENTS.md](AGENTS.md) holds durable product and design decisions — read it before UI work and record new durable decisions there.

## Rules that are easy to get wrong

- **Missing measurements stay `null`.** Never infer a missing provider metric as zero. The UI shows `—` or "Not reported" (`src/lib.js`).
- **Provider units do not mix.** GitHub AI Credits and legacy premium requests keep their own unit and are never summed.
- **Provider-specific logic stays at the adapter boundary** in `server/providers/` and `server/sources/`. Everything downstream works on normalized events only.
- **No credentials are stored.** Authentication stays in each provider's official CLI.
- **Local only.** The server binds `127.0.0.1` and rejects unexpected `Host` headers; do not widen this.
- **Browser requests are same-origin only.** `crossSiteRejection` in `server/api.mjs` rejects cross-site fetch metadata and a foreign `Origin` on every API route. Non-`GET`/`HEAD` requests must also send `Content-Type: application/json`. The API has no credentials, so this guard is what stops any visited web page from driving it. Never bypass it for a new route, and keep `src/api.js` sending JSON.
- **Runtime writes are disabled** unless a run explicitly enables them.
- **Standalone.** Ideas may be copied from Agent Café, but never import its runtime modules.
- **English for all dashboard-owned strings** (navigation, labels, statuses, empty states, generated metadata). Preserve the original language of user prompts and provider payloads.
- **Never commit** real prompts, session histories, SQLite files, logs, tokens or machine-specific paths. Test fixtures under `tests/fixtures/` are synthetic.

## Style

Follow the surrounding code: 2-space indent, single quotes in `server/`, ESM everywhere, `.mjs` on the server and `.js`/`.jsx` in `src/`. The codebase is deliberately terse — dense arrow functions, few comments, no wrapper layers. Match that density instead of adding abstraction. `.editorconfig` covers whitespace.

## Changing things

- Adding a provider: adapter in `server/providers/`, register in `index.mjs`, normalize through `normalized-events.mjs`, declare only real capabilities, add synthetic fixtures and parser/lifecycle tests, document detection and metric gaps in the README.
- Touching the Sites handoff: keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` and `tests/sites-worker.test.mjs` intact. The build must leave `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json`.
- UI changes must stay keyboard-accessible and usable at narrow widths; the Context/Metrics/Tools inspector must remain reachable at every supported width.
- [CONTRIBUTING.md](CONTRIBUTING.md) has the full PR checklist.
