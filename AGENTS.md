# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

All dashboard-owned navigation, labels, statuses, empty states, and generated metadata use English. Preserve the original language of user prompts and provider payloads.

The Context, Metrics, and Tools inspector must remain accessible at every supported width. Give tabs dedicated space, keep text at a readable fixed size, and use internal scrolling or responsive stacking instead of shrinking or hiding content.

## Product decisions

- The selected visual direction is design 3, the dense dark four-pane developer observability interface stored in `docs/dashboard-overview.png`.
- This project must remain standalone: it may copy or refactor ideas from Agent Café, but must never import Agent Café runtime modules.
- Missing provider metrics stay unavailable and are never inferred as zero.
- Session charts keep their legend and inspected values outside the plotting area so descriptions and data never overlap.
- Copilot credit charts must use one provider credit unit per series and coalesce duplicate measurements from the same timestamp.
- Provider status controls reserve their own header space and open details on click, never on incidental hover.
- Session detail controls respond to the width of the trace pane itself: metric choices, chart evidence and toolbar actions must remain visible without horizontal page scrolling.
- Below tablet width, the session list and trace stack vertically while the navigation rail remains available; dense tables may drop secondary numeric columns before forcing overflow.
