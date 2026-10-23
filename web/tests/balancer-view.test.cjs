const { test } = require('node:test');
const assert = require('node:assert/strict');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.value = ''; }
  set textContent(v) { this.children = []; this.text = String(v); }
  get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(k, fn) { this.events[k] = fn; }
  querySelectorAll(tag) { return walk(this).slice(1).filter(n => n.tag === tag); }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.events.click?.(); }
}
const walk = n => [n, ...n.children.flatMap(walk)];
const fixture = () => Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), name: `Друг ${i + 1}`, rankTier: i % 5 + 31, roles: [i % 5 + 1], selected: true, updatedAt: Date.now() }));
let root;
globalThis.document = { activeElement: null, createElement: tag => new Node(tag), getElementById: id => walk(root).find(n => n.id === id) };
const lifecycle = {};
globalThis.addEventListener = (name, handler) => { lifecycle[name] = handler; };
const find = text => walk(root).find(n => n.tag === 'button' && n.textContent === text);
const id = value => document.getElementById(value);
function setup(friends = fixture(), { brokenStorage = false } = {}) {
  root = new Node('div'); document.activeElement = null;
  let saved = JSON.stringify(friends);
  globalThis.localStorage = { getItem() { return saved; }, setItem(_, v) { if (brokenStorage) throw new Error('quota'); saved = v; } };
  return () => JSON.parse(saved);
}

test('builds from fresh ranks, recalculates manual swaps and flags role violations, edits invalidate output', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  setup(); let requests = 0;
  renderBalancer(root, { getProfile: async () => { requests++; throw new Error('unexpected'); } });
  await find('Собрать команды').events.click();
  assert.equal(requests, 0);
  assert.equal(walk(root).filter(n => n.className?.includes('balance-swap')).length, 10);
  assert.match(root.textContent, /Все позиции закрыты/);
  assert.equal(walk(root).filter(n => n.className === 'balance-total' && /Средний ≈ 1\s925 MMR/.test(n.textContent)).length, 2);
  id('balance-swap-radiant-0').click(); id('balance-swap-dire-1').click();
  assert.match(root.textContent, /нарушений позиций — 2/);
  assert.match(walk(root).find(n => n.className === 'balance-difference').textContent, /Разница среднего MMR команд61,6/);
  const oldTotal = walk(root).find(n => n.className === 'balance-difference').textContent;
  id('balance-swap-radiant-0').click(); id('balance-swap-dire-1').click();
  assert.match(root.textContent, /Все позиции закрыты/);
  assert.notEqual(walk(root).find(n => n.className === 'balance-difference').textContent, oldTotal);
  const role = id('balance-1-role-2'); role.checked = true; role.events.change();
  assert.equal(walk(root).filter(n => n.className?.includes('balance-swap')).length, 0);
});

test('stale refresh failure blocks output; retry refreshes failed profile before balancing', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  const friends = fixture(); friends[0].updatedAt = 1; setup(friends);
  let fail = true, calls = 0;
  renderBalancer(root, { getProfile: async () => { calls++; if (fail) throw new Error('Сеть недоступна'); return { ...friends[0], updatedAt: Date.now() }; } });
  await find('Собрать команды').events.click();
  assert.match(root.textContent, /Сеть недоступна/);
  assert.equal(walk(root).filter(n => n.className?.includes('balance-swap')).length, 0);
  fail = false;
  await find('Собрать команды').events.click();
  assert.equal(calls, 2);
  assert.equal(walk(root).filter(n => n.className?.includes('balance-swap')).length, 10);
});

test('unknown ranks and storage failures are visible; roster changes remain available in the tab', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  const friends = fixture(); friends[0].rankTier = null; setup(friends, { brokenStorage: true });
  renderBalancer(root, { getProfile: async () => { throw new Error('unexpected'); } });
  await find('Собрать команды').events.click();
  assert.match(root.textContent, /не предоставляет ранг/);
  const check = id('balance-select-1'); check.checked = false; check.events.change();
  assert.match(root.textContent, /Не удалось сохранить/);
  assert.match(root.textContent, /9 \/ 10/);
});

test('adding validates duplicates and roles, persists a new profile without HTML rendering or MMR', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  const saved = setup([]);
  renderBalancer(root, { getProfile: async id => ({ id, name: '<script>alert(1)</script>', rankTier: 22, source:'stratz', updatedAt: Date.now() }) });
  id('balance-account').value = '123';
  const submit = () => walk(root).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  await submit(); assert.match(id('balance-add-error').textContent, /позици/);
  const role = id('balance-add-role-1'); role.checked = true; role.events.change();
  await submit();
  assert.equal(saved()[0].name, '<script>alert(1)</script>');
  assert.equal(saved()[0].source,'stratz');
  assert.equal(walk(root).find(n=>n.className==='balance-name').href,'https://stratz.com/players/123');
  assert.equal(Object.hasOwn(saved()[0], 'mmr'), false);
  assert.equal(walk(root).some(n => n.tag === 'script'), false);
  id('balance-account').value = '123'; await submit(); assert.match(id('balance-add-error').textContent, /уже есть/);
});

test('back-forward cache preserves a usable request signal; actual page departure aborts it', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  const friends = fixture(); setup(friends);
  let lastSignal;
  renderBalancer(root, { getProfile: async (id, { signal }) => {
    lastSignal = signal; signal.throwIfAborted();
    return { ...friends.find(p => p.id === id), updatedAt: Date.now() };
  } });
  lifecycle.pagehide({ persisted: true });
  await find('Обновить ранги').events.click();
  assert.equal(lastSignal.aborted, false);
  assert.match(root.textContent, /Ранги выбранных игроков обновлены/);
  lifecycle.pagehide({ persisted: false });
  assert.equal(lastSignal.aborted, true);
});

test('database picker searches names and IDs, fills the existing manual form and uses OpenDota on add', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  const saved = setup([]); let loaded = 0, requestedID;
  renderBalancer(root, {
    getDatabaseMatches: async () => { loaded++; return [{ players: [{ account_id: '123', nickname: 'Игрок из базы' }, { account_id: '456', nickname: 'Другой игрок' }] }]; },
    getProfile: async account => { requestedID = account; return { id: account, name: 'Профиль OpenDota', rankTier: 31, updatedAt: Date.now() }; },
  });
  assert.equal(loaded, 0);
  await find('Выбрать из базы').events.click();
  assert.equal(loaded, 1);
  const search = id('balance-database-search'); search.value = 'игрок из'; search.events.input();
  assert.match(id('balance-database-list').textContent, /Игрок из базы/);
  assert.ok(!id('balance-database-list').textContent.includes('Другой игрок'));
  find('Выбрать').click(); assert.equal(id('balance-account').value, '123');
  const role = id('balance-add-role-2'); role.checked = true; role.events.change();
  await walk(root).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  assert.equal(requestedID, '123'); assert.equal(saved()[0].id, '123');
  assert.match(id('balance-database-list').textContent, /Уже добавлен/);
  search.value = '456'; search.events.input();
  assert.match(id('balance-database-list').textContent, /Другой игрок/);
  // Manual entry remains independent of the source picker.
  id('balance-account').value = '789'; role.checked = true; role.events.change();
  await walk(root).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  assert.equal(requestedID, '789'); assert.equal(saved().length, 2);
});

test('database list errors are retryable and never disable manual ID entry', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  setup([]); let fail = true;
  renderBalancer(root, { getDatabaseMatches: async () => { if (fail) throw new Error('База недоступна'); return []; } });
  await find('Выбрать из базы').events.click();
  assert.match(root.textContent, /База недоступна/);
  assert.equal(id('balance-account').disabled, undefined);
  fail = false; await find('Выбрать из базы').events.click();
  assert.match(root.textContent, /Нет игроков с Dota ID/);
});

test('database picker renders all players with avatar slots, loads pictures and preserves search', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  setup([]); let avatarCalls = 0;
  renderBalancer(root, {
    getDatabaseMatches: async () => [{ players: Array.from({ length: 37 }, (_, i) => ({ account_id: String(100 + i), nickname: `Участник ${i}` })) }],
    loadDatabaseAvatars: async (list, signal) => {
      avatarCalls++; assert.equal(signal.aborted, false);
      for (const slot of walk(list).filter(n => n.attrs['data-avatar-account'])) {
        const img = new Node('img'); img.src = `https://example.com/${slot.attrs['data-avatar-account']}.png`; slot.append(img);
      }
    },
  });
  await find('Выбрать из базы').events.click();
  assert.equal(id('balance-database-list').children.length, 37);
  assert.equal(walk(id('balance-database-list')).filter(n => n.tag === 'img').length, 37);
  assert.ok(avatarCalls > 0);
  assert.ok(!root.textContent.includes('Показаны первые'));
  const search = id('balance-database-search'); search.value = '136'; search.events.input();
  assert.equal(id('balance-database-list').children.length, 1);
  assert.match(id('balance-database-list').textContent, /Участник 36/);
  assert.equal(walk(id('balance-database-list')).find(n => n.tag === 'img').src, 'https://example.com/136.png');
});

test('unavailable database avatars retain initials and do not prevent choosing a player', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  setup([]);
  renderBalancer(root, {
    getDatabaseMatches: async () => [{ players: [{ account_id: '123', nickname: 'Алексей' }] }],
    loadDatabaseAvatars: async () => { throw new Error('Steam unavailable'); },
  });
  await find('Выбрать из базы').events.click();
  assert.equal(walk(id('balance-database-list')).find(n => n.attrs['data-avatar-account'] === '123').textContent, 'АЛ');
  find('Выбрать').click(); assert.equal(id('balance-account').value, '123');
});

test('Immortal MMR can be entered, used in averages, cleared and retained across rank refresh without storing it', async () => {
  const { renderBalancer } = await import('../assets/balancer-view.js');
  const friends = fixture(); friends[0].rankTier = 80; const saved = setup(friends);
  renderBalancer(root, { getProfile: async account => ({ ...friends.find(p => p.id === account), updatedAt: Date.now() }) });
  assert.equal(id('balance-mmr-2'), undefined);
  let input = id('balance-mmr-1'); input.value = '9000'; input.events.change();
  assert.equal(saved()[0].manualMMR, undefined);
  await find('Собрать команды').events.click();
  assert.ok(root.textContent.includes('9 000 MMR (вручную)'));
  assert.ok(!root.textContent.includes('В составах есть Титан: для него взята'));
  assert.match(walk(root).find(n => n.className === 'balance-difference').textContent, /1\s476,6/);
  await find('Обновить ранги').events.click();
  assert.equal(id('balance-mmr-1').value, '9000');
  input = id('balance-mmr-1'); input.value = '1.5'; input.events.change();
  assert.match(root.textContent, /целый положительный MMR/);
  assert.equal(id('balance-mmr-1').value, '9000');
  input = id('balance-mmr-1'); input.value = ''; input.events.change();
  await find('Собрать команды').events.click();
  assert.match(root.textContent, /В составах есть Титан: для него взята/);
});
