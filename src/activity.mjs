// Pure presentation state: never changes room state or reveals hidden actions.
export function turnState(view,myId,connected,isHost){
 const mine=view?.players.find(p=>p?.id===myId),submitted=view?.actions.some(a=>a.playerId===myId);
 if(!view)return {attention:false,label:'尚未加入房间',canAct:false};
 if(!connected)return {attention:false,label:'连接中 · 等待恢复',canAct:false};
 if(view.vote)return {attention:!view.vote.yes.includes(myId)&&view.vote.voters.includes(myId),label:'队伍正在投票',canAct:false};
 if(view.operation==='branch'||view.branchPending)return {attention:false,label:'队伍正在打开联机分支',canAct:false};
 if(view.operation==='reroll')return {attention:false,label:'正在重 Roll 上轮剧情',canAct:false};
 if(view.mapsReady===false&&view.map&&view.phase!=='lobby')return {attention:false,label:'等待地图同步',canAct:false};
 const canAct=!!mine&&!submitted&&((view.phase==='host-action'&&isHost)||(view.phase==='actions'&&!isHost));
 if(canAct)return {attention:true,label:'轮到你行动',canAct:true};
 if(view.hostChatPaused&&['ready','error'].includes(view.phase))
  return {attention:false,label:isHost?'返回联机聊天后继续':'等待房主返回联机聊天',canAct:false};
 if(isHost&&['ready','error'].includes(view.phase))return {attention:true,label:view.phase==='error'?'需要重试生成':'行动已收齐 · 可以生成',canAct:false};
 return {attention:false,canAct:false,label:({lobby:'等待队伍集结','host-action':'等待房主先行动',actions:submitted?'行动已锁定 · 等待队友':'等待队友行动',ready:'等待房主生成',generating:'剧情正在生成',error:'等待房主重试',ended:'联机已结束'})[view.phase]||'等待下一回合'};
}
export function createActivityTracker(){
 let roomId=null,epoch=null,seen=new Set(),storyVersion=null;
 return {update(view,myId,{chatOpen=false,actionOpen=false}={}){
  if(!view){roomId=null;epoch=null;seen.clear();storyVersion=null;return {chatUnread:0,storyUnread:false};}
  if(roomId!==view.id){roomId=view.id;epoch=view.chatEpoch;seen.clear();storyVersion=null;}
  if(epoch!==view.chatEpoch){epoch=view.chatEpoch;seen.clear();}
  const ids=new Set(view.chat.map(m=>m.id));seen=new Set([...seen].filter(id=>ids.has(id)));
  if(chatOpen)for(const m of view.chat)seen.add(m.id);
  const last=view.results.at(-1),latest=last?JSON.stringify([last.id??last.round,last.variant??0,view.branch?.id]):null;
  if(actionOpen)storyVersion=latest;
  return {chatUnread:view.chat.filter(m=>m.playerId!==myId&&!seen.has(m.id)).length,storyUnread:!!latest&&latest!==storyVersion};
 }};
}
