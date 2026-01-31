---

task: UI Repo Optimization + Best Practices Sweep
test_command: "pnpm test"
---

# Task: UI Repo Optimization + Best Practices Sweep

Perform a production-minded optimization + best-practices pass on our UI repository without changing product behavior. Use `agent-browser` to visually verify key flows after changes.

## Requirements

1. **No feature changes**: do not change UX/product behavior (only performance, reliability, maintainability, accessibility correctness).
2. **Keep diffs clean**: prefer small, reviewable commits.
3. **Use agent-browser** to visually verify the app still behaves correctly after each major change set.
4. **All tests must pass** at the end.
5. If a best-practice change requires a behavior change, **skip it** and document why in the PR notes.

## Scope Areas

* Performance: bundle size, route/component code-splitting, render hotspots, memoization where appropriate
* Best practices: linting, TypeScript strictness, dead code, consistent patterns
* Accessibility: keyboard navigation, focus states, aria labels, contrast regressions (no design changes unless fixing a bug)
* Reliability: error boundaries, loading states, network retry/backoff where already intended
* DX/Repo health: scripts, CI consistency, dependency hygiene

## Success Criteria

1. [ ] **Baseline recorded**: capture before/after metrics in `docs/optimization-report.md`:

   * build size summary (from existing build output)
   * key route load times (rough numbers are fine)
   * any obvious React render hotspots observed
2. [ ] **Bundle + dependency hygiene**:

   * remove unused deps (or justify)
   * ensure lockfile is consistent
   * dedupe deps where safe
3. [ ] **Build + tooling best practices**:

   * ensure eslint + prettier (or existing formatter) run clean
   * fix the *highest-signal* lint rules (no noisy rule bikeshedding)
   * ensure TypeScript is not hiding errors via `any`/`@ts-ignore` unless justified
4. [ ] **Performance wins with zero UX change** (pick the best 2–4 that apply):

   * lazy-load heavy routes/components
   * remove unnecessary re-renders (memo/useMemo/useCallback only when it measurably helps)
   * optimize expensive lists (virtualization if already borderline, otherwise skip)
   * reduce large asset impact (proper formats, compression, caching headers if applicable)
5. [ ] **Accessibility pass**:

   * fix missing labels/roles and keyboard traps
   * ensure focus indicators exist (don’t remove outlines; enhance if needed)
   * confirm dialogs/menus behave correctly with keyboard navigation
6. [ ] **Stability pass**:

   * add/verify error boundaries around risky sections
   * ensure async flows have proper loading + error states (if missing)
7. [ ] **agent-browser visual verification**:

   * verify app loads
   * verify primary navigation works
   * verify the top 3 critical user flows (derive from existing app; document what you tested)
   * verify no obvious layout breakages on common viewport sizes
8. [ ] **All tests pass**
9. [ ] **PR-ready summary**:

   * update `docs/optimization-report.md` with what changed, why, and impact
   * include “Skipped / not worth it” section to show good judgment

## Example Output

```
- docs/optimization-report.md updated with baseline + results
- Reduced main bundle by ~12% via route-level lazy loading
- Removed 2 unused dependencies; lockfile normalized
- Fixed 14 lint issues (no behavior changes)
- Verified flows in agent-browser: Login -> Dashboard, Search -> Detail, Settings update
- pnpm test: PASS
```

---

## Ralph Instructions

1. Work on the next incomplete criterion (marked [ ])
2. After each meaningful change set:

   * run `pnpm test`
   * run `pnpm lint` (or the repo’s lint command) if available
   * use `agent-browser` to visually verify at least one critical flow
3. Keep commits small and frequent (e.g., “chore: remove unused deps”, “perf: lazy-load route X”)
4. If a change risks behavior/UX differences, revert and document it as skipped
5. When ALL criteria are [x], output: `<ralph>COMPLETE</ralph>`
6. If stuck on the same issue 3+ times, output: `<ralph>GUTTER</ralph>`
