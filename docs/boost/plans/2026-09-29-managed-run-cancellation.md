# Managed run cancellation implementation plan

> Execute inline using boost:executing-plans, with real process regression tests.

**Goal:** Keep a cancelled managed session cancelled after its child process closes, and guarantee bounded process shutdown.

**Architecture:** Keep the active run and child together so cancellation and close callbacks share terminal state. Retain the process until close, escalate SIGTERM to SIGKILL after five seconds, and await child closure before closing SQLite.

**Tech stack:** Node ESM, node:test, node:sqlite; no new dependencies.

## Constraints

- Preserve prompts, output and events; cancellation never rolls back files.
- External sessions remain read-only and cannot be cancelled here.
- English dashboard strings; synthetic fixtures only.
- Work on `fix/managed-run-cancellation`, based on `develop`.

## Task 1: Terminal state and process lifecycle

Files: `server/runtime/run-manager.mjs`, `server/api.mjs`, new `tests/run-cancellation.test.mjs`, new `tests/fixtures/cancellable-provider.mjs`.

- [x] Add real child-process tests: cancellation stays cancelled after close, final shutdown output is retained, repeated cancellation emits one cancellation, external sessions are rejected, processes ignoring SIGTERM are killed, and terminate resolves only after child closure.
- [x] Run `node --test tests/run-cancellation.test.mjs` and confirm the current state-overwrite and unbounded-shutdown defects.
- [x] Store `{ child, run, closed, killTimer }` per active process. Cancel the shared run, retain the active entry until close and clear timers on close. Use a five-second forced shutdown deadline. Make terminate asynchronous and await it in API close.
- [x] Run the new regression file and existing dashboard and API tests.
- [x] Extend reservation to pending Copilot telemetry setup and track usage probes. Reproduce both failures before fixing; stop active probes and suppress subsequent probes after cancellation.

## Task 2: Documentation and review

Files: `docs/architecture.md`.

- [x] Document cancellation, signal escalation, partial result retention and shutdown ordering.
- [x] Review the diff for terminal-state races, accidental child leaks and SQLite calls after close. Independent review found the usage-probe leak; fixed and re-reviewed without remaining important findings.
- [x] Run `npm run check`: 59/59 tests pass and build succeeds. The independent clean-clone check defect remains a subsequent task.
- [x] Prepare the local branch and report results; no remote publication is required for this cancellation change.
