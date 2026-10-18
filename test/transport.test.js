const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { gzipSync } = require('node:zlib');
const axios = require('axios');
const { createFaviconService } = require('../favicon');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function upstream(t, handler) {
  const server = http.createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  // Test-only routing: exercise the real Axios HTTP adapter without public network access.
  return (url, settings) => axios.get(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, {
    ...settings, proxy: false,
  });
}

test('real Axios adapter preserves image bytes and follows only checked redirects', async t => {
  const paths = [];
  const transport = await upstream(t, (req, res) => {
    paths.push(req.url);
    if (req.url === '/s2/favicons') {
      res.writeHead(302, { Location: 'https://t0.gstatic.com/faviconV2' }).end();
    } else if (req.url === '/faviconV2') {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
    } else {
      res.writeHead(404).end();
    }
  });
  const result = await createFaviconService({ env: {}, transport }).get('example.com');
  assert.deepEqual(result.data, png);
  assert.equal(result.contentType, 'image/png');
  assert.ok(paths.includes('/faviconV2'));
});

test('real Axios adapter enforces raw and decompressed response limits', async t => {
  const oversized = Buffer.concat([png, Buffer.alloc(16384)]);
  const compressed = gzipSync(oversized);
  assert.ok(compressed.length < 256);
  for (const gzip of [false, true]) {
    await t.test(gzip ? 'gzip decoded bytes' : 'chunked bytes', async t => {
      const transport = await upstream(t, (req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
        res.write(gzip ? compressed : oversized);
        res.end();
      });
      const service = createFaviconService({ env: {}, transport, MAX_IMAGE_BYTES: 256 });
      await assert.rejects(service.get('example.com'), { status: 502 });
    });
  }
});

test('real Axios sockets are cancelled at the overall deadline, including stalled bodies', { timeout: 3000 }, async t => {
  const closed = [];
  const signals = [];
  const localTransport = await upstream(t, (req, res) => {
    closed.push(once(res, 'close'));
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.write(png);
    // Never finish the body: the overall deadline must cancel both sockets.
  });
  const service = createFaviconService({
    env: {}, PROVIDER_TIMEOUT_MS: 2000, REQUEST_TIMEOUT_MS: 200,
    transport: (url, settings) => {
      signals.push(settings.signal);
      return localTransport(url, settings);
    },
  });
  await assert.rejects(service.get('example.com'), { status: 504 });
  assert.equal(closed.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
  await Promise.all(closed);
});
