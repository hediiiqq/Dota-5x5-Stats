const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this.text = ''; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(key, callback) { this.events[key] = callback; }
  focus() {}
  get firstChild() { return this.children[0]; }
}
globalThis.document = { createElement: tag => new Node(tag) };
const walk = root => [root, ...root.children.flatMap(walk)];
const byClass = (root, name) => walk(root).filter(node => node.className?.split(' ').includes(name));
const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
const match = { id: '5', dota_match_id: '9040846950', duration: 120, players: [
  { player_slot: 0, side: 'radiant', hero_name: 'Axe', nickname: '<b>Игрок</b>' },
  { player_slot: 1, side: 'radiant', hero_name: 'Tusk', nickname: 'Второй' },
  { player_slot: 128, side: 'dire', hero_name: 'Lina', nickname: 'Соперник' },
] };
const snapshot = (time, extra = {}) => ({ game_time: time, item_ids: [42, 46, 35, 999999, 42], backpack_item_ids: [], neutral_item_id: null, neutral_enhancement_id: -1, kills: 0, deaths: null, assists: 3, level: 1, last_hits: 0, denies: null, flags: 0, ...extra });
const response = () => ({ match_id: '5', dota_match_id: '9040846950', available: true, players: [
  { player_slot: 0, snapshots: [snapshot(-60), snapshot(30, { level: 3, flags: 2 })] },
  { player_slot: 1, snapshots: [] },
  { player_slot: 128, snapshots: [snapshot(10)] },
] });

test('snapshot lookup uses actual time, preserves duplicates and never invents a future snapshot', async () => {
  const { inventorySnapshotAt } = await import('../assets/inventory.js');
  const rows = [snapshot(-60), snapshot(29), snapshot(29, { level: 4 }), snapshot(61)];
  assert.equal(inventorySnapshotAt(rows, -61), null);
  assert.equal(inventorySnapshotAt(rows, 0), rows[0]);
  assert.equal(inventorySnapshotAt(rows, 30), rows[2]);
  assert.equal(inventorySnapshotAt(rows, 500), rows[3]);
  assert.equal(inventorySnapshotAt([], 0), null);
});

test('inventory API validation checks identity, duplicate/unknown slots, times and nullable counts', async () => {
  const { inventoryRecords } = await import('../assets/inventory.js');
  const source = response(); source.players[0].snapshots.reverse();
  assert.equal(inventoryRecords(source, match, '5').get(0)[0].game_time, -60);
  assert.equal(source.players[0].snapshots[0].game_time, 30);
  for (const mutate of [
    value => { value.match_id = '6'; },
    value => { value.dota_match_id = '4'; },
    value => { value.players.push(value.players[0]); },
    value => { value.players[0].player_slot = 99; },
    value => { value.players[0].snapshots[0].game_time = null; },
    value => { value.players[0].snapshots[0].kills = -1; },
    value => { value.players[0].snapshots[0].item_ids = null; },
  ]) { const value = response(); mutate(value); assert.throws(() => inventoryRecords(value, match, '5')); }
});

test('timeline supports pair, single player, clearing and switching without resetting time or refetching', async () => {
  const { renderInventoryTimeline } = await import('../assets/inventory.js');
  let calls = 0;
  globalThis.fetch = async path => { calls++; assert.equal(path, '/api/matches/5/inventory'); return reply(response()); };
  const root = renderInventoryTimeline(match, '5', new AbortController().signal);
  await settle();
  assert.equal(byClass(root, 'snapshot-player').length, 2);
  assert.match(root.textContent, /До первого снимка/);
  const slider = walk(root).find(node => node.type === 'range');
  assert.equal(slider.min, '-60'); assert.equal(slider.max, '120');
  slider.value = '45'; slider.events.input();
  assert.match(root.textContent, /Снимок на 0:30/);
  assert.match(root.textContent, /Снимок на 0:10/);
  const picks = byClass(root, 'snapshot-pick');
  picks.find(node => node.attrs['data-player-slot'] === '128').events.click();
  assert.equal(byClass(root, 'snapshot-player').length, 1);
  picks.find(node => node.attrs['data-player-slot'] === '1').events.click();
  assert.equal(slider.value, '45');
  assert.match(root.textContent, /Нет снимков игрока/);
  picks.find(node => node.attrs['data-player-slot'] === '1').events.click();
  assert.match(root.textContent, /Выберите игрока/);
  assert.equal(calls, 1);
});

test('snapshot shows unfiltered repeated items, neutral unknowns, flags and zero versus missing metrics', async () => {
  const { renderInventoryTimeline } = await import('../assets/inventory.js');
  globalThis.fetch = async () => reply(response());
  const root = renderInventoryTimeline(match, '5', new AbortController().signal);
  await settle();
  const card = byClass(root, 'snapshot-player')[0];
  const titles = walk(card).map(node => node.attrs['aria-label'] || '').join('|');
  assert.match(titles, /Observer Ward/); assert.match(titles, /Town Portal Scroll/);
  assert.match(titles, /Recipe/); assert.match(titles, /Предмет #999999/);
  assert.equal(walk(card).filter(node => node.title?.includes('Observer Ward')).length, 2);
  assert.match(card.textContent, /Убийства0/); assert.match(card.textContent, /Смерти—/);
  assert.equal(byClass(card, 'aghanim-absent').length, 2);
  assert.equal(byClass(card, 'aghanim-image').length, 2);
  const slider = walk(root).find(node => node.type === 'range'); slider.value = '40'; slider.events.input();
  assert.ok(byClass(root, 'aghanim-permanent').some(node => node.title.includes('Shard')));
  slider.value = '120'; slider.events.input();
  assert.match(root.textContent, /Последний доступный снимок/);
});

test('unavailable data, invalid response and retry have distinct states', async () => {
  const { renderInventoryTimeline } = await import('../assets/inventory.js');
  globalThis.fetch = async () => reply({ ...response(), available: false, players: [] });
  const unavailable = renderInventoryTimeline(match, '5', new AbortController().signal); await settle();
  assert.match(unavailable.textContent, /Снимки инвентаря недоступны/);
  let calls = 0;
  globalThis.fetch = async () => { if (++calls === 1) throw Error('offline'); return reply(response()); };
  const root = renderInventoryTimeline(match, '5', new AbortController().signal); await settle();
  assert.match(root.textContent, /Не удалось загрузить инвентарь/);
  walk(root).find(node => node.textContent === 'Повторить').events.click(); await settle();
  assert.equal(byClass(root, 'snapshot-player').length, 2);
  globalThis.fetch = async () => reply({ ...response(), match_id: '999' });
  const invalid = renderInventoryTimeline(match, '5', new AbortController().signal); await settle();
  assert.match(invalid.textContent, /Не удалось загрузить инвентарь/);
});

test('Roshan Scepter and Shard variants count as owned even before snapshot flags are set', async () => {
  const { renderInventoryTimeline } = await import('../assets/inventory.js');
  const value = response();
  value.players[0].snapshots = [snapshot(0, { item_ids: [727], backpack_item_ids: [725], flags: 0 })];
  globalThis.fetch = async () => reply(value);
  const root = renderInventoryTimeline(match, '5', new AbortController().signal); await settle();
  const card = byClass(root, 'snapshot-player')[0];
  assert.equal(byClass(card, 'aghanim-item').length, 2);
});

test('snapshot Aghanims use snapshot flags and distinguish a carried Scepter from an active upgrade', async () => {
  const { snapshotAghanimState } = await import('../assets/inventory.js');
  assert.equal(snapshotAghanimState(snapshot(0, { item_ids: [108] })).scepter.state, 'active');
  assert.equal(snapshotAghanimState(snapshot(0, { item_ids: [], backpack_item_ids: [108] })).scepter.state, 'backpack');
  assert.equal(snapshotAghanimState(snapshot(0, { flags: 3 })).scepter.state, 'permanent');
  assert.equal(snapshotAghanimState(snapshot(0, { flags: 3 })).shard.state, 'permanent');
  assert.equal(snapshotAghanimState(snapshot(0, { flags: null })).shard.state, 'unknown');
  assert.equal(snapshotAghanimState(snapshot(0)).shard.state, 'absent');
});

test('net worth uses its own timestamped series, is optional and never borrows final match value', async () => {
  const { renderInventoryTimeline } = await import('../assets/inventory.js');
  const value = response();
  value.players[0].net_worth = [{ game_time: 0, value: 600 }, { game_time: 60, value: 1500 }];
  const withFinalStats = { ...match, players: match.players.map(player => ({ ...player, net_worth: 99999 })) };
  globalThis.fetch = async () => reply(value);
  const root = renderInventoryTimeline(withFinalStats, '5', new AbortController().signal); await settle();
  assert.match(byClass(root, 'snapshot-worth')[0].textContent, /600/);
  const slider = walk(root).find(node => node.type === 'range');
  slider.value = '-1'; slider.events.input();
  assert.match(byClass(root, 'snapshot-worth')[0].textContent, /—/);
  slider.value = '80'; slider.events.input();
  assert.match(byClass(root, 'snapshot-worth')[0].textContent.replace(/\s/g, ''), /1500/);
  assert.match(byClass(root, 'snapshot-worth')[0].textContent, /1:00/);
  assert.doesNotMatch(root.textContent, /99999/);
  assert.match(byClass(root, 'snapshot-worth')[1].textContent, /Нет данных ОЦ/);
});

test('optional net worth validation rejects missing timestamps or invalid gold values', async () => {
  const { inventoryRecords } = await import('../assets/inventory.js');
  for (const series of [[{ game_time: null, value: 500 }], [{ game_time: 0, value: -1 }], [{ game_time: 0, value: null }], [59.6, 72.4]]) {
    const value = response(); value.players[0].net_worth = series;
    assert.throws(() => inventoryRecords(value, match, '5'));
  }
});

test('aborted request never updates inventory', async () => {
  const { renderInventoryTimeline } = await import('../assets/inventory.js');
  let resolve; globalThis.fetch = () => new Promise(done => { resolve = done; });
  const controller = new AbortController();
  const root = renderInventoryTimeline(match, '5', controller.signal);
  controller.abort(); resolve(reply(response())); await settle();
  assert.equal(byClass(root, 'snapshot-player').length, 0);
});

test('six match tabs include records and keyboard wraps across all tabs', async () => {
  const { renderMatchTabs } = await import('../assets/inventory.js');
  const panels = Object.fromEntries(['overview', 'graphs', 'records', 'purchases', 'inventory', 'skills'].map(key => [key, new Node('section')]));
  const root = renderMatchTabs(panels);
  const buttons = walk(root).filter(node => node.tag === 'button');
  assert.equal(buttons.length, 6);
  const key = name => ({ key: name, preventDefault() {} });
  buttons[0].events.keydown(key('End')); assert.equal(panels.skills.hidden, false);
  buttons[5].events.keydown(key('ArrowRight')); assert.equal(panels.overview.hidden, false);
  buttons[1].events.keydown(key('ArrowRight')); assert.equal(panels.records.hidden, false);
  buttons[3].events.keydown(key('ArrowRight')); assert.equal(panels.inventory.hidden, false);
  assert.match(fs.readFileSync(require.resolve('../match.html'), 'utf8'), /id="section-inventory"/);
});
