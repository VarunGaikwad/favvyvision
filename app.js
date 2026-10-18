const express = require('express');
const { randomUUID } = require('node:crypto');
const { createFaviconService } = require('./favicon');

function createApp(options = {}) {
  const service = createFaviconService(options);
  const logger = options.logger || (entry => console.log(JSON.stringify(entry)));
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    res.set('X-Request-ID', requestId);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    res.locals.cache = 'none';
    res.locals.providerErrors = [];
    res.on('finish', () => {
      logger({ requestId, path: req.path, status: res.statusCode,
        latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
        cache: res.locals.cache, providerErrors: res.locals.providerErrors });
    });
    next();
  });
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.get('/', (req, res) => res.type('html').send(`<!doctype html>
<html><head><title>Favicon API</title><style>
body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; text-align: center; color: #333; }
h1 { color: #4A90E2; } code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
</style></head><body><h1>🧩 Welcome to the Favicon API</h1>
<p>Fetch a favicon using a simple GET request.</p><h3>Usage</h3>
<p><code>/favicon?domain=example.com</code></p>
<p>Returns the largest valid image by byte size from Google or DuckDuckGo (not necessarily the highest resolution).</p>
<h3>Example</h3><a href="/favicon?domain=github.com">/favicon?domain=github.com</a>
<footer>🚀 Powered by Node.js + Express</footer></body></html>`));
  app.get('/favicon', async (req, res, next) => {
    try {
      const params = new URL(req.originalUrl, 'http://localhost').searchParams;
      if (params.getAll('domain').length !== 1 || [...params.keys()].some(key => key.startsWith('domain['))) {
        return res.status(400).json({ error: 'Invalid domain' });
      }
      const result = await service.get(params.get('domain'));
      res.locals.cache = result.cache;
      res.locals.providerErrors = result.providerErrors;
      const ttl = Math.min(3600, Math.floor(service.config.CACHE_TTL_MS / 1000));
      res.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
      res.type(result.contentType).send(result.data);
    } catch (error) { next(error); }
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 404, 502, 503, 504].includes(error.status) ? error.status : 500;
    res.locals.cache = error.cache || 'none';
    res.locals.providerErrors = error.providerErrors || [];
    const messages = { 400: 'Invalid domain', 404: 'Favicon not found', 502: 'Upstream unavailable',
      503: 'Service busy', 504: 'Upstream timeout', 500: 'Internal server error' };
    res.set('Cache-Control', 'no-store').status(status).json({ error: messages[status] });
  });
  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
