# Favvyvision

CommonJS Express API serving favicon bytes from Google and DuckDuckGo. It does not scrape the requested domain. Hosting is not selected; this repository is not evidence of a deployed service.

## Run locally

Requires Node.js 24 LTS and npm, with HTTPS egress to the favicon providers (including allowed Google redirects).

```sh
nvm use
npm ci
npm test
npm start
```

The listener defaults to `0.0.0.0:5173`. Configuration is read at startup. Set environment variables through your platform, or use Node's built-in env-file support:

```sh
PORT=5173 PROVIDER_TIMEOUT_MS=2000 npm start
# Or, if you maintain a local .env file using the settings below:
node --env-file=.env server.js
```

`npm start` does not automatically load `.env`; no dotenv loader is used. Keep secrets out of committed files. `npm run dev` uses Node's built-in watch mode; no separate watcher dependency is required.

## API

```sh
curl http://localhost:5173/healthz
# {"status":"ok"}
curl -f 'http://localhost:5173/favicon?domain=example.com' -o favicon.ico
```

- `GET /` serves the usage homepage.
- `GET /healthz` returns HTTP 200 with `{"status":"ok"}`; it does not probe providers.
- `GET /favicon?domain=example.com` returns raw supported raster bytes (PNG, JPEG, GIF, WebP, BMP or ICO) with the matching content type. The saved filename does not determine the format.
- Supply exactly one public hostname, not a URL, port or IP address. Case, IDNA and a trailing dot are normalized. Duplicate domain fields are rejected.
- The larger accepted provider response **by byte count** wins; this does not promise higher resolution. Validation checks MIME types and file signatures, not full image decoding. Providers may return generic placeholder icons, which can count as success.

| Status | Meaning for `/favicon` |
| --- | --- |
| 400 | Invalid input |
| 404 | Providers confirmed absence |
| 502 | Provider response invalid or unavailable |
| 503 | Distinct in-flight request capacity reached |
| 504 | Provider/request deadline exceeded |

Responses include `X-Content-Type-Options: nosniff` and a generated `X-Request-ID`. Successful images have public browser/CDN cache headers (one hour by default); errors use `Cache-Control: no-store`. Structured request logs omit query strings, domains and bodies. Configure gateway/access logs separately to preserve that privacy.

## Configuration

All settings are positive integers; invalid values fail startup. `PORT` must also be at most 65535.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | 5173 | HTTP listener port |
| `PROVIDER_TIMEOUT_MS` | 2000 | Individual provider request deadline |
| `REQUEST_TIMEOUT_MS` | 5000 | Overall lookup deadline, including fallback |
| `MAX_IMAGE_BYTES` | 1048576 | Maximum accepted image bytes |
| `CACHE_TTL_MS` | 3600000 | Per-instance successful image cache lifetime |
| `CACHE_MAX_ENTRIES` | 256 | Maximum retained cache entries |
| `CACHE_MAX_BYTES` | 33554432 | Maximum retained image bytes |
| `MAX_INFLIGHT` | 64 | Maximum distinct concurrent lookups |

Keep the overall request timeout **below the gateway timeout**. Tune limits against the instance memory budget: cache bytes exclude object overhead, provider/in-flight buffers, redirect/decompression buffers and the Node runtime. A bounded cache is not a process-memory ceiling.

Successful images are cached per instance with entry, byte and TTL bounds. Expired entries are pruned on lookups/insertion, not by background timers. HTTP cache lifetime is the configured TTL rounded down to seconds, capped at one hour. Same-domain concurrent requests coalesce. Neither cache nor in-flight capacity is shared across instances.

## Files and hosting boundary

- `app.js`: exports the Express app and `createApp(options)` for isolated tests; importing it never binds a listener.
- `favicon.js`: hostname validation, provider fetching, deadlines, image validation, cache and in-flight coordination.
- `server.js`: standalone listener with graceful SIGTERM/SIGINT shutdown; suitable as the entry point in a container or a conventional Node process host.
- `test/`: offline `node --test` coverage with mocked providers/local HTTP checks: validation, formats and redirects, deadlines, error mapping, caching/coalescing/capacity, privacy headers/logs and listener lifecycle. Real Axios adapter tests use a local upstream to verify decoded size limits and socket cancellation.

For a platform-managed Node 24 Express adapter, import `app.js` using that platform's supported integration. No provider-specific adapter or deployment configuration is supplied. The platform must support Node 24, startup environment injection, outbound HTTPS, request deadlines, memory limits and the appropriate lifecycle/health checks. No broad `trust proxy` setting is enabled by default; configure only a verified proxy topology if needed.

**Before public launch, configure distributed rate limits at the edge/gateway and outbound request/concurrency/spend budgets.** The app has no rate limiter; its per-instance capacity cap is not abuse protection. For multiple instances, a CDN cache key must include the normalized `domain` query value (or the full query string); never drop the query and serve one domain's icon for another.

## Release verification

CI runs `npm ci`, offline `npm test`, and `npm audit --omit=dev --audit-level=high` on Node 24 for pushes and pull requests. These checks do not prove live provider or hosting behavior.

Before launch in a real staging environment:

- [ ] Run tests and the production dependency audit on the final lockfile; resolve high/critical findings.
- [ ] Verify actual Google/DuckDuckGo responses, raster content types, size limits and redirect behavior. Google HTTPS redirects to `t0.gstatic.com` through `t3.gstatic.com` are allowed; confirm no unexpected redirect hosts are needed rather than widening the allowlist blindly.
- [ ] Verify cold starts, health checks, graceful termination and timeout behavior behind the selected gateway. Keep application deadlines below its timeout and shutdown within its termination grace period.
- [ ] Measure load and memory with cold/warm caches and concurrent lookups; tune cache, image and in-flight limits plus outbound budgets.
- [ ] With two instances, verify CDN hits and expiry, distinct domain-query cache keys, error `no-store`, and a distributed edge rate limit that works across instances.
- [ ] Confirm gateway/application logs and metrics do not expose domain queries or bodies; verify request-ID correlation.
- [ ] Record the last known-good platform revision and environment configuration. Release a small canary, monitor errors/timeouts, memory and outbound volume, then increase traffic only if healthy. On regression, route traffic back to that revision and restore its configuration using the platform rollback mechanism; verify health and favicon requests afterward. Exercise this procedure in staging first.

No deployment, load-test or live-provider proof is included yet. Provider availability, placeholders and image quality remain external limitations.
