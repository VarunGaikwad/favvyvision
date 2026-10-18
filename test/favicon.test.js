const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { createApp } = require('../app');
const { createFaviconService, normalizeDomain, providerURLs, readConfig } = require('../favicon');

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20)]);
const icon = Buffer.from('0000010001000000000000000000', 'hex');
const response = (data = png, type = 'image/png') => ({ status: 200, data, headers: { 'content-type': type } });
const absent = () => ({ status: 404, headers: {} });
const quiet = { env: {}, logger: () => {} };
const service = options => createFaviconService({ env: {}, ...options });
async function serve(t, options = {}) {
  const server = createApp({ ...quiet, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return async path => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path, headers: { 'X-Request-ID': 'untrusted-client-id' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('imports never bind a listener', () => {
  execFileSync(process.execPath, ['-e', "require('node:net').Server.prototype.listen = () => { throw Error('bound'); }; require('./app'); require('./server');"], { cwd: process.cwd() });
});

test('configuration defaults and every optional setting validated, including injected overrides', () => {
  assert.equal(readConfig({}).MAX_INFLIGHT, 64);
  for (const key of Object.keys(readConfig({}))) {
    for (const value of ['', '0', '-1', '1.1', 'NaN', ' 2', '2e3', '9007199254740992', null, [], [2], {}, true]) {
      assert.throws(() => readConfig({ [key]: value }), new RegExp(key));
      assert.throws(() => service({ [key]: value }), new RegExp(key));
    }
    assert.equal(readConfig({ [key]: '12' })[key], 12);
    assert.equal(readConfig({ [key]: '12' }, { [key]: 3 })[key], 3);
  }
});

test('hostname boundary rejects malformed and nonpublic input', () => {
  for (const value of [undefined, null, [], {}, ['example.com'], '', 'localhost', '127.0.0.1', '[::1]', 'https://example.com',
    'example.com/x', 'example.com:80', 'user@example.com', ' example.com', 'exa mple.com', 'example.com\n', 'example.com?',
    'example.com#x', 'example.com\\x', 'example%2ecom', 'example.invalid', 'com', 'co.uk', '-x.com', 'x-.com',
    'a..com', 'a'.repeat(64) + '.com', `${('a'.repeat(63) + '.').repeat(4)}com`, 'example.com..', 'x_foo.com']) {
    assert.throws(() => normalizeDomain(value), { status: 400 }, String(value));
  }
  assert.equal(normalizeDomain('WWW.Example.COM.'), 'www.example.com');
  assert.equal(normalizeDomain('BÜCHER.de.'), 'xn--bcher-kva.de');
  assert.equal(normalizeDomain('foo.blogspot.com'), 'foo.blogspot.com');
});

test('health/home and malformed query shapes make no outbound calls', async t => {
  let calls = 0;
  const get = await serve(t, { transport: () => { calls++; throw Error('unexpected'); } });
  assert.deepEqual(JSON.parse((await get('/healthz')).data), { status: 'ok' });
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.data.toString(), /Favicon API/);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.match(home.data.toString(), /<html lang="en">/);
  assert.match(home.data.toString(), /id="domain-form"/);
  for (const domain of ['github.com', 'wikipedia.org', 'stackoverflow.com']) {
    assert.ok(home.data.toString().includes(`href="/favicon?domain=${domain}"`));
  }
  for (const [asset, type] of [['welcome.css', /text\/css/], ['welcome.js', /javascript/]]) {
    const result = await get('/assets/' + asset);
    assert.equal(result.status, 200);
    assert.match(result.headers['content-type'], type);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await get('/assets/missing.js')).status, 404);
  for (const query of ['', 'domain=', 'domain=example.com&domain=example.org', 'domain[]=example.com',
    'domain[x]=example.com', 'domain=example.com&domain[]=evil.com', 'domain=https%3A%2F%2Fexample.com', 'domain=localhost']) {
    const result = await get('/favicon?' + query);
    assert.equal(result.status, 400, query);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await get('/missing')).status, 404);
  assert.equal(calls, 0);
});

test('canonical provider URLs, success bytes/type/headers, private logs, canonical cache hit', async t => {
  const calls = [];
  const logs = [];
  const get = await serve(t, { logger: entry => logs.push(entry), transport: async (url, settings) => {
    calls.push(url);
    assert.equal(settings.maxRedirects, 0);
    assert.equal(settings.maxContentLength, 1048576);
    assert.equal(settings.timeout, 2000);
    assert.ok(settings.signal instanceof AbortSignal);
    return url.includes('google') ? response() : response(icon, 'image/x-icon');
  } });
  const result = await get('/favicon?domain=B%C3%9CCHER.de.&secret=DO_NOT_LOG');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, png);
  assert.equal(result.headers['content-type'], 'image/png');
  assert.equal(result.headers['cache-control'], 'public, max-age=3600, s-maxage=3600');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['x-powered-by'], undefined);
  assert.notEqual(result.headers['x-request-id'], 'untrusted-client-id');
  assert.deepEqual(calls, providerURLs('xn--bcher-kva.de'));
  assert.deepEqual(calls, ['https://www.google.com/s2/favicons?domain=xn--bcher-kva.de&sz=256', 'https://icons.duckduckgo.com/ip3/xn--bcher-kva.de.ico']);
  assert.equal((await get('/favicon?domain=xn--bcher-kva.de')).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(logs[0].cache, 'miss');
  assert.equal(logs[1].cache, 'hit');
  assert.equal(logs[0].path, '/favicon');
  assert.equal(typeof logs[0].latencyMs, 'number');
  assert.doesNotMatch(JSON.stringify(logs), /B.CHER|bcher|DO_NOT_LOG|domain=|untrusted-client-id/);
});

test('TTL uses injected clock, expires opportunistically and canonicalizes keys', async () => {
  let now = 0;
  let calls = 0;
  const api = service({ clock: () => now, CACHE_TTL_MS: 10, transport: async () => { calls++; return response(); } });
  assert.equal((await api.get('EXAMPLE.com.')).cache, 'miss');
  now = 9;
  assert.equal((await api.get('example.com')).cache, 'hit');
  now = 10;
  assert.equal((await api.get('example.com')).cache, 'miss');
  assert.equal(calls, 4);
});

test('cache bounded by entries and bytes with LRU eviction; oversized cache entries not retained', async () => {
  for (const limits of [{ CACHE_MAX_ENTRIES: 2 }, { CACHE_MAX_BYTES: png.length * 2 }]) {
    const api = service({ ...limits, transport: async () => response() });
    await api.get('a.com'); await api.get('b.com');
    assert.equal((await api.get('a.com')).cache, 'hit');
    await api.get('c.com');
    assert.equal((await api.get('a.com')).cache, 'hit');
    assert.equal((await api.get('b.com')).cache, 'miss');
  }
  const api = service({ CACHE_MAX_BYTES: 1, transport: async () => response() });
  assert.equal((await api.get('a.com')).cache, 'miss');
  assert.equal((await api.get('a.com')).cache, 'miss');
});

test('coalesces same key, caps distinct in-flight, cleans up success and failure', async () => {
  let calls = 0;
  // Both providers await the same gate.
  let gateResolve;
  const gate = new Promise(resolve => { gateResolve = resolve; });
  const grouped = service({ MAX_INFLIGHT: 1, transport: async () => { calls++; await gate; return response(); } });
  const first = grouped.get('a.com');
  const second = grouped.get('A.COM.');
  await assert.rejects(grouped.get('b.com'), { status: 503 });
  gateResolve();
  assert.equal((await first).cache, 'miss');
  assert.equal((await second).cache, 'coalesced');
  assert.equal(calls, 2);
  assert.equal((await grouped.get('b.com')).cache, 'miss');
  const broken = service({ MAX_INFLIGHT: 1, transport: async () => absent() });
  const one = broken.get('a.com'); const two = broken.get('a.com');
  await assert.rejects(one, { status: 404, cache: 'miss' });
  await assert.rejects(two, { status: 404, cache: 'coalesced' });
  await assert.rejects(broken.get('b.com'), { status: 404 });
  await assert.rejects(broken.get('a.com'), { status: 404 });
});

test('fallback to registrable domain; success survives provider failure; largest byte selection', async () => {
  const urls = [];
  const api = service({ transport: async url => {
    urls.push(url);
    if (url.includes('sub.example.com')) return absent();
    if (url.includes('google')) throw Error('sensitive error secret');
    return response(icon, 'image/vnd.microsoft.icon');
  } });
  const result = await api.get('sub.example.com');
  assert.deepEqual(result.data, icon);
  assert.deepEqual(urls, [...providerURLs('sub.example.com'), ...providerURLs('example.com')]);
  assert.deepEqual(result.providerErrors, ['not_found', 'not_found', 'upstream']);
  const larger = Buffer.concat([png, Buffer.alloc(100)]);
  const selected = await service({ transport: async url => url.includes('google') ? response() : response(larger) }).get('example.com');
  assert.deepEqual(selected.data, larger);
});

test('404 only all definitive absence; upstream/timeout distinctions and sanitized HTTP errors', async t => {
  for (const [transport, expected] of [
    [async () => absent(), 404],
    [async () => ({ status: 410 }), 404],
    [async url => url.includes('google') ? absent() : ({ status: 503 }), 502],
    [async () => { throw Error('secret-domain-body-stack'); }, 502],
    [async () => { throw Object.assign(Error('secret'), { code: 'ECONNABORTED' }); }, 504],
  ]) {
    const get = await serve(t, { transport });
    const result = await get('/favicon?domain=example.com');
    assert.equal(result.status, expected);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.doesNotMatch(result.data.toString(), /secret|stack|example.com/);
  }
});

test('overall deadline aborts actual signal and includes fallback, even noncooperative transports', async () => {
  const signals = [];
  const start = Date.now();
  const api = service({ PROVIDER_TIMEOUT_MS: 1000, REQUEST_TIMEOUT_MS: 30, transport: (url, { signal }) => {
    signals.push(signal);
    if (url.includes('sub.')) return Promise.resolve(absent());
    return new Promise(() => {});
  } });
  await assert.rejects(api.get('sub.example.com'), { status: 504 });
  assert.equal(signals.length, 4);
  assert.ok(signals.slice(2).every(signal => signal.aborted));
  assert.ok(Date.now() - start < 500);
  await assert.rejects(api.get('sub.example.com'), { status: 504 });
});

test('per-provider timeout and success despite another provider hanging', async () => {
  let signal;
  const api = service({ PROVIDER_TIMEOUT_MS: 15, REQUEST_TIMEOUT_MS: 200, transport: (url, options) => {
    if (url.includes('google')) return Promise.resolve(response());
    signal = options.signal;
    return new Promise(() => {});
  } });
  const result = await api.get('example.com');
  assert.deepEqual(result.data, png);
  assert.deepEqual(result.providerErrors, ['timeout']);
  assert.equal(signal.aborted, true);
});

test('reject empty, HTML, SVG, wrong MIME, unknown signature and decoded oversize images', async () => {
  for (const invalid of [response(Buffer.alloc(0)), response(Buffer.from('<html>secret</html>'), 'text/html'),
    response(Buffer.from('<svg/>'), 'image/svg+xml'), response(png, 'text/html'),
    response(Buffer.alloc(20)), response(Buffer.concat([png, Buffer.alloc(100)]))]) {
    const api = service({ MAX_IMAGE_BYTES: 40, transport: async () => invalid });
    await assert.rejects(api.get('example.com'), { status: 502 });
  }
  await assert.rejects(service({ transport: async () => ({ status: 200, data: png, headers: {} }) }).get('example.com'), { status: 502 });
});

test('supported raster types accepted with compatible Content-Type only', async () => {
  const samples = [response(Buffer.from('ffd8ff00', 'hex'), 'image/jpeg'),
    response(Buffer.from('GIF89a'), 'image/gif'), response(Buffer.from('RIFF0000WEBP'), 'image/webp'),
    response(Buffer.concat([Buffer.from('BM'), Buffer.alloc(12)]), 'image/bmp'), response(icon, 'image/x-icon'),
    response(png, 'image/png; charset=binary')];
  for (const sample of samples) {
    assert.deepEqual((await service({ transport: async () => sample }).get('example.com')).data, sample.data);
  }
});

test('redirect allowlist rejects unsafe destination, protocol, port, credentials and loops before calling it', async () => {
  for (const location of ['https://evil.com/a', 'http://t0.gstatic.com/a', 'https://t0.gstatic.com:444/a',
    'https://user:pass@t0.gstatic.com/a', 'https://t4.gstatic.com/a', 'https://www.google.com.evil.com/a',
    'https://icons.duckduckgo.com.evil.com/a', 'file:///etc/passwd']) {
    const calls = [];
    const api = service({ transport: async url => {
      calls.push(url);
      return url.includes('google.com') ? { status: 302, headers: { location } } : absent();
    } });
    await assert.rejects(api.get('example.com'), { status: 502 });
    assert.equal(calls.length, 2, location);
  }
  let calls = 0;
  await assert.rejects(service({ transport: async url => {
    calls++;
    return { status: 302, headers: { location: url } };
  } }).get('example.com'), { status: 502 });
  assert.equal(calls, 8);
});

test('Google gstatic redirect accepted; Duck redirects cannot switch to Google', async () => {
  for (let host = 0; host < 4; host++) {
    const api = service({ transport: async url => {
      if (url.includes('www.google.com')) return { status: 302, headers: { location: `https://t${host}.gstatic.com/faviconV2?x=1` } };
      if (url.includes('gstatic')) return response();
      return { status: 302, headers: { location: 'https://www.google.com/s2/favicons' } };
    } });
    const result = await api.get('example.com');
    assert.deepEqual(result.data, png);
    assert.deepEqual(result.providerErrors, ['unsafe_redirect']);
  }
});

test('HTTP in-flight capacity errors are no-store and logs contain only error categories', async t => {
  const logs = [];
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const get = await serve(t, { MAX_INFLIGHT: 1, logger: entry => logs.push(entry), transport: async () => {
    entered();
    await gate;
    throw Error('sensitive-upstream-stack-and-body');
  } });
  const pending = get('/favicon?domain=private-example.com&token=SECRET');
  await started;
  const busy = await get('/favicon?domain=another-example.com');
  assert.equal(busy.status, 503);
  assert.equal(busy.headers['cache-control'], 'no-store');
  release();
  assert.equal((await pending).status, 502);
  assert.deepEqual(logs.find(entry => entry.status === 502).providerErrors, ['upstream', 'upstream']);
  assert.doesNotMatch(JSON.stringify(logs), /private-example|another-example|SECRET|sensitive|stack|body/);
});

test('relative same-provider redirects work, missing Location is rejected', async () => {
  let followed = false;
  const api = service({ transport: async url => {
    if (url.includes('duckduckgo')) return { status: 302, headers: {} };
    if (url.includes('/redirected')) { followed = true; return response(); }
    return { status: 302, headers: { location: '/redirected' } };
  } });
  assert.deepEqual((await api.get('example.com')).data, png);
  assert.equal(followed, true);
});

test('server defaults to port 5173 on all interfaces and forces bounded shutdown', () => {
  const script = `
    const assert = require('node:assert/strict');
    delete process.env.PORT;
    const realTimeout = setTimeout;
    global.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 30));
    require('node:net').Server.prototype.listen = function(port, host) {
      assert.equal(port, 5173);
      assert.equal(host, '0.0.0.0');
      return { close() {}, closeIdleConnections() {}, closeAllConnections() { console.log('forced-close'); } };
    };
    require('./server').startServer();
    setInterval(() => {}, 1000);
    realTimeout(() => process.kill(process.pid, 'SIGTERM'), 5);
  `;
  assert.throws(() => execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 3000 }), error => {
    assert.equal(error.status, 1);
    assert.match(error.stdout, /forced-close/);
    return true;
  });
});

test('local server starts on configured PORT and gracefully exits on SIGTERM/SIGINT', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const reservation = http.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = once(child, 'exit');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('startup timeout')); }, 3000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', reject);
    });
    child.kill(signal);
    const [code, termination] = await exit;
    assert.equal(code, 0);
    assert.equal(termination, null);
  }
  assert.throws(() => execFileSync(process.execPath, ['server.js'], { env: { ...process.env, PORT: 'wrong' }, stdio: 'pipe' }), /Command failed/);
});
