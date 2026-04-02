# 9020 Speeeeeeed Plan Tracker

## Completed
- [x] Fix startup boot blocker (`index.html` unclosed comment; script loading as module).
- [x] Keep explicit trip lifecycle states and transition behavior in `app.js`.
- [x] Keep periodic active-trip persistence every 15 seconds.
- [x] Keep restore-on-reopen with stale snapshot cutoff at 1 hour.
- [x] Improve auto-pause/auto-resume behavior with better pause-reference handling and 100m resume radius.
- [x] Enforce strict GPS-only timing trigger logic.
- [x] Apply selected timing mode behavior: `50-120` active; others visible but disabled.
- [x] Add timing and control highlight classes (ready/ongoing/done + pause/resume/reset flashes).
- [x] Center and float gyro consent button above content.
- [x] Improve gyro visual strength and add N/E/S/W max overlays on tachometer.
- [x] Extract pure metric helper (`deriveTripMetrics`) for testability.
- [x] Add unit tests for pause/resume decisions, timing engine flows, record aggregation, and pause-time exclusion.
- [x] Run verification (`npm test`) and syntax checks.
- [x] Investigate slow-feel issue: removed history rendering from 24 Hz loop and added GPS/UI runtime rate diagnostics.

## In Progress
- [ ] Browser-level integration checks with Playwright (blocked locally: Playwright not installed in Python env and sandbox disallows local port binding in this run).

## Follow-ups
- Install Playwright and run scripted browser checks for:
  - page boot/runtime wiring,
  - highlight TTL behavior,
  - snapshot restore `<1h` vs `>1h` reopen behavior.
