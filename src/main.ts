import './style.css';
import { initPwa } from './pwa';
import { readRanking, recordResult } from './ranking';
import { createGame, startGame, restartGame, pauseGame, resumeGame, launchPlate, advanceGameInPlace, canLaunch, canRepeatLaunch, RULES, type SushiType } from './engine';
import { sushiSvg, avatarSvg, chefSvg, blossomSvg } from './art';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.style.setProperty('--belt-item-size', `${Math.min(10, 180 / RULES.capacity)}%`);
const read = (key:string, fallback:string) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key:string,value:string) => { try { localStorage.setItem(key,value); } catch {} };
let best = Number(read('sushi-loop-guests-best','0')) || 0;
best=Math.max(best,...readRanking().map(entry=>entry.served));
let ranking = false;
let held: { lane:number; pointer?:number; key?:string } | null = null;
let nextRepeat = 0;
let sound = read('sushi-loop-sound','off') === 'on';
let state = createGame(Date.now());
let help = false;
let lastPhase = '';
let lastEvent = 0;
let restoreFocus: HTMLElement | null = null;
let audio: AudioContext | undefined;
const names: Record<SushiType,string> = { salmon:'Salmon', tuna:'Tuna', maki:'Maki', shrimp:'Shrimp', tamago:'Tamago', avocado:'Avocado maki', cucumber:'Cucumber maki', ikura:'Ikura gunkan' };
app.innerHTML = `<main class="game"><header class="header"><div class="brand"><span class="brand-mark">鮨</span><div><h1>sushi<span>loop</span></h1><p>A LITTLE JOY, ON A ROLL</p></div></div><div class="header-actions"><button id="sound" class="icon-button" aria-label="Turn sound on"></button><button id="pause" class="icon-button" aria-label="Pause game"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 6v12M16 6v12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button></div></header><section class="hud" aria-label="Game progress"><div class="score"><div><span class="eyebrow">GUESTS SERVED</span><strong id="served">0</strong></div></div><div class="occupancy"><span class="eyebrow">BELT SPACE</span><strong id="capacity">0 / ${RULES.capacity}</strong><div class="progress"><i id="progress"></i></div></div><div class="best"><span class="eyebrow">PERSONAL BEST</span><strong>♔ <span id="best">${best}</span></strong></div></section><div class="service-line"><span><i class="live-dot"></i> THE LUNCH CLUB</span><span>Made with a little love</span></div><section class="arena" aria-label="Sushi conveyor and customer orders"><div class="room-grain"></div><div class="blossom">${blossomSvg()}</div><div class="belt-shadow"></div><div class="belt"><div class="belt-pattern"></div></div><div class="kitchen"><div class="kitchen-label">おいしい • OISHII</div><div class="chef">${chefSvg()}</div><div class="prep"><span class="board">${sushiSvg('salmon')}</span><span class="tea">♨</span><span class="chopsticks"></span></div><div class="kitchen-name">good food, good mood</div></div><div id="slots">${Array.from({length:RULES.capacity},(_,i)=>`<span class="slot" data-slot="${i}"></span>`).join('')}</div><div id="plates"></div>${[0,1,2,3].map(i=>`<div class="guest guest-${i}" id="guest-${i}"><div class="avatar">${avatarSvg(i)}</div><div class="order"><div class="order-content"></div></div></div>`).join('')}<div class="launch-gate"><span>↑</span></div><div id="effects" aria-hidden="true"></div></section><div class="belt-status"><span id="status">Your kitchen is ready</span></div><section class="queue-section" aria-label="Sushi lanes"><div class="queue-heading"><h2>Pick a plate. Make a day.</h2><span>TAP OR HOLD A LANE ↑</span></div><div class="lanes">${Array.from({length:RULES.laneCount},(_,i)=>`<button class="lane" data-lane="${i}" aria-label="Launch from lane ${i+1}"><span class="lane-arrow">↑</span><span class="lane-pieces"></span><span class="lane-number">${i+1}</span></button>`).join('')}</div></section><footer><button id="help">ⓘ How to play</button><button id="install" aria-label="Install Sushi Loop" hidden>↓ Install</button><button id="ranking">Local rankings</button><span class="footer-note">take your time</span></footer><div id="overlay" class="overlay"></div><div class="sr-only" id="announcement" role="status" aria-live="polite"></div></main>`;
const elements = new Map<string, HTMLElement>();
const el = (id:string) => {
 const cached = elements.get(id);
 if (cached?.isConnected) return cached;
 const node = document.getElementById(id)!;
 elements.set(id,node);
 return node;
};
const arena = document.querySelector<HTMLElement>('.arena')!;
const slots = Array.from(document.querySelectorAll<HTMLElement>('.slot'));
const launchGate = document.querySelector<HTMLElement>('.launch-gate')!;
const gameChildren = Array.from(app.querySelector('.game')!.children);
const guests = [0,1,2,3].map(i => {
 const node = el(`guest-${i}`);
 return { node, order: node.querySelector<HTMLElement>('.order-content')!, avatar: node.querySelector<HTMLElement>('.avatar')! };
});
function setText(node:HTMLElement, value:string) { if(node.textContent!==value) node.textContent=value; }
function setDisabled(node:HTMLButtonElement, value:boolean) { if(node.disabled!==value) node.disabled=value; }
function setClass(node:HTMLElement, name:string, value:boolean) { if(node.classList.contains(name)!==value) node.classList.toggle(name,value); }
function setData(node:HTMLElement, key:string, value:string) { if(node.dataset[key]!==value) node.dataset[key]=value; }
let arenaWidth=0, arenaHeight=0, motionPhase=NaN, geometryDirty=true;
const slotTransforms:string[]=[];
const lastTransforms=new WeakMap<HTMLElement,string>();
function positionNode(node:HTMLElement, transform:string) {
 if(lastTransforms.get(node)!==transform) { node.style.transform=transform; lastTransforms.set(node,transform); }
}
function updateMotion() {
 if(geometryDirty || motionPhase!==state.beltPhase) {
  motionPhase=state.beltPhase;
  geometryDirty=false;
  for(let i=0;i<RULES.capacity;i++) {
   const angle=(state.beltPhase+i/RULES.capacity)*Math.PI*2;
   const transform=`translate3d(${-Math.sin(angle)*.35*arenaWidth}px, ${Math.cos(angle)*.35*arenaHeight}px, 0) translate(-50%, -50%)`;
   slotTransforms[i]=transform;
   positionNode(slots[i],transform);
  }
 }
 for(const plate of state.plates) positionNode(plates.get(plate.id)!,slotTransforms[plate.slot]);
}

const lanes = Array.from(document.querySelectorAll<HTMLButtonElement>('.lane'));
const lanePieces=lanes.map(button=>button.querySelector<HTMLElement>('.lane-pieces')!);
const queueKeys:string[] = [];
const guestKeys:string[] = [];
const plates = new Map<number,HTMLElement>();
const activePlateIds=new Set<number>();
const occupiedSlots=new Set<number>();
let renderedPlateCount=-1;
function tone(frequency=520) { if (!sound) return; try { audio ??= new AudioContext(); void audio.resume(); const oscillator=audio.createOscillator(); const gain=audio.createGain(); oscillator.type='sine'; oscillator.frequency.value=frequency; gain.gain.setValueAtTime(.055,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.16); oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime+.17); } catch {} }
function soundButton() { el('sound').textContent = sound ? '♫' : '♪'; el('sound').setAttribute('aria-label', sound ? 'Turn sound off' : 'Turn sound on'); el('sound').setAttribute('aria-pressed',String(sound)); el('sound').classList.toggle('muted',!sound); }
soundButton();
el('sound').onclick=()=> { sound=!sound; save('sushi-loop-sound',sound?'on':'off'); soundButton(); tone(); };
function clearHold() { held=null; lanes.forEach(button=>button.classList.remove('held')); }
function pause() { clearHold(); if (state.phase==='playing') state=pauseGame(state); else if(state.phase==='paused' && !help && !ranking) state=resumeGame(state); render(); }
el('pause').onclick=pause;
function openHelp() { clearHold(); help=true; if(state.phase==='playing') state=pauseGame(state); lastPhase=''; render(); }
el('help').onclick=openHelp;
function openRanking() { clearHold(); ranking=true; if(state.phase==='playing') state=pauseGame(state); lastPhase=''; render(); }
el('ranking').onclick=openRanking;
function launch(index:number, immediate=true) { if(!canLaunch(state)) return; state=launchPlate(state,index); nextRepeat=performance.now()+RULES.repeatInterval*1000; tone(360+index*70); if(immediate) render(); }
lanes.forEach((button,i)=> {
 button.onpointerdown=event=> { if(event.button!==0 || state.phase!=='playing' || held) return; event.preventDefault(); button.focus({preventScroll:true}); button.setPointerCapture(event.pointerId); held={lane:i,pointer:event.pointerId}; button.classList.add('held'); launch(i); };
 button.onpointermove=event=> { if(held?.pointer!==event.pointerId) return; const rect=button.getBoundingClientRect(); if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) clearHold(); };
 button.onpointerup=button.onpointercancel=button.onlostpointercapture=()=>clearHold();
 button.onclick=event=> { if(event.detail===0) launch(i); };
});
window.addEventListener('pointerup',clearHold); window.addEventListener('pointercancel',clearHold); window.addEventListener('blur',()=>{clearHold();if(state.phase==='playing'){state=pauseGame(state);render();}});
document.addEventListener('keyup',event=>{if(held?.key===event.key) clearHold();});
document.addEventListener('keydown',event=> {
 if(event.key==='Tab' && !el('overlay').hidden) { const buttons=Array.from(el('overlay').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const first=buttons[0], last=buttons[buttons.length-1]; if(event.shiftKey && (document.activeElement===first || !el('overlay').contains(document.activeElement))) { event.preventDefault(); last?.focus(); } else if(!event.shiftKey && (document.activeElement===last || !el('overlay').contains(document.activeElement))) {event.preventDefault();first?.focus();} return; }
 if(event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
 if(/^[1-5]$/.test(event.key) && state.phase==='playing') { event.preventDefault(); clearHold(); held={lane:Number(event.key)-1,key:event.key}; lanes[held.lane].classList.add('held'); launch(held.lane); }
 if(event.key.toLowerCase()==='p' || event.key==='Escape') { event.preventDefault(); if(help || ranking) { help=false; ranking=false; lastPhase='';render(); } else pause(); }
});
document.addEventListener('visibilitychange',()=> { if(document.hidden) {clearHold();if(state.phase==='playing') { state=pauseGame(state); render(); }} });
function showOverlay() {
 const overlay=el('overlay'); const phase=state.phase;
 if(phase==='playing' && !help && !ranking) { overlay.hidden=true; gameChildren.forEach(node=>{if(node!==overlay && node instanceof HTMLElement) node.inert=false;}); if(document.activeElement?.closest('#overlay')) (restoreFocus?.isConnected && !restoreFocus.closest('#overlay') ? restoreFocus : lanes[0]).focus({preventScroll:true}); return; }
 if(overlay.hidden && document.activeElement instanceof HTMLElement) restoreFocus=document.activeElement;
 overlay.hidden=false;
 gameChildren.forEach(node=>{if(node!==overlay && node instanceof HTMLElement) node.inert=true;});
 const isEnd=phase==='lost';
 overlay.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-kicker">${ranking?'YOUR LITTLE HALL OF FAME':help?'THE LITTLE HANDBOOK':phase==='ready'?'WELCOME TO YOUR HAPPY PLACE':phase==='paused'?'TAKE A LITTLE BREATHER':`${RULES.capacity} PLATES, COUNTLESS SMALL JOYS`}</div><div class="modal-art">${help?sushiSvg('maki'):chefSvg()}<span class="spark spark-one">✧</span><span class="spark spark-two">✦</span></div><h2 id="modal-title">${ranking?'Lovely local runs.':help?'A little sushi magic.':phase==='ready'?'Good things<br>come around.':phase==='paused'?'On a tea break.':'A full belt,<br>a lovely run.'}</h2><p class="modal-description">${ranking?'The best runs on this device, counted in happy guests.':help?'Tap or hold a lane to send sushi clockwise. Match the orders to serve your guests. They are happy to wait.':phase==='ready'?'Your counter. Five lanes of delicious possibilities.<br>Settle in and make a few guests smile.':phase==='paused'?'Your sushi and your guests can wait.<br>Come back when you’re ready.':'Thank you for all those little plates of happiness.'}</p>${ranking?rankingMarkup():help||phase==='ready'?`<div class="tutorial"><div><b>1</b><span>Tap or hold</span></div><i>→</i><div><b>2</b><span>Let it roll</span></div><i>→</i><div><b>3</b><span>Match orders</span></div></div><p class="rules-note">${RULES.capacity} slots on the belt. Filling the last one ends your run.<br>Unclaimed sushi keeps rolling. No hurry — guests will wait.</p>`:''}${isEnd&&!ranking&&!help?`<div class="results"><div><strong>${state.served}</strong><span>GUESTS SERVED</span></div><div><strong>${state.delivered}</strong><span>PIECES ENJOYED</span></div></div>`:''}<button class="primary" id="primary">${ranking?'Back':help?'Got it!':phase==='ready'?'Let’s roll':phase==='paused'?'Back to the kitchen':'One more round'} <span>→</span></button>${!help&&!ranking?`<div class="pause-links"><button class="secondary" id="modal-help">How to play</button><button class="secondary" id="modal-ranking">Local rankings</button>${phase==='paused'?'<button class="secondary" id="restart">Fresh start</button>':''}</div>`:''}<div class="modal-foot">${help?'Hold keys 1–5 · P to pause<br>On iPhone: Share → Add to Home Screen':'FRESH SUSHI. SMALL JOYS. ALL YOURS.'}</div></section>`;
 el('primary').onclick=()=> { clearHold(); if(ranking) ranking=false; else if(help) help=false; else if(phase==='ready') state=startGame(state); else if(phase==='paused') state=resumeGame(state); else { state=restartGame(state,Date.now()); newRun(); } lastPhase='';tone(620);render(); };
 document.getElementById('modal-help')?.addEventListener('click',openHelp);
 document.getElementById('modal-ranking')?.addEventListener('click',openRanking);
 document.getElementById('restart')?.addEventListener('click',()=>{clearHold();state=restartGame(state,Date.now());newRun();lastPhase='';render();});
 requestAnimationFrame(()=>el('primary').focus({preventScroll:true}));
}
function render() {
 setText(el('served'),String(state.served));
 const count=state.plates.length;
 setText(el('capacity'),`${count} / ${RULES.capacity}`);
 if(renderedPlateCount!==count) {
  renderedPlateCount=count;
  const progress=el('progress');
  progress.style.transform=`scaleX(${count/RULES.capacity})`;
  setClass(progress,'nearly-full',count/RULES.capacity>=.83);
 }
 setText(el('status'),state.phase==='playing'?(state.pending.length?'Making room for your sushi…':'Tap or hold a lane · guests can wait'):state.phase==='lost'?'A lovely run, beautifully served':'Your kitchen is ready');
 setClass(launchGate,'loading',state.pending.length>0);
 setDisabled(el('pause') as HTMLButtonElement,state.phase==='ready'||state.phase==='lost');
 if(state.phase!=='playing') clearHold();
 lanes.forEach((button,i)=> { setDisabled(button,state.phase!=='playing'); const key=state.queues[i].join(); if(queueKeys[i]!==key) { queueKeys[i]=key; button.dataset.type=state.queues[i][0]; lanePieces[i].innerHTML=state.queues[i].map((type,j)=>`<span class="piece piece-${j}" data-type="${type}">${sushiSvg(type)}</span>`).join(''); button.setAttribute('aria-label',`Lane ${i+1}: send ${names[state.queues[i][0]]}. Next ${names[state.queues[i][1]]}`); } });
 state.seats.forEach((seat,i)=> { const {node:guest,order,avatar}=guests[i]; const customer=seat.customer; const key=customer?`${customer.id}-${customer.type}-${customer.remaining}`:'empty'; if(guestKeys[i]!==key) { const changed=guestKeys[i]?.split('-')[0]!==key.split('-')[0]; guestKeys[i]=key; order.innerHTML=customer?`${sushiSvg(customer.type)}<strong>×${customer.remaining}</strong>`:'<span class="thanks">See you soon! ♡</span>'; guest.dataset.type=customer?.type ?? ''; guest.dataset.remaining=String(customer?.remaining ?? 0); guest.setAttribute('aria-label',customer?`Guest ${i+1} wants ${customer.remaining} ${names[customer.type]}`:`Guest ${i+1} seat is waiting`); guest.classList.toggle('empty',!customer); if(changed&&customer) { avatar.innerHTML=avatarSvg(customer.id%6); if(!matchMedia('(prefers-reduced-motion: reduce)').matches) avatar.animate([{transform:'translateY(12px)',opacity:0},{transform:'translateY(0)',opacity:1}],{duration:400,easing:'ease-out'}); } } });
 let structureChanged=false;
 activePlateIds.clear();
 for(const plate of state.plates) {
  activePlateIds.add(plate.id);
  let node=plates.get(plate.id);
  if(!node) {
   node=document.createElement('div');
   node.className=`plate ${plate.type}`;
   node.dataset.type=plate.type;
   node.innerHTML=sushiSvg(plate.type);
   el('plates').append(node);
   plates.set(plate.id,node);
   structureChanged=true;
  }
  if(node.dataset.slot!==String(plate.slot)) {
   setData(node,'slot',String(plate.slot));
   structureChanged=true;
  }
 }
 for(const [id,node] of plates) if(!activePlateIds.has(id)) {
  node.remove(); plates.delete(id); structureChanged=true;
 }
 if(structureChanged) {
  occupiedSlots.clear();
  for(const plate of state.plates) occupiedSlots.add(plate.slot);
  slots.forEach((node,i)=>setClass(node,'occupied',occupiedSlots.has(i)));
 }
 updateMotion();
 state.events.filter(event=>event.id>lastEvent).forEach(event=> { lastEvent=event.id; if(event.kind==='serve'||event.kind==='complete') { const effect=document.createElement('span'); effect.className=`float-point float-${event.station}`; effect.textContent=event.kind==='complete'?'Thank you! ♡':'Delicious ♡'; el('effects').append(effect); setTimeout(()=>effect.remove(),1300); if(event.kind==='complete') {tone(800); el('announcement').textContent=`Happy guest! ${state.served} guests served.`;} } });
 if(state.served>best){ best=state.served; save('sushi-loop-guests-best',String(best)); setText(el('best'),String(best)); }
 recordRun();
 if(lastPhase!==state.phase){lastPhase=state.phase; showOverlay();}
 syncAnimation();
}
let runId = ''; let runCreatedAt = 0; let recordedServed = -1; let recordedDelivered = -1; let recordedEnd = false;
function newRun() { runId=globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; runCreatedAt=Date.now(); recordedServed=-1;recordedDelivered=-1;recordedEnd=false;lastEvent=0;el('effects').replaceChildren(); }
function rankingMarkup():string { const entries=readRanking(); return entries.length?`<ol class="ranking-list">${entries.map((entry,i)=>`<li><b>${i+1}</b><strong>${entry.served} ${entry.served===1?'guest':'guests'}</strong><span>${entry.delivered} pieces enjoyed</span></li>`).join('')}</ol>`:'<p class="rules-note">Your first lovely run belongs here.<br>Rankings stay on this device.</p>'; }
function recordRun() { if(state.phase==='ready' || (state.served===0 && state.phase!=='lost')) return; if(state.served!==recordedServed || state.delivered!==recordedDelivered || (state.phase==='lost'&&!recordedEnd)) {recordResult({id:runId,served:state.served,delivered:state.delivered,createdAt:runCreatedAt});recordedServed=state.served;recordedDelivered=state.delivered;recordedEnd=state.phase==='lost';} }
let animationFrame:number | null=null;
let previous:number | null=null;
function syncAnimation() {
 const running=state.phase==='playing' && !document.hidden;
 if(running && animationFrame===null) animationFrame=requestAnimationFrame(frame);
 else if(!running) {
  if(animationFrame!==null) cancelAnimationFrame(animationFrame);
  animationFrame=null;
  previous=null;
 }
}
function frame(now:number) {
 animationFrame=null;
 if(state.phase!=='playing' || document.hidden) { previous=null; return; }
 const delta=previous===null?0:Math.min(.1,(now-previous)/1000);
 previous=now;
 state=advanceGameInPlace(state,delta);
 if(held && now>=nextRepeat && canRepeatLaunch(state)) launch(held.lane,false);
 render();
}
const resizeObserver=new ResizeObserver(entries=> {
 const size=entries[0].contentRect;
 if(arenaWidth===size.width && arenaHeight===size.height) return;
 arenaWidth=size.width;
 arenaHeight=size.height;
 geometryDirty=true;
 render();
});
resizeObserver.observe(arena);
newRun();
initPwa();
render();
