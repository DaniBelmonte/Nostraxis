# Frontend architecture

The frontend is organised by product scene. Start in `features/<scene>` when
looking for behaviour owned by a screen or workflow.

```text
src/
|-- app/                 application shell and global orchestration
|-- features/            product scenes
|   |-- sessions/
|   |-- analytics/
|   |-- compare/
|   |-- experiments/
|   |-- repositories/
|   |-- provider-usage/
|   `-- settings/
`-- shared/              code genuinely reused by multiple scenes
    |-- api/
    |-- components/
    `-- lib/
```

## Scene layout

Use only the folders a scene needs:

| Folder | Responsibility |
|---|---|
| `pages/` | Scene entry points composed by `app/App.jsx` |
| `components/` | Visual pieces owned by that scene |
| `hooks/` | State, effects and user actions; the React equivalent of a lightweight ViewModel |
| `model/` | Pure selectors, transformations and scene-specific constants |
| `api/` | Scene-specific calls built on `shared/api/client.js` |

Every scene exposes its public surface through `index.js`. Code outside the
scene imports from that entry point instead of reaching into its internals.

## Dependency rule

```text
app -> features -> shared
```

- `app` may compose scenes but contains no scene business rules.
- A feature owns its UI state and product behaviour.
- Features must not import another feature's internal files.
- `shared` must not import from `features` or `app`.
- Put code in `shared` only after it is used by more than one scene.

`features/workspace/pages/WorkspaceViews.jsx` is a temporary compatibility
module while the existing workspace scenes are extracted independently. New
behaviour belongs in the owning scene, not in that module.
