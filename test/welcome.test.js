const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup(fetch) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', hidden: false, textContent: '', dataset: {}, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      reportValidity() { return true; },
      focus() { this.focused = true; },
      select() { this.selected = true; }
    });
    return nodes.get(selector);
  };
  const example = node('example');
  example.dataset.domain = 'wikipedia.org';
  const revoked = [];
  class BrowserURL extends URL {
    static createObjectURL() { return 'blob:preview'; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [example] },
    window: { location: { origin: 'https://icons.example.com' } },
    navigator: {}, URL: BrowserURL, AbortController, fetch
  });
  vm.runInContext(readFileSync(require.resolve('../public/welcome.js'), 'utf8'), context);
  return { node, revoked, run: () => vm.runInContext('tryDomain()', context) };
}

test('playground previews images, encodes input, updates links and releases old blobs', async () => {
  const paths = [];
  const ui = setup(async path => {
    paths.push(path);
    return { ok: true, blob: async () => ({}) };
  });
  ui.node('#domain').value = 'github.com';
  await ui.run();
  const image = ui.node('#favicon-preview');
  assert.equal(image.src, 'blob:preview');
  image.onload();
  assert.equal(image.hidden, false);
  assert.equal(ui.node('#placeholder').hidden, true);
  assert.equal(ui.node('#status').textContent, 'Hello, github.com.');
  assert.equal(ui.node('#request-url').value, 'https://icons.example.com/favicon?domain=github.com');
  assert.equal(ui.node('#open-image').href, '/favicon?domain=github.com');
  ui.node('#domain').value = 'bad.com&domain=evil.com';
  await ui.run();
  assert.equal(paths[1], '/favicon?domain=bad.com%26domain%3Devil.com');
  assert.deepEqual(ui.revoked, ['blob:preview']);
});

test('examples populate the form and lookup; failures leave usable controls and copy fallback', async () => {
  let path;
  const ui = setup(async value => { path = value; return { ok: false, status: 404 }; });
  ui.node('example').handlers.click({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(path, '/favicon?domain=wikipedia.org');
  assert.equal(ui.node('#domain').value, 'wikipedia.org');
  assert.match(ui.node('#status').textContent, /No favicon found/);
  assert.equal(ui.node('#favicon-preview').hidden, true);
  assert.equal(ui.node('#fetch-button').disabled, false);
  assert.equal(ui.node('#preview')['aria-busy'], 'false');
  await ui.node('#copy-button').handlers.click();
  assert.equal(ui.node('#request-url').selected, true);
  assert.match(ui.node('#copy-status').textContent, /Select and copy/);
});

test('a newer lookup cancels the previous request without stale results', async () => {
  let finish;
  let firstSignal;
  const ui = setup((path, { signal }) => {
    if (!finish) {
      firstSignal = signal;
      return new Promise(resolve => { finish = resolve; });
    }
    return Promise.resolve({ ok: false, status: 400 });
  });
  ui.node('#domain').value = 'github.com';
  const first = ui.run();
  ui.node('#domain').value = 'localhost';
  await ui.run();
  finish({ ok: true, blob: async () => ({}) });
  await first;
  assert.equal(firstSignal.aborted, true);
  assert.match(ui.node('#status').textContent, /Enter a public hostname/);
  assert.equal(ui.node('#favicon-preview').src, undefined);
});
