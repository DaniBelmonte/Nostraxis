# Clean-clone validation

Goal: make the documented `npm run check` work without existing dist artifacts.

- [x] Reproduce the failure in a temporary copy of tracked files without dist.
- [x] Change package.json check to build first, then test. The packaging test intentionally reads build artifacts.
- [x] Run check from the same clean temporary copy: build succeeds, 59/59 tests pass, Sites artifacts are generated.
- [x] Prepare this fix as an independent commit after managed-session cancellation.

No dependency, provider, UI or publishing change is included.
