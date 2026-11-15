import {toolIcon} from './tool-window';
import {sceneFields} from './room.mjs';
export const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const button=(action:string,label:string,disabled=false,kind='')=>`<button type="button" data-act="${action}" class="${kind}" ${disabled?'disabled':''}>${label}</button>`;
export const phaseName={lobby:'队伍集结','host-action':'房主行动',actions:'队友行动',ready:'准备生成',generating:'剧情生成中',error:'等待重试',ended:'已结束'};
export function mapProgressLabel(sync:any){
 return sync?.parts.length?'正在下载地图 · '+Math.floor(sync.parts.length/sync.total*100)+'%':'正在等待房主发送地图…';
}
export function createViews(drafts:any){
 const input=(name:string,placeholder:string,area=false)=>area?`<textarea data-field="${name}" aria-label="${placeholder}" placeholder="${placeholder}">${escape(drafts[name])}</textarea>`:`<input data-field="${name}" aria-label="${placeholder}" value="${escape(drafts[name])}" placeholder="${placeholder}" ${['password','resumePassword'].includes(name)?'type="password" autocomplete="off" maxlength="64"':''}>`;
 function entry(c:any,busy:boolean,entryTab:string,canHost:boolean){
 const guestResume=c.guestResume.get(),hostResume=c.getHostResume();
 return `
 <div class="mm-entry-hero"><div class="mm-crest" aria-hidden="true"><span>咩</span></div><div class="mm-eyebrow">MIEMIE · MULTIPLAYER ROLEPLAY</div><h1>集结，进入你的故事</h1><p>2—4 位玩家 · 同一个世界 · 各自的命运</p></div>
 ${guestResume||hostResume?`<section class="mm-resume" aria-label="继续上次联机">
  ${guestResume?`<div><strong>继续作为来宾</strong>${guestResume.needsPassword?input('resumePassword','输入原房间密码'):''}${button('resume-guest','重新加入原房间',busy)}</div>`:''}
  ${hostResume?`<div><strong>${escape(hostResume.title)} · 第 ${escape(hostResume.round)} 回合</strong>${button('restore','恢复房主存档',busy)}</div>`:''}
 </section>`:''}
 <nav class="mm-entry-tabs" aria-label="联机方式">${button('entry:join','加入队伍',false,entryTab==='join'?'selected':'')}${button('entry:create','创建房间',false,entryTab==='create'?'selected':'')}</nav>
 <div class="mm-entry-form"><div class="mm-section-label"><span>01</span> 你的身份 ${button('persona','刷新身份列表',busy,'mm-text-button')}</div><div class="mm-profile-row"><span class="mm-profile-seal">${escape(drafts.name.slice(0,1)||'咩')}</span><details data-detail="persona-picker" class="mm-persona-picker"><summary aria-label="选择酒馆身份">${escape(drafts.personaId?drafts.name:'请选择酒馆笑脸中的身份')}<span>⌄</span></summary><div class="mm-persona-options">${(drafts.personas||[]).map(p=>button('select-persona:'+encodeURIComponent(p.id),escape(p.name),false,p.id===drafts.personaId?'selected':'')).join('')||'<p>暂无身份，请先在酒馆笑脸中创建。</p>'}</div></details></div><details data-detail="persona" class="mm-persona-details"><summary>角色身份描述 <span>队友可见</span></summary><p>${escape(drafts.personaId?drafts.description:'请在酒馆笑脸中维护身份资料，在此选择使用。')}</p></details>
 <div class="mm-section-label"><span>02</span> ${entryTab==='join'?'寻找你的队伍':'房间规则'}</div>
 ${entryTab==='join'?`
  <div class="mm-form-columns mm-join-fields">
   <label>房间号${input('invite','输入房间号或完整邀请')}</label>
   <label>密码 · 选填${input('password','无密码可留空')}</label>
  </div>
  ${button('join',busy?'正在连接…':'加入队伍',busy,'primary mm-wide')}
  <p class="mm-fine-print">进房后自动入座，重连回到原席位。</p>
  ${takeoverSeats(c,busy)}`:
 `<label>房间名称</label>${input('title','为这次冒险命名')}<label>行动可见性 · 创建后固定</label><div class="mm-mode-cards">${button('mode:public','<strong>公开行动</strong><small>共享选择，一起推进故事</small>',false,drafts.actionVisibility==='public'?'selected':'')}${button('mode:hidden','<strong>暗行动</strong><small>只看见已提交，保留博弈</small>',false,drafts.actionVisibility==='hidden'?'selected':'')}</div><label>入房密码 · 选填</label>${input('password','留空表示无密码')}<details data-detail="scene-draft" class="mm-network mm-scene-draft"><summary>公开场景资料 · 选填</summary><p>仅同步下面填写的文字，所有入房玩家可见。</p>${sceneFields.map(([key,label,max])=>`<label>${label}<textarea data-field="${key}" maxlength="${max}" aria-label="${label}">${escape(drafts[key])}</textarea></label>`).join('')}</details>${button('host',busy?'正在创建…':'创建房间',busy||!canHost,'primary mm-wide')}${!canHost?'<p class="mm-fine-print" role="status">请先在酒馆打开单个角色的聊天。</p>':''}<p class="mm-fine-print">席位数量在房间内设置。</p>`}
 <details data-detail="network" class="mm-network"><summary>高级连接设置</summary><label>加入方式<select data-field="joinMode"><option value="short" ${drafts.joinMode==='short'?'selected':''}>6 位房间号 + 可选密码</option><option value="long" ${drafts.joinMode==='long'?'selected':''}>兼容旧版长邀请码</option></select></label><p>默认尝试直连。房主和来宾可在这里粘贴 TURN 服务的连线配置，遇到网络限制时会自动尝试中继。</p>${input('network','网络配置 JSON',true)}</details></div>`;}
 function takeoverSeats(c:any,busy:boolean){
  if(c.mode!=='guest'||!c.connected||c.view||['lobby','generating','ended'].includes(c.seatPhase))return '';
  if(!c.seatPhase&&!c.error?.includes('剧情已经开始'))return '';
  const offline=c.seats.filter((seat,index)=>index>0&&seat?.online===false);
  if(!offline.length)return '';
  return `<section class="mm-takeover" aria-label="离线角色"><h3>接管离线角色</h3>
   <p>由房主批准后入座。</p>
   ${offline.map(seat=>button('takeover:'+seat.seat,`${escape(seat.name)} · user${seat.seat}`,busy)).join('')}
  </section>`;
 }
 function seats(c:any,busy:boolean){
  const v=c.view,isHost=c.mode==='host',waiting=v.phase==='lobby';
  return v.players.map((p,n)=>{
   const locked=v.lockedSeats?.[n],mine=p?.id===c.myId;
   let control='';
   if(n>0&&isHost&&p)control=button('kick:'+n,'移出');
   else if(n>0&&waiting&&!p){
    if(isHost)control=button('lock:'+n,locked?'解锁':'锁位',!locked&&v.capacity<=2,'mm-seat-hit');
    else if(!locked)control=button('move:'+n,'换到此位',busy||!c.connected,'mm-seat-hit');
   }
   return `<article data-seat="${n}" class="mm-seat ${p?'occupied':''} ${locked?'locked':''} ${mine?'mine':''}">
    <div class="mm-banner-top">${n===0?'HOST':'USER '+n}</div>
    <div class="mm-seat-line"></div>
    <div class="mm-avatar">${locked?'×':p?escape(p.name.slice(0,1)):'＋'}</div>
    <strong>${locked?'席位锁定':p?escape(p.name):'等待队友'}</strong>
    <small>${p?'user'+n:locked?'暂不开放':'空闲席位'}</small>
    <div class="mm-seat-status ${p?.ready&&p.online?'ready':''}">${p?!p.online?'离线 · 角色保留':p.ready?'◆ 已准备':'◇ 待准备':locked?'LOCKED':'OPEN'}</div>
    ${control?`<div class="mm-seat-tools">${control}</div>`:''}
   </article>`;
  }).join('');
 }

 function roomMap(c:any){
  const sync=c.mapSync;
  if(c.mode==='host')return c.view.map&&!c.view.mapsReady?'<p class="mm-session-pause" role="status">等待队友同步地图资源。</p>':'';
  if(!c.view.map)return '';
  if(sync?.state==='ready')return '<p class="mm-fine-print">地图已同步 · 联机对话已打开</p>';
  if(sync?.state==='enable-assets')return '<div class="mm-session-pause" role="status">联机对话已打开。请在酒馆启用随包脚本与正则。'+button('map-check','检查启用状态',false,'mm-text-button')+'</div>';
  if(sync?.state==='error')return '<div class="mm-session-pause" role="status">'+escape(sync.error)+button('map-retry','重新同步地图',false,'mm-text-button')+'</div>';
  if(sync?.state==='confirm'){
   const assets=sync.assets, scripts=assets.scripts.slice(0,8);
   return '<div class="mm-session-pause"><p>已收到「'+escape(sync.map.card.data.name)+'」的角色卡及 '+sync.map.books.length+' 本世界书。随包脚本可在你的酒馆中运行。</p>'+
    (scripts.length?'<p>'+scripts.map(escape).join('、')+(assets.scripts.length>scripts.length?' 等 '+assets.scripts.length+' 个脚本':'')+'</p>':'')+
    (assets.regexCount?'<p>'+assets.regexCount+' 条角色正则</p>':'')+
    (assets.preset?'<p>预设「'+escape(assets.preset)+'」'+(assets.presetRegexes?' · '+assets.presetRegexes+' 条预设正则':'')+'</p>':'')+
    button('map-confirm','确认并打开联机对话',false,'primary')+'</div>';
  }
  const label=['checking','verifying'].includes(sync?.state)?'正在校验地图资源…':sync?.state==='installing'?'正在将地图导入酒馆…':mapProgressLabel(sync);
  return '<p class="mm-session-pause" role="status"><span data-map-progress>'+label+'</span></p>';
 }
 function linkedChat(c:any,busy:boolean){
  const chat=c.linkedHostChat();
  if(!chat)return '';
  const away=c.mode==='host'?c.view.hostChatPaused:!c.adapter.matchesChat(c.chatBinding());
  return `<section class="mm-linked-chat${away?' away':''}" aria-label="联机对话">
   <div class="mm-linked-chat-icon">${toolIcon('chat')}</div>
   <div class="mm-linked-chat-copy"><span class="mm-eyebrow">联机对话</span>
    <strong>${escape(chat.character||'房主绑定的对话')}</strong><small>${escape(chat.name)}</small>
    <span class="mm-linked-chat-status" role="status">${away?'已切离':'当前已打开'}</span>
   </div>
   ${away&&chat.canReturn?button('return-chat',busy?'正在返回…':'返回联机对话',busy,'primary mm-linked-chat-return'):away?'<span class="mm-linked-chat-hint">请在酒馆找回原对话</span>':''}
  </section>`;
 }
 function lobby(c:any,busy:boolean,inHub:boolean){const v=c.view,isHost=c.mode==='host',me=v.players.find(p=>p?.id===c.myId),players=v.players.filter(Boolean),ready=players.filter(p=>p.ready&&p.online).length;return `
 <div class="mm-roomhead"><div><span class="mm-eyebrow">${v.actionVisibility==='hidden'?'暗行动 · 隐秘博弈':'公开行动 · 协同冒险'}</span><h1>${escape(v.title)}</h1></div><span class="mm-live ${c.connected?'':'offline'}">${c.connected?'● 已连接':'○ 重连中'}</span></div>
 ${linkedChat(c,busy)}
 ${!isHost&&v.hostChatPaused?'<p class="mm-session-pause" role="status">房主暂时切换了聊天，房间和已提交的行动保留。</p>':''}
 ${sceneFields.some(([key])=>v.scene?.[key])?`<details data-detail="public-scene" class="mm-public-scene" open><summary>公开场景资料</summary>${sceneFields.map(([key,label])=>v.scene?.[key]?`<section><h3>${label}</h3><p>${escape(v.scene[key])}</p></section>`:'').join('')}</details>`:''}
 ${roomMap(c)}
 ${scriptSync(c)}
 ${c.transcriptError?'<p class="mm-session-pause" role="status">联机对话写入失败。'+button('transcript-retry','重试写入',false,'mm-text-button')+'</p>':''}
 <div class="mm-room-meta"><span>${phaseName[v.phase]} · 第 ${v.round} 回合</span><span>${players.length} / ${v.capacity||4} 席</span></div>
 <div class="mm-seats">${seats(c,busy)}</div>
 ${isHost?`<div class="mm-invitation"><div><span class="mm-eyebrow">${c.roomCode?'房间邀请码':'完整邀请'}${c.key?.password?' · 需密码':''}</span><textarea readonly aria-label="房间邀请码" class="mm-invite">${escape(c.roomCode||c.invite)}</textarea></div><div>${button('copy','复制')}${c.roomCode?button('copy-full','完整邀请',false,'mm-text-button'):''}</div></div>`:''}
 ${v.phase==='lobby'?`<div class="mm-launch-match"><p><span class="mm-ready-count">${ready} / ${players.length}</span> 已准备 · 至少 2 人开始</p><div class="mm-row">${button('ready',me?.ready?'取消准备':'准备就绪',(!c.connected||(!isHost&&!!v.map&&c.mapSync?.state!=='ready')),'mm-ready-button')}${isHost?button('start','开始故事',busy||v.hostChatPaused||v.mapsReady===false||players.length<2||ready!==players.length,'primary'):''}</div></div>`:`<div class="mm-in-session"><span class="mm-eyebrow">SESSION IN PROGRESS</span><h3>故事已经开始</h3><p>${inHub?'选择下方入口提交行动或与队友交流。':'关闭大厅也会保持联机。通过两个悬浮入口行动和交流。'}</p></div>`}
 <div class="mm-tool-shortcuts">${button('open:action',`${toolIcon('action')}<span><strong>回合行动</strong><small>提交行动 · 剧情与个人状态</small></span>`)}${button('open:chat',`${toolIcon('chat')}<span><strong>队伍聊天室</strong><small>独立交流 · 未读提醒</small></span>`)}</div>
 ${isHost?c.pending.map((p,i)=>`<div class="mm-message">有人申请接管 user${p.seat}${button('approve:'+i,'批准接管')}</div>`).join(''):''}
 <div class="mm-room-exit">${isHost?button('end','结束联机',false,'mm-text-button'):button('leave','离开房间',busy,'mm-text-button')}${!isHost&&!c.connected?button('reconnect','立即重连'):''}<span>${v.phase==='lobby'?(isHost?'点击空位锁定或解锁':'点击空位可换位，换位后请重新准备'):'角色与剧情由房主同步'}</span></div>`;}
 function scriptSync(c:any){
  const {scripts=[],processors=[]}=c.view;
  if(!scripts.length&&!processors.length)return '';
  const states={idle:'本回合未开始',waiting:'等待前序脚本',running:'进行中',done:'本回合结束',failed:'处理失败'};
  const scopes={character:'角色卡',preset:'预设',global:'全局'};
  return `<details class="mm-history mm-script-sync" data-detail="scripts"><summary>脚本同步 <small>${scripts.length} 个已启用</small></summary>
   ${scripts.map(s=>`<p><strong>${escape(s.name)}</strong><small>${scopes[s.scope]} · ${s.scope==='global'?'各端本地运行':c.mode==='host'?(c.view.mapsReady?'已同步':'等待同步'):(c.mapSync?.state==='ready'?'已同步':'同步中')}</small></p>`).join('')}
   ${processors.length?'<h3>同步前需等待</h3>':''}${processors.map(p=>`<p><strong>${escape(p.name)}</strong><small>${!p.enabled?'本房间已停用':!p.available?'脚本自动处理未启用':states[p.state]}</small>${c.mode==='host'?button('processor:'+p.id,p.enabled?'停用':'启用',c.view.phase==='generating','mm-text-button'):''}</p>`).join('')}
  </details>`;
 }
 function action(c:any,busy:boolean,turn:any){
  const v=c.view,isHost=c.mode==='host',players=v.players.filter(Boolean);
  const hidden=v.actionVisibility==='hidden',appendDisabled=isHost&&v.hostChatPaused;
  const actions=new Map<string,any>(v.actions.map(a=>[a.playerId,a]));
  const floors=new Map<string,number>((v.branchFloors??[]).map(target=>[target.id,target.floor]));
  const canPropose=c.connected&&v.phase==='host-action'&&!v.vote&&!v.operation&&!v.branchPending&&!v.hostChatPaused
   &&v.mapsReady!==false&&players.filter(p=>p.online).length>=2;
  const latest=v.results.at(-1),vote=v.vote;
  const canVote=!!vote&&vote.voters.includes(c.myId)&&!vote.yes.includes(c.myId);
  return `
 <div class="mm-scroll mm-action-feed" data-scroll="action">
 <div class="mm-turn-banner ${turn.attention?'active':''}">
  <div><h2>第 ${v.round} 回合</h2><span class="mm-turn-phase">${turn.label}</span></div>
  <span class="mm-turn-mode">${hidden?'暗行动':'公开行动'}</span>
 </div>
 ${v.hostChatPaused?`<p class="mm-session-pause" role="status">${isHost?'请返回联机房间绑定的酒馆聊天。':'等待房主返回联机聊天。'}</p>`:''}
 ${vote?`<section class="mm-vote" aria-label="队伍投票">
  <h3>${vote.kind==='reroll'?'重 Roll 上轮剧情':'创建剧情分支'}</h3>
  <p>第 ${vote.round} 回合 · ${vote.yes.length} / ${vote.voters.length} 赞成 · 在线玩家一致通过</p>
  ${canVote?'<div class="mm-row">'+button('vote:yes','赞成',false,'primary')+button('vote:no','反对')+'</div>':''}
 </section>`:''}
 ${(v.processors??[]).some(p=>['waiting','running','done'].includes(p.state))?scriptSync(c):''}
 <section class="mm-current-actions" aria-label="本轮行动">
  <div class="mm-action-section-title"><h3>本轮行动</h3><span>${actions.size} / ${players.length} 已提交</span></div>
  ${players.map(p=>{
   const entry=actions.get(p.id);
   const status=entry?(entry.skip?'已跳过':'已提交'):!p.online?'离线':v.phase==='lobby'?'待开局':'待行动';
   const skip=isHost&&v.phase==='actions'&&p.seat>0&&!p.online&&!entry;
   return `<article class="mm-player-action ${entry?'submitted':''}" data-action-seat="${p.seat}">
    <span class="mm-action-seal" aria-hidden="true"><span>${escape(p.name.slice(0,1))}</span></span>
    <div class="mm-player-action-body">
     <div class="mm-player-action-heading"><strong>${escape(p.name)}</strong><small>${p.seat===0?'房主':'席位 '+p.seat}${p.id===c.myId?' · 你':''}</small><span class="mm-action-state">${status}</span></div>
     ${entry?`<p class="mm-player-action-text ${entry.submitted?'secret':''}">${entry.submitted?'暗行动已锁定':escape(entry.content)}</p>`:''}
     ${skip?button('skip:'+p.seat,'跳过本轮',false,'mm-text-button'):''}
    </div>
   </article>`;
  }).join('')}
 </section>
 ${latest&&floors.has(latest.id)?`<div class="mm-turn-tools">${button('reroll:'+latest.id,'发起重 Roll',!canPropose,'mm-text-button')}</div>`:''}
 ${!v.results.length&&v.scene?.opening?`<details data-detail="turn-opening" class="mm-history"><summary>公开开场</summary><p>${escape(v.scene.opening)}</p></details>`:''}
 ${v.results.length?`<details data-detail="history" class="mm-history">
  <summary><span>往轮记录</span><small>${v.results.length} 回合</small></summary>
  ${v.results.map((r,i)=>`<article class="mm-story"><small>第 ${r.round} 回合${floors.has(r.id)?' · 酒馆第 '+floors.get(r.id)+' 楼':''}</small>
   ${r.actions?.map(a=>`<p class="mm-past-action"><strong>${escape(a.name)}</strong> ${a.submitted?'暗行动已锁定':escape(a.content)}</p>`).join('')||''}
   <p>${escape(r.story)}</p>${r.status?`<small>我的状态</small><pre>${escape(r.status)}</pre>`:''}
   ${floors.has(r.id)?button('branch:'+r.id,'从此楼发起分支投票',!canPropose,'mm-text-button'):v.map?'':button('append:'+i,'写入当前聊天',appendDisabled,'mm-text-button')}</article>`).reverse().join('')}
 </details>`:''}
 </div>
 <div class="mm-composer">${['host-action','actions'].includes(v.phase)?`<label>你的本轮行动 <span>${turn.canAct?'等待你提交':turn.label}</span></label>${input('action','你准备采取什么行动？',true)}${button('action',turn.canAct?(v.actionVisibility==='hidden'?'锁定并秘密提交':'锁定并提交行动'):'等待 · 暂不可提交',!turn.canAct||busy,'primary mm-wide')}`:isHost&&['ready','error'].includes(v.phase)?button('generate',v.hostChatPaused?'返回联机聊天后生成':v.phase==='error'?'重试这一轮':'生成共同剧情',busy||!c.connected||v.hostChatPaused||v.mapsReady===false,'primary mm-wide'):v.phase==='generating'?`<div class="mm-generating"><i></i> ${v.processors?.some(p=>p.state==='running')?'等待脚本处理后同步':v.operation==='reroll'?'正在重 Roll 上轮剧情':'房主正在生成共同剧情'}</div>${isHost?button('cancel','取消生成',false,'mm-wide'):''}`:`<p class="mm-hint">${turn.label}</p>`}</div>`;}
 function chat(c:any){const v=c.view;return `<div class="mm-channel-meta"><span>队伍频道 · ${v.players.filter(p=>p?.online).length} 人在线</span>${c.mode==='host'?button('clear','清空',false,'mm-text-button'):''}</div><div class="mm-scroll mm-chat-log" data-scroll="chat">${v.chat.map(m=>`<div class="mm-chat-message ${m.playerId===c.myId?'self':''}"><span class="mm-chat-avatar">${escape(m.name.slice(0,1))}</span><div><small>${escape(m.name)} <span>user${m.seat}</span></small><p>${escape(m.content)}</p></div></div>`).join('')||'<div class="mm-empty-scene"><div class="mm-orbit-art">◇</div><h3>队伍频道已就绪</h3><p>一起商量下一步。聊天不会作为 RP 行动提交。</p></div>'}</div><div class="mm-composer">${input('chat','发消息给队伍…',true)}<div class="mm-chat-send"><span>重连自动同步 · 最近 300 条</span>${button('chat','发送',!c.connected,'primary')}</div></div>`;}
 return {entry,lobby,action,chat};
}

// Reuse input nodes across room updates so typing, selection, IME and undo survive.
export function paint(container:HTMLElement,html:string){
 const doc=container.ownerDocument,active=doc.activeElement as HTMLInputElement;const focused=container.contains(active);
 const fields=new Map(Array.from(container.querySelectorAll<HTMLElement>('[data-field]')).map(n=>[n.dataset.field,n]));
 const details=new Map(Array.from(container.querySelectorAll<HTMLDetailsElement>('[data-detail]')).map(n=>[n.dataset.detail,n.open]));
 const scrolls=new Map(Array.from(container.querySelectorAll<HTMLElement>('[data-scroll]')).map(n=>[n.dataset.scroll,{top:n.scrollTop,bottom:n.scrollHeight-n.scrollTop-n.clientHeight<40}]));
 const template=doc.createElement('template');template.innerHTML=html;
 for(const next of template.content.querySelectorAll<HTMLElement>('[data-field]')){const old=fields.get(next.dataset.field);if(old&&old.tagName===next.tagName){const value=(next as HTMLInputElement).value;if(old.tagName==='SELECT')old.innerHTML=next.innerHTML;if((old as HTMLInputElement).value!==value)(old as HTMLInputElement).value=value;next.replaceWith(old);}}
 container.replaceChildren(template.content);
 for(const node of container.querySelectorAll<HTMLDetailsElement>('[data-detail]'))if(details.has(node.dataset.detail))node.open=details.get(node.dataset.detail)!;
 if(focused&&active.isConnected)active.focus({preventScroll:true});
 for(const node of container.querySelectorAll<HTMLElement>('[data-scroll]')){const old=scrolls.get(node.dataset.scroll);if(node.dataset.scroll==='chat'&&(!old||old.bottom))node.scrollTop=node.scrollHeight;else if(old)node.scrollTop=old.top;}
}
