import {createMultiplayerLobbyNativeLauncher} from './presentation/native-launcher';
import {observeWindowLayer,supportsWindowLayer} from './presentation/window-layer';
import type {LauncherAppearance} from './presentation/launcher-appearance';
export const toolIcon=(kind:string)=>kind==='action'?'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m20 3-9 15h7l-6 11L26 12h-8l5-9Z" stroke="currentColor" stroke-width="1.7" fill="currentColor" fill-opacity=".18"/></svg>':'<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 7h22v16H15l-7 5v-5H5Z" stroke="currentColor" stroke-width="1.7"/><path d="M10 12h12M10 17h8" stroke="currentColor" stroke-width="1.7"/></svg>';
export function createToolWindow(host:Window,kind:'action'|'chat',appearance:LauncherAppearance,onToggle:()=>void,onError:(e:unknown)=>void){
 const doc=host.document,title=kind==='action'?'回合行动':'队伍聊天室';
 const panel=doc.createElement('section');panel.className=`mm-lobby mm-utility mm-${kind}-window`;panel.dataset.presentation='native';panel.hidden=true;panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);panel.style.setProperty('--mm-window-width',kind==='action'?'420':'370');panel.style.setProperty('--mm-window-height',kind==='action'?'650':'540');
 panel.innerHTML=`<header><div class="mm-tool-title">${toolIcon(kind)}<div><b>${title}</b><small>${kind==='action'?'YOUR TURN / YOUR STORY':'PARTY CHANNEL'}</small></div></div><span class="mm-tool-live">●</span></header><div class="mm-tool-content"></div><footer><button type="button" data-tool-back>返回</button></footer>`;
 doc.body.append(panel);let disposed=false,open=false,suspended=false;
 const launcher=createMultiplayerLobbyNativeLauncher({host,icon:'data:image/png;base64,',appearance,product:{name:title,launcherName:title},dockKey:`miemie_multiplayer_lobby_${kind}_dock_v1`,defaultRatio:kind==='action'?.28:.43,baseSize:50,open:()=>show(),requestBack:()=>close(),onError});
 const orb=launcher.getOrigin()!;orb.dataset.lobbyTool=kind;orb.innerHTML=`<span class="mm-orb-flame" aria-hidden="true"></span><span class="mm-orb-icon">${toolIcon(kind)}</span><span class="mm-orb-badge" aria-hidden="true" hidden></span><span class="mm-orb-sparks" aria-hidden="true"><i></i><i></i><i></i></span>`;
 const stopLayer=observeWindowLayer(host,panel);
 const useWindowLayer=supportsWindowLayer(orb);
 // Keep the small launchers reachable while the other tool is open, including narrow screens.
 function foreground(){if(disposed||suspended||!useWindowLayer)return;try{if(!orb.hasAttribute('popover'))orb.setAttribute('popover','manual');if(orb.matches(':popover-open'))orb.hidePopover();orb.showPopover();}catch{}}
 async function show(){if(disposed||suspended)return;open=true;onToggle();await launcher.show(panel);if(!disposed)onToggle();}
 async function close(){if(disposed||suspended)return;open=false;await launcher.close(panel);if(!disposed){foreground();onToggle();}}
 panel.querySelector('[data-tool-back]')!.addEventListener('click',()=>void close());
 const key=(e:KeyboardEvent)=>{if(e.key!=='Escape'||panel.hidden||panel.inert||!panel.contains(doc.activeElement))return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)void close();};doc.addEventListener('keydown',key,true);
 foreground();
 return {panel,content:panel.querySelector<HTMLElement>('.mm-tool-content')!,orb,show,close,isOpen:()=>open,foreground,
  suspend(value:boolean){
   if(disposed||suspended===value)return;
   suspended=value;
   if(value){
    open=false;launcher.release();
    if(useWindowLayer&&orb.matches(':popover-open'))orb.hidePopover();
    orb.removeAttribute('popover');orb.hidden=true;
   }else{orb.hidden=false;foreground();}
  },
  alert(attention:boolean,count:number,storyUnread=false,label=''){orb.dataset.attention=String(attention);orb.dataset.unread=String(count>0||storyUnread);orb.setAttribute('aria-label',`${title}，${label}${count?'，'+count+' 条未读':''}${storyUnread?'，有新剧情':''}`);const badge=orb.querySelector<HTMLElement>('.mm-orb-badge')!;badge.hidden=!count&&!storyUnread;badge.textContent=count?count>99?'99+':String(count):'•';orb.title=`${title} · ${label}`;},
  dispose(){if(disposed)return;disposed=true;open=false;doc.removeEventListener('keydown',key,true);launcher.dispose();stopLayer();panel.remove();}
 };
}
