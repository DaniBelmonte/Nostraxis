# Standalone architecture

## Runtime flow

```text
React UI
  -> local HTTP API + SSE
    -> RunManager / ExperimentService / ExternalSessionService
      -> ProviderAdapter (Codex, Claude, Copilot, Custom JSONL)
      -> SessionObserver (existing Codex, Claude and Copilot histories + Copilot OTel)
        -> normalized event stream
          -> SQLiteStore
            -> analytics / comparison / run detail
```

Everything in the flow lives in this repository. Provider CLIs are child processes, not linked application internals.

## Modules

| Boundary | Location | Extension contract |
|---|---|---|
| Providers | `server/providers` | Adapter with `build`, `parse`, capabilities and optional session reference |
| Events | `server/core/normalized-events.mjs` | Stable `agent.*` event names and provider payload normalization |
| Runtime | `server/runtime/run-manager.mjs` | Lifecycle, process isolation, cancellation and event persistence |
| External sources | `server/sources` | Read-only discovery, provider-log parsing, deduplication and repository association |
| Persistence | `server/persistence/database.mjs` | SQLite schema and repository-style store methods |
| Metrics | `server/metrics/analytics.mjs` | Nullable metric definitions, aggregation and comparison |
| Provider details | `server/core/provider-details.mjs` | Neutral per-model and per-agent breakdown every adapter fills (`run.providerDetails`) |
| Comparison | `server/metrics/comparison.mjs`, `server/metrics/deviation.mjs`, `server/comparison/service.mjs` | Per-run comparison profile from normalized events, deviations from the group median and their drivers; imported runs and declared effort |
| Export / import | `server/exports/` | Full-run JSONL export and its validated import |
| Evaluators | `server/evaluators` | Independent evaluator catalog and `evaluate` implementation |
| Experiments | `server/experiments` | Context materialization and variant orchestration |
| API | `server/api.mjs` | Local JSON endpoints and SSE updates |
| Frontend | `src` | Dense developer UI consuming only the public API |

## Data integrity

- Missing measurements remain `null`; only known values are aggregated.
- Copilot usage prefers metadata-only OpenTelemetry spans correlated by conversation ID. Managed runs fall back to `/usage` and then `/context` when OTel is unavailable.
- Copilot token totals use `invoke_agent` spans and exclude their `chat` children; AI units use top-level spans only. Subagent token breakdown and incomplete credit coverage remain explicit.
- GitHub AI Credits and legacy premium requests retain their provider-defined unit and are not summed together.
- A context snapshot persists strategy, exact item content, item hashes, prompt template, rendered prompt, task, repository path, branch and HEAD.
- Opaque or encrypted reasoning fields are stripped. Reasoning is stored only when the provider exposes a displayable summary.
- External logs never claim reproducibility when the provider omits full context; unavailable context is recorded explicitly in the snapshot.
- Imported runs from another Nostraxis live in their own `imported_runs` table and never join local sessions or analytics. Costs priced by the exporter are dropped at import and re-priced locally.
- Provider-specific measurements (usage per model and agent, rate-limit windows, cache-miss reasons, stop reasons, routing, compaction cost) are read only in the adapters and stored as `run.providerDetails` in one neutral shape; the comparison never reads a provider log format.
- A Claude subagent log under `<session>/subagents/` joins its parent run as an agent and adds its events to the parent; it never becomes or replaces a run.
- Tool calls carry the provider's call id on their start and on an `agent.tool_completed` event, and subagent events carry `agent`; `server/metrics/schedule.mjs` pairs them into the comparison timeline. Starts stored before ids existed pair with the oldest open call of the same tool; calls without an end are estimates and never count as concurrent.
- Deviation drivers are exact arithmetic on reported values: the token waterfall closes on the run's total, the call split uses a log-mean decomposition, and a value missing from a run produces no driver.
- Reasoning effort, context occupancy, compactions and injected instruction files are recorded by the adapters only where the provider log states them. Effort declared by the user is stored apart and always labelled as declared.
- Runtime writes are disabled unless a run explicitly enables them.
- The HTTP server binds to `127.0.0.1` and rejects unexpected Host headers.
- Binding to loopback does not stop a web page from reaching the API through the browser, so cross-site fetch metadata and a mismatched `Origin` are rejected with 403 before every route. Non-`GET`/`HEAD` requests must also use `application/json`; routes that trigger synchronization or provider refreshes use `POST`.

## Adding an integration

1. Add an adapter under `server/providers` and register it in `server/providers/index.mjs`.
2. Map its stream into normalized `agent.*` events without inventing missing usage.
3. Declare actual capabilities so the UI can communicate availability.
4. Add parser and run lifecycle tests.

Evaluators and context strategies follow the same registration pattern and do not need changes to provider code.
