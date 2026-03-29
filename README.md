# Project Name

9443 Speeeeeed runtime project managed via PM2 in `/Users/chap/webserver/944_speeeeeeed`.

## About
9443 Speeeeeed is a static web project located at /Users/chap/webserver/944_speeeeeeed. It is operated through PM2 and mapped to deployment mode `static-copy` where applicable. Use this README for repeatable setup, configuration, and PM2-aligned runtime operations.

## Features
- Serves the 9443 Speeeeeed static web experience from sanitized published artifacts.
- Uses the hardened secure static server with security headers and blocked sensitive paths.
- Deployment mode is static-copy, aligned with PM2-managed runtime startup.

## Install and Run

### Prerequisites
- Node.js (LTS) for deployment tooling and secure static server runtime.

### Setup
1. `cd /Users/chap/webserver/944_speeeeeeed`
2. Provide required runtime environment variables (no explicit template file detected in this root).

### Running
```bash
# Build/start commands (project-local)
node -e "const { deployRepo } = require('/Users/chap/webserver/990_scripts/9903_gitpull/deployment'); deployRepo('/Users/chap/webserver/944_speeeeeeed').then(console.log).catch(console.error);"
node /Users/chap/webserver/990_scripts/9903_gitpull/secure-static-server.js --root '/Users/chap/webserver/.published/9443-speeeeeed' --port '9443' --spa
```

```bash
# PM2 production-equivalent command
pm2 start '/bin/bash' --name '9443 Speeeeeed' --cwd '/Users/chap/webserver/.published/9443-speeeeeed' --interpreter 'none' -- '-lc' 'node '\''/Users/chap/webserver/990_scripts/9903_gitpull/secure-static-server.js'\'' --root '\''/Users/chap/webserver/.published/9443-speeeeeed'\'' --port '\''9443'\'' --spa'
```

```bash
# Raw PM2 runtime command (from pm2 jlist)
/bin/bash -lc node '/Users/chap/webserver/990_scripts/9903_gitpull/secure-static-server.js' --root '/Users/chap/webserver/.published/9443-speeeeeed' --port '9443' --spa
```
