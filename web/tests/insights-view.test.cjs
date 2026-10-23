const { test } = require('node:test');
const assert = require('node:assert/strict');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set value(value) { this.selected = String(value); }
  get value() { return this.selected ?? (this.tag === 'select' ? this.children[0]?.value : '') ?? ''; }
  append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.text = ''; this.append(...children); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(name, callback) { this.events[name] = callback; }
  click() { if (!this.disabled) this.events.click?.(); }
}
const walk = root => [root, ...root.children.flatMap(walk)];
const saved = { value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
globalThis.document = { createElement: tag => new Node(tag) };
globalThis.localStorage = saved;

test('all five analytics screens render with real aggregations and sortable tables', async () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const { join } = require('node:path');
  const common = readFileSync(join(__dirname, '../assets/common.js'), 'utf8').replace(/^export /gm, '');
  const history = readFileSync(join(__dirname, '../assets/history.js'), 'utf8');
  const ui = runInNewContext(`${common}\nconst percentage = (w, n) => n ? String(w / n * 100) : '—';\n${history.slice(history.indexOf('function statisticCard'), history.indexOf('function playerLink')).replace(/^export /gm, '')}\n({ statsTable, sortedValue, rateCell });`, { document });
  const { element } = await import('../assets/common.js');
  ui.playerLink = row => element('a', '', row.name);
  ui.renderMatch = match => element('li', '', `Match ${match.id}`);
  const { renderInsights } = await import('../assets/insights-view.js');
  const matches = [{ id: '1', duration: 1800, started_at: '2026-10-20T18:00:00Z', winner: 'radiant', players: [
    { account_id: '1', nickname: 'One', side: 'radiant', hero_id: 1, hero_name: 'Anti-Mage', kills: 4 },
    { account_id: '2', nickname: 'Two', side: 'dire', hero_id: 2, hero_name: 'Axe', kills: 2 },
  ] }];
  const data = { players: new Map([['1', { id: '1', name: 'One' }], ['2', { id: '2', name: 'Two' }]]), heroes: new Map([[1, { hero_id: 1, name: 'Anti-Mage' }]]) };
  for (const section of ['compare', 'rivals', 'records', 'evening', 'favorites']) {
    globalThis.location = { search: `?view=insights&section=${section}` };
    const root = element('div'); renderInsights(matches, data, root, ui);
    assert.ok(root.children.length >= 2, section);
    assert.match(root.textContent, /СравнениеПротивостоянияРекордыИтоги дняИзбранное/);
    assert.ok(!walk(root).some(node => node.tag === 'a' && node.href?.includes('section=duration')));
    if (section !== 'favorites') assert.ok(walk(root).some(node => node.tag === 'table') || section === 'records');
    if (section === 'evening') assert.match(root.children.at(-1).textContent, /^Герои дня/);
  }
});

test('daily calendar marks days with matches and opens their summaries', async () => {
  const { renderMatchCalendar } = await import('../assets/insights-view.js');
  const root = renderMatchCalendar([
    { started_at: '2026-10-20T12:00:00' },
    { started_at: '2026-10-20T20:00:00' },
    { started_at: '2026-11-02T12:00:00' },
    { started_at: null }, { started_at: 'invalid' },
  ], '2026-10-20');
  let active = walk(root).filter(node => node.className?.includes('calendar-has-matches'));
  assert.equal(active.length, 1);
  assert.equal(active[0].href, '/?view=insights&section=evening&day=2026-10-20');
  assert.equal(active[0].attrs['aria-current'], 'date');
  assert.match(active[0].attrs['aria-label'], /матчей: 2/);
  assert.equal(walk(root).filter(node => node.tag === 'a').length, 31);
  walk(root).find(node => node.attrs['aria-label'] === 'Следующий месяц').click();
  active = walk(root).filter(node => node.className?.includes('calendar-has-matches'));
  assert.equal(active.length, 1);
  assert.equal(active[0].href, '/?view=insights&section=evening&day=2026-11-02');
  assert.equal(walk(root).filter(node => node.tag === 'a').length, 30);
});

test('daily calendar supports leap days and ignores invalid selected dates', async () => {
  const { renderMatchCalendar } = await import('../assets/insights-view.js');
  const root = renderMatchCalendar([{ started_at: '2024-02-29T12:00:00' }], '2024-02-31');
  assert.equal(walk(root).filter(node => node.tag === 'a').length, 29);
  assert.ok(walk(root).some(node => node.attrs['aria-current'] === 'date' && node.href.endsWith('2024-02-29')));
});

test('comparison calendars mark match dates and select a range without leaving comparison', async () => {
  const { renderInsights } = await import('../assets/insights-view.js');
  const { element } = await import('../assets/common.js');
  globalThis.location = { search: '?view=insights&section=compare&account_id=1&other_id=2' };
  const root = element('div');
  renderInsights([{ started_at: '2026-10-20T12:00:00', players: [] }], { players: new Map([['1', { id: '1', name: 'One' }], ['2', { id: '2', name: 'Two' }]]), heroes: new Map() }, root, {
    statsTable: title => element('section', '', title), sortedValue: value => value, rateCell: () => '—',
  });
  const from = walk(root).find(node => node.name === 'from');
  const to = walk(root).find(node => node.name === 'to');
  assert.equal(from.type, 'hidden'); assert.equal(to.type, 'hidden');
  assert.equal(walk(root).filter(node => node.className === 'panel match-calendar').length, 2);
  const days = walk(root).filter(node => node.tag === 'button' && node.className?.includes('calendar-has-matches'));
  days[0].click(); days[1].click();
  assert.equal(from.value, '2026-10-20'); assert.equal(to.value, '2026-10-20');
  assert.equal(walk(root).find(node => node.name === 'account_id').value, '1');
  assert.equal(walk(root).find(node => node.name === 'other_id').value, '2');
  walk(root).find(node => node.tag === 'button' && node.textContent === 'Сбросить дату').click();
  assert.equal(from.value, ''); assert.equal(to.value, '2026-10-20');
});

test('rivals reuse the searchable player picker and preserve the minimum games filter', async () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const { join } = require('node:path');
  const { element, number, steamProfileURL } = await import('../assets/common.js');
  const { renderInsights } = await import('../assets/insights-view.js');
  const source = readFileSync(join(__dirname, '../assets/history.js'), 'utf8');
  const params = new URLSearchParams('view=insights&section=rivals&account_id=1&min_games=3');
  const picker = runInNewContext(`${source.slice(source.indexOf('function renderPlayerChoice'), source.indexOf('function minimumGames'))}\nrenderPlayerChoice;`, {
    document, element, number, steamProfileURL, params, view: 'insights',
    ranked: players => [...players.values()], percentage: () => '50%', playerAvatar: () => element('span'),
    compareStatisticsValues: (a, b, descending) => descending ? b - a : a - b,
    loadStatsAvatars: async () => {}, controller: new AbortController(),
  });
  const data = { players: new Map([
    ['1', { id: '1', name: 'One', count: 4, wins: 2, decided: 4 }],
    ['2', { id: '2', name: 'Two', count: 3, wins: 1, decided: 3 }],
  ]), heroes: new Map() };
  globalThis.location = { search: `?${params}` };
  const root = element('div');
  renderInsights([], data, root, {
    choosePlayer: host => picker(data, host, { playerURL: id => `/?view=insights&section=rivals&account_id=${id}&min_games=3` }),
    statsTable: title => element('section', '', title), sortedValue: value => value, playerLink: row => element('a', '', row.name), rateCell: () => '—',
  });
  assert.match(root.textContent, /Противостояния · One/);
  const search = walk(root).find(node => node.type === 'search');
  search.value = '2'; search.events.input();
  const choices = walk(root).filter(node => node.className === 'player-choice');
  assert.equal(choices.length, 1);
  assert.equal(choices[0].href, '/?view=insights&section=rivals&account_id=2&min_games=3');
  assert.equal(walk(root).find(node => node.name === 'account_id').value, '1');
});

test('note editor retains unsaved text on failure and renders notes without interpreting markup', async () => {
  const { favoriteEditor } = await import('../assets/favorites.js');
  saved.value = null;
  const root = favoriteEditor('1'), nodes = walk(root);
  const input = nodes.find(node => node.tag === 'textarea');
  input.value = '<img src=x onerror=alert(1)>';
  nodes.find(node => node.tag === 'button' && node.textContent === 'Сохранить в избранное').click();
  assert.match(root.textContent, /сохранены/);
  const original = saved.setItem; saved.setItem = () => { throw Error('quota'); };
  input.value = 'unsaved'; nodes.find(node => node.tag === 'button').click();
  assert.match(root.textContent, /Не удалось сохранить/); assert.equal(input.value, 'unsaved');
  saved.setItem = original;
});

test('record cards omit tie counts and explain incomplete metrics while retaining all tied players', async () => {
  const { renderInsights } = await import('../assets/insights-view.js');
  const { element } = await import('../assets/common.js');
  globalThis.location = { search: '?view=insights&section=records' };
  const root = element('div');
  const player = { account_id: '1', nickname: 'One', side: 'radiant', kills: 10, gold_per_min: 800, xp_per_min: 900, net_worth: 30000, hero_healing: 1000, hero_damage: 30000 };
  renderInsights([{ id: '1', duration: 1800, players: [player, { ...player, account_id: '2', nickname: 'Two' }] }], { players: new Map(), heroes: new Map() }, root, {
    playerLink: row => element('a', '', row.name),
  });
  assert.doesNotMatch(root.textContent, /Совпадений рекорда/);
  const notes = walk(root).filter(node => node.className === 'record-data-note muted small');
  assert.equal(notes.length, 5);
  for (const note of notes) assert.match(note.textContent, /часть информации о матчах отсутствует/);
  const kills = walk(root).find(node => node.className === 'panel insight-record' && node.children[0].textContent === 'Рекорд убийств');
  assert.match(kills.textContent, /One/); assert.match(kills.textContent, /Two/);
});

test('comparison has two independent searchable pickers that preserve the range and hero filters', async () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const { join } = require('node:path');
  const { element, number, steamProfileURL } = await import('../assets/common.js');
  const { renderInsights } = await import('../assets/insights-view.js');
  const source = readFileSync(join(__dirname, '../assets/history.js'), 'utf8');
  const params = new URLSearchParams('view=insights&section=compare&account_id=1&other_id=2&hero_id=1&from=2026-10-01&to=2026-10-31');
  const picker = runInNewContext(`${source.slice(source.indexOf('function renderPlayerChoice'), source.indexOf('function minimumGames'))}\nrenderPlayerChoice;`, {
    document, element, number, steamProfileURL, params, view: 'insights',
    ranked: players => [...players.values()], percentage: () => '50%', playerAvatar: () => element('span'),
    compareStatisticsValues: (a, b, descending) => descending ? b - a : a - b,
    loadStatsAvatars: async () => {}, controller: new AbortController(),
  });
  const data = { players: new Map([
    ['1', { id: '1', name: 'One', count: 4, wins: 2, decided: 4 }],
    ['2', { id: '2', name: 'Two', count: 3, wins: 1, decided: 3 }],
  ]), heroes: new Map([[1, { hero_id: 1, name: 'Axe' }]]) };
  globalThis.location = { search: `?${params}` };
  const root = element('div');
  renderInsights([], data, root, {
    chooseComparisonPlayer: (host, options) => picker(data, host, options),
    statsTable: title => element('section', '', title), sortedValue: value => value, rateCell: () => '—',
  });
  const hosts = walk(root).filter(node => node.className === 'comparison-picker');
  assert.equal(hosts.length, 2);
  const leftSearch = walk(hosts[0]).find(node => node.type === 'search');
  const rightSearch = walk(hosts[1]).find(node => node.type === 'search');
  assert.notEqual(leftSearch.id, rightSearch.id);
  leftSearch.value = 'Two'; leftSearch.events.input();
  walk(hosts[0]).find(node => node.className === 'player-choice').click();
  assert.equal(walk(root).find(node => node.name === 'account_id').value, '2');
  assert.equal(walk(root).find(node => node.name === 'other_id').value, '2');
  rightSearch.value = 'One'; rightSearch.events.input();
  walk(hosts[1]).find(node => node.className === 'player-choice').click();
  assert.equal(walk(root).find(node => node.name === 'other_id').value, '1');
  assert.equal(walk(root).find(node => node.name === 'from').value, '2026-10-01');
  assert.equal(walk(root).find(node => node.name === 'to').value, '2026-10-31');
  assert.equal(walk(root).find(node => node.name === 'hero_id').value, '1');
});

test('team skill tables label columns as learning steps and preserve unknown abilities', async () => {
  const { renderTeamAbilityBuild } = await import('../assets/inventory.js');
  const root = renderTeamAbilityBuild([{ nickname: 'One', hero_id: 1, ability_upgrades: [5004, 999999] }, { hero_id: 2, ability_upgrades: null }], 'Radiant');
  assert.match(root.textContent, /не уровни героя/);
  assert.ok(walk(root).some(node => node.attrs['aria-label'] === 'Шаг 2: Способность #999999'));
  assert.match(root.textContent, /Нет записей о прокачке/);
});

test('favorites list immediately reflects note edits and removal without reloading', async () => {
  const { renderInsights } = await import('../assets/insights-view.js');
  const { favoriteEditor } = await import('../assets/favorites.js');
  saved.value = JSON.stringify({ '1': { note: 'before' } });
  globalThis.location = { search: '?view=insights&section=favorites' };
  const root = new Node('div');
  renderInsights([{ id: '1' }], { players: new Map() }, root, {
    renderMatch(match, options = {}) { const row = new Node('li'); row.append(favoriteEditor(match.id, options.onFavoriteChange)); return row; },
  });
  let nodes = walk(root);
  nodes.find(node => node.tag === 'textarea').value = 'after';
  nodes.find(node => node.tag === 'button' && node.textContent === 'Сохранить в избранное').click();
  assert.equal(walk(root).find(node => node.className === 'favorite-saved-note').textContent, 'after');
  nodes = walk(root);
  nodes.find(node => node.tag === 'button' && node.textContent === 'Убрать из избранного').click();
  assert.match(root.textContent, /Избранных матчей пока нет/);
  assert.equal(walk(root).some(node => node.tag === 'textarea'), false);
});
