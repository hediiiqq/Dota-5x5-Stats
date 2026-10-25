const { test } = require('node:test');
const assert = require('node:assert/strict');
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.text = ''; this.append(...children); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(name, callback) { this.events[name] = callback; }
}
globalThis.document = { createElement: tag => new Node(tag) };
const walk = node => [node, ...node.children.flatMap(walk)];
const hasClass = (node, name) => node.className?.split(' ').includes(name);
const players = [
  { side: 'radiant', nickname: 'One', hero_id: 1, kills: 5, ability_upgrades: [5004, 6997, 999999, 5004] },
  { side: 'radiant', nickname: 'Two', hero_id: 2, kills: 2, ability_upgrades: null },
  { side: 'dire', nickname: 'Three', hero_id: 3, kills: 1, ability_upgrades: [] },
];
test('overview cards show the complete skill order beside equipment without inventing times or levels', async () => {
  const { renderOverview } = await import('../assets/scoreboard.js');
  const root = renderOverview({ players }, new Map());
  const cards = walk(root).filter(node => hasClass(node, 'hero-card'));
  const loadout = walk(cards[0]).find(node => hasClass(node, 'card-loadout'));
  assert.ok(loadout);
  assert.ok(loadout.children.some(node => hasClass(node, 'inventory')));
  const order = walk(loadout).find(node => hasClass(node, 'ability-sequence'));
  assert.equal(walk(order).filter(node => hasClass(node, 'skill-event')).length, 4);
  const timeline = walk(order).find(node => hasClass(node, 'ability-level-grid'));
  assert.ok(timeline, 'skills and talents share one hero-level grid');
  assert.equal(walk(order).filter(node => hasClass(node, 'skill-talent-event')).length, 1);
  assert.ok(walk(order).some(node => node.title?.includes('запись 2')));
  assert.ok(!walk(root).some(node => hasClass(node, 'selected-player')));
  assert.ok(!walk(root).some(node => node.attrs['aria-controls'] === 'selected-player'));
  assert.ok(!walk(cards[0]).some(node => node.tag === 'button'));
  assert.match(order.textContent, /Порядок изучения/);
  assert.ok(walk(order).some(node => node.title?.includes('Способность #999999')));
  assert.match(cards[1].textContent, /История прокачки недоступна/);
  assert.match(cards[2].textContent, /Нет записей о прокачке/);
});
test('scoreboard groups hero and identity and keeps each team total below its players after sorting', async () => {
  const { renderScoreboard } = await import('../assets/scoreboard.js');
  const root = renderScoreboard({ players }, new Map());
  const rows = walk(root).filter(node => hasClass(node, 'score-player-row'));
  assert.equal(rows[0].children.length, 10);
  assert.ok(walk(rows[0].children[0]).some(node => hasClass(node, 'hero-portrait')));
  assert.match(rows[0].children[0].textContent, /One/);
  const team = walk(root).find(node => hasClass(node, 'score-side') && hasClass(node, 'radiant'));
  assert.ok(hasClass(team.children.at(-1), 'score-total'));
  const kills = walk(root).find(node => node.attrs['aria-label']?.startsWith('Убийства: сортировать'));
  kills.events.click();
  assert.match(team.children[1].textContent, /Two/);
  assert.ok(hasClass(team.children.at(-1), 'score-total'));
});
