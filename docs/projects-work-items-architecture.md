# Projects, Work Items, and session organization

## Provider evidence

| Provider | Session identity in Nostraxis | Workspace evidence imported |
|---|---|---|
| Codex | `external-` plus SHA-256 of `codex:<native session id>` | `session_meta.payload.cwd` and every changed `turn_context.payload.cwd` |
| Claude Code | `external-` plus SHA-256 of `claude:<native session id>` | `cwd` on transcript records |
| Copilot CLI | `external-` plus SHA-256 of `copilot:<native session id>` | `session.start.payload.context.cwd` |
| VS Code Copilot Chat | `external-` plus SHA-256 of `copilot:<native chat id>` | local `workspace.json` folder URI; a workspace file resolves to its parent folder |
| Hermes | `external-` plus SHA-256 of `hermes:<native session id>` | `git_repo_root`, falling back to `cwd` in local SQLite |
| Managed Nostraxis runs | Run UUID | configured repository path at launch |

The fallback identity for provider logs without a native ID uses their source filename. Identity never includes a mutable title, timestamp, or working directory, so reimports preserve manual assignments. The provider namespace prevents cross-provider collisions. Native IDs are treated as provider-wide identifiers; if a future adapter has only source-local IDs, it must namespace them by a stable source identifier before import.

OpenAI's [Projects and chats documentation](https://learn.chatgpt.com/docs/projects) says local projects can attach multiple folders, have a primary working folder, and retain secondary folders for file access. Codex CLI uses the launch directory, while the IDE extension uses the selected workspace root. A Nostraxis Project therefore owns a list of source folders and never assumes one repository. Its association is an independent local organization rule.

GitHub's [Copilot CLI configuration reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) documents per-session `events.jsonl` histories under `session-state`. The [CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) supports changing the working directory during a session, so a single initial directory cannot always describe all work.

## Assignment rules

1. An explicit user assignment takes precedence over automatic evidence and survives reimport.
2. A session whose observed working directories share one or more user Projects appears in all of those Projects. Nested and identical workspace folders are allowed; one stored session can appear in multiple Project views without duplication in the source data.
3. With no working directory, absolute paths from observed file events can associate a session with the Projects common to all matching file evidence.
4. If working directories or files identify disjoint Projects, or one observed working directory falls outside all registered Project folders, the session stays in the global Inbox. Relative paths and prompt text never assign a Project.
5. A detected folder remains a suggestion and can be hidden. Hidden paths remain hidden after reimport. The user can create a Project from a real folder or move a session manually.
6. Work Items are never inferred. A Project match means `Project → Unassigned` until the user assigns a Work Item.

New user Projects reject missing folders and repeated folders within the same Project. Different Projects may use the same folder or nested folders. A Project can own several unrelated folders. Removing a folder, Work Item, or Project changes only Nostraxis's grouping.

## Local model and migration

`runs` and `events` are imported observations. `work_projects`, `work_project_folders`, `hidden_work_project_paths`, and `run_work_projects` are the existing local organization layer. The additive migrations create `work_items` and `run_work_items` with foreign keys and remove the cross-Project unique constraint from workspace folders. Existing Projects and assignments remain intact; existing Project sessions begin in Unassigned. `work_items` stores a kind and optional `external_system`, `external_key`, and `external_url` for later Jira, PR, or experiment links. The first UI supports Feature, Task, Bug, and Research.

One session has at most one Work Item. Moving it to another Project clears an incompatible Work Item assignment. Deleting a Work Item returns its sessions to Project Unassigned. Deleting a Project leaves source runs and events untouched. All new tables live in Nostraxis's SQLite database.

## Aggregation

`POST /api/selection-analysis` accepts transient session IDs, a Project ID, or a Work Item ID. All three use one aggregation function. Session token totals use reported input plus output when both exist, otherwise an explicit reported total. Each metric reports its value and coverage; an entirely unavailable metric remains `null`, not zero. Active duration sums measured session active time and does not substitute conversation spans. File and command counts come from observed events, while providers and models use session metadata. The response is computed on demand and never creates a permanent selection.

When the dataset includes Copilot sessions, analysis shows Copilot credit totals as prominent metrics and charts credits by session. It sums only matching credit units; AI credits and legacy premium requests remain separate. Missing credits retain coverage, and main-agent-only observations are identified.

Session Selector state stays in the browser. The Sessions list starts in inspection mode; a Select sessions control reveals checkboxes and bulk actions, and leaving the mode clears the selection. While enabled, it carries selected IDs through search and filter changes, supports moving them to a Project and Work Item, clearing Work Items, comparing up to four in the existing comparison scene, and opening aggregate analysis for any selection.
Bulk Project and Work Item moves use one SQLite transaction through `PUT /api/organization/assign-runs`.
