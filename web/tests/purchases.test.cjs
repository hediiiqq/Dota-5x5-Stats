const { test } = require('node:test');
const assert = require('node:assert/strict');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this.text = ''; this.append(...children); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, callback) { this.events[name] = callback; }
  get firstChild() { return this.children[0]; }
}
const walk = root => [root, ...root.children.flatMap(walk)];
globalThis.document = { createElement: tag => new Node(tag) };
const match = { players: [
  { player_slot: 0, side: 'radiant', nickname: '<b>Игрок</b>', hero_name: 'Axe' },
  { player_slot: 128, side: 'dire', nickname: 'Другой', hero_name: 'Tusk' },
] };
const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });

test('purchase times include negative and zero seconds', async () => {
  const { purchaseTime } = await import('../assets/inventory.js');
  assert.equal(purchaseTime(-89), '−1:29');
  assert.equal(purchaseTime(0), '0:00');
  assert.equal(purchaseTime(3686), '61:26');
});

test('purchase table shows every player and groups purchases into five-minute columns', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  globalThis.fetch = async path => {
    assert.equal(path, '/api/matches/5/purchases');
    return reply({ available: true, players: [
      { player_slot: 128, purchases: [] },
      { player_slot: 0, purchases: [{ item_id: 999999, time: 98 }, { item_id: 44, time: -89 }, { item_id: 34, time: -89 }, { item_id: 44, time: -89 }] },
    ] });
  };
  const root = renderPurchases(match, '5', new AbortController().signal);
  await settle();
  const entries = walk(root).filter(node => node.className?.includes('purchase-entry'));
  assert.equal(entries.length, 4);
  assert.match(entries[0].textContent, /Tango/);
  assert.match(entries[1].textContent, /Magic Stick/);
  assert.match(entries[2].textContent, /Tango/);
  assert.match(entries[3].textContent, /Предмет #999999/);
  assert.match(entries[0].textContent, /−1:29/);
  assert.equal(walk(root).filter(node => node.className === 'purchase-player-row').length, 2);
  assert.ok(walk(root).some(node => node.tag === 'th' && node.textContent === '5′'));
  assert.match(root.textContent, /Нет записей о покупках/);
});

test('timeline bucket boundaries keep pregame and late purchases', async () => {
  const { purchaseBucket } = await import('../assets/inventory.js');
  assert.equal(purchaseBucket(-89), 0);
  assert.equal(purchaseBucket(0), 0);
  assert.equal(purchaseBucket(1), 1);
  assert.equal(purchaseBucket(300), 1);
  assert.equal(purchaseBucket(301), 2);
  assert.equal(purchaseBucket(3600), 12);
});

test('timeline adapts to typical match durations without excessive columns', async () => {
  const { purchaseScale } = await import('../assets/inventory.js');
  for (const [minutes, intervalMinutes, columns] of [[30, 5, 6], [45, 5, 9], [50, 5, 10], [51, 10, 6], [60, 10, 6], [70, 10, 7], [90, 10, 9], [120, 15, 8], [300, 30, 10]]) {
    assert.deepEqual(purchaseScale(minutes * 60), { intervalMinutes, columns });
  }
});

test('long matches display the whole game including purchases after an hour', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  globalThis.fetch = async () => reply({ available: true, players: [{ player_slot: 0, purchases: [
    { item_id: 44, time: -89 }, { item_id: 34, time: 3600 }, { item_id: 1, time: 3601 }, { item_id: 116, time: 5300 },
  ] }] });
  const root = renderPurchases({ ...match, duration: 5400 }, '1', new AbortController().signal);
  await settle();
  assert.equal(walk(root).find(node => node.tag === 'select'), undefined);
  const entries = walk(root).filter(node => node.tag === 'button' && node.className?.includes('purchase-entry'));
  assert.equal(entries.length, 4);
  assert.match(entries[2].textContent, /60:01/);
  assert.match(entries[3].textContent, /88:20/);
  assert.ok(walk(root).some(node => node.tag === 'th' && node.textContent === '90′'));
  assert.ok(walk(root).filter(node => node.className === 'purchase-column').length <= 11);
});

test('purchase history hides wards, TP scrolls and recipes without losing other purchases', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  const purchases = [42, 43, 218, 46, 35, 62, 217, 44, 34, 999999].map(item_id => ({ item_id, time: 20 }));
  globalThis.fetch = async () => reply({ available: true, players: [{ player_slot: 0, purchases }] });
  const root = renderPurchases(match, '1', new AbortController().signal);
  await settle();
  const entries = walk(root).filter(node => node.tag === 'button' && node.className?.includes('purchase-entry'));
  assert.equal(entries.length, 3);
  assert.match(entries[0].textContent, /Tango/);
  assert.match(entries[1].textContent, /Magic Stick/);
  assert.match(entries[2].textContent, /Предмет #999999/);
});

test('history consisting only of hidden purchases is labelled as filtered', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  globalThis.fetch = async () => reply({ available: true, players: [{ player_slot: 0, purchases: [{ item_id: 46, time: 0 }] }] });
  const root = renderPurchases(match, '1', new AbortController().signal);
  await settle();
  assert.match(root.textContent, /Нет покупок для отображения/);
});

test('item icons use generic recipe artwork and retry alternate CDN URLs before hiding', async () => {
  const { itemImageURLs } = await import('../assets/items.js');
  const { image } = await import('../assets/common.js');
  const urls = itemImageURLs(35);
  assert.match(urls[0], /\/items\/recipe\.png$/);
  assert.equal(itemImageURLs(999999).length, 0);
  const item = image(urls[0], 'test', '', 32, urls.slice(1));
  assert.equal(item.src, urls[0]);
  item.events.error();
  assert.equal(item.src, urls[1]);
  assert.notEqual(item.hidden, true);
  for (let index = 1; index < urls.length; index++) item.events.error();
  assert.equal(item.hidden, true);
});

test('match tabs expose only the selected panel and support keyboard navigation', async () => {
  const { renderMatchTabs } = await import('../assets/inventory.js');
  const panels = { overview: new Node('section'), purchases: new Node('section'), skills: new Node('section') };
  const changes = [];
  const root = renderMatchTabs(panels, 'overview', key => changes.push(key));
  const buttons = walk(root).filter(node => node.tag === 'button');
  assert.equal(panels.overview.hidden, false);
  assert.equal(panels.purchases.hidden, true);
  buttons[1].events.click();
  assert.equal(panels.overview.hidden, true);
  assert.equal(panels.purchases.hidden, false);
  assert.equal(buttons[1].attrs['aria-selected'], 'true');
  buttons[2].focus = () => {};
  buttons[1].events.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(panels.skills.hidden, false);
  assert.deepEqual(changes, ['overview', 'purchases', 'skills']);
});

test('skills and talents share chronological hero levels with gaps, as in the Spectre reference', async () => {
  const { renderSkillProgression, renderAbilitySequence } = await import('../assets/inventory.js');
  const upgrades = [5334,5336,5334,5335,5334,5337,5334,5336,5336,6900,5336,5337,5335,5335,8040,5335,5337,5993,6902];
  for (const root of [renderSkillProgression({ players: [{ hero_id:67, side:'radiant', ability_upgrades:upgrades }] }), renderAbilitySequence(upgrades, 67)]) {
    const grid = walk(root).find(node => node.className === 'ability-level-grid');
    assert.ok(grid);
    assert.equal(grid.children.length, 30);
    const entries = walk(grid).filter(node => node.className?.split(' ').includes('skill-event'));
    assert.deepEqual(entries.map(entry => entry.attrs['data-ability-id']), upgrades.map(String));
    assert.deepEqual(entries.map(entry => entry.attrs['data-level']), ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','18','20','25']);
    assert.equal(grid.children[16].attrs['data-level'], '17');
    assert.equal(grid.children[16].className, 'skill-level-gap');
    assert.equal(grid.children[9].className, 'skill-event skill-talent-event');
    assert.equal(grid.children[24].className, 'skill-event skill-talent-event');
    assert.match(root.textContent, /расчётные/i);
  }
});

test('unknown abilities keep their original order without inventing a hero level', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  const root = renderAbilitySequence([5007,999999,5007], 2);
  const entries = walk(root).filter(node => node.className?.split(' ').includes('skill-event'));
  assert.deepEqual(entries.map(entry => entry.attrs['data-ability-id']), ['5007','999999','5007']);
  assert.equal(entries[1].attrs['data-level'], '?');
});

test('all talent tiers and their second choices follow levels 10 through 30', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  const talents = [6997,1841,412,1724,6138,6282,6552,6998];
  const root = renderAbilitySequence(talents, 105);
  const entries = walk(root).filter(node => node.className?.split(' ').includes('skill-event'));
  assert.deepEqual(entries.map(entry => entry.attrs['data-level']), ['10','15','20','25','27','28','29','30']);
  assert.deepEqual(entries.map(entry => entry.attrs['data-ability-id']), talents.map(String));
});

test('a delayed talent stays after the preceding skills instead of moving back to its unlock tier', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  const upgrades = [5601,879,5601,886,5601,5599,5601,886,886,886,6997,879,5599,879,879,1841];
  const root = renderAbilitySequence(upgrades, 105);
  const entries = walk(root).filter(node => node.className?.split(' ').includes('skill-event'));
  assert.deepEqual(entries.map(entry => entry.attrs['data-level']), ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16']);
  assert.deepEqual(entries.filter(entry => entry.className.includes('skill-talent-event')).map(entry => entry.attrs['data-level']), ['11','16']);
});

test('unavailable and empty skill histories remain distinct', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  assert.match(renderAbilitySequence(null, 2).textContent, /недоступна/);
  assert.match(renderAbilitySequence([], 2).textContent, /Нет записей/);
});

test('granted and automatic abilities never consume a level or make later skill levels unknown', async () => {
  const { renderAbilitySequence, renderSkillProgression } = await import('../assets/inventory.js');
  const upgrades = [5007,419,5008,729,5007,944,5375,5008,5376,5007];
  for (const root of [renderAbilitySequence(upgrades, 2), renderSkillProgression({players:[{hero_id:2, side:'radiant', ability_upgrades:upgrades}]})]) {
    const grid = walk(root).find(node => node.className === 'ability-level-grid');
    const learned = walk(grid).filter(node => node.className?.split(' ').includes('skill-event'));
    assert.deepEqual(learned.map(entry => entry.attrs['data-ability-id']), ['5007','5008','5007','5008','5007']);
    assert.deepEqual(learned.map(entry => entry.attrs['data-level']), ['1','2','3','4','5']);
    const automatic = walk(root).find(node => node.className === 'ability-non-level');
    const grants = walk(automatic).filter(node => node.className?.split(' ').includes('skill-event'));
    assert.deepEqual(grants.map(entry => entry.attrs['data-ability-id']), ['419','729','944','5375','5376']);
    assert.deepEqual(grants.map(entry => entry.attrs['data-source']), ['scepter','shard','scepter','innate','automatic']);
    assert.ok(grants.every(entry => entry.attrs['data-level'] === '—'));
  }
});

test('heroes with more than four ability icons keep every learnable form and share paired ranks', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  const upgrades = [1498,1499,1500,1502,1503,1501,1504,1506];
  const root = renderAbilitySequence(upgrades, 145);
  const grid = walk(root).find(node => node.className === 'ability-level-grid');
  const entries = walk(grid).filter(node => node.className?.split(' ').includes('skill-event'));
  assert.deepEqual(entries.map(entry => entry.attrs['data-ability-id']), upgrades.map(String));
  assert.deepEqual(entries.map(entry => entry.attrs['data-level']), ['1','2','3','4','5','6','7','12']);
});

test('Wyvern fifth basic rank comes from Edda without consuming a hero level or hiding later skills', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  for (const id of [5651,5652,5653]) {
    const root = renderAbilitySequence([id,id,id,id,id,5654], 112);
    const grid = walk(root).find(node => node.className === 'ability-level-grid');
    const learned = walk(grid).filter(node => node.className?.split(' ').includes('skill-event'));
    assert.deepEqual(learned.map(entry => entry.attrs['data-level']), ['1','3','5','7','8']);
    const bonus = walk(root).find(node => node.attrs['data-source'] === 'eldwurms_edda');
    assert.ok(bonus);
    assert.equal(bonus.attrs['data-rank'], '5');
    assert.equal(bonus.attrs['data-level'], '—');
    assert.match(bonus.title, /Eldwurm/);
  }
  const invalid = renderAbilitySequence([5654,5654,5654,5654], 112);
  assert.ok(!walk(invalid).some(node => node.attrs['data-source'] === 'eldwurms_edda'), 'the book cannot raise the ultimate');
});

test('Edda cannot explain a sixth rank or a fifth rank of a second basic ability', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  const upgrades = [5651,5651,5651,5651,5651,5652,5652,5652,5652,5652];
  const entries = walk(renderAbilitySequence(upgrades,112)).filter(node => node.className?.split(' ').includes('skill-event'));
  assert.equal(entries.filter(entry => entry.attrs['data-source'] === 'eldwurms_edda').length,1);
  assert.equal(entries.at(-1).attrs['data-level'],'?');
  const sixth = walk(renderAbilitySequence([5651,5651,5651,5651,5651,5651],112)).filter(node => node.className?.split(' ').includes('skill-event'));
  assert.equal(sixth.at(-1).attrs['data-level'],'?');
});

test('Tree Throw and Break Tether retain their parent skill identity without advancing the level grid', async () => {
  const { renderAbilitySequence } = await import('../assets/inventory.js');
  for (const [hero, parent, action, slug] of [[19,5108,6937,'tiny_tree_grab'],[91,5485,5489,'wisp_tether']]) {
    const root = renderAbilitySequence([parent,action,parent],hero);
    const grid = walk(root).find(node => node.className === 'ability-level-grid');
    const learned = walk(grid).filter(node => node.className?.split(' ').includes('skill-event'));
    assert.deepEqual(learned.map(entry => entry.attrs['data-level']),['1','3']);
    const entry = walk(root).find(node => node.attrs['data-ability-id'] === String(action));
    assert.equal(entry.attrs['data-parent-ability'],slug);
    assert.equal(entry.attrs['data-level'],'—');
  }
});

test('missing metadata and unknown player history have separate states', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  globalThis.fetch = async () => reply({ available: false, players: [] });
  const unavailable = renderPurchases(match, '1', new AbortController().signal);
  await settle();
  assert.match(unavailable.textContent, /История покупок недоступна/);
  globalThis.fetch = async () => reply({ available: true, players: [{ player_slot: 0, purchases: null }] });
  const missing = renderPurchases(match, '1', new AbortController().signal);
  await settle();
  assert.match(missing.textContent, /Нет данных о покупках этого игрока/);
});

test('purchase request failure can be retried without reloading match', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw Error('offline');
    return reply({ available: true, players: [{ player_slot: 0, purchases: [] }] });
  };
  const root = renderPurchases(match, '1', new AbortController().signal);
  await settle();
  assert.match(root.textContent, /Не удалось загрузить покупки/);
  walk(root).find(node => node.tag === 'button' && node.textContent === 'Повторить').events.click();
  await settle();
  assert.equal(calls, 2);
  assert.match(root.textContent, /Нет записей о покупках/);
});

test('invalid purchase data produces a retryable error, not an empty history', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  globalThis.fetch = async () => reply({ available: true, players: [{ player_slot: 0, purchases: [{ item_id: 44, time: null }] }] });
  const root = renderPurchases(match, '1', new AbortController().signal);
  await settle();
  assert.match(root.textContent, /Не удалось загрузить покупки/);
  assert.ok(walk(root).some(node => node.tag === 'button' && node.textContent === 'Повторить'));
});

test('leaving the page prevents a pending purchase response from updating the panel', async () => {
  const { renderPurchases } = await import('../assets/inventory.js');
  let resolve;
  globalThis.fetch = () => new Promise(done => { resolve = done; });
  const controller = new AbortController();
  const root = renderPurchases(match, '1', controller.signal);
  controller.abort();
  resolve(reply({ available: true, players: [{ player_slot: 0, purchases: [] }] }));
  await settle();
  assert.doesNotMatch(root.textContent, /Нет записей о покупках/);
});
