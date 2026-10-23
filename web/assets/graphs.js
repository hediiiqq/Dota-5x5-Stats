import { element, number, heroBadge, requestJSON, showStatus, showLoading } from './common.js';
import { purchaseTime } from './inventory.js';

const COLORS = ['#75baff','#83d8b4','#db91e5','#f0ce65','#ee995b','#f09db9','#c2ce73','#81d6e8','#b59aff','#72c88a'];
const MODES = [['advantage','Преимущество команд'],['net_worth','Общая ценность'],['levels','Уровни'],['hero_damage','Урон героям']];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const short = value => Math.abs(value) >= 1000 ? `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value/1000)} тыс.` : number(value);

export function graphAt(points, time) {
 let low=0, high=points?.length || 0;
 while(low<high) { const middle=(low+high)>>>1; if(points[middle].game_time<=time) low=middle+1; else high=middle; }
 return points?.[low-1] || null;
}

export function advantageSeries(teams, key) {
 const radiant=teams.find(team=>team.side==='radiant')?.[key], dire=teams.find(team=>team.side==='dire')?.[key];
 if(!radiant?.length || !dire?.length) return [];
 return [...new Set([...radiant,...dire].map(point=>point.game_time))].sort((a,b)=>a-b).flatMap(time=>{
  const a=graphAt(radiant,time), b=graphAt(dire,time);
  return a&&b ? [{game_time:time,value:a.value-b.value}] : [];
 });
}

export function graphPath(points, x, y, stepped=false) {
 return points.map((point,index)=> index===0 ? `M${x(point.game_time)},${y(point.value)}` : stepped ? `H${x(point.game_time)}V${y(point.value)}` : `L${x(point.game_time)},${y(point.value)}`).join('');
}

export function graphTimeTicks(start, end) {
 const ticks=[];
 for(let time=Math.ceil(start/600)*600;time<end;time+=600) ticks.push(time===0?0:time);
 ticks.push(end);
 return ticks;
}

export function layoutDeathMarkers(kills, x, sideOf) {
 const rows=new Map();
 return [...kills].sort((a,b)=>a.game_time-b.game_time).map(kill=>{
  const side=sideOf(kill.victim_player_slot), left=x(kill.game_time)-10;
  const ends=rows.get(side)||[];
  let row=ends.findIndex(end=>end+4<=left);
  if(row<0) row=ends.length;
  ends[row]=left+20;rows.set(side,ends);
  return {kill,side,row,left};
 });
}

export function graphRecords(response, match, matchID) {
 const invalid=()=>{throw Error('Сервер вернул некорректные графики.');};
 if(!response || response.match_id!==String(matchID) || response.dota_match_id!==String(match.dota_match_id) || typeof response.available!=='boolean' || !Number.isSafeInteger(response.duration) || response.duration<=0 || !Array.isArray(response.players) || !Array.isArray(response.teams)) invalid();
 const slots=new Set(match.players.map(player=>player.player_slot)), seen=new Set(), sides=new Set();
 function points(rows,key) {
  if(rows==null) return null;
  if(!Array.isArray(rows) || rows.some(point=>!Number.isSafeInteger(point?.game_time) || point.game_time>response.duration || !finite(point.value) || point.value<0 || (key==='levels' && (!Number.isInteger(point.value)||point.value<1||point.value>30)))) invalid();
  const sorted=rows.map(point=>({...point})).sort((a,b)=>a.game_time-b.game_time);
  if(key==='levels' && sorted.some((point,index)=>index>0&&point.value<sorted[index-1].value)) invalid();
  return sorted;
 }
 const players=response.players.map(player=>{
  if(!Number.isInteger(player?.player_slot)||!slots.has(player.player_slot)||seen.has(player.player_slot)) invalid();
  seen.add(player.player_slot);
  return {...player,...Object.fromEntries(['net_worth','levels','hero_damage'].map(key=>[key,points(player[key],key)]))};
 });
 const teams=response.teams.map(team=>{
  if(!team||!['radiant','dire'].includes(team.side)||sides.has(team.side)) invalid();
  sides.add(team.side);return {...team,net_worth:points(team.net_worth),experience:points(team.experience)};
 });
 if(response.kills!=null && (!Array.isArray(response.kills)||response.kills.some(kill=>!Number.isSafeInteger(kill?.game_time)||kill.game_time>response.duration||!slots.has(kill.victim_player_slot)||!Array.isArray(kill.killer_player_slots)||kill.killer_player_slots.some(slot=>!slots.has(slot))||(kill.bounty!=null&&(!Number.isInteger(kill.bounty)||kill.bounty<0))))) invalid();
 const preliminary=response.preliminary_series??[];
 if(!Array.isArray(preliminary)||preliminary.some(name=>!['team_net_worth','team_experience','hero_damage'].includes(name))) invalid();
 return {...response,players,teams,kills:response.kills==null?null:[...response.kills].sort((a,b)=>a.game_time-b.game_time),preliminary_series:preliminary};
}

function svgNode(tag, attrs={}, text) {
 const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
 if(text!==undefined) node.textContent=String(text);
 return node;
}

export function renderGraphs(match, matchID, signal) {
 const panel=element('section','panel graphs-panel');
 panel.setAttribute('aria-label','Графики матча');
 const heading=element('div','panel-heading');heading.append(element('h2','','Графики'),element('span','muted small','Весь матч'));
 const status=element('div','status graph-status');status.setAttribute('role','status');
 const body=element('div','graphs-body');body.hidden=true;panel.append(heading,status,body);
 let records, mode='net_worth', cursor=0, filter='all', showDeaths=true;
 const selected=new Set(match.players.map(player=>player.player_slot));
 const metrics=new Set(['net_worth','experience']);
 const people=new Map(match.players.map((player,index)=>[player.player_slot,{...player,color:COLORS[index%COLORS.length]}]));
 const playerName=slot=>people.get(slot)?.hero_name||'Герой';
 let startTime=0,visual,plotHost,readout,note,legend,deathFilter,playerButtons=[],modeButtons=[],metricButtons=[];
 function activeSeries() {
  if(mode==='advantage') return ['net_worth','experience'].filter(key=>metrics.has(key)).map(key=>({name:key==='net_worth'?'ОЦ · Radiant − Dire':'Опыт · Radiant − Dire',color:key==='net_worth'?'#f0ce65':'#9dc5e8',points:advantageSeries(records.teams,key),preliminary:records.preliminary_series.includes(`team_${key}`)}));
  return records.players.filter(player=>selected.has(player.player_slot)).map(player=>({player:people.get(player.player_slot),name:playerName(player.player_slot),color:people.get(player.player_slot).color,points:player[mode]||[],preliminary:mode==='hero_damage'&&records.preliminary_series.includes('hero_damage')}));
 }
 function setTime(value) { cursor=Math.max(startTime,Math.min(records.duration,Math.round(value))); draw(); }
 function draw() {
  if(signal.aborted) return;
  plotHost.setAttribute('aria-label',`Время ${purchaseTime(cursor)}. Стрелки: изменить время, Home: начало, End: конец матча.`);
  deathFilter.disabled=records.kills===null||!showDeaths;
  modeButtons.forEach(([key,button])=>button.setAttribute('aria-pressed',String(key===mode)));
  playerButtons.forEach(([slot,button])=>button.setAttribute('aria-pressed',String(selected.has(slot))));
  const series=activeSeries(), populated=series.filter(line=>line.points.length);
  note.textContent=series.some(line=>line.preliminary) ? 'Предварительные данные: масштаб и временная привязка командных рядов и урона ещё не сверены с клиентом Dota. Значения отмечены знаком ≈.' : mode==='levels' ? 'Ступени — получение уровня героем. Несколько повышений в одну секунду сохраняются.' : 'Личная ОЦ использует тот же ряд, что перемотка инвентаря. Значение курсора — последний доступный образец, не позднее выбранного времени.';
  legend.hidden=mode!=='advantage';
  metricButtons.forEach(([key,button])=>button.setAttribute('aria-pressed',String(metrics.has(key))));
  readout.replaceChildren();
  readout.hidden=!populated.length;
  if(!populated.length) {
   plotHost.replaceChildren(element('p','graph-empty muted',mode!=='advantage'&&!selected.size?'Выберите хотя бы одного игрока.':mode==='advantage'&&!metrics.size?'Выберите ОЦ или опыт.':'Для выбранного режима нет данных.'));
   return;
  }
  const start=startTime, end=records.duration;
  const values=populated.flatMap(line=>line.points.map(point=>point.value));
  const bound=Math.max(1,...values.map(Math.abs));
  const step=mode==='levels'?5:Math.pow(10,Math.max(0,Math.floor(Math.log10(bound))-1));
  const maximum=mode==='levels'?Math.min(30,Math.max(5,Math.ceil(bound/5)*5)):Math.ceil(bound/step)*step;
  const minimum=mode==='advantage'?-maximum:0;
  const x=time=>64+(time-start)/(end-start)*884;
  const visibleKills=showDeaths?(records.kills||[]).filter(kill=>filter==='all'||filter==='selected'&&selected.has(kill.victim_player_slot)||people.get(kill.victim_player_slot)?.side===filter):[];
  const markers=layoutDeathMarkers(visibleKills,x,slot=>people.get(slot)?.side);
  const rowCount=side=>Math.max(0,...markers.filter(marker=>marker.side===side).map(marker=>marker.row+1));
  const plotTop=60+rowCount('radiant')*20, plotBottom=plotTop+350;
  const ticks=graphTimeTicks(start,end);
  const staggerEnd=ticks.length>1&&x(end)-x(ticks.at(-2))<65;
  const ticksY=plotBottom+38+rowCount('dire')*20;
  const y=value=>plotBottom-(value-minimum)/(maximum-minimum)*350;
  const chart=svgNode('svg',{viewBox:`0 0 1000 ${ticksY+(staggerEnd?34:16)}`,class:'graph-svg',role:'img','aria-label':MODES.find(([key])=>key===mode)[1]});
  chart.append(svgNode('title',{},`${MODES.find(([key])=>key===mode)[1]}. Выберите время наведением или стрелками для чтения значений.`));
  chart.append(svgNode('text',{x:64,y:plotTop-15,class:'graph-axis'},`${series.some(line=>line.preliminary)?'≈ ':''}${mode==='levels'?'Уровень':mode==='hero_damage'?'Накопленный урон':mode==='advantage'?'Разница ОЦ / опыта':'Золото'}`));
  if(mode==='advantage') {
   chart.append(svgNode('rect',{x:64,y:plotTop,width:884,height:175,fill:'#83d8b4','fill-opacity':'.035'}),svgNode('rect',{x:64,y:plotTop+175,width:884,height:175,fill:'#ed8f8f','fill-opacity':'.035'}));
   chart.append(svgNode('text',{x:72,y:plotTop+18,class:'graph-axis'},'Radiant +'),svgNode('text',{x:72,y:plotBottom-8,class:'graph-axis'},'Dire +'));
  }
  for(let index=0;index<=4;index++) {
   const value=minimum+(maximum-minimum)*index/4;
   chart.append(svgNode('line',{x1:64,x2:948,y1:y(value),y2:y(value),class:value===0?'graph-zero':'graph-grid'}),svgNode('text',{x:56,y:y(value)+5,'text-anchor':'end',class:'graph-axis'},mode==='levels'?number(Math.round(value)):short(value)));
  }
  for(const [index,time] of ticks.entries()) {
   const last=index===ticks.length-1;
   chart.append(svgNode('text',{x:x(time),y:ticksY+(last&&staggerEnd?18:0),'text-anchor':last?'end':index===0?'start':'middle',class:'graph-axis graph-time-tick'},purchaseTime(time)));
  }
  for(const line of populated) {
   const path=svgNode('path',{d:graphPath(line.points,x,y,mode==='levels'),fill:'none',stroke:line.color,'stroke-width':2.5,'vector-effect':'non-scaling-stroke'});
   path.append(svgNode('title',{},line.name));chart.append(path);
   const last=line.points.at(-1);
   if(last.game_time<end) chart.append(svgNode('path',{d:`M${x(last.game_time)},${y(last.value)}H${x(end)}`,fill:'none',stroke:line.color,'stroke-opacity':.4,'stroke-dasharray':'4 5'}));
   const current=graphAt(line.points,cursor);
   if(current) chart.append(svgNode('circle',{cx:x(current.game_time),cy:y(current.value),r:4,fill:line.color}));
  }
  for(const {kill,side,row,left} of markers) {
   const victim=people.get(kill.victim_player_slot);
   const top=side==='radiant'?12+row*20:plotBottom+18+row*20;
   const marker=svgNode('g',{class:'graph-kill',tabindex:0,role:'button','aria-label':`${purchaseTime(kill.game_time)}: погиб ${playerName(kill.victim_player_slot)}. ${kill.killer_player_slots.length?`Убийцы: ${kill.killer_player_slots.map(playerName).join(', ')}`:'Убийца неизвестен'}`});
   marker.append(svgNode('rect',{x:left,y:top,width:20,height:16,rx:2,fill:victim.color,'fill-opacity':.24,stroke:victim.color}));
   if(victim.hero_icon_url) marker.append(svgNode('image',{href:victim.hero_icon_url,x:left+1,y:top+1,width:18,height:14,preserveAspectRatio:'xMidYMid meet'}));
   else marker.append(svgNode('text',{x:x(kill.game_time),y:top+12,'text-anchor':'middle',class:'graph-kill-letter'},(victim.hero_name||'?')[0]));
   marker.append(svgNode('title',{},`${purchaseTime(kill.game_time)} · смерть ${playerName(kill.victim_player_slot)}${kill.bounty==null?'':` · награда ${number(kill.bounty)}`}`));
   marker.addEventListener('click',()=>setTime(kill.game_time));
   marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setTime(kill.game_time);}});
   chart.append(marker);
  }
  chart.append(svgNode('line',{x1:x(cursor),x2:x(cursor),y1:plotTop-8,y2:plotBottom+8,class:'graph-cursor'}));
  const plot=element('div','graph-plot');plot.append(chart);
  const move=event=>{const rect=chart.getBoundingClientRect();const px=(event.clientX-rect.left)/rect.width*1000;if(px>=0&&px<=1000)setTime(start+(Math.max(64,Math.min(948,px))-64)/884*(end-start));};
  // Taps select time; the persistent plot host also supports keyboard navigation.
  plot.addEventListener('pointerdown',event=>{if(!event.target?.closest?.('.graph-kill'))move(event);});
  chart.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&!event.target?.closest?.('.graph-kill'))move(event);});
  readout.style.top=`${(plotTop+12)/(ticksY+(staggerEnd?34:16))*100}%`;
  readout.style.left=`clamp(8px, calc(${x(cursor)/10}% ${cursor>(start+end)/2?'- 236px':'+ 16px'}), calc(100% - 228px))`;
  const label=element('p','graph-readout-title',`На ${purchaseTime(cursor)}`);readout.append(label);
  const rows=populated.map(line=>({...line,point:graphAt(line.points,cursor)})).sort((a,b)=>(b.point?.value??-Infinity)-(a.point?.value??-Infinity));
  for(const line of rows) {
   const row=element('div','graph-readout-row');row.style.borderColor=line.color;
   const identity=line.player?heroBadge(line.player):element('span','',line.name);
   identity.className+=' graph-readout-name';
   row.append(identity,element('strong','mono',line.point?`${line.preliminary?'≈ ':''}${number(line.point.value)}`:'—'));
   readout.append(row);
  }
  const eventList=visibleKills.filter(kill=>Math.abs(kill.game_time-cursor)<=3);
  if(eventList.length) {
   const deaths=element('div','graph-nearby-kills');
   for(const kill of eventList) deaths.append(element('p','small',`${purchaseTime(kill.game_time)} · погиб ${playerName(kill.victim_player_slot)} · ${kill.killer_player_slots.length?`убийцы: ${kill.killer_player_slots.map(playerName).join(', ')}`:'убийца неизвестен'}${kill.bounty==null?'':` · награда ${number(kill.bounty)}`}`));
   readout.append(deaths);
  }
  plotHost.replaceChildren(plot);
 }
 function build() {
  body.replaceChildren();playerButtons=[];modeButtons=[];metricButtons=[];
  const modes=element('div','graph-modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','Режим графика');
  for(const [key,label] of MODES) { const button=element('button','graph-mode',label);button.type='button';button.addEventListener('click',()=>{mode=key;draw();});modes.append(button);modeButtons.push([key,button]); }
  const layout=element('div','graph-layout'), sidebar=element('aside','graph-players');sidebar.setAttribute('aria-label','Линии игроков');
  for(const [side,name] of [['radiant','Radiant'],['dire','Dire']]) {
   const team=element('section',`graph-team ${side}`), title=element('div','graph-team-heading');title.append(element('h3','',name));
   const players=match.players.filter(player=>player.side===side);
   const all=element('button','graph-team-toggle','Все / снять');all.type='button';all.setAttribute('aria-label',`${name}: выбрать всех или снять выбор`);
   all.addEventListener('click',()=>{const remove=players.every(player=>selected.has(player.player_slot));for(const player of players)remove?selected.delete(player.player_slot):selected.add(player.player_slot);draw();});title.append(all);team.append(title);
   for(const player of players) {
    const button=element('button','graph-player-toggle');button.type='button';button.style.borderLeftColor=people.get(player.player_slot).color;
    const text=element('span','graph-player-text');text.append(element('strong','',player.hero_name||'Герой'));
    button.append(heroBadge(player),text);button.setAttribute('aria-label',`Линия ${playerName(player.player_slot)}`);
    button.addEventListener('click',()=>{selected.has(player.player_slot)?selected.delete(player.player_slot):selected.add(player.player_slot);draw();});playerButtons.push([player.player_slot,button]);team.append(button);
   }
   sidebar.append(team);
  }
  const content=element('div','graph-content');note=element('p','graph-note small');legend=element('div','graph-legend');
  for(const [key,label] of [['net_worth','Общая ценность'],['experience','Опыт']]) {
   const button=element('button','graph-metric-toggle',label);button.type='button';
   button.addEventListener('click',()=>{metrics.has(key)?metrics.delete(key):metrics.add(key);draw();});
   legend.append(button);metricButtons.push([key,button]);
  }
  startTime=Math.min(0,...(records.kills||[]).map(kill=>kill.game_time),...records.players.flatMap(player=>['net_worth','levels','hero_damage'].flatMap(key=>(player[key]||[]).map(point=>point.game_time))));
  const kills=element('select','graph-kill-filter');deathFilter=kills;kills.setAttribute('aria-label','Показать смерти героев');
  for(const [value,label] of [['all','Все смерти'],['radiant','Смерти Radiant'],['dire','Смерти Dire'],['selected','Смерти выбранных']]){const option=element('option','',label);option.value=value;kills.append(option);}
  kills.value=filter;kills.disabled=records.kills===null;kills.addEventListener('change',()=>{filter=kills.value;draw();});
  const deathControls=element('div','graph-death-controls');
  const deathLabel=element('label','graph-deaths-label'), deathToggle=element('input','graph-deaths-toggle');
  deathToggle.type='checkbox';deathToggle.checked=showDeaths;deathToggle.disabled=records.kills===null;
  deathToggle.addEventListener('change',()=>{showDeaths=deathToggle.checked;draw();});
  deathLabel.append(deathToggle,element('span','','Показывать смерти'));deathControls.append(deathLabel,kills);
  visual=element('div','graph-visual');
  plotHost=element('div','graph-plot-host');readout=element('div','graph-readout');
  plotHost.tabIndex=0;plotHost.setAttribute('role','group');
  plotHost.addEventListener('keydown',event=>{
   if(event.target!==plotHost)return;
   const times={ArrowLeft:cursor-(event.shiftKey?60:1),ArrowRight:cursor+(event.shiftKey?60:1),Home:startTime,End:records.duration};
   if(Object.hasOwn(times,event.key)){event.preventDefault();setTime(times[event.key]);}
  });
  visual.append(plotHost,readout);
  content.append(note,legend,deathControls,visual,element('p','graph-help muted small',`${records.kills===null?'События убийств недоступны.':'Верхняя полоса — смерти Radiant, нижняя — смерти Dire. Выберите время на графике нажатием, наведением или стрелками.'} Пунктир продолжает последнее известное значение. На узком экране график прокручивается вправо.`));
  layout.append(sidebar,content);body.append(modes,layout);draw();
 }
 async function load() {
  if(signal.aborted) return;
  body.hidden=true;panel.setAttribute('aria-busy','true');showLoading(status,'Загружаем графики…');
  try {
   records=graphRecords(await requestJSON(`/api/matches/${matchID}/graphs`,signal),match,matchID);
   if(signal.aborted)return;
   if(!records.available){showStatus(status,'Графики недоступны','Для этого матча расширенные данные пока не сохранены.');return;}
   build();status.hidden=true;body.hidden=false;
  } catch(error) { if(!signal.aborted)showStatus(status,'Не удалось загрузить графики',error.message,load); }
  finally {if(!signal.aborted)panel.setAttribute('aria-busy','false');}
 }
 load();return panel;
}
