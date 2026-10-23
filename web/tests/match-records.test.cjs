const {test}=require('node:test');
const assert=require('node:assert/strict');
class Node {
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};}
 append(...nodes){this.children.push(...nodes);}
 set textContent(value){this.text=String(value);this.children=[];}
 get textContent(){return (this.text||'')+this.children.map(node=>node.textContent).join('');}
 setAttribute(key,value){this.attrs[key]=String(value);}
 addEventListener(){}
}
globalThis.document={createElement:tag=>new Node(tag)};
const walk=node=>[node,...node.children.flatMap(walk)];
const game={duration:1200,players:[
 {player_slot:0,account_id:'123',nickname:'Первый',hero_name:'Axe',side:'radiant',kills:5,deaths:0,assists:null,hero_damage:6000},
 {player_slot:128,account_id:null,nickname:null,hero_name:'Lina',side:'dire',kills:5,deaths:0,assists:3,hero_damage:8000},
]};
test('match records include anonymous players, preserve ties and ignore unavailable values',async()=>{
 const {matchRecords}=await import('../assets/insights.js');
 const result=matchRecords(game);
 assert.equal(result.kills.length,2);assert.equal(result.deaths.length,2);
 assert.equal(result.assists.length,1);assert.equal(result.assists[0].value,3);
 assert.equal(result.damage_per_min[0].value,400);assert.equal(result.damage_per_min[0].player.hero_name,'Lina');
 assert.deepEqual(result.hero_healing,[]);assert.equal(result.longest,undefined);
 assert.deepEqual(matchRecords({...game,duration:0}).damage_per_min,[]);
 assert.deepEqual(matchRecords({players:[null,{kills:NaN},{kills:-1}]}).kills,[]);
});
test('match record panels show all leaders with safe identity and explicit missing data',async()=>{
 const {renderMatchRecords}=await import('../assets/match-records.js');
 const root=renderMatchRecords(game);
 assert.equal(walk(root).filter(node=>node.className?.includes('insight-record')).length,8);
 assert.match(root.textContent,/Первый/);assert.match(root.textContent,/Lina/);assert.match(root.textContent,/Нет данных/);
 assert.equal(walk(root).some(node=>node.href==='/?view=player&account_id=123'),true);
 assert.equal(walk(root).some(node=>node.href?.includes('account_id=null')),false);
 assert.equal(walk(root).filter(node=>node.className==='record-entry').length,6);
 assert.match(renderMatchRecords({players:[]}).textContent,/Нет данных/);
});
