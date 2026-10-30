import './style.css';
import { createGame, startGame, tick, launchPlate, pauseGame, resumeGame, restartGame, RULES, STATIONS, type SushiType } from './engine';
const names: Record<SushiType, string> = { salmon: 'Salmon', tuna: 'Tuna', maki: 'Maki', shrimp: 'Shrimp', tamago: 'Tamago' };
const emoji: Record<SushiType, string> = { salmon: '🍣', tuna: '🍣', maki: '🍙', shrimp: '🍤', tamago: '🥚' };
let state = createGame(Date.now());
let best = 0;
try { best = Number(localStorage.getItem('sushi-loop-best')) || 0; } catch { /* Storage is optional. */ }
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main><header><h1>Sushi Loop</h1><button id="pause">Pause</button></header><p>Tap a queue to send sushi. Match your guests' orders!</p><div id="stats"></div><div id="board"><div class="belt"></div><div id="guests"></div><div id="plates"></div></div><div id="queues"></div><div id="message" role="status"></div><button id="start">Start service</button><button id="restart">New shift</button><p>Complete orders before guests lose patience. Reach ${RULES.goal} points in 90 seconds.</p></main>`;
function point(p: number) { const angle = p * Math.PI * 2 + Math.PI / 2; return { x: 50 + Math.cos(angle) * 35, y: 50 + Math.sin(angle) * 35 }; }
function render() {
  if (state.score > best) { best = state.score; try { localStorage.setItem('sushi-loop-best', String(best)); } catch { /* Private browsing. */ } }
  document.querySelector('#stats')!.textContent = `${Math.ceil(RULES.duration - state.elapsed)}s · ${state.score}/${RULES.goal} pts · ${state.coins} coins · Combo ${state.combo} · Best ${best}`;
  document.querySelector('#guests')!.innerHTML = state.seats.map((seat, i) => { const p = point(STATIONS[i]); const c = seat.customer; return `<div class="guest" style="left:${p.x}%;top:${p.y}%">${c ? `${names[c.type]} ${emoji[c.type]}<br>${c.remaining}/${c.quantity}<progress max="${c.maxPatience}" value="${c.patience}"></progress>` : 'Next guest…'}</div>`; }).join('');
  document.querySelector('#plates')!.innerHTML = state.plates.map(plate => { const p = point(plate.position); return `<span class="plate" style="left:${p.x}%;top:${p.y}%" title="${names[plate.type]}">${emoji[plate.type]}</span>`; }).join('');
  document.querySelector('#queues')!.innerHTML = state.queues.map((queue, i) => `<button data-lane="${i}" ${state.phase !== 'playing' || state.plates.length >= RULES.capacity ? 'disabled' : ''}><strong>${names[queue[0]]}</strong><br>${queue.map(t => emoji[t]).join('<br>')}</button>`).join('');
  document.querySelector('#message')!.textContent = state.phase === 'won' ? 'Beautiful service! Goal reached.' : state.phase === 'lost' ? 'Shift over. Try another service!' : state.phase === 'paused' ? 'Service paused' : `${state.plates.length}/${RULES.capacity} plates · ${state.misses}/${RULES.maxMisses} guests missed`;
  document.querySelector('#pause')!.textContent = state.phase === 'paused' ? 'Resume' : 'Pause';
  (document.querySelector('#start') as HTMLButtonElement).hidden = state.phase !== 'ready';
}
app.addEventListener('click', e => { const target = (e.target as HTMLElement).closest('button'); if (!target) return; if (target.dataset.lane !== undefined) state = launchPlate(state, Number(target.dataset.lane)); if (target.id === 'start') state = startGame(state); if (target.id === 'restart') state = restartGame(state, Date.now()); if (target.id === 'pause') state = state.phase === 'paused' ? resumeGame(state) : pauseGame(state); render(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { state = pauseGame(state); render(); } });
let previous = performance.now();
function frame(now: number) { state = tick(state, Math.min((now - previous) / 1000, 0.1)); previous = now; render(); requestAnimationFrame(frame); }
render(); requestAnimationFrame(frame);
