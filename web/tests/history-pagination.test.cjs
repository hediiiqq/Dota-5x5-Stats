const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const read = name => readFileSync(join(__dirname, '../assets', name), 'utf8');
class Node {
  constructor() { this.children = []; this.events = {}; this.attrs = {}; }
  get firstChild() { return this.children[0]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, fn) { this.events[key] = fn; }
}
async function openPage(search = '', saved = null, blockedStorage = false, length = 1) {
  const nodes = new Map();
  const requests = [], navigation = [], writes = [], canonical = [];
  const storage = {
    getItem() { if (blockedStorage) throw Error('blocked'); return saved; },
    setItem(key, value) { if (blockedStorage) throw Error('blocked'); writes.push([key, value]); },
  };
  const context = {
    URLSearchParams, URL, AbortController,
    location: { search, assign: url => navigation.push(url) },
    history: { replaceState: (_, __, url) => canonical.push(url) },
    localStorage: storage,
    document: {
      querySelector: key => { if (!nodes.has(key)) nodes.set(key, new Node()); return nodes.get(key); },
      createElement: () => new Node(),
    },
    addEventListener() {}, favoriteEditor: () => new Node(),
    fetch: async url => {
      requests.push(url);
      return { ok: true, text: async () => JSON.stringify(Array.from({ length }, (_, i) => ({ id: String(i + 1) }))) };
    },
  };
  const common = read('common.js').replace(/^export /gm, '');
  const history = read('history.js').split('const excludedItems')[0].replace(/^import .*;\r?$/gm, '');
  await runInNewContext(`${common}\n${history}\nload();`, context);
  return { nodes, requests, navigation, writes, canonical, context };
}

test('all page sizes drive API requests, next links and match return context', async () => {
  for (const size of [5, 10, 15, 20, 50, 100]) {
    const page = await openPage(`?limit=${size}&offset=${size}`, null, false, size);
    assert.equal(page.requests[0], `/api/matches?limit=${size}&offset=${size}`);
    assert.equal(page.nodes.get('#page-size').value, String(size));
    assert.equal(page.nodes.get('#next').href, `/?limit=${size}&offset=${size * 2}`);
    assert.equal(page.nodes.get('#previous').href, `/?limit=${size}`);
    assert.equal(page.nodes.get('#page-number').textContent, 'Страница 2');
    const card = page.nodes.get('#matches').children[0].children[0];
    assert.equal(card.children.at(-1).children[0].href, `/match?id=1&offset=${size}&limit=${size}`);
  }
});

test('saved preference is restored, URL wins and changing size resets pagination', async () => {
  const saved = await openPage('', '50');
  assert.equal(saved.requests[0], '/api/matches?limit=50&offset=0');
  const page = await openPage('?limit=10&offset=40', '50');
  assert.equal(page.requests[0], '/api/matches?limit=10&offset=40');
  page.nodes.get('#page-size').value = '100';
  page.nodes.get('#page-size').events.change();
  assert.equal(page.navigation.at(-1), '/?limit=100');
  assert.equal(page.writes.at(-1)[1], '100');
});

test('invalid preferences and unavailable browser storage fall back safely', async () => {
  for (const value of ['7', '0', '-5', 'Infinity', '10.5', '010', '']) {
    const page = await openPage(`?limit=${value}`, value);
    assert.equal(page.requests[0], '/api/matches?limit=5&offset=0');
  }
  const blocked = await openPage('', null, true);
  assert.equal(blocked.requests[0], '/api/matches?limit=5&offset=0');
  blocked.nodes.get('#page-size').value = '20';
  blocked.nodes.get('#page-size').events.change();
  assert.equal(blocked.navigation.at(-1), '/?limit=20');
});

test('short and empty pages keep previous navigation and disable next', async () => {
  for (const length of [0, 3]) {
    const page = await openPage('?limit=20&offset=40', null, false, length);
    assert.equal(page.nodes.get('#previous').href, '/?limit=20&offset=20');
    assert.equal(page.nodes.get('#next').attrs['aria-disabled'], 'true');
  }
});

test('match back link preserves explicit page size despite another saved preference', async () => {
  const page = await openPage('', '100');
  page.context.location.search = '?id=1&offset=30&limit=15';
  const source = read('match.js').split('const status =')[0].replace(/^import .*;\r?$/gm, '');
  runInNewContext(`{ ${source} }`, page.context);
  assert.equal(page.nodes.get('#back').href, '/?limit=15&offset=30');
});
