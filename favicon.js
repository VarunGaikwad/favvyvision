const axios = require('axios');
const { parse } = require('tldts');
const { domainToASCII } = require('node:url');
const { isIP } = require('node:net');

const DEFAULTS = Object.freeze({
  PROVIDER_TIMEOUT_MS: 2000,
  REQUEST_TIMEOUT_MS: 5000,
  MAX_IMAGE_BYTES: 1048576,
  CACHE_TTL_MS: 3600000,
  CACHE_MAX_ENTRIES: 256,
  CACHE_MAX_BYTES: 33554432,
  MAX_INFLIGHT: 64,
});

function readConfig(env = process.env, overrides = {}) {
  const config = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = Object.hasOwn(overrides, key) ? overrides[key] : Object.hasOwn(env, key) ? env[key] : fallback;
    if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
      throw new TypeError(`Invalid ${key}: expected a positive safe integer`);
    }
    config[key] = Number(value);
  }
  return config;
}

class ServiceError extends Error {
  constructor(status, category, providerErrors = []) {
    super(category);
    this.status = status;
    this.providerErrors = providerErrors;
  }
}

function normalizeDomain(value) {
  if (typeof value !== 'string' || !value || /[\s\/:@?#\\%]/u.test(value)) {
    throw new ServiceError(400, 'invalid_domain');
  }
  const domain = domainToASCII(value).toLowerCase().replace(/\.$/, '');
  const labels = domain.split('.');
  const parsed = parse(domain, { allowPrivateDomains: false });
  if (!domain || domain.length > 253 || isIP(domain) || labels.length < 2 ||
      labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      !parsed.isIcann || !parsed.domain) {
    throw new ServiceError(400, 'invalid_domain');
  }
  return domain;
}

function providerURLs(domain) {
  const google = new URL('https://www.google.com/s2/favicons');
  google.search = new URLSearchParams({ domain, sz: '256' }).toString();
  return [google.href, new URL(`/ip3/${domain}.ico`, 'https://icons.duckduckgo.com').href];
}

function safeProviderURL(url, provider) {
  const parsed = new URL(url);
  const hosts = provider === 0
    ? /^(?:www\.google\.com|t[0-3]\.gstatic\.com)$/
    : /^icons\.duckduckgo\.com$/;
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password ||
      !hosts.test(parsed.hostname)) throw new Error('unsafe_redirect');
  return parsed.href;
}

function imageType(data, header) {
  const type = String(header || '').split(';')[0].trim().toLowerCase();
  const starts = hex => data.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const match =
    (data.length >= 8 && starts('89504e470d0a1a0a') && type === 'image/png') ||
    (data.length >= 3 && starts('ffd8ff') && ['image/jpeg', 'image/jpg'].includes(type)) ||
    (data.length >= 6 && /^(GIF87a|GIF89a)$/.test(data.toString('ascii', 0, 6)) && type === 'image/gif') ||
    (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && type === 'image/webp') ||
    (data.length >= 6 && starts('00000100') && data.readUInt16LE(4) > 0 && ['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'].includes(type)) ||
    (data.length >= 14 && starts('424d') && type === 'image/bmp');
  if (!match) throw new Error('invalid_image');
  return type;
}

// Racing the signal also bounds injected transports that do not implement cancellation.
function withSignal(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('timeout'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(work).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

function createFaviconService(options = {}) {
  const config = readConfig(options.env, options);
  const transport = options.transport || ((url, settings) => axios.get(url, settings));
  const clock = options.clock || Date.now;
  const cache = new Map();
  const inflight = new Map();
  let cacheBytes = 0;

  function remove(key) {
    cacheBytes -= cache.get(key).data.length;
    cache.delete(key);
  }
  function prune() {
    for (const [key, value] of cache) if (value.expires <= clock()) remove(key);
  }
  function store(key, result) {
    prune();
    if (result.data.length > config.CACHE_MAX_BYTES) return;
    if (cache.has(key)) remove(key);
    while (cache.size >= config.CACHE_MAX_ENTRIES || cacheBytes + result.data.length > config.CACHE_MAX_BYTES) {
      remove(cache.keys().next().value);
    }
    cache.set(key, { ...result, expires: clock() + config.CACHE_TTL_MS });
    cacheBytes += result.data.length;
  }

  async function fetchProvider(initialURL, provider, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, Math.min(config.PROVIDER_TIMEOUT_MS, 2147483647));
    try {
      return await withSignal(async () => {
        let url = initialURL;
        for (let redirects = 0; ; redirects++) {
          if (controller.signal.aborted) throw new Error('timeout');
          url = safeProviderURL(url, provider);
          const response = await transport(url, {
            responseType: 'arraybuffer', timeout: config.PROVIDER_TIMEOUT_MS,
            signal: controller.signal, maxRedirects: 0,
            maxContentLength: config.MAX_IMAGE_BYTES, maxBodyLength: config.MAX_IMAGE_BYTES,
            validateStatus: () => true,
          });
          if (response.status >= 300 && response.status < 400) {
            if (redirects >= 3 || !response.headers?.location) throw new Error('unsafe_redirect');
            url = safeProviderURL(new URL(response.headers.location, url).href, provider);
            continue;
          }
          if ([404, 410].includes(response.status)) return { category: 'not_found' };
          if (response.status !== 200) return { category: 'upstream' };
          const data = Buffer.from(response.data);
          if (!data.length || data.length > config.MAX_IMAGE_BYTES) throw new Error('invalid_image');
          return { data, contentType: imageType(data, response.headers?.['content-type']) };
        }
      }, controller.signal);
    } catch (error) {
      return { category: controller.signal.aborted || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code)
        ? 'timeout' : error.message === 'unsafe_redirect' ? 'unsafe_redirect' : error.message === 'invalid_image' ? 'invalid_image' : 'upstream' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async function load(domain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.REQUEST_TIMEOUT_MS, 2147483647));
    const errors = [];
    try {
      const root = parse(domain).domain;
      for (const candidate of root !== domain ? [domain, root] : [domain]) {
        const results = await Promise.all(providerURLs(candidate).map((url, index) => fetchProvider(url, index, controller.signal)));
        errors.push(...results.filter(result => result.category).map(result => result.category));
        const valid = results.filter(result => result.data).sort((a, b) => b.data.length - a.data.length);
        if (valid.length) {
          const result = { ...valid[0], providerErrors: errors };
          store(domain, result);
          return result;
        }
        if (controller.signal.aborted) break;
      }
      const status = errors.includes('timeout') ? 504 : errors.every(value => value === 'not_found') ? 404 : 502;
      throw new ServiceError(status, 'favicon_unavailable', errors);
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(value) {
    const domain = normalizeDomain(value);
    prune();
    if (cache.has(domain)) {
      const result = cache.get(domain);
      cache.delete(domain);
      cache.set(domain, result);
      return { ...result, providerErrors: [], cache: 'hit' };
    }
    const coalesced = inflight.has(domain);
    if (!coalesced && inflight.size >= config.MAX_INFLIGHT) {
      throw new ServiceError(503, 'capacity');
    }
    if (!coalesced) {
      const pending = load(domain).finally(() => inflight.delete(domain));
      inflight.set(domain, pending);
    }
    try {
      return { ...await inflight.get(domain), cache: coalesced ? 'coalesced' : 'miss' };
    } catch (error) {
      // Each waiter gets its own metadata rather than mutating the shared error.
      const failure = new ServiceError(error.status || 502, error.message, error.providerErrors);
      failure.cache = coalesced ? 'coalesced' : 'miss';
      throw failure;
    }
  }
  return { get, config };
}

module.exports = { createFaviconService, normalizeDomain, providerURLs, readConfig };
