# Project guidance

## Agent workflow

These are instruction defaults, not runtime enforcement or tool permissions. Follow higher-priority guidance and explicit user overrides. Read the matching installed skill's `SKILL.md` before using it; the host supplies its location. If a required skill is unavailable, report the limitation rather than pretending to load it. Do not install skills during initialization.

- **caveman:** Use for concise chat responses, preserving technical facts and exact code, commands, paths, and errors. Use full sentences for questions and safety warnings. Keep persisted documentation and code in normal prose. Honor requests to stop caveman or use normal mode.
- **grilling:** Use before asking clarification questions about requirements, preferences, or decisions. Choose the lightest suitable mode; do not turn clear tasks into interviews. Use `AskQuestion` when available in an interactive TUI; otherwise ask in chat. Cancellation is not consent.
- **ponytail:** Use when building or changing code. Make the smallest complete change, reuse existing patterns, and retain validation, error handling, security, accessibility, and required tests. Combine with the task-specific skill rather than replacing debugging, migration, or test-first guidance.

## Overview and layout

Favvyvision is a CommonJS Express favicon API backed by Google and DuckDuckGo; it does not scrape the requested domain.

- `app.js` exports the Express app and `createApp(options)` for isolated tests. Importing it must not bind a listener. Routes are `/`, `/healthz`, and `/favicon?domain=example.com`.
- `favicon.js` owns hostname validation, provider fetching and redirect checks, image validation, deadlines, bounded caching, and in-flight coordination.
- `server.js` owns the standalone listener and bounded SIGTERM/SIGINT shutdown. Its default address is `0.0.0.0:5173`.
- `test/favicon.test.js` covers service/API behavior and listener lifecycle; `test/transport.test.js` exercises the real Axios adapter against a local upstream.
- `vercel.json` routes all requests to `app.js` using `@vercel/node`. The README's statement that no deployment configuration exists is stale; the config itself is not evidence of a successful deployment.

## Commands

Run from the repository root with Node.js 24 (`.nvmrc`, `package.json`) and npm (`package-lock.json`).

```sh
nvm use
npm ci
npm test
npm start
npm run dev
npm audit --omit=dev --audit-level=high
```

- `npm test` runs `node --test`; tests use injected providers or loopback HTTP rather than live providers.
- `npm start` runs `node server.js`; `npm run dev` runs `node --watch server.js`.
- No build, lint, type-check, or format scripts are defined.
- `.github/workflows/ci.yml` runs `npm ci`, `npm test`, and the production dependency audit above on Node 24 for pushes and pull requests. Offline tests do not verify live providers or hosting.
- Configuration is read at startup. `npm start` does not load `.env` automatically; the documented alternative is `node --env-file=.env server.js`. See `README.md` for settings and release checks.

## Conventions and constraints

- Use CommonJS and existing `node:test` / `node:assert/strict` patterns. Inject `transport`, `clock`, `env`, and `logger` through existing factories for deterministic tests; close local servers and sockets during cleanup.
- Preserve the public-hostname boundary: accept one hostname, not URLs, ports, IP addresses, or duplicate domain query fields. Keep canonicalization and provider-specific HTTPS redirect allowlists.
- Fetch only from the supported providers and checked redirects. Keep response size limits, MIME/signature validation, cancellation, and provider/overall deadlines. SVG and HTML are not accepted images.
- Successful provider responses are selected by byte size, not image resolution. Do not describe signature validation as full image decoding.
- Keep cache entry/byte/TTL bounds and same-domain request coalescing. Caches and in-flight limits are per instance, not distributed abuse protection.
- Preserve sanitized error responses, error `Cache-Control: no-store`, and logs that omit query strings, domains, and bodies. Do not enable broad `trust proxy` without verifying the proxy topology.
- For deployment, keep application deadlines below the gateway timeout and CDN cache keys sensitive to the domain query. The README requires distributed edge rate limits and outbound budgets before public launch; these are not implemented by the application's capacity cap.
