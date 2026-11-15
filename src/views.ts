import {toolIcon} from './tool-window';
import {sceneFields} from './room.mjs';
export const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const button=(action:string,label:string,disabled=false,kind='')=>`<button type="button" data-act="${action}" class="${kind}" ${disabled?'disabled':''}>${label}</button>`;
export const phaseName={lobby:'队伍集结','host-action':'房主行动',actions:'队友行动',ready:'准备生成',generating:'剧情生成中',error:'等待重试',ended:'已结束'};
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
 <details data-detail="network" class="mm-network"><summary>高级连接设置</summary><label>加入方式<select data-field="joinMode"><option value="short" ${drafts.joinMode==='short'?'selected':''}>6 位房间号 + 可选密码</option><option value="long" ${drafts.joinMode==='long'?'selected':''}>兼容旧版长邀请码</option></select></label><p>默认使用公共信令。需要时填写自己的 PeerJS / STUN / TURN 配置。</p>${input('network','网络配置 JSON',true)}</details></div>`;}
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
  if(sync?.state==='enable-assets')return '<div class="mm-session-pause" role="status">联机对话已打开。请在酒馆的提示中启用随包脚本和角色正则。'+button('map-check','检查启用状态',false,'mm-text-button')+'</div>';
  if(sync?.state==='error')return '<div class="mm-session-pause" role="status">'+escape(sync.error)+button('map-retry','重新同步地图',false,'mm-text-button')+'</div>';
  if(sync?.state==='confirm'){
   const assets=sync.assets, scripts=assets.scripts.slice(0,8);
   return '<div class="mm-session-pause"><p>已收到「'+escape(sync.map.card.data.name)+'」的角色卡及 '+sync.map.books.length+' 本世界书。随包脚本可在你的酒馆中运行。</p>'+
    (scripts.length?'<p>'+scripts.map(escape).join('、')+(assets.scripts.length>scripts.length?' 等 '+assets.scripts.length+' 个脚本':'')+'</p>':'')+
    (assets.regexCount?'<p>'+assets.regexCount+' 条角色正则</p>':'')+button('map-confirm','确认并打开联机对话',false,'primary')+'</div>';
  }
  const label=sync?.state==='downloading'?'正在同步地图 · '+Math.floor(sync.parts.length/sync.total*100)+'%':'正在同步角色卡、头像与世界书…';
  return '<p class="mm-session-pause" role="status">'+label+'</p>';
 }
 function linkedChat(c:any,busy:boolean){
  const chat=c.linkedHostChat();
  if(!chat)return '';
  const away=c.view.hostChatPaused;
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
 ${isHost?linkedChat(c,busy):v.hostChatPaused?'<p class="mm-session-pause" role="status">房主暂时切换了聊天，房间和已提交的行动保留。</p>':''}
 ${sceneFields.some(([key])=>v.scene?.[key])?`<details data-detail="public-scene" class="mm-public-scene" open><summary>公开场景资料</summary>${sceneFields.map(([key,label])=>v.scene?.[key]?`<section><h3>${label}</h3><p>${escape(v.scene[key])}</p></section>`:'').join('')}</details>`:''}
 ${roomMap(c)}
 ${c.transcriptError?'<p class="mm-session-pause" role="status">联机对话写入失败。'+button('transcript-retry','重试写入',false,'mm-text-button')+'</p>':''}
 <div class="mm-room-meta"><span>${phaseName[v.phase]} · 第 ${v.round} 回合</span><span>${players.length} / ${v.capacity||4} 席</span></div>
 <div class="mm-seats">${seats(c,busy)}</div>
 ${isHost?`<div class="mm-invitation"><div><span class="mm-eyebrow">${c.roomCode?'房间邀请码':'完整邀请'}${c.key?.password?' · 需密码':''}</span><textarea readonly aria-label="房间邀请码" class="mm-invite">${escape(c.roomCode||c.invite)}</textarea></div><div>${button('copy','复制')}${c.roomCode?button('copy-full','完整邀请',false,'mm-text-button'):''}</div></div>`:''}
 ${v.phase==='lobby'?`<div class="mm-launch-match"><p><span class="mm-ready-count">${ready} / ${players.length}</span> 已准备 · 至少 2 人开始</p><div class="mm-row">${button('ready',me?.ready?'取消准备':'准备就绪',(!c.connected||(!isHost&&!!v.map&&c.mapSync?.state!=='ready')),'mm-ready-button')}${isHost?button('start','开始故事',busy||v.hostChatPaused||v.mapsReady===false||players.length<2||ready!==players.length,'primary'):''}</div></div>`:`<div class="mm-in-session"><span class="mm-eyebrow">SESSION IN PROGRESS</span><h3>故事已经开始</h3><p>${inHub?'选择下方入口提交行动或与队友交流。':'关闭大厅也会保持联机。通过两个悬浮入口行动和交流。'}</p></div>`}
 <div class="mm-tool-shortcuts">${button('open:action',`${toolIcon('action')}<span><strong>回合行动</strong><small>提交行动 · 剧情与个人状态</small></span>`)}${button('open:chat',`${toolIcon('chat')}<span><strong>队伍聊天室</strong><small>独立交流 · 未读提醒</small></span>`)}</div>
 ${isHost?c.pending.map((p,i)=>`<div class="mm-message">有人申请接管 user${p.seat}${button('approve:'+i,'批准接管')}</div>`).join(''):''}
 <div class="mm-room-exit">${isHost?button('end','结束联机',false,'mm-text-button'):button('leave','离开房间',busy,'mm-text-button')}${!isHost&&!c.connected?button('reconnect','立即重连'):''}<span>${v.phase==='lobby'?(isHost?'点击空位锁定或解锁':'点击空位可换位，换位后请重新准备'):'角色与剧情由房主同步'}</span></div>`;}
 function action(c:any,busy:boolean,turn:any){const v=c.view,isHost=c.mode==='host',me=v.players.find(p=>p?.id===c.myId),last=v.results.at(-1),appendDisabled=isHost&&v.hostChatPaused;return `
 <div class="mm-scroll" data-scroll="action"><div class="mm-turn-banner ${turn.attention?'active':''}"><span class="mm-eyebrow">ROUND ${String(v.round).padStart(2,'0')}</span><h2>${turn.label}</h2><p>${v.actionVisibility==='hidden'?'暗行动 · 其他玩家仅看见你已提交':'公开行动 · 队友会看见本轮行动'}</p></div>
 ${v.hostChatPaused?`<p class="mm-session-pause" role="status">${isHost?'请返回联机房间绑定的酒馆聊天。':'等待房主返回联机聊天。'}</p>`:''}
 <div class="mm-round-roster">${v.players.filter(Boolean).map(p=>`<span class="${v.actions.some(a=>a.playerId===p.id)?'done':''}" title="${escape(p.name)}">${escape(p.name)}<i>${v.actions.some(a=>a.playerId===p.id)?'✓':p.online?'·':'○'}</i></span>`).join('')}</div>
 ${last?`<article class="mm-story"><span class="mm-eyebrow">上一回合 · ${last.round}</span><p>${escape(last.story)}</p><details data-detail="status" open><summary>我的状态 · user${me?.seat}</summary><pre>${escape(last.status)}</pre></details>${v.map?'':button('append:'+(v.results.length-1),'写入当前酒馆聊天',appendDisabled,'mm-text-button')}</article>`:`<div class="mm-empty-scene"><div class="mm-orbit-art" aria-hidden="true">✧</div><h3>${v.phase==='lobby'?'队伍即将启程':'你的选择，让故事发生'}</h3><p>${v.phase==='lobby'?'在大厅准备就绪，等待房主开始。':escape(v.scene?.opening||'本轮剧情将在行动收齐后生成。')}</p></div>`}
 ${v.results.length>1?`<details data-detail="history" class="mm-history"><summary>更早的剧情 · ${v.results.length-1} 回合</summary>${v.results.slice(0,-1).map((r,i)=>`<article class="mm-story"><small>ROUND ${r.round}</small><p>${escape(r.story)}</p><pre>${escape(r.status)}</pre>${v.map?'':button('append:'+i,'写入当前聊天',appendDisabled,'mm-text-button')}</article>`).join('')}</details>`:''}
 ${v.actions.length?`<details data-detail="submitted" class="mm-submitted"><summary>本轮已提交 · ${v.actions.length} / ${v.players.filter(Boolean).length}</summary>${v.actions.map(a=>`<div class="mm-message"><small>${escape(a.name)} · 已锁定</small><p>${a.submitted?'秘密行动已提交':escape(a.content)}</p></div>`).join('')}</details>`:''}
 ${isHost&&v.phase==='actions'?v.players.filter(p=>p&&p.seat>0&&!p.online&&!v.actions.some(a=>a.playerId===p.id)).map(p=>button('skip:'+p.seat,'跳过离线角色 '+escape(p.name))).join(''):''}</div>
 <div class="mm-composer">${['host-action','actions'].includes(v.phase)?`<label>你的本轮行动 <span>${turn.canAct?'等待你提交':'可先写下草稿'}</span></label>${input('action','你准备采取什么行动？',true)}${button('action',turn.canAct?(v.actionVisibility==='hidden'?'锁定并秘密提交':'锁定并提交行动'):'等待 · 暂不可提交',!turn.canAct||busy,'primary mm-wide')}`:isHost&&['ready','error'].includes(v.phase)?button('generate',v.hostChatPaused?'返回联机聊天后生成':v.phase==='error'?'重试这一轮':'生成共同剧情',busy||!c.connected||v.hostChatPaused,'primary mm-wide'):v.phase==='generating'?`<div class="mm-generating"><i></i> 房主正在生成共同剧情</div>${isHost?button('cancel','取消生成',false,'mm-wide'):''}`:`<p class="mm-hint">${turn.label}</p>`}</div>`;}
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
