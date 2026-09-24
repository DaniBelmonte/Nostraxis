# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

All dashboard-owned navigation, labels, statuses, empty states, and generated metadata use English. Preserve the original language of user prompts and provider payloads.

The Context, Metrics, and Tools inspector must remain accessible at every supported width. Give tabs dedicated space, keep text at a readable fixed size, and use internal scrolling or responsive stacking instead of shrinking or hiding content.

## Product decisions

- The selected visual direction is design 3, the dense dark four-pane developer observability interface stored in `docs/dashboard-overview.png`.
- The frontend is organized by product scene under `src/features`. Each scene exposes a small public API through `index.js` and groups its page, components, hooks, model, and API code in explicit subfolders as needed. Optimize for discoverability by developers who are new to JavaScript.
- This project must remain standalone: it may copy or refactor ideas from Agent Café, but must never import Agent Café runtime modules.
- Missing provider metrics stay unavailable and are never inferred as zero.
- Session time is measured from the real event timestamps: the active time is the sum of the intervals between consecutive events of the same interaction. The time before a user action and any silence longer than `MAX_WORK_GAP_MS` are excluded, so a conversation resumed the next day, or a provider that writes its shutdown record when the terminal is closed, never reports days of execution. The conversation span and the last turn are reported beside the active time, never in its place, and anything unmeasurable stays `—`.
- A user action is what the person did, not every message shaped like one: Copilot subagent prompts carry an `agentId`, Claude subagent prompts are sidechains, and a Codex response item repeating a reported message is a transcript copy. Each adapter marks its inputs with `userAction`.
- Session charts keep their legend and inspected values outside the plotting area so descriptions and data never overlap.
- Copilot credit charts must use one provider credit unit per series and coalesce duplicate measurements from the same timestamp.
- Provider status controls reserve their own header space and open details on click, never on incidental hover.
- Session detail controls respond to the width of the trace pane itself: metric choices, chart evidence and toolbar actions must remain visible without horizontal page scrolling.
- Below tablet width, the session list and trace stack vertically while the navigation rail remains available; dense tables may drop secondary numeric columns before forcing overflow.
- General-purpose agents such as Hermes share the main session, trace, comparison, and analytics surfaces with coding agents. Hermes-specific session types distinguish interactive sessions, automations, and messaging while preserving native source metadata; their filter and grouping controls appear only when Hermes is the selected provider, never as a global dashboard dimension.
- Hermes support observes its canonical local SQLite state in read-only mode. The initial proof of concept imports every native source, classifying desktop/CLI as interactive, cron as automation, and other channels as messaging; it does not launch managed Hermes runs until Nostraxis can enforce its Commands and Writes permissions accurately.

## Filtering and work-project decisions

- The Sessions pane prioritizes finding work projects and sessions, especially when sessions have no useful folder assignment. A work project is user-created and can collect sessions from unrelated folders; repository path remains separate source metadata.
- Folders detected from session paths may appear as suggested projects. Users can hide a detected folder or remove a user-created project from Nostraxis without deleting or changing source sessions. Hidden folder paths remain hidden across reimports until explicitly restored or added by the user.
- Users can include or exclude multiple providers, models, and statuses in the Sessions view. Excluding them changes visibility only and never deletes or rewrites sessions or provider metrics.
- Creating a work project in the UI requires selecting a local folder, with an absolute-path entry fallback. Use an in-app folder browser backed by the local API, because server-launched macOS dialogs can hang or be invisible in the preview. The folder automatically groups matching sessions, while sessions from other folders may still be assigned manually.
- Settings is organized into distinct Session sources, Provider adapters, and Metric definitions sections. Each remains readable on narrow screens; long paths, versions, and errors belong in expandable details rather than forcing horizontal overflow.
- Settings lets the user add and remove local agent-history sources through the same in-app folder browser or an absolute file path. A work-project workspace is an organization rule, not necessarily where provider logs live: a new history source is synced immediately, and imported sessions then join matching projects by their workspace path. Removing a custom source does not delete sessions already imported.
- A user-created work project can contain multiple workspace folders. Its card exposes a folder picker for adding another workspace, with absolute-path entry as a fallback; removing a workspace changes Nostraxis grouping only and never deletes source sessions.
- Selecting a work project's workspace folders automatically includes existing sessions from each folder and its subfolders. The project card links directly to its filtered Sessions view, and project search finds any of its workspace folders.
- The Projects screen keeps work-project creation and existing workspace management in a bounded primary column, with registered code repositories in a separate secondary column that stacks below on narrow screens. Avoid full-width project forms and visually active-looking disabled actions.
