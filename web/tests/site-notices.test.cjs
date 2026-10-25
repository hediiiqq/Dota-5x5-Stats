const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {runInNewContext} = require('node:vm');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.hidden = true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  set textContent(text) { this.text = text; }
  get textContent() { return this.text || this.children.map(child => child.textContent).join(' '); }
  addEventListener(name, fn) { this.events[name] = fn; }
}

function fixture(handler) {
  const events = {}, requests = [];
  const context = {
    AbortController, setTimeout, clearTimeout,
    document: { visibilityState: 'visible', createElement: tag => new Element(tag) },
    addEventListener: (name, fn) => { events[name] = fn; },
    fetch: async (url, options) => {
      requests.push({url, options});
      const result = await handler();
      return {ok: result.status === 200, json: async () => result.data};
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../assets/common.js'), 'utf8').replace(/^export /gm, '');
  runInNewContext(`${source}\nthis.api = {noticeItems, mountSiteNotices};`, context);
  return {...context.api, events, requests};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('public notices validate IDs and text, reject duplicates and sort without numeric rounding', () => {
  const {noticeItems} = fixture(() => ({}));
  const items = noticeItems({items: [{id:'2',text:'Two'}, {id:'9223372036854775807',text:'Max ID'}, {id:'10',text:'Ten'}]});
  assert.equal(items.map(item => item.id).join(','), '9223372036854775807,10,2');
  for (const payload of [null, {items:null}, {items:[{id:1,text:'Numeric'}]}, {items:[{id:'0',text:'Zero'}]},
    {items:[{id:'9223372036854775808',text:'Overflow'}]}, {items:[{id:'1',text:' '}]},
    {items:[{id:'1',text:'я'.repeat(501)}]}, {items:[{id:'1',text:'a'},{id:'1',text:'b'}]}]) {
    assert.throws(() => noticeItems(payload));
  }
});

test('public notices render text safely and hide the entire region for an empty list', async () => {
  let items = [{id:'1',text:'<script>alert(1)</script> — 26.10.2026'}];
  const f = fixture(() => ({status:200,data:{items}}));
  const root = new Element('section');
  f.mountSiteNotices(root);
  await settle();
  assert.equal(root.hidden, false);
  assert.equal(root.children[0].tag, 'p');
  assert.equal(root.children[0].textContent, items[0].text);
  assert.equal(root.children[0].children.length, 0);
  assert.equal(f.requests[0].url, '/api/notices');
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal(f.requests[0].options.credentials, 'same-origin');
  items = [];
  f.events.pageshow({persisted:true});
  await settle();
  assert.equal(root.hidden, true);
  assert.equal(root.children.length, 0);
});

test('failed public notices can be retried and never restore hardcoded content', async () => {
  let failed = true;
  const f = fixture(() => failed ? {status:500} : {status:200,data:{items:[{id:'3',text:'Recovered'}]}});
  const root = new Element('section');
  f.mountSiteNotices(root);
  await settle();
  assert.match(root.textContent, /Не удалось загрузить/);
  failed = false;
  await root.children[0].children[1].events.click();
  assert.equal(root.textContent, 'Recovered');
});
