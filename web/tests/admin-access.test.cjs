const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.attrs = {}; this.hidden = false; }
  get firstChild() { return this.children[0]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.text = ''; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || this.children.map(child => child.textContent).join(' '); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...((selector.startsWith('#') ? child.id === selector.slice(1) : child.tag === selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
}

const validSession = () => ({
  admin: { steam_id: '76561198000000001' },
  expires_at: new Date(Date.now() + 600000).toISOString(), csrf_token: 'fixture-csrf-token',
});

function open(handler) {
  const root = new Element();
  const status = new Element();
  const writes = [], requests = [];
  const context = {
    AbortController, setTimeout, clearTimeout,
    document: {
      visibilityState: 'visible', createElement: tag => new Element(tag),
      querySelector: selector => selector === '#admin-content' ? root : selector === '#admin-status' ? status : root.querySelector(selector),
    },
    sessionStorage: { setItem: (key, value) => writes.push([key, value]) },
    showLoading: node => { node.hidden = false; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const result = await handler(url, options);
      return { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => result.data };
    },
  };
  const common = fs.readFileSync(path.join(__dirname, '../assets/common.js'), 'utf8').replace(/^export /gm, '');
  const history = fs.readFileSync(path.join(__dirname, '../assets/history.js'), 'utf8');
  const source = history.slice(history.indexOf('// Administrator access lives'), history.indexOf('\nfunction start()'));
  runInNewContext(`${common}\nlet controller;\n${source}\nthis.ui = { loadAdmin, logoutAdmin, session: () => adminSession };`, context);
  return { root, status, writes, requests, ...context.ui };
}

test('signed-out access offers Steam login and remembers only the return destination', async () => {
  const page = open(() => ({ status: 401 }));
  await page.loadAdmin();
  assert.equal(page.session(), null);
  const link = page.root.querySelector('a');
  assert.equal(link.href, '/auth/steam');
  link.events.click({});
  assert.equal(page.writes.length, 1);
  assert.equal(page.writes[0][0], 'dota-stats:admin-return');
  assert.ok(Number(page.writes[0][1]) > 0);
  assert.equal(page.root.querySelectorAll('button').length, 0);
});

test('valid session exposes only profile and expiry; logout sends CSRF in the header', async () => {
  const page = open(url => ({ status: url === '/api/admin/session' ? 200 : 204, data: validSession() }));
  await page.loadAdmin();
  assert.match(page.root.textContent, /76561198000000001/);
  assert.doesNotMatch(page.root.textContent, /fixture-csrf-token/);
  assert.equal(page.writes.length, 0);
  await page.logoutAdmin(false);
  assert.equal(page.requests[1].url, '/api/admin/logout');
  assert.equal(page.requests[1].options.method, 'POST');
  assert.equal(page.requests[1].options.headers['X-CSRF-Token'], 'fixture-csrf-token');
  assert.equal(page.requests[1].options.credentials, 'same-origin');
  assert.equal(page.requests[1].options.cache, 'no-store');
  assert.equal(page.session(), null);
  assert.doesNotMatch(page.root.textContent, /76561198000000001/);
  assert.match(page.root.textContent, /Вы вышли из админ-панели/);
});

test('logout-all uses its own endpoint and disables duplicate submissions', async () => {
  let finish;
  const page = open(url => url === '/api/admin/session'
    ? { status: 200, data: validSession() }
    : new Promise(resolve => { finish = resolve; }));
  await page.loadAdmin();
  const pending = page.logoutAdmin(true);
  assert.ok(page.root.querySelectorAll('button').every(button => button.disabled));
  await page.logoutAdmin(true);
  assert.equal(page.requests.length, 2);
  assert.equal(page.requests[1].url, '/api/admin/logout-all');
  finish({ status: 204 });
  await pending;
  assert.match(page.root.textContent, /Вы вышли на всех устройствах/);
});

test('forbidden sessions never show privileged actions', async () => {
  const page = open(() => ({ status: 403 }));
  await page.loadAdmin();
  assert.equal(page.session(), null);
  assert.match(page.root.textContent, /Нет прав администратора/);
  assert.equal(page.root.querySelectorAll('button').length, 1);
  await page.logoutAdmin(false);
  assert.equal(page.requests.length, 1);
});

test('malformed, expired, and server-error responses offer retry without granting UI access', async () => {
  for (const result of [
    { status: 500 }, { status: 200, data: null },
    { status: 200, data: { ...validSession(), csrf_token: '' } },
    { status: 200, data: { ...validSession(), expires_at: '2020-01-01T00:00:00Z' } },
    { status: 200, data: { ...validSession(), admin: { steam_id: '<script>' } } },
    { status: 200, data: { ...validSession(), admin: { steam_id: 76561198000000001 } } },
  ]) {
    const page = open(() => result);
    await page.loadAdmin();
    assert.equal(page.session(), null);
    assert.match(page.root.textContent, /Не удалось проверить доступ/);
    assert.equal(page.root.querySelector('button').textContent, 'Проверить снова');
  }
});

test('expired session during logout is treated as signed out', async () => {
  const page = open(url => ({ status: url === '/api/admin/session' ? 200 : 401, data: validSession() }));
  await page.loadAdmin();
  await page.logoutAdmin(false);
  assert.equal(page.session(), null);
  assert.match(page.root.textContent, /Сессия завершена/);
});

test('CSRF rejection rechecks access without retrying the destructive request', async () => {
  let sessions = 0;
  const page = open(url => url === '/api/admin/session'
    ? { status: ++sessions === 1 ? 200 : 403, data: validSession() }
    : { status: 403 });
  await page.loadAdmin();
  await page.logoutAdmin(true);
  assert.equal(page.requests.length, 3);
  assert.equal(page.session(), null);
  assert.match(page.root.textContent, /Нет прав администратора/);
});

test('logout failure never claims success and lets the user recheck the session', async () => {
  const page = open(url => {
    if (url === '/api/admin/session') return { status: 200, data: validSession() };
    throw new Error('network');
  });
  await page.loadAdmin();
  await page.logoutAdmin(false);
  assert.match(page.root.textContent, /Не удалось подтвердить выход/);
  assert.ok(page.session());
  assert.ok(page.root.querySelectorAll('button').every(button => !button.disabled));
  assert.ok(page.root.querySelectorAll('button').some(button => button.textContent === 'Обновить состояние'));
});
