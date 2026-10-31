import { animate } from 'motion/mini';

type Control = ReturnType<typeof animate>;
type Guest = { node: HTMLElement; avatar: HTMLElement };
/** Native, bounded scene animations. No animation-frame loop or layout reads. */
export function createGameAnimations({ effects, chef, guests, lanes }: { effects: HTMLElement; chef: HTMLElement; guests: Guest[]; lanes: HTMLButtonElement[] }) {
 const preference = matchMedia('(prefers-reduced-motion: reduce)');
 const idle = new Set<Control>();
 const transient = new Set<Control>();
 const channels = new Map<Element, Set<Control>>();
 const poses = new Map<Element, Map<string,string>>();
 function restore(node:Element) { const style=(node as HTMLElement).style; for(const [property,value] of poses.get(node) ?? []) {if(value) style.setProperty(property,value);else style.removeProperty(property);} poses.delete(node); }
 let playing = false, generation = 0, lastMilestone = 0;
 const active = () => playing && !document.hidden && !preference.matches;
 function cancel(set: Set<Control>) { for(const control of set) control.cancel(); set.clear(); }
 function motion(node: Element | null, frames: Parameters<typeof animate>[1], duration=.5, loop=false, delay=0, done?:()=>void, finiteInactive=false) {
  if(!node || preference.matches || document.hidden || (!finiteInactive && !playing)) return;
  const pose=poses.get(node) ?? new Map<string,string>();
  for(const property of Object.keys(frames)) if(!pose.has(property)) pose.set(property,(node as HTMLElement).style.getPropertyValue(property));
  poses.set(node,pose);
  const bucket=loop?idle:transient;
  const control=animate(node,frames,{duration,delay,ease:'easeInOut',...(loop?{repeat:Infinity}:{})});
  bucket.add(control);
  const owned=channels.get(node) ?? new Set<Control>(); owned.add(control); channels.set(node,owned);
  const run=generation;
  void control.finished.then(()=> { bucket.delete(control); owned.delete(control); control.cancel(); if(!owned.size && channels.get(node)===owned) {channels.delete(node);restore(node);} if(run===generation) done?.(); }).catch(()=>{});
 }
 function stopNode(root:Element,subtree=true) {
  for(const [node,controls] of channels) if(node===root || (subtree && root.contains(node))) { for(const control of controls) {control.cancel(); idle.delete(control);transient.delete(control);} channels.delete(node); restore(node); }
 }
 function breathingWrapper(avatar:HTMLElement) {
  let wrapper=avatar.querySelector<HTMLElement>('.character-breath');
  if(!wrapper) {wrapper=document.createElement('div');wrapper.className='character-breath';wrapper.append(...Array.from(avatar.childNodes));avatar.append(wrapper);}
  return wrapper;
 }
 function idleGuest(guest:Guest,index:number) {
  if(guest.node.classList.contains('empty')) return;
  motion(breathingWrapper(guest.avatar),{transform:['translateY(0px) rotate(-.7deg)','translateY(-2px) rotate(.7deg)','translateY(0px) rotate(-.7deg)']},3.4+index*.25,true);
  motion(guest.avatar.querySelector('.character-eyes'),{opacity:[...Array(18).fill(1),0,1]},4.7+index*.43,true);
 }
 function startIdle() {
  if(!active()) return;
  guests.forEach(idleGuest);
  motion(chef,{transform:['translateY(0px)','translateY(-2px)','translateY(0px)']},3.8,true);
  motion(chef.querySelector('.chef-eyes'),{opacity:[...Array(18).fill(1),0,1]},5.6,true);
 }
 function clear() {
  generation++; cancel(idle);cancel(transient);channels.clear();for(const node of poses.keys()) restore(node);effects.replaceChildren();
  guests.forEach(guest=>guest.node.classList.remove('savoring','celebrating'));
 }
 function setPlaying(value:boolean) {
  if(playing===value) return;
  playing=value;clear();startIdle();
  if(value) guests.forEach(guest=>motion(guest.avatar,{transform:['translateY(12px) scale(.9)','translateY(-3px) scale(1.025)','translateY(0px) scale(1)'],opacity:[0,1,1]},.5));
 }
 function arrival(index:number,markup?:string) {
  const guest=guests[index];stopNode(guest.avatar);if(markup) guest.avatar.innerHTML=markup;guest.node.classList.remove('celebrating','savoring');
  motion(guest.avatar,{transform:['translateY(22px) scale(.72) rotate(-7deg)','translateY(-5px) scale(1.04) rotate(3deg)','translateY(0px) scale(1) rotate(0deg)'],opacity:[0,1,1]},.65);
  idleGuest(guest,index);
 }
 const anchors=[[17,74],[17,18],[83,18],[83,74]];
 function particle(index:number, text:string, major=false) {
  if(!active() || effects.childElementCount>=24) return;
  const node=document.createElement('span');const [x,y]=anchors[index];
  node.className=text.length>2?'joy-caption':'joy-spark';node.textContent=text;node.style.left=`${x}%`;node.style.top=`${y}%`;
  effects.append(node);
  const drift=(Math.random()-.5)*(major?85:50);
  motion(node,{transform:[`translate(-50%,0) scale(.5) rotate(-12deg)`,`translate(calc(-50% + ${drift*.4}px),-18px) scale(1) rotate(5deg)`,`translate(calc(-50% + ${drift}px),-${major?66:44}px) scale(.8) rotate(14deg)`],opacity:[0,1,0]},.95,false,0,()=>node.remove());
 }
 function serve(index:number) {
  if(!active()) return;
  const guest=guests[index]; if(guest.node.classList.contains('celebrating')) return;
  stopNode(guest.avatar,false);
  guest.node.classList.add('savoring');
  motion(guest.avatar,{transform:['rotate(0deg) translateY(0px)','rotate(7deg) translateY(3px)','rotate(-3deg) translateY(-1px)','rotate(0deg) translateY(0px)']},.65,false,0,()=>guest.node.classList.remove('savoring'));
  stopNode(guest.node.querySelector('.order')!);
  motion(guest.node.querySelector('.order'),{transform:['scale(1)','scale(1.09)','scale(1)']},.35);
  particle(index,'♡');
 }
 function complete(index:number,total:number) {
  if(!active()) return;
  const guest=guests[index];stopNode(guest.avatar);guest.node.classList.remove('savoring');guest.node.classList.add('celebrating');
  motion(guest.avatar.querySelector('.character-head'),{transform:['rotate(-8deg)','rotate(7deg)','rotate(0deg)']},.55);
  motion(guest.avatar.querySelector('.character-arm-left'),{transform:['rotate(0deg)','rotate(135deg)','rotate(110deg)']},.4);
  motion(guest.avatar.querySelector('.character-arm-right'),{transform:['rotate(0deg)','rotate(-135deg)','rotate(-110deg)']},.4);
  motion(guest.avatar,{transform:['translateY(0px) scale(1)','translateY(-9px) scale(1.05)','translateY(0px) scale(1)','translateY(14px) scale(.94)'],opacity:[1,1,1,0]},1,false,0,()=>guest.node.classList.remove('celebrating'));
  particle(index,'Thank you! ♡');
  for(let n=0;n<5;n++) particle(index,n%2?'✦':'♡');
  const milestone=Math.floor(total/5)*5;
  if(milestone>lastMilestone && milestone>0) {
   lastMilestone=milestone;
   const previous=effects.querySelector('.celebration-banner');
   if(previous) {stopNode(previous);previous.remove();}
   if(effects.childElementCount>=24) return;
   const banner=document.createElement('span');banner.className='celebration-banner';banner.textContent=`${milestone} happy guests · made with love ♡`;effects.append(banner);
   motion(banner,{transform:['translate(-50%,8px) scale(.9)','translate(-50%,0px) scale(1)','translate(-50%,-5px) scale(1)'],opacity:[0,1,0]},1,false,0,()=>banner.remove());
   for(let n=0;n<6;n++) particle((index+n)%4,n%2?'✧':'✦',true);
  }
 }
 function launch(index:number) {
  const arm=chef.querySelector('.chef-arm'); if(arm) stopNode(arm);
  motion(arm,{transform:['rotate(0deg)','rotate(-28deg)','rotate(13deg)','rotate(0deg)']},.42);
  motion(lanes[index].querySelector('.lane-arrow'),{transform:['translateY(0px)','translateY(-6px)','translateY(0px)']},.3);
 }
 function plateAdded(node:HTMLElement) { motion(node.querySelector('svg'),{transform:['scale(.65) rotate(-10deg)','scale(1.05) rotate(6deg)','scale(1) rotate(0deg)'],opacity:[0,1,1]},.42); }
 function modal(node:Element) {
  // Dialogs may enter while the scene is stopped; this finite animation never loops.
  motion(node,{transform:['translateY(12px) scale(.97)','translateY(0px) scale(1)'],opacity:[0,1]},.22,false,0,undefined,true);
 }
 function changed() {clear();startIdle();}
 preference.addEventListener('change',changed);
 document.addEventListener('visibilitychange',changed);
 return {setPlaying,arrival,launch,serve,complete,plateAdded,modal,reset(){playing=false;lastMilestone=0;clear();},dispose(){clear();preference.removeEventListener('change',changed);document.removeEventListener('visibilitychange',changed);}};
}
