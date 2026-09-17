# Contributing to Nostraxis

Thank you for helping make local agent work easier to understand. Contributions of code, tests, documentation, translations and reproducible bug reports are welcome.

## Before you start

- Search the existing issues before opening a new one.
- Use an issue for a substantial feature or architecture change so the direction can be agreed before implementation.
- Never include real prompts, provider credentials, private repository paths or local session databases in an issue, fixture or pull request.
- Keep provider-specific behavior at the adapter boundary. Missing provider data must remain unavailable; do not infer it as zero.

## Local development

Requirements:

- Node.js 22.5 or later
- npm
- Git
- At least one supported agent CLI if you want to exercise live discovery or managed runs

Install and start the local dashboard:

```bash
npm install
npm run dev
```

The app is available at <http://localhost:4173>. Use isolated demo data for visual work:

```bash
NOSTRAXIS_SEED=1 npm run dev
```

## Project map

| Area | Location | Responsibility |
| --- | --- | --- |
| React UI | `src/` | Sessions, analytics, comparison, repositories and settings |
| HTTP API | `server/api.mjs` | Local JSON endpoints and server-sent events |
| Provider adapters | `server/providers/` | Launch configuration and provider event parsing |
| Session discovery | `server/sources/` | Read-only import of local provider histories |
| Runtime | `server/runtime/` | Process lifecycle, cancellation and event persistence |
| Storage | `server/persistence/` | SQLite schema and queries |
| Tests | `tests/` | Node test runner coverage and provider fixtures |

Read [docs/architecture.md](docs/architecture.md) before changing a boundary between these areas.

## Making a change

1. Fork the repository and create a focused branch.
2. Add or update tests for behavior changes.
3. Keep fixtures synthetic and free of personal information.
4. Run the full project check:

   ```bash
   npm run check
   ```

5. Open a pull request using the repository template.

## Adding a provider

1. Add an adapter in `server/providers/` and register it in `server/providers/index.mjs`.
2. Normalize events through `server/core/normalized-events.mjs`.
3. Declare only capabilities the provider actually exposes.
4. Keep authentication in the provider's official CLI; Nostraxis must not store provider credentials.
5. Add synthetic parsing and lifecycle fixtures under `tests/fixtures/`.
6. Document detection, authentication and known metric gaps in the README.

## Pull-request checklist

- The change has one clear purpose.
- Tests and the production build pass locally.
- New UI states are accessible by keyboard and remain usable at narrow widths.
- No secrets, real session histories, SQLite files, logs or machine-specific paths are committed.
- Documentation and configuration examples match the implemented behavior.
- Missing measurements remain `null` or “Not reported”.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
