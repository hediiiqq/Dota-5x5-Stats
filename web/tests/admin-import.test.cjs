const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {runInNewContext} = require('node:vm');

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.attrs = {}; this.value = ''; this.hidden = false; }
  get firstChild() { return this.children[0]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.text = ''; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text || this.children.map(n => n.textContent).join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, fn) { this.events[k] = fn; }
  querySelectorAll(selector) {
    const matches = node => selector[0] === '#' ? node.id === selector.slice(1) : selector[0] === '.' ? node.className?.split(' ').includes(selector.slice(1)) : node.tag === selector;
    return this.children.flatMap(n => [...(matches(n) ? [n] : []), ...n.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
}
const account = (overrides = {}) => ({id: 'account1', name: 'whymiutu', dota_account_id: '123', connection_state: 'disconnected', last_success_at: null, last_checked_match_id: '9000000000', active_job_id: null, ...overrides});
const job = (overrides = {}) => ({id: '42', account_id: 'account1', account_name: 'whymiutu', mode: 'history', min_match_id: '6000000000', after_match_id: null, status: 'queued', stage: null, created_at: '2026-10-26T12:00:00Z', started_at: null, finished_at: null, updated_at: '2026-10-26T12:00:00Z', counters: {discovered: 0, saved: 0, existing: 0, filtered: 0, failed: 0}, error: null, ...overrides});
const session = () => ({admin: {steam_id: '76561198000000001'}, expires_at: new Date(Date.now() + 600000).toISOString(), csrf_token: 'test-csrf'});
const ok = data => ({status: 200, data});
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(handler = () => null) {
  const root = new Element(), status = new Element(), requests = [], timers = new Map(), listeners = {};
  let timerID = 0;
  const document = {visibilityState: 'visible', createElement: tag => {const node = new Element(tag); node.focus = () => {document.activeElement = node; node.focused = true;}; return node;},
    querySelector: s => s === '#admin-content' ? root : s === '#admin-status' ? status : root.querySelector(s),
    addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; }};
  const context = {document, AbortController,
    setTimeout: (fn, ms) => { timers.set(++timerID, {fn, ms}); return timerID; }, clearTimeout: id => timers.delete(id),
    showLoading: node => { node.hidden = false; },
    fetch: async (url, options = {}) => {
      requests.push({url, options});
      const custom = await handler(url, options);
      const result = custom || (url === '/api/admin/session' ? ok(session()) : url === '/api/admin/notices' ? ok({items: []}) : url === '/api/admin/import-accounts' ? ok({accounts: [account()]}) : url.includes('/import-jobs/') ? ok({job: job()}) : ok({jobs: [], next_before: null}));
      return {status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => result.data};
    }};
  const common = fs.readFileSync(path.join(__dirname, '../assets/common.js'), 'utf8').replace(/^export /gm, '');
  const source = fs.readFileSync(path.join(__dirname, '../assets/history.js'), 'utf8');
  const block = source.slice(source.indexOf('// Administrator access lives'), source.indexOf('\nfunction start()'));
  runInNewContext(`${common}\nlet controller;\n${block}\nthis.api = {loadAdmin, logoutAdmin, loadAdminImports, submitAdminImport, openAdminImportJob, moreAdminImportJobs, stopAdminImports, adminMessage, saveAdminNotice, editor: () => adminNotices, state: () => adminImports, session: () => adminSession};`, context);
  return {...context.api, root, requests, document, listeners, timers,
    async poll() { const timer = [...timers.entries()].find(([, t]) => t.ms === 5000); assert.ok(timer, 'poll timer exists'); timers.delete(timer[0]); timer[1].fn(); await settle(); },
    imports: () => requests.filter(r => r.url.includes('/import-'))};
}

test('imports are only requested after confirmed session and show configured accounts', async () => {
  const denied = fixture(() => ({status: 401}));
  await denied.loadAdmin();
  assert.equal(denied.imports().length, 0);
  const page = fixture(); await page.loadAdmin();
  assert.ok(page.state());
  assert.match(page.root.textContent, /whymiutu/);
  assert.match(page.root.textContent, /9000000000/);
  assert.equal(page.root.querySelectorAll('input').some(n => n.type === 'password'), false);
  assert.equal(page.state().mode.value, 'incremental');
});

test('unknown progress forces history, rejects invalid IDs and preserves bigint as string', async () => {
  const page = fixture((url, options) => url.endsWith('/import-accounts') ? ok({accounts: [account({last_checked_match_id: null, dota_account_id: null})]}) : options.method === 'POST' ? {status: 202, data: {job: job({min_match_id: '9223372036854775807'})}} : null);
  await page.loadAdmin();
  assert.equal(page.state().mode.value, 'history');
  for (const value of ['', '0', '-1', '1.5', '1e5', '9223372036854775808']) {
    page.state().boundary.value = value;
    await page.submitAdminImport();
  }
  assert.equal(page.imports().filter(r => r.options.method).length, 0);
  page.state().boundary.value = '9223372036854775807';
  await page.submitAdminImport();
  const write = page.imports().find(r => r.options.method);
  assert.deepEqual(JSON.parse(write.options.body), {account_id: 'account1', mode: 'history', min_match_id: '9223372036854775807'});
  assert.equal(write.options.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(write.options.credentials, 'same-origin');
  assert.equal(page.state().selectedJob.id, '42');
});

test('incremental sends only account and mode; duplicate clicks cannot create two jobs', async () => {
  let finish;
  const page = fixture((url, options) => options.method === 'POST' ? new Promise(resolve => {finish = resolve;}) : null);
  await page.loadAdmin();
  const pending = page.submitAdminImport();
  await page.submitAdminImport();
  await page.logoutAdmin(false);
  assert.equal(page.requests.filter(r => r.options.method).length, 1);
  assert.deepEqual(JSON.parse(page.requests.find(r => r.options.method).options.body), {account_id: 'account1', mode: 'incremental'});
  finish({status: 202, data: {job: job({mode: 'incremental', min_match_id: null, after_match_id: '9000000000'})}});
  await pending;
  assert.equal(page.state().submit.disabled, true); // Account is locally marked busy until a refresh.
});

test('failed POST stays uncertain until explicit queue refresh, never retries automatically', async () => {
  const page = fixture((url, options) => { if (options.method === 'POST') throw new Error('lost response'); return null; });
  await page.loadAdmin(); await page.submitAdminImport();
  assert.equal(page.state().uncertain, true);
  assert.match(page.state().feedback.textContent, /провер/);
  await page.submitAdminImport(); await page.poll();
  assert.equal(page.requests.filter(r => r.options.method).length, 1);
  assert.equal(page.state().uncertain, true);
  await page.loadAdminImports(true);
  assert.equal(page.state().uncertain, false);
});

test('busy conflict exposes the existing job without claiming a new one was created', async () => {
  const page = fixture((url, options) => options.method === 'POST' ? {status: 409, data: {error: {code: 'account_busy', message: 'busy'}, active_job_id: '42'}} : null);
  await page.loadAdmin(); await page.submitAdminImport();
  assert.equal(page.state().selectedJob.id, '42');
  assert.match(page.state().feedback.textContent, /уже/);
  assert.equal(page.requests.filter(r => r.options.method).length, 1);
});

test('CSRF blocks further writes and session expiry removes all privileged UI', async () => {
  const page = fixture((url, options) => options.method === 'POST' ? {status: 403, data: {error: {code: 'csrf_invalid'}}} : null);
  await page.loadAdmin(); await page.submitAdminImport();
  assert.equal(page.state().locked, true);
  await page.submitAdminImport();
  assert.equal(page.requests.filter(r => r.options.method).length, 1);
  assert.equal([...page.timers.values()].some(t => t.ms === 5000), false);
  const expired = fixture(url => url.endsWith('/import-accounts') ? {status: 401} : null);
  await expired.loadAdmin();
  assert.equal(expired.state(), null); assert.equal(expired.session(), null);
  assert.match(expired.root.textContent, /Сессия завершена/);
});

test('poll updates job detail and counters while keeping form nodes and unsent boundary', async () => {
  let current = job();
  const page = fixture(url => url.includes('/import-jobs/') ? ok({job: current}) : null);
  await page.loadAdmin(); await page.openAdminImportJob('42');
  const input = page.state().boundary;
  input.value = '6000000001';
  current = job({status: 'running', stage: 'awaiting_guard', counters: {discovered: 12, saved: 3, existing: 7, filtered: 1, failed: 1}});
  await page.poll();
  assert.equal(page.state().boundary, input);
  assert.equal(input.value, '6000000001');
  assert.match(page.state().detail.textContent, /мобильном/);
  assert.match(page.state().detail.textContent, /12/);
  assert.match(page.state().detail.textContent, /3/);
});

test('hidden tab stops polling, returning refreshes once and overlapping refreshes are ignored', async () => {
  const page = fixture(); await page.loadAdmin();
  page.document.visibilityState = 'hidden'; page.listeners.visibilitychange();
  assert.equal([...page.timers.values()].some(t => t.ms === 5000), false);
  const count = page.imports().length;
  page.document.visibilityState = 'visible'; page.listeners.visibilitychange(); await settle();
  assert.equal(page.imports().length, count + 2);
  assert.equal([...page.timers.values()].filter(t => t.ms === 5000).length, 1);
});

test('late refresh after logout cannot restore private data or timers', async () => {
  let finish, delay = false;
  const page = fixture(url => delay && url.endsWith('/import-accounts') ? new Promise(resolve => {finish = resolve;}) : null);
  await page.loadAdmin(); delay = true;
  const pending = page.loadAdminImports(); await settle();
  page.adminMessage('Вы вышли', 'Войдите снова', {login: true});
  finish(ok({accounts: [account()]})); await pending;
  assert.equal(page.state(), null);
  assert.doesNotMatch(page.root.textContent, /whymiutu/);
  assert.equal([...page.timers.values()].some(t => t.ms === 5000), false);
});

test('missing API shows unavailable state with retry and never displays fictional accounts', async () => {
  const page = fixture(url => url.includes('/import-') ? {status: 404} : null);
  await page.loadAdmin();
  assert.match(page.state().status.textContent, /недоступ/);
  assert.equal(page.state().submit.disabled, true);
  assert.doesNotMatch(page.state().section.textContent, /whymiutu|andudu/);
});

test('pagination uses server cursor, appends jobs and keeps IDs and error text safe', async () => {
  const page = fixture(url => url.includes('before=') ? ok({jobs: [job({id: '41', status: 'failed', error: {code: 'test', message: '<img onerror=alert(1)>'}})], next_before: null}) : url.endsWith('/import-jobs?limit=20') ? ok({jobs: [job()], next_before: 'cursor/+='}) : null);
  await page.loadAdmin(); await page.moreAdminImportJobs();
  assert.equal(page.state().jobs.length, 2);
  assert.ok(page.imports().some(r => r.url.includes('before=cursor%2F%2B%3D')));
  assert.match(page.state().list.textContent, /<img onerror/);
  assert.equal(page.state().list.querySelectorAll('img').length, 0);
});

test('malformed successful responses do not unlock the form or turn missing counters into zero', async () => {
  for (const data of [{accounts: [account({last_checked_match_id: 9000000000})]}, {accounts: [account(), account()]}, {accounts: null}]) {
    const page = fixture(url => url.endsWith('/import-accounts') ? ok(data) : null);
    await page.loadAdmin(); assert.equal(page.state().submit.disabled, true);
  }
  const page = fixture(url => url.includes('/import-jobs/') ? ok({job: job({counters: null})}) : null);
  await page.loadAdmin(); await page.openAdminImportJob('42');
  assert.match(page.state().detail.textContent, /—/);
});

test('account switching applies each accounts own progress and busy state', async () => {
  const page = fixture(url => url.endsWith('/import-accounts') ? ok({accounts: [account(), account({id: 'account2', name: 'andudu', last_checked_match_id: null, active_job_id: '43'})]}) : null);
  await page.loadAdmin();
  page.state().account.value = 'account2'; page.state().account.events.change();
  assert.equal(page.state().mode.value, 'history');
  assert.equal(page.state().submit.disabled, true);
  assert.match(page.state().accountInfo.textContent, /43/);
});

test('public bootstrap still mounts admin only in admin view', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/history.js'), 'utf8');
  assert.match(source, /else if \(view === "admin"\) loadAdmin\(\)/);
  assert.match(source, /stopAdminImports\(\)/);
});

test('access recheck cannot discard pending notice or import writes', async () => {
  for (const kind of ['notice', 'import']) {
    let finish;
    const page = fixture((url, options) => options.method === 'POST' ? new Promise(resolve => {finish = resolve;}) : null);
    await page.loadAdmin();
    const state = page.state(), editor = page.editor();
    editor.input.value = 'Сохранить черновик';
    const pending = kind === 'notice' ? page.saveAdminNotice() : page.submitAdminImport();
    await settle();
    const checks = page.requests.filter(r => r.url === '/api/admin/session').length;
    await page.loadAdmin();
    assert.equal(page.requests.filter(r => r.url === '/api/admin/session').length, checks);
    assert.equal(page.state(), state);
    assert.equal(page.editor(), editor);
    finish(kind === 'notice' ? {status: 201, data: {id: '1', text: 'Сохранить черновик'}} : {status: 202, data: {job: job()}});
    await pending;
  }
});

test('older active jobs refresh beyond the first page and detail agrees with its queue row', async () => {
  const page = fixture(url => url.includes('before=') ? ok({jobs: [job({id: '41', status: 'running'})], next_before: null}) : url.includes('/import-jobs/') ? ok({job: job({id: url.split('/').at(-1), status: 'succeeded'})}) : url.endsWith('/import-jobs?limit=20') ? ok({jobs: [job()], next_before: 'older'}) : null);
  await page.loadAdmin(); await page.moreAdminImportJobs();
  assert.equal(page.state().jobs.find(j => j.id === '41').status, 'running');
  await page.poll();
  assert.equal(page.state().jobs.find(j => j.id === '41').status, 'succeeded');
  await page.openAdminImportJob('42');
  assert.equal(page.state().jobs.find(j => j.id === '42').status, 'succeeded');
  assert.equal(page.state().selectedJob.status, 'succeeded');
});

test('queue polling preserves keyboard focus on the same job button', async () => {
  const page = fixture(url => url.endsWith('/import-jobs?limit=20') ? ok({jobs: [job()], next_before: null}) : null);
  await page.loadAdmin();
  page.state().list.querySelector('button').focus();
  const id = page.document.activeElement.id;
  await page.poll();
  assert.equal(page.document.activeElement, page.state().list.querySelector('button'));
  assert.equal(page.document.activeElement.id, id);
});

module.exports = {fixture, account, job, ok};
