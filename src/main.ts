import {Controller} from './controller.mjs';
import {createAdapter} from './adapter.mjs';
import {startLobbyPresentation} from './presentation/lobby-presentation';
import {createLobbyHeader} from './presentation/lobby-header';
import {createLauncherAppearance} from './presentation/launcher-appearance';
import {observeWindowLayer} from './presentation/window-layer';
import {createLauncherSettings} from './launcher-settings';
import {createIcon} from './presentation/icons';
import {MULTIPLAYER_LOBBY_PRODUCT as PRODUCT} from './presentation/product-identity';
import {createToolWindow} from './tool-window';
import {createActivityTracker,turnState} from './activity.mjs';
import {createViews,paint,escape,button,mapProgressLabel} from './views';
import styles from './ui.css';
import {createOpeningCeremony} from './opening-ceremony';
import {createChatComposerLock} from './chat-composer-lock';
import {createLobbyConfirmation} from './confirmation';
import {createAttachmentPreview} from './attachment-preview';
import ICON from '../assets/multiplayer-lobby-icon.png';
const host=window.parent?.SillyTavern?window.parent:window;
const key='__miemieMultiplayerLobbyV1';
const previous = host[key];
if (!previous) boot();
else if (previous.disposed) {
 const cancel = () => {cancelled=true;};
 let cancelled=false;
 window.addEventListener('pagehide',cancel,{once:true});
 window.addEventListener('unload',cancel,{once:true});
 void previous.settled.then(() => {
  window.removeEventListener('pagehide',cancel);window.removeEventListener('unload',cancel);
  if(!cancelled&&!host[key])boot();
 });
}
function boot(){
 const doc=host.document,adapter=createAdapter(host,host.TavernHelper||window.TavernHelper);
 const panel=doc.createElement('section');panel.className='mm-lobby mm-main';panel.hidden=true;panel.inert=true;panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',PRODUCT.name);
 const frame=doc.createElement('div');frame.className='mm-frame';panel.append(frame);
 frame.innerHTML=`<header class="mm-lobby-header">
  <div class="mm-brand">
   <img class="mm-product-icon" data-tool-icon="multiplayer-lobby" src="${ICON}" alt="" draggable="false">
   <div class="mm-brand-text"><h2>${PRODUCT.name} ${PRODUCT.version}</h2><p class="mm-subtitle"></p></div>
  </div>
  <button type="button" data-act="settings" class="mm-settings-button" aria-label="悬浮球设置" title="悬浮球设置" aria-haspopup="dialog" aria-controls="mm-lobby-launcher-settings"></button>
 </header><div class="mm-main-body"></div>`;
 const content=frame.querySelector<HTMLElement>('.mm-main-body')!;
 const header=createLobbyHeader(frame.querySelector<HTMLElement>('.mm-subtitle')!,()=>host.SillyTavern?.getContext(),
  ()=>{
   controller?.refreshHostChat();void controller?.checkRoomAssets();refreshLinkedChat();
   if(controller&&!controller.view&&entryTab==='create'&&hostChatAvailable!==canHost())render();
  },refreshPersonas);
 frame.querySelector('[data-act="settings"]')!.append(createIcon(doc,'settings'));
 const css=doc.createElement('style');css.textContent=styles;doc.head.append(css);doc.body.append(panel);
 const ceremony=createOpeningCeremony(host,ICON);let previousPhase='',previousRoom='',pendingCeremony=false;
 const composerLock=createChatComposerLock(doc);
 const confirmation=createLobbyConfirmation(doc);
 const attachmentPreview=createAttachmentPreview(doc);
 let mapProgressFrame=0;
 let openAttachment:{resultId:string,hash:string,path:string,branchId:string|null} | null=null;
 const appearance=createLauncherAppearance(host),settings=createLauncherSettings(panel,frame,appearance),tracker=createActivityTracker();
 let disposed=false,composing=false,entryTab='join',busy=0,notice='',controller:any,roomId:string|null=null,tools:Record<string,ReturnType<typeof createToolWindow>>={};
 const drafts={...adapter.profile(),title:'今晚一起冒险',invite:'',chat:'',action:'',network:'',actionVisibility:'public',password:'',joinMode:'short',intro:'',rules:'',opening:'',resumePassword:''};
 const personaDraft={personas:adapter.personas(),personaId:''};
 Object.assign(drafts,personaDraft);
 let lastTavernPersonaId='';
 let hostChatAvailable=false;
 function syncPersonas(){
  const personas=adapter.personas(),activeId=adapter.activePersonaId(personas);
  const selected=personas.find(p=>p.id===(activeId!==lastTavernPersonaId?activeId:personaDraft.personaId))
   ?? personas.find(p=>p.id===activeId);
  lastTavernPersonaId=activeId;
  const {name,description}=selected??adapter.profile(),personaId=selected?.id??'';
  const changed=personaId!==personaDraft.personaId||name!==drafts.name||description!==drafts.description
   || JSON.stringify(personas)!==JSON.stringify(personaDraft.personas);
  Object.assign(personaDraft,{personas,personaId});
  Object.assign(drafts,personaDraft,{name,description});
  return changed;
 }
 function refreshPersonas(){
  if(disposed||controller?.view||!syncPersonas())return;
  const active=doc.activeElement as HTMLElement|null;
  const picker=active?.closest('.mm-persona-picker');
  const action=picker?active?.dataset.act:undefined;
  render();
  if(picker){
   const next=frame.querySelector('.mm-persona-picker');
   const button=action?[...next?.querySelectorAll<HTMLButtonElement>('button')??[]].find(node=>node.dataset.act===action):undefined;
   (button??next?.querySelector('summary'))?.focus({preventScroll:true});
  }
 }
 const views=createViews(drafts);
 controller=new Controller(host.localStorage,adapter,(_controller,reason)=>{
  if(reason==='map-progress'){
   if(!mapProgressFrame)mapProgressFrame=host.requestAnimationFrame(()=>{
    mapProgressFrame=0;
    if(controller.mapSync?.state!=='downloading')return;
    const label=content.querySelector('[data-map-progress]');
    if(label)label.textContent=mapProgressLabel(controller.mapSync);
   });
  }else render();
 },undefined,host.sessionStorage);
 const floorEvents=adapter.onFloorChange(messageId=>{
  controller.scheduleNativeSync(messageId);
  refreshAttachmentRails();
 });
 let embeddedTool: 'action'|'chat'|null=null;
 const stopLayer=observeWindowLayer(host,panel);
 const presentation=startLobbyPresentation({
  host,panel,icon:ICON,appearance,
  dismissLayer,resetLayers,
  onChange(){
   header.refresh(presentation.isActive());floorEvents.connect();
   if(presentation.isActive())controller.refreshHostChat();
   if(!presentation.isSurface()&&embeddedTool){embeddedTool=null;composing=false;}
   render();foreground();
  },
  onStop(){controller.close();drafts.password='';},
  onError:fail,
 });
 function clearToolView(){
  embeddedTool=null;composing=false;render();
 }
 function dismissLayer(){
  const picker=frame.querySelector<HTMLDetailsElement>('.mm-persona-picker[open]');
  if(settings.close())return true;
  if(picker?.contains(doc.activeElement)){
   picker.open=false;picker.querySelector('summary')?.focus({preventScroll:true});return true;
  }
  if(!embeddedTool)return false;
  const tool=embeddedTool;
  clearToolView();
  frame.querySelector<HTMLElement>(`[data-act="open:${tool}"]`)?.focus({preventScroll:true});
  return true;
 }
 function resetLayers(){
  settings.close();ceremony.close(false);confirmation.cancel();attachmentPreview.close();embeddedTool=null;composing=false;
 }
 function foreground(){if(ceremony.isOpen()||!presentation.canUseTools())return;for(const t of Object.values(tools))t.foreground();}
 function fail(error:any){if(disposed)return;notice=error?.message||String(error);render();}
 function refreshLinkedChat(){
  const binding=controller?.chatBinding();
  const inLinkedChat=!!binding&&controller.view?.phase!=='ended'&&adapter.matchesChat(binding);
  composerLock.sync(inLinkedChat);
  if(controller?.mode==='guest'){
   try{adapter.refreshMapPreset(binding,inLinkedChat);}catch(error){console.warn('[咩咩联机大厅]',error);}
  }
  if(binding)void controller.syncTranscript();
  refreshAttachmentRails();
 }
 async function showAttachment(resultId:string,index:number){
  const room=controller.view;
  const result=room?.results.find(row=>row.id===resultId);
  const attachment=result?.attachments?.[index];
  if(!attachment)return;
  if(controller.attachments.status(attachment.hash)==='failed'){controller.attachments.retry(attachment.hash);return;}
  const url=await controller.attachments.open(attachment);
  if(!url)throw Error('附件尚未存储成功');
  if(!disposed&&controller.view?.id===room.id&&controller.view.branch?.id===room.branch?.id){
   openAttachment={resultId,hash:attachment.hash,path:attachment.path,branchId:room.branch?.id??null};
   attachmentPreview.open(attachment.path,attachment.type,url);
  }
 }
 function refreshAttachmentRails(){
  const view=controller?.view,binding=controller?.chatBinding();
  const active=new Set<HTMLElement>();
  if(binding&&view?.results.some(row=>row.attachments?.length)&&adapter.matchesChat(binding)){
   for(const {id,floor} of adapter.resultFloors(binding)){
    const result=view.results.find(row=>row.id===id);
    if(!result?.attachments?.length)continue;
    const message=doc.querySelector<HTMLElement>('#chat .mes[mesid="'+floor+'"] .mes_text');
    if(!message)continue;
    const ready=result.attachments.map(entry=>controller.mode==='host'?'ready':controller.attachments.status(entry.hash));
    let rail=message.nextElementSibling as HTMLElement;
    const signature=JSON.stringify([id,result.attachments.map(entry=>[entry.hash,entry.path]),ready]);
    if(!rail?.classList.contains('mm-lobby-native-attachments')){
     rail=doc.createElement('div');rail.className='mm-lobby-native-attachments';message.after(rail);
    }
    active.add(rail);
    if(rail.dataset.entries===signature)continue;
    rail.dataset.entries=signature;
    rail.replaceChildren(...result.attachments.map((entry,index)=>{
     const control=doc.createElement('button');
     control.type='button';
     control.textContent=(ready[index]==='failed'?'重试 · ':'')+entry.path.split('/').at(-1);
     control.disabled=ready[index]==='pending';
     control.addEventListener('click',()=>void showAttachment(id,index).catch(fail));
     return control;
    }));
   }
  }
  for(const rail of doc.querySelectorAll<HTMLElement>('.mm-lobby-native-attachments'))if(!active.has(rail))rail.remove();
 }
 function canHost(){
  try{adapter.hostChat();return true;}catch{return false;}
 }
 function bindInput(node:HTMLElement){
  node.addEventListener('input',e=>{const target=e.target as HTMLInputElement;if(target.dataset.field)drafts[target.dataset.field]=target.value;});
  node.addEventListener('compositionstart',()=>{composing=true;});node.addEventListener('compositionend',()=>{composing=false;render();});
  node.addEventListener('click',handleClick);
 }
 function render(){
  if(disposed||!controller)return;
  const v=controller.view;
  if(openAttachment&&(openAttachment.branchId!==(v?.branch?.id??null)||!v?.results.some(row=>
   row.id===openAttachment.resultId&&row.attachments?.some(entry=>entry.hash===openAttachment.hash&&entry.path===openAttachment.path)))){
   attachmentPreview.close();openAttachment=null;
  }
  hostChatAvailable=!v&&entryTab==='create'&&canHost();
  refreshLinkedChat();
  if(!v)syncPersonas();
  const started = v?.id === previousRoom && previousPhase === 'lobby' && v.phase === 'host-action';
  if (previousRoom && previousRoom !== (v?.id || '')) {ceremony.close();pendingCeremony=false;}
  previousRoom=v?.id||'';previousPhase=v?.phase||'';
  if(roomId!==(v?.id||null)){
   confirmation.cancel();
   attachmentPreview.close();
   roomId=v?.id||null;embeddedTool=null;composing=false;drafts.action='';drafts.chat='';
   for(const t of Object.values(tools))t.dispose();
   tools={};tracker.update(null,controller.myId);
  }
  const canUseTools=presentation.canUseTools();
  if(v&&presentation.isActive()&&!tools.action){
   for(const kind of ['action','chat'] as const){
    tools[kind]=createToolWindow(host,kind,appearance,()=>{render();foreground();},fail);
    bindInput(tools[kind].content);
   }
  }
  for(const t of Object.values(tools)){
   if(!canUseTools&&t.isOpen())composing=false;
   t.suspend(!canUseTools);
  }
  if(started)pendingCeremony=true;
  const surfaceOpen=presentation.isSurface()&&!panel.hidden&&!panel.inert;
  if(pendingCeremony&&(canUseTools||surfaceOpen)){
   pendingCeremony=false;
   if(surfaceOpen)embeddedTool='action';
   ceremony.show(()=>presentation.canUseTools()?tools.action?.orb||presentation.origin():panel);
  }
  let toolView='';
  if(v&&tools.action){
   const turn=turnState(v,controller.myId,controller.connected,controller.mode==='host');
   const alerts=tracker.update(v,controller.myId,{
    chatOpen:embeddedTool==='chat'||tools.chat.isOpen(),actionOpen:embeddedTool==='action'||tools.action.isOpen(),
   });
   tools.action.alert(turn.attention,0,alerts.storyUnread,turn.label);
   tools.chat.alert(false,alerts.chatUnread,false,controller.connected?'队伍频道':'连接中');
   if(!composing){
    const actionView=views.action(controller,!!busy,turn)+message(v.error);
    const chatView=views.chat(controller)+message();
    paint(tools.action.content,embeddedTool==='action'?'':actionView);
    paint(tools.chat.content,embeddedTool==='chat'?'':chatView);
    toolView=embeddedTool==='action'?actionView:chatView;
   }
  }
  if(composing)return;
  const body=embeddedTool
   ? `<div class="mm-tool-content" role="region" aria-label="${embeddedTool==='action'?'回合行动':'队伍聊天室'}">${toolView}</div>`
   : `<div class="mm-scroll" data-scroll="lobby">${v?views.lobby(controller,!!busy,presentation.isSurface()):views.entry(controller,!!busy,entryTab,hostChatAvailable)}</div>${message()}`;
  paint(content,`${body}<footer><span>${v?'联机已建立 · 收起大厅不离开房间':'为下一场故事，集结你的队伍'}<small>SheepSheep</small></span>${button('close',embeddedTool?'返回大厅':'返回')}</footer>`);
 }
 function message(extra=''){const text=notice||controller.error||extra;return text?`<div class="mm-notice" role="status">${escape(text)}</div>`:'';}
 async function handleClick(e:Event){
  const control=(e.target as Element).closest<HTMLElement>('[data-act]');
  const action=control?.dataset.act;if(!action||disposed||!presentation.isActive())return;
  const room=controller.view?.id;
  const ask=async (title:string,description:string,confirm:string,danger=false)=>
   await confirmation.ask({title,description,confirm,danger},control)
   &&!disposed&&room===controller.view?.id;
  if(action==='preview-opening'){
   control.focus({preventScroll:true});
   ceremony.show();
   return;
  }
  if(action==='settings'){settings.open();return;}
  if(action==='close'){await presentation.back();foreground();return;}
  const operation=['host','join','restore','resume-guest','start','generate','leave','return-chat'].includes(action);if(operation&&busy)return;
  const restorePicker = action.startsWith('select-persona:');
  const restoreControl = ['entry:join','entry:create','mode:public','mode:hidden','persona','return-chat'].includes(action);
  if(operation)busy++;notice='';
  try{
   if(action.startsWith('select-persona:')){
    const id=decodeURIComponent(action.slice(15));
    if(adapter.personas().some(persona=>persona.id===id))personaDraft.personaId=id;
    const picker=control?.closest('details');
    if(picker)picker.open=false;
    return;
   }
   if(action.startsWith('entry:')){entryTab=action.slice(6);return;}
   if(action.startsWith('mode:')){drafts.actionVisibility=action.slice(5);return;}
   if(action==='open:action'||action==='open:chat'){
    const kind=action==='open:action'?'action':'chat';
    if(presentation.isSurface()){
     embeddedTool=kind;render();panel.focus({preventScroll:true});
    }else await tools[kind]?.show();
    return;
   }
   if(action==='persona'){syncPersonas();}
   else if(action==='map-confirm'){
    if(!panel.hidden&&!controller.mapChat)await presentation.back();
    await controller.installRoomMap();
   }
   else if(action==='map-check'){
    if(!await controller.checkRoomAssets()&&controller.mapSync?.state!=='asset-error')
     notice='请打开联机对话并启用随包脚本和正则后再准备。';
   }
   else if(action==='map-retry')controller.requestRoomMap();
   else if(action==='transcript-retry'){controller.transcriptError='';refreshLinkedChat();}
   else if(action==='resume-guest'){
    render();await controller.resumeGuest(drafts.resumePassword);drafts.resumePassword='';
   }
   else if(action==='return-chat'){
    render();
    if(await controller.returnToLinkedChat()){await presentation.close();foreground();}
   }
   else if(['host','join','restore'].includes(action)){
    render();controller.config=drafts.network.trim()?JSON.parse(drafts.network):{};
    if(action==='restore')await controller.host(null,null,true);
    else{
     const selected=personaDraft.personas.find(p=>p.id===personaDraft.personaId);
     if(!selected)throw Error('请先在酒馆笑脸中创建身份，再从列表选择');
     Object.assign(drafts,{name:selected.name,description:selected.description});
     const persona={name:selected.name,description:selected.description};
     if(action==='join')await controller.join(drafts.invite,persona,undefined,{password:drafts.password});
     else await controller.host(persona,drafts.title,false,drafts.actionVisibility,{
      mode:drafts.joinMode,password:drafts.password,scene:{intro:drafts.intro,rules:drafts.rules,opening:drafts.opening},
     });
    }
    drafts.password='';
   }
   else if(action==='copy'||action==='copy-full'){await host.navigator.clipboard.writeText(action==='copy-full'?controller.invite:controller.roomCode||controller.invite);notice=action==='copy-full'?'完整邀请已复制（不含密码）':'房间邀请已复制';}
   else if(action.startsWith('lock:')){const seat=Number(action.split(':')[1]);controller.lock(seat,!controller.view.lockedSeats?.[seat]);}
   else if(action.startsWith('move:'))controller.send('move',{seat:Number(action.slice(5))});
   else if(action.startsWith('kick:')){
    const seat=Number(action.slice(5)),player=controller.view?.players[seat];
    if(player&&await ask('移出队友',`将「${player.name}」移出房间？开局后的角色与已提交行动会保留。`,'移出',true)
     &&controller.view.players[seat]?.id===player.id)controller.kick(seat);
   }
   else if(action.startsWith('skip:')){
    const seat=Number(action.slice(5)),round=controller.view.round;
    if(await ask('跳过离线角色','该角色本轮会按跳过行动处理。','跳过',true)&&controller.view.round===round)controller.skip(seat);
   }
   else if(action==='ready')controller.send('ready',{ready:!controller.view.players.find(p=>p?.id===controller.myId)?.ready});
   else if(action==='start'){if(await controller.start()){if(!presentation.isSurface())await presentation.close();foreground();}}
   else if(action==='generate'){render();await controller.generate();}
   else if(action==='cancel')controller.cancel();
   else if(action==='action'){controller.send('action',{content:drafts.action});drafts.action='';}
   else if(action.startsWith('reroll:')||action.startsWith('branch:')){
    const [kind,resultId]=action.split(':');
    if(await ask(kind==='reroll'?'发起重 Roll 投票':'发起分支投票',
     (kind==='reroll'?'用原行动重新生成上轮回复。':'从该剧情楼层另存一段对话，再带全队进入分支。')+
     '发起计为一票赞成，60 秒内须获得在线玩家一致同意。','发起投票')){
     controller.send('propose-vote',{kind,resultId});
    }
   }
   else if(action.startsWith('vote:')&&controller.view?.vote){
    controller.send('cast-vote',{voteId:controller.view.vote.id,yes:action==='vote:yes'});
   }
   else if(action.startsWith('processor:'))controller.toggleProcessor(action.slice(10));
   else if(action.startsWith('attachment:')){
    const [,result,index]=action.split(':');
    await showAttachment(result,Number(index));
   }
   else if(action==='chat'){controller.send('chat',{content:drafts.chat});drafts.chat='';}
   else if(action==='clear'){
    if(await ask('清空队伍聊天','所有玩家的队伍聊天室记录都会清空。','清空记录',true))controller.clearChat();
   }
   else if(action==='end'){
    if(await ask('结束联机','所有玩家将离开房间，队伍聊天室记录也会清空。','结束联机',true))await controller.end();
   }
   else if(action==='leave'){
    if(await ask('离开房间','如需继续，可以通过原邀请重新加入。','离开房间',true))await controller.leave();
   }
   else if(action==='reconnect')await controller.reconnect();
   else if(action.startsWith('takeover:'))controller.requestTakeover(Number(action.slice(9)));
   else if(action.startsWith('approve:'))controller.approve(Number(action.split(':')[1]));
   else if(action.startsWith('append:')){
    controller.refreshHostChat();
    if(controller.hostChatPaused)throw Error('请返回联机房间绑定的酒馆聊天');
    const r=controller.view.results[Number(action.split(':')[1])];
    if(await ask('写入酒馆聊天','将这一轮的剧情和你的状态栏写入当前打开的酒馆聊天。','写入')){
     controller.refreshHostChat();
     if(controller.hostChatPaused)throw Error('请返回联机房间绑定的酒馆聊天');
     await adapter.append(r);notice='已写入当前聊天';
    }
   }
  }catch(error){fail(error);}finally{
   if(operation)busy--;
   render();
   if (restorePicker) frame.querySelector<HTMLElement>('.mm-persona-picker > summary')?.focus({preventScroll:true});
   else if (restoreControl) frame.querySelector<HTMLElement>(`[data-act="${action}"]`)?.focus({preventScroll:true});
  }
 }
 bindInput(frame);panel.querySelector('.mm-settings-layer')!.addEventListener('click',handleClick);
 frame.addEventListener('toggle',event=>{
  const details=event.target as HTMLDetailsElement;
  if(details.open&&details.classList.contains('mm-persona-picker'))refreshPersonas();
 },true);
 const onKey=(e:KeyboardEvent)=>{
  if(e.key!=='Escape'||e.isComposing||presentation.isSurface()||panel.hidden||panel.inert||!panel.contains(doc.activeElement))return;
  e.preventDefault();e.stopImmediatePropagation();
  if(!e.repeat)void presentation.back();
 };doc.addEventListener('keydown',onKey,true);
 let releaseTask=Promise.resolve();
 const rounds=Object.freeze({version:1,apiVersion:1,register:controller.extensions.register,registerRoundProcessor:controller.processors.register});
 const instance={
  get disposed(){return disposed;},
  get settled(){return releaseTask;},
  open:presentation.open,
  dispose(){
   if(disposed)return;
   disposed=true;
   window.removeEventListener('pagehide',onPageHide);
   window.removeEventListener('unload',onPageHide);
   doc.removeEventListener('keydown',onKey,true);
   if(mapProgressFrame)host.cancelAnimationFrame(mapProgressFrame);
   confirmation.dispose();
   attachmentPreview.dispose();floorEvents.disconnect();controller.extensions.dispose();
   controller.close();
   if(host.MieMieMultiplayerLobby===rounds)delete host.MieMieMultiplayerLobby;
   for(const t of Object.values(tools))t.dispose();
   tools={};ceremony.dispose();settings.dispose();header.dispose();composerLock.dispose();
   releaseTask=presentation.dispose().finally(()=>{if(host[key]===instance)delete host[key];});
   stopLayer();panel.remove();css.remove();
  },
 };
 const onPageHide=()=>instance.dispose();
 host[key]=instance;
 host.MieMieMultiplayerLobby=rounds;
 host.dispatchEvent(new host.CustomEvent('miemie:lobby:ready',{detail:rounds}));
 window.addEventListener('pagehide',onPageHide,{once:true});
 window.addEventListener('unload',onPageHide,{once:true});
 render();
}
