const { test } = require('node:test');
const assert = require('node:assert/strict');
class Node {
 constructor(tag) { this.tag=tag; this.children=[]; this.attrs={}; this.events={}; this.style={}; }
 set textContent(value) { this.children=[]; this.text=String(value); }
 get textContent() { return (this.text||'')+this.children.map(child=>child.textContent).join(''); }
 append(...children) { this.children.push(...children); }
 replaceChildren(...children) { this.children=[]; this.text=''; this.append(...children); }
 setAttribute(key,value) { this.attrs[key]=String(value); }
 addEventListener(key,value) { this.events[key]=value; }
 get firstChild() { return this.children[0]; }
}
globalThis.document={createElement:tag=>new Node(tag),createElementNS:(_,tag)=>new Node(tag)};
const walk=root=>[root,...root.children.flatMap(walk)];
const cls=(root,name)=>walk(root).filter(el=>el.className?.split(' ').includes(name));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const point=(game_time,value)=>({game_time,value});
const match={id:'5',dota_match_id:'123',duration:100,players:[{player_slot:0,side:'radiant',hero_name:'Axe',nickname:'<b>One</b>'},{player_slot:128,side:'dire',hero_name:'Lina',nickname:'Two'}]};
const data=()=>({match_id:'5',dota_match_id:'123',duration:100,available:true,preliminary_series:['hero_damage'],teams:[{side:'radiant',net_worth:[point(0,100),point(20,300)],experience:null},{side:'dire',net_worth:[point(10,200),point(30,350)],experience:null}],players:[{player_slot:0,net_worth:[point(0,50),point(40,80)],levels:[point(0,1),point(10,2),point(10,3)],hero_damage:[point(0,0),point(50,100)]},{player_slot:128,net_worth:[point(0,40)],levels:[point(0,1)],hero_damage:null}],kills:[{game_time:-30,victim_player_slot:0,killer_player_slots:[],bounty:null}]});
test('graph lookup handles pregame, duplicates and no future samples; advantage aligns independent times',async()=>{
 const {graphAt,advantageSeries,graphPath}=await import('../assets/graphs.js');
 assert.equal(graphAt([point(0,1)],-1),null);
 assert.equal(graphAt([point(0,1),point(10,2),point(10,3)],10).value,3);
 assert.deepEqual(advantageSeries(data().teams,'net_worth'),[point(10,-100),point(20,100),point(30,-50)]);
 assert.equal(advantageSeries(data().teams.slice(0,1),'net_worth').length,0);
 assert.match(graphPath([point(0,1),point(10,2)],x=>x,y=>y,true),/H10V2/);
});
test('graphs validate identity, slots, points, levels and keep null series distinct',async()=>{
 const {graphRecords}=await import('../assets/graphs.js');
 const valid=graphRecords(data(),match,'5'); assert.equal(valid.players[1].hero_damage,null);
 for(const mutate of [d=>d.match_id='6',d=>d.players.push(d.players[0]),d=>d.players[0].levels=[point(0,31)],d=>d.players[0].net_worth=[point(0,NaN)],d=>d.kills[0].victim_player_slot=255,d=>d.players[0].net_worth=[point(101,1)]]) {
  const value=data(); mutate(value); assert.throws(()=>graphRecords(value,match,'5'));
 }
});

test('time ticks use ten minute intervals and always include the match end',async()=>{
 const {graphTimeTicks}=await import('../assets/graphs.js');
 assert.deepEqual(graphTimeTicks(-90,2375),[0,600,1200,1800,2375]);
 assert.deepEqual(graphTimeTicks(0,1200),[0,600,1200]);
 assert.deepEqual(graphTimeTicks(0,1205),[0,600,1200,1205]);
 assert.deepEqual(graphTimeTicks(0,100),[0,100]);
});

test('crowded death markers occupy separate rows, including across former bucket boundaries',async()=>{
 const {layoutDeathMarkers}=await import('../assets/graphs.js');
 const kills=[23,24,24,24,24,25,46,47].map(game_time=>({game_time,victim_player_slot:0}));
 const markers=layoutDeathMarkers(kills,x=>x,()=> 'radiant');
 assert.equal(markers.length,kills.length);
 for(let i=0;i<markers.length;i++)for(let j=i+1;j<markers.length;j++) {
  if(markers[i].row===markers[j].row)assert.ok(Math.abs(markers[i].left-markers[j].left)>=24);
 }
 assert.ok(Math.max(...markers.map(marker=>marker.row))>=5);
});
test('graph UI switches modes, filters lines, preserves cursor, handles retry and abort',async()=>{
 const {renderGraphs}=await import('../assets/graphs.js'); let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,text:async()=>JSON.stringify(data())};};
 const root=renderGraphs(match,'5',new AbortController().signal); await settle();
 assert.equal(calls,1); assert.equal(cls(root,'graph-player-toggle').length,2);
 assert.ok(!cls(root,'graph-players')[0].textContent.includes('Two'));
 assert.ok(!cls(root,'graph-readout')[0].textContent.includes('образец'));
 assert.ok(!cls(root,'graph-readout')[0].textContent.includes('Two'));
 const readout=cls(root,'graph-readout')[0];
 assert.equal(cls(readout,'hero-identity').length,2);
 const deaths=cls(root,'graph-deaths-toggle')[0];
 deaths.checked=false;deaths.events.change();
 assert.equal(walk(root).filter(node=>node.attrs.class==='graph-kill').length,0);
 deaths.checked=true;deaths.events.change();
 assert.equal(walk(root).filter(node=>node.attrs.class==='graph-kill').length,1);
 assert.ok(walk(root).some(node=>node.tag==='svg'));
 assert.equal(cls(root,'graph-slider').length,0);
 assert.equal(cls(root,'graph-clock').length,0);
 const host=cls(root,'graph-plot-host')[0];
 for(let i=0;i<30;i++)host.events.keydown({target:host,key:'ArrowRight',preventDefault(){}});
 assert.equal(cls(root,'graph-readout')[0],readout,'cursor updates preserve the tooltip for smooth transitions');
 cls(root,'graph-mode')[2].events.click();
 assert.match(cls(root,'graph-readout-title')[0].textContent,/0:30/); assert.equal(calls,1);
 cls(root,'graph-mode')[0].events.click();
 const metric=cls(root,'graph-metric-toggle')[0];metric.events.click();
 assert.ok(walk(root).includes(metric),'metric controls must remain mounted for keyboard focus');
 cls(root,'graph-mode')[2].events.click();
 const plot=cls(root,'graph-plot')[0];
 assert.doesNotThrow(()=>plot.events.pointerdown({target:{closest:()=>true}}),'death marker must not trigger plot scrubbing');
 cls(root,'graph-player-toggle')[0].events.click();cls(root,'graph-player-toggle')[1].events.click();
 assert.match(root.textContent,/Выберите хотя бы одного игрока/);
 let fail=true;globalThis.fetch=async()=>{if(fail)throw Error('offline');return {ok:true,text:async()=>JSON.stringify(data())};};
 const retry=renderGraphs(match,'5',new AbortController().signal);await settle();
 assert.match(retry.textContent,/Не удалось загрузить графики/);fail=false;
 walk(retry).find(node=>node.tag==='button'&&node.textContent==='Повторить').events.click();await settle();
 assert.ok(walk(retry).some(node=>node.tag==='svg'));
 const aborted=new AbortController();aborted.abort();const empty=renderGraphs(match,'5',aborted.signal);await settle();
 assert.equal(walk(empty).filter(node=>node.tag==='svg').length,0);
});
