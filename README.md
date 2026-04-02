# Project Name

9020 Speeeeeeed runtime project managed via PM2 in `/Users/trixie/webserver/900_html/9020_speeeeeeed`.

## About
9020 Speeeeeeed is a local static SPA project located at `/Users/trixie/webserver/900_html/9020_speeeeeeed`. It is published into `/Users/trixie/webserver/.published/9020_speeeeeeed` and served through the shared secure static server in SPA mode on port `9020`.

## Features
- Serves the 9020 Speeeeeeed experience from sanitized published artifacts.
- Uses the hardened secure static server with security headers and blocked sensitive paths.
- Follows the shared local bootstrap flow driven by `9903_git-pull`.

## Install and Run

### Prerequisites
- Node.js for deployment tooling and secure static server runtime.
- PM2 for the local process manager workflow.

### Setup
1. `cd /Users/trixie/webserver`
2. Optionally set `WEB_ROOT`, `PM2_HOME`, `GIT_PULL_USERNAME`, `GIT_PULL_TOKEN`, or `GIT_PULL_INTERVAL_MS`.

### Running
```bash
# One-time bootstrap for local static 900_html sites
node 990_scripts/9903_git-pull/publish-all.js
node 990_scripts/9903_git-pull/rollout-pm2.js

# Recurring updater
pm2 start '/bin/bash' --name '9903 GIT Pull every minute' --cwd '/Users/trixie/webserver/990_scripts/9903_git-pull' --interpreter 'none' -- '-lc' 'node gitpull.js'
```

```bash
# Direct publish + local serve for this site only
node -e "const { deployRepo } = require('/Users/trixie/webserver/990_scripts/9903_git-pull/deployment'); deployRepo('/Users/trixie/webserver/900_html/9020_speeeeeeed').then(console.log).catch(console.error);"
node /Users/trixie/webserver/990_scripts/9903_git-pull/secure-static-server.js --root '/Users/trixie/webserver/.published/9020_speeeeeeed' --port '9020' --spa
```

## Stabilization Update (2026-04-02)
- Fixed boot blocker in [`index.html`](/Users/trixie/webserver/900_html/9020_speeeeeeed/index.html) by closing the unfinished simulation comment and switching app loading to `type="module"`.
- Added compass max readouts on tachometer (`N/E/S/W`) with IDs used by runtime gyro updates.
- Refined UI behavior in [`styles.css`](/Users/trixie/webserver/900_html/9020_speeeeeeed/styles.css):
  - centered/floating gyro consent button above all content,
  - stronger gyro blob visibility,
  - timing-state and event highlight classes (ready/ongoing/better/worse),
  - auto-pause/auto-resume/reset button flash styles.
- Stabilized trip runtime in [`app.js`](/Users/trixie/webserver/900_html/9020_speeeeeeed/app.js):
  - explicit lifecycle transitions kept (`IDLE`, `TRACKING`, `PAUSED_AUTO`, `PAUSED_MANUAL`, `ENDED`),
  - 15-second active snapshot persistence and restore path,
  - safer auto-pause anchor handling to reduce false positives,
  - auto-resume radius gate kept at 100m,
  - `50-120` timing mode enabled as selected, others shown but disabled,
  - all-time record display policy preserved (before start/after reset only),
  - removed expensive `renderHistory()` calls from the 24 Hz render loop (history now updates only on history actions/trip lifecycle changes),
  - added runtime diagnostics via `window.app.getRuntimeStats()` to inspect GPS vs UI refresh rates.
- Hardened logic in [`logic.js`](/Users/trixie/webserver/900_html/9020_speeeeeeed/logic.js):
  - strict GPS-only heavy-acceleration trigger in timing detection,
  - extracted pure `deriveTripMetrics(...)` helper for testability.
- Converted local server to ESM and added tests in [`tests/logic.test.js`](/Users/trixie/webserver/900_html/9020_speeeeeeed/tests/logic.test.js).
- Validation:
  - `node --check` passed for `app.js`, `logic.js`, `server.js`,
  - `npm test` passed (9/9 unit tests).

## UI Follow-up Update (2026-04-02)
- Reinstated speed-dependent tachometer color coding in [`app.js`](/Users/trixie/webserver/900_html/9020_speeeeeeed/app.js):
  - dynamic color mapped by speed,
  - speed number glow follows speed color,
  - progress ring color follows speed color.
- Adjusted gyro max overlays as requested:
  - removed literal direction labels (values are now number-only),
  - set overlay opacity to `0.7` in [`styles.css`](/Users/trixie/webserver/900_html/9020_speeeeeeed/styles.css).
- Rolled back gyro indicator feel to a softer previous look by reducing motion-blob visual intensity in [`app.js`](/Users/trixie/webserver/900_html/9020_speeeeeeed/app.js) and [`styles.css`](/Users/trixie/webserver/900_html/9020_speeeeeeed/styles.css).
