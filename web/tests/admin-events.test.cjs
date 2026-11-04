const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {runInNewContext} = require('node:vm');

class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.attrs={};this.hidden=false;this.scrollTop=0;this.clientHeight=90;}
  get scrollHeight(){return this.querySelectorAll('.journal-line').length*90;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text||this.children.map(n=>n.textContent).join(' ');}
  setAttribute(k,v){this.attrs[k]=String(v);}
  addEventListener(k,fn){this.events[k]=fn;}
  querySelectorAll(selector){const matches=n=>selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):n.tag===selector;return this.children.flatMap(n=>[...(matches(n)?[n]:[]),...n.querySelectorAll(selector)]);}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
}
const event=(id,extra={})=>({id,created_at:'2026-11-05T12:00:00Z',job_id:'9007199254740997',level:'info',stage:null,dota_match_id:null,message:'Начата обработка задания',...extra});
const ok=data=>({status:200,data});
const session=()=>ok({admin:{steam_id:'76561198000000001'},expires_at:new Date(Date.now()+600000).toISOString()});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(handler=()=>null){
  const root=new Element(),requests=[],timers=new Map(),listeners={},windowListeners={};let nextTimer=0;
  const document={visibilityState:'visible',querySelector:()=>null,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>listeners[name]=fn};
  const context={document,AbortController,URLSearchParams,
    addEventListener:(name,fn)=>windowListeners[name]=fn,
    setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options)||(url==='/api/admin/session'?session():ok({events:[],next_before:null}));return{ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.data};},
  };
  const common=fs.readFileSync(path.join(__dirname,'../assets/common.js'),'utf8').replace(/^export /gm,'');
  const source=fs.readFileSync(path.join(__dirname,'../assets/admin-events.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  runInNewContext(`${common}\n${source}\nthis.api={createEventJournal,validateEventsPage};`,context);
  return {root,requests,timers,listeners,windowListeners,document,journal:context.api.createEventJournal(root),validate:context.api.validateEventsPage,
    async poll(){const entry=[...timers].find(([,v])=>v.ms===5000);assert.ok(entry,'poll scheduled');timers.delete(entry[0]);entry[1].fn();await settle();}};
}

test('events are read only after admin session, IDs remain exact and text is plain',async()=>{
  const denied=fixture(()=>({status:401}));await denied.journal.start();
  assert.equal(denied.requests.length,1);assert.match(denied.root.textContent,/Вход/);
  const page=fixture(url=>url.includes('import-events')?ok({events:[event('9007199254740999',{message:'<img src=x onerror=alert(1)>',level:'error',dota_match_id:'9040846950'})],next_before:null}):null);
  await page.journal.start();
  assert.match(page.root.textContent,/9007199254740997/);assert.match(page.root.textContent,/<img src=x/);
  assert.equal(page.root.querySelectorAll('img').length,0);
  assert.equal(page.requests[1].options.credentials,'same-origin');assert.equal(page.requests[1].options.cache,'no-store');
});

test('pagination appends older events and pauses refresh until returning to latest',async()=>{
  const page=fixture(url=>url.includes('import-events')?ok(url.includes('before=')?{events:[event('9007199254740998')],next_before:null}:{events:[event('9007199254740999')],next_before:'9007199254740999'}):null);
  await page.journal.start();await page.journal.more();
  assert.equal(page.root.querySelector('.journal-lines').children.length,2);
  assert.ok(page.requests.some(r=>r.url.includes('before=9007199254740999')));
  assert.equal([...page.timers.values()].some(v=>v.ms===5000),false);
  await page.journal.refresh();assert.equal(page.root.querySelector('.journal-lines').children.length,1);
  assert.equal([...page.timers.values()].some(v=>v.ms===5000),true);
});

test('session expiry clears private rows and stops polling',async()=>{
  let expired=false;
  const page=fixture(url=>url.includes('import-events')?(expired?{status:401}:ok({events:[event('3',{message:'private-event'})],next_before:null})):null);
  await page.journal.start();expired=true;await page.poll();
  assert.doesNotMatch(page.root.textContent,/private-event/);
  assert.match(page.root.textContent,/Сессия завершена/);
  assert.equal([...page.timers.values()].some(v=>v.ms===5000),false);
});

test('invalid responses and failures preserve loaded rows with a recovery action',async()=>{
  let broken=false;
  const page=fixture(url=>url.includes('import-events')?ok(broken?{events:[event('0')],next_before:null}:{events:[event('3',{message:'earlier-event'})],next_before:null}):null);
  await page.journal.start();broken=true;await page.journal.refresh();
  assert.match(page.root.textContent,/earlier-event/);assert.match(page.root.textContent,/Не удалось/);
  assert.throws(()=>page.validate({events:[event('3'),event('3')],next_before:null}));
  assert.throws(()=>page.validate({events:[event('3')],next_before:'4'}));
  assert.throws(()=>page.validate({events:[event('9223372036854775808')],next_before:null}));
});

test('hidden tab stops polling and late responses cannot restore rows after leaving',async()=>{
  let pending,hold=false;
  const page=fixture(url=>url.includes('import-events')?(hold?new Promise(resolve=>pending=resolve):ok({events:[event('3')],next_before:null})):null);
  await page.journal.start();page.document.visibilityState='hidden';page.listeners.visibilitychange();
  assert.equal([...page.timers.values()].some(v=>v.ms===5000),false);
  page.document.visibilityState='visible';page.listeners.visibilitychange();await settle();
  hold=true;const request=page.journal.refresh();await settle();page.journal.stop();
  pending(ok({events:[event('4',{message:'late-private-event'})],next_before:null}));await request;
  assert.doesNotMatch(page.root.textContent,/late-private-event/);
});

test('console renders older events first and follows the newest line',async()=>{
  const page=fixture(url=>url.includes('import-events')?ok({events:[event('3',{message:'newest-line'}),event('2',{message:'middle-line'}),event('1',{message:'oldest-line'})],next_before:null}):null);
  await page.journal.start();
  const lines=page.root.querySelector('.journal-lines').children;
  assert.match(lines[0].textContent,/oldest-line/);assert.match(lines[2].textContent,/newest-line/);
  const output=page.root.querySelector('.journal-console');
  assert.equal(output.scrollTop,output.scrollHeight);
});

test('scrolling up pauses output; following resumes it without a jump while reading',async()=>{
  const page=fixture(url=>url.includes('import-events')?ok({events:[event('3'),event('2'),event('1')],next_before:null}):null);
  await page.journal.start();
  const output=page.root.querySelector('.journal-console');
  const follow=page.root.querySelector('.journal-follow');
  output.scrollTop=0;output.events.scroll();
  assert.equal(follow.checked,false);
  assert.equal([...page.timers.values()].some(v=>v.ms===5000),false);
  assert.match(page.root.textContent,/пауз/);
  follow.checked=true;follow.events.change();
  assert.equal(output.scrollTop,output.scrollHeight);
  assert.equal([...page.timers.values()].some(v=>v.ms===5000),true);
});
