import {Room,uuid} from './room.mjs';
import {createGuestResume} from './guest-resume.mjs';
import {connectWithRelay} from './ice.mjs';
import {identity,inviteFor,openPeer,listen,connect,secret,parseInvite} from './transport.mjs';
import {allocatePeer,peerIdFor,listenShort,connectShort} from './short-transport.mjs';
import {parseShort,fingerprint,passwordKey,nonce} from './short-auth.mjs';
import {createRoundProcessors} from './round-processors.mjs';
import {splitReply} from './context.mjs';
import {createLobbyExtensionApi} from './extension-api.mjs';
import {attachmentPath,createSharedAttachments,MAX_ROOM_ATTACHMENT_BYTES} from './shared-attachments.mjs';
import {decodeRoomMap,describeRoomMap,encodeRoomMap,MAP_CHUNK_SIZE,MAP_CHUNK_WINDOW,roomMapAssets,validateMapDescriptor} from './room-map.mjs';
const hostSaveKey='mm-lobby-host-v1';
const returnToChat='请返回联机房间绑定的酒馆聊天';
const mapFirstChunkMs=60000;
const mapIdleMs=30000;
const mapDownloadMs=600000;
const mapProgress=sync=>Math.floor(sync.parts.length/sync.total*100);
const maxJsonFrameBytes=16300;
const frameEncoder=new TextEncoder();
const nativeSource='tavern-native';
const resultKey=result=>result.id+':'+(result.variant??0)+':'+(result.displayRevision??0);
function publicStory(message,privateStatus) {
 if(typeof message!=='string'||message.length>500000)return null;
 const text=message.replace(/<user[0-3]>\s*<status>[\s\S]*?<\/status>\s*<\/user[0-3]>/gi,'')
  .replace(/<status>[\s\S]*?<\/status>/gi,'').trim();
 if(/<\/?(?:user\d|status)(?=[\s/>])/i.test(text)||privateStatus&&text===message.trim())return null;
 return text||null;
}
export class Controller {
 constructor(storage,adapter,notify=()=>{},transport={identity,openPeer,allocatePeer},session){
  Object.assign(this,{storage,adapter,notify,transport,connections:new Map(),waiting:new Set(),requests:new Map(),pending:[],
   guestResume:createGuestResume(session),hostChatPaused:false,mode:'none',view:null,connected:false,closed:true,config:{},epoch:0});
  this.processors=createRoundProcessors(()=>{if(this.room)this.broadcast();});
  this.extensions=createLobbyExtensionApi(this);
  this.attachments=createSharedAttachments({
   store:{get:key=>this.adapter.mapStore.get(key),
    saveAttachment:(roomId,hash,blob,limit)=>this.adapter.mapStore.saveAttachment
     ?this.adapter.mapStore.saveAttachment(roomId,hash,blob,limit):this.adapter.mapStore.put('attachment:'+roomId+':'+hash,blob)},
   view:()=>this.view,
   connection:()=>this.mapSync?.state==='ready'||!this.view?.map?this.seatedConnection:null,
   changed:()=>this.emit(),
  });
 }
 emit(){this.notify(this);queueMicrotask(()=>this.extensions.notify());}
 getHostResume(){
  try{
   const saved=JSON.parse(this.storage.getItem(hostSaveKey)||'null');
   return saved?.state&&saved.key&&!saved.lease&&saved.state.phase!=='ended'
    ? {title:saved.state.title,round:saved.state.round}
    : null;
  }catch{return null;}
 }
 namespace(){return JSON.stringify([this.config.host||'0.peerjs.com',this.config.port||443,this.config.path||'/']);}
 save(){this.storage.setItem(hostSaveKey,JSON.stringify({state:this.room.state,key:this.key,invite:this.invite,protocol:this.protocol,roomCode:this.roomCode,network:this.config}));}
 async host(profile,title,restore=false,actionVisibility='public',access={}){
  this.close();this.closed=false;this.mode='host';this.error='';this.roomCode=null;
  const epoch=this.epoch,current=()=>!this.closed&&this.epoch===epoch;let peer,createdMapId,committedMap=false;
  try{
   let room,key,invite,protocol,roomCode=null,mapWire=null;
   let network=this.config;
   if(restore){
    const saved=JSON.parse(this.storage.getItem(hostSaveKey)||'null');
    if(!saved)throw Error('没有可恢复的房间');
    if(saved.state.phase==='ended')throw Error('这个房间已经结束');
    if(saved.lease)throw Error('旧目录测试房间不支持直接迁移，请新建房间');
    room=Room.restore(saved.state);
    ({key,invite}=saved);
    protocol=saved.protocol||'legacy';roomCode=saved.roomCode||null;network=saved.network??network;
    peer=await this.transport.openPeer(key.peerId,network,8);
   }
   else{
    const chat=this.adapter.hostChat();
    protocol=access.mode==='long'?'legacy':'short';if(protocol==='legacy'&&access.password)throw Error('密码功能需要 6 位房间号模式');key=await this.transport.identity();if(!current())return;
    room=Room.create(profile,secret(),title,actionVisibility,access.scene);
    Object.assign(room.state,chat);
    if(chat.chatRef){
     const map=await this.adapter.captureRoomMap(room.state.id,chat.chatRef);
     mapWire=await encodeRoomMap(map);
     mapWire.descriptor.resources=describeRoomMap(map);
     if(!current())return;
     if(!this.adapter.matchesChat(chat))throw Error(returnToChat);
     createdMapId=room.state.id;
     await this.adapter.mapStore.put('host:'+createdMapId,mapWire);
     if(!current())return;
     room.state.mapDescriptor=mapWire.descriptor;
    }
    if(protocol==='short'){
     if(access.password){const salt=nonce();key.password={salt,key:await passwordKey(access.password,salt)};if(!current())return;}
     const allocated=await this.transport.allocatePeer(this.config);peer=allocated.peer;if(!current()){peer.destroy();return;}
     roomCode=allocated.code;key.peerId=peerIdFor(roomCode);invite=`MM3.${roomCode}.${await fingerprint(key.publicKey)}`;
    }else{invite=await inviteFor(key);if(!current())return;peer=await this.transport.openPeer(key.peerId,this.config);}
   }
   if(!current()){peer?.destroy();return;}
   if(restore&&room.state.mapDescriptor){
    mapWire=await this.adapter.mapStore.get('host:'+room.state.id);
    if(!current()){peer.destroy();return;}
    if(mapWire?.descriptor.hash!==room.state.mapDescriptor.hash)throw Error('本地地图存档已丢失，请重新建房');
   }
   Object.assign(this,{room,key,invite,protocol,roomCode,peer,config:network,mapWire,installedPlayers:new WeakSet(),chatStreams:new WeakSet(),
    chatSnapshotSent:new WeakSet(),votePeers:new WeakSet(),branchAcks:new WeakMap(),branchFloors:[],scripts:[],
    attachmentPeers:new WeakSet(),attachmentReceipts:new WeakMap(),floorReceipts:new WeakMap(),nativePending:new Map()});
   this.hostChatPaused=!!room.state.binding&&this.adapter.matchesChat?.(room.state)===false;
   room.save=()=>{if(current())this.save();};this.myId=room.state.players[0].id;this.save();committedMap=true;
   if(mapWire&&this.adapter.captureRoomMap) this.mapPoll=setInterval(()=>{
    void this.refreshRoomMap().catch(()=>{});
    this.scheduleNativeSync();
   },8000);
   (protocol==='short'?listenShort:listen)(peer,key,{connected:c=>{
    if(!current()){c.close();return;}
    this.waiting.add(c);c.send(this.seatSnapshot());
   },message:(c,m)=>{if(current())return this.receive(c,m);},closed:c=>{if(!current())return;const id=this.connections.get(c);this.connections.delete(c);this.waiting.delete(c);this.pending=this.pending.filter(p=>p.conn!==c);if(id&&!Array.from(this.connections.values()).includes(id)&&room.state.players.some(p=>p?.id===id)){room.disconnect(id);this.broadcast();}}});
   peer.on('disconnected',()=>{if(!current())return;this.connected=false;this.emit();clearTimeout(this.retry);this.retry=setTimeout(()=>{if(current()&&!peer.destroyed)peer.reconnect();},1000);});
   peer.on('open',()=>{if(current()){this.connected=true;this.error='';this.emit();}});
   peer.on('error',e=>{if(!current())return;this.error=e.type==='unavailable-id'?'房间号被占用，不能冒充原房间恢复；请新建房间':e.message;this.emit();});this.connected=true;this.broadcast();
  }catch(e){peer?.destroy();if(!current())return;this.close();this.error=e.message;this.emit();throw e;}
  finally{if(createdMapId&&!committedMap)void this.adapter.mapStore.remove('host:'+createdMapId).catch(()=>{});}
 }

 async join(invite,profile,seat,access={}){
  this.close();this.error='';this.invite=invite.trim();this.protocol=this.invite.startsWith('MM1.')?'legacy':'short';this.profile=profile;this.seat=seat;this.access={password:access.password||''};this.expectedRoom=access.roomId||null;
  this.retryRevokedJoin=!this.expectedRoom;
  if(this.protocol==='short'){const info=parseShort(this.invite);this.roomCode=info.code;this.pinKey='mm-lobby-pin:'+this.namespace()+':'+info.code;const pin=this.storage.getItem(this.pinKey);this.access.fingerprint=info.fingerprint||pin||undefined;}
  else{parseInvite(this.invite);if(access.password)throw Error('旧版邀请码不支持密码');this.roomCode=null;}
  this.closed=false;this.mode='guest';await this.reconnect();
 }
 readGuestToken(key){
  this.guestTokenKey=key;
  this.token=this.storage.getItem(key)||secret();
  this.storage.setItem(key,this.token);
 }
 async reconnect(){
  if(this.closed||this.leaving)return;const epoch=++this.epoch;clearTimeout(this.retry);this.seatedConnection=null;this.connection?.close();this.peer?.destroy();this.connected=false;
  this.attachments.reset();
  if(this.mapSync?.state!=='installing')this.resetMapSync();
  this.emit();
  let initialSeats, sendJoin;
  try{const p=await openPeer(undefined,this.config);if(this.closed||this.epoch!==epoch){p.destroy();return;}this.peer=p;
   if(this.protocol==='legacy')this.readGuestToken('mm-lobby-token:'+this.invite);
   const callbacks={message:m=>{
    if(this.epoch!==epoch)return;
    if(m.type==='seats'&&!initialSeats){initialSeats=m;sendJoin?.();}
    this.guestReceive(m);
   },closed:()=>{
    if(this.epoch!==epoch)return;
    this.connected=false;this.emit();
    if(!this.closed&&!this.leaving)this.retry=setTimeout(()=>this.reconnect().catch(()=>{}),5000);
   },authenticated:fp=>{if(this.epoch!==epoch)return;this.storage.setItem(this.pinKey,fp);this.readGuestToken('mm-lobby-token3:'+this.namespace()+':'+fp);}};
   const connection=await connectWithRelay(p,()=>this.protocol==='short'?connectShort(p,this.invite,this.access,callbacks):connect(p,this.invite,callbacks),()=>{
    this.error='正在尝试通过 TURN 中继重新连接…';this.emit();
   });
   if(this.closed||this.epoch!==epoch){connection.close();return;}this.connection=connection;this.connected=true;this.error='';this.resend=true;
   let sent=false,timer;
   sendJoin=()=>{
    if(sent||this.epoch!==epoch||!connection.open)return;
    sent=true;clearTimeout(timer);
    const request={type:'join',profile:this.profile,token:this.token,mapProtocol:1,mapSyncVersion:2,chatStream:1,voteProtocol:1,collaborationProtocol:1};
    // Hosts before 0.6.1 still require a seat hint from their authenticated snapshot.
    if(!initialSeats?.autoSeat){
     const first=initialSeats?.seats?.findIndex((slot,index)=>index>0&&!slot);
     request.seat=this.seat??(first>0?first:1);
    }
    connection.send(request);
   };
   if(initialSeats)sendJoin();
   else timer=setTimeout(sendJoin,800);
   this.emit();
  }catch(e){if(this.epoch!==epoch)return;this.error=e.message;clearTimeout(this.retry);if(!e.fatal&&!this.closed)this.retry=setTimeout(()=>this.reconnect().catch(()=>{}),8000);this.emit();throw e;}
 }
 resumeGuest(password){
  const saved=this.guestResume.get();
  if(!saved)throw Error('没有可继续的来宾房间');
  if(saved.needsPassword&&!password)throw Error('请输入原房间的密码');
  this.config=saved.network??{};
  return this.join(saved.invite,saved.profile,saved.seat,{password,roomId:saved.roomId});
 }
 rememberGuest(){
  const seat=this.view.players.findIndex(p=>p?.id===this.myId);
  if(seat<1||this.leaving)return;
  const invite=this.protocol==='short'?`MM3.${this.roomCode}.${this.access.fingerprint}`:this.invite;
  this.guestResume.set({invite,roomId:this.view.id,seat,profile:this.profile,network:this.config,needsPassword:!!this.access.passwordKey});
 }
 guestReceive(m){
  if(this.leaving){
   if(m.requestId===this.leaving.requestId&&['ack','error'].includes(m.type))this.leaving.finish();
   return;
  }
  if(m.type==='kicked'){
   if(this.guestTokenKey&&this.storage.getItem(this.guestTokenKey)===this.token)this.storage.removeItem(this.guestTokenKey);
   this.guestResume.clear();
   if(this.retryRevokedJoin&&!this.view){
    this.retryRevokedJoin=false;
    this.error='旧凭据已失效，正在重新申请入房…';
    void this.reconnect().catch(()=>{});
   }else{
    this.close();
    this.error='你已被房主移出。可重新输入房间号与密码加入。';
    this.emit();
   }
   return;
  }
  if(m.type==='state'){
   if(this.expectedRoom&&m.view.id!==this.expectedRoom){
    this.guestResume.clear();this.close();this.error='原房间已变更，请确认新的邀请';this.emit();return;
   }
   this.error='';
   this.retryRevokedJoin=false;
   this.seatedConnection=this.connection;
   if(!this.view||m.view.id!==this.view.id||m.view.revision>=this.view.revision){
    const sameRoom=this.view?.id===m.view.id;
    const keepChat=sameRoom&&(!Array.isArray(m.view.chat)||this.chatRevision>m.view.revision);
    if(keepChat){
     m.view.chat=this.view.chat;
     m.view.chatEpoch=this.view.chatEpoch;
    }else{
     m.view.chat??=[];
     this.chatRevision=m.view.revision;
    }
    this.view=m.view;this.myId=m.myId;
   }
   if(this.view.phase==='ended'){
    this.guestResume.clear();this.close();this.error='房主已结束联机，本地房间记录已清空';
   }else{
    this.expectedRoom=this.view.id;
    if(this.resend){
     this.resend=false;this.rememberGuest();
     if(!this.view.map)this.resendRequests();
    }
    if(this.view.map&&this.connection?.open){
     if(this.mapSync?.descriptor?.hash!==this.view.map.hash){
      if(this.mapSync?.state!=='installing')this.prepareRoomMap();
     }
     else if(this.mapSync.state==='ready'&&!this.mapSync.sent){
      this.mapSync.sent=true;this.connection.send({type:'map-ready',hash:this.view.map.hash});this.resendRequests();
     }
    }
    void this.attachments.pump();
   }
  }
  else if(m.type==='chat-update'){
   if(!this.view||m.roomId!==this.view.id||m.revision<=this.chatRevision||m.chatEpoch<this.view.chatEpoch)return;
   const chat=m.chatEpoch===this.view.chatEpoch?this.view.chat:[];
   this.chatRevision=m.revision;
   this.view={...this.view,chatEpoch:m.chatEpoch,chat:m.message?[...chat,m.message].slice(-300):[]};
  }
  else if(m.type==='map-chunk'){void this.receiveMapChunk(m);return;}
  else if(m.type==='attachment-chunk'||m.type==='attachment-error'){void this.attachments.receive(m);return;}
  else if(m.type==='seats'){this.seats=m.seats;this.seatPhase=m.phase;}else if(m.type==='ack')this.requests.delete(m.requestId);else if(m.type==='error'){this.requests.delete(m.requestId);this.error=m.message;}this.emit();
 }
 resendRequests(){for(const request of this.requests.values())this.connection?.send(request);}
 stopMapDownload(sync){
  clearTimeout(sync?.idleTimer);
  clearTimeout(sync?.totalTimer);
 }
 resetMapSync(){
  this.stopMapDownload(this.mapSync);
  this.mapSync=null;
 }
 prepareRoomMap(){
  const descriptor=this.view?.map;
  if(!descriptor||!this.connection?.open)return;
  if(!this.adapter.verifyRoomMap){this.requestRoomMap();return;}
  this.resetMapSync();
  const sync=this.mapSync={state:'checking',descriptor,roomId:this.view.id};
  const current=()=>this.mapSync===sync&&!this.closed&&this.view?.id===sync.roomId&&this.view.map?.hash===descriptor.hash;
  void (async()=>{
   try{
    const branch=await this.adapter.mapStore.get('guest-branch:'+sync.roomId);
    if(current()&&branch?.binding&&!this.mapChat){
     this.mapChat=branch.binding;this.appliedBranch=branch.id;
    }
    const allowed=await this.adapter.mapStore.get('installed:'+descriptor.hash);
    if(current()&&allowed){
     const binding=await this.adapter.verifyRoomMap(sync.roomId,descriptor.hash,current,this.mapChat);
     if(current()&&binding){
      this.mapChat=binding;sync.assets=allowed;sync.state='enable-assets';await this.checkRoomAssets();this.emit();return;
     }
    }
    if(current()&&descriptor.resources&&this.adapter.findLocalRoomMap){
     const map=await this.adapter.findLocalRoomMap(sync.roomId,descriptor,current);
     if(current()&&map){sync.state='verifying';await this.acceptRoomMap(sync,map);return;}
    }
   }catch{/* A missing or stale local map is repaired by the transfer. */}
   if(current())this.requestRoomMap();
  })();
 }
 requestRoomMap(){
  if(!this.view?.map||!this.connection?.open)return;
  this.resetMapSync();
  let total;
  try{total=validateMapDescriptor(this.view.map);}
  catch(error){this.mapSync={state:'error',descriptor:this.view.map,error:error.message};this.emit();return;}
  const sync=this.mapSync={state:'downloading',parts:[],total,descriptor:this.view.map,roomId:this.view.id,transferId:uuid()};
  sync.totalTimer=setTimeout(()=>this.failMap(sync,`地图下载达到总时限（${mapProgress(sync)}%）。`),mapDownloadMs);
  this.watchMapProgress(sync);
  try{this.requestMapWindow(sync);}catch(error){this.failMap(sync,error.message);return;}
  this.emit();
 }
 requestMapWindow(sync){
  this.connection.send({type:'map-window',start:sync.parts.length,transferId:sync.transferId,hash:sync.descriptor.hash});
 }
 watchMapProgress(sync){
  clearTimeout(sync.idleTimer);
  const started=sync.parts.length>0;
  sync.idleTimer=setTimeout(()=>this.failMap(sync,started
   ?`地图下载停在 ${mapProgress(sync)}%，30 秒未收到新分片。`
   :'等待地图超时，60 秒未收到房主发送的首个分片。'),started?mapIdleMs:mapFirstChunkMs);
 }
 failMap(sync,error){
  if(this.mapSync!==sync)return;
  this.stopMapDownload(sync);
  sync.state='error';sync.error=error;sync.parts=[];
  this.emit();
 }
 async receiveMapChunk(message){
  const sync=this.mapSync;
  if(sync?.state!=='downloading'||(message.transferId!==undefined&&message.transferId!==sync.transferId))return;
  try{
   if(message.index!==sync.parts.length||typeof message.data!=='string'||message.data.length>MAP_CHUNK_SIZE
     ||(message.index<sync.total-1&&message.data.length!==MAP_CHUNK_SIZE))throw Error('收到的地图分片无效');
   const previousProgress=mapProgress(sync);
   sync.parts.push(message.data);
   if(sync.parts.length===sync.total){
    this.stopMapDownload(sync);sync.state='verifying';this.emit();
    const data=sync.parts.join('');sync.parts=[];
    const map=await decodeRoomMap(sync.descriptor,data);
    if(this.mapSync!==sync)return;
    await this.acceptRoomMap(sync,map);
   }else{
    this.watchMapProgress(sync);
    if(sync.parts.length%MAP_CHUNK_WINDOW===0)this.requestMapWindow(sync);
    if(sync.parts.length===1||mapProgress(sync)!==previousProgress)this.notify(this,'map-progress');
   }
  }catch(error){this.failMap(sync,error.message);}
 }
 async acceptRoomMap(sync,map){
  if(map.roomId!==sync.roomId)throw Error('地图属于另一个房间');
  sync.map=map;sync.assets=roomMapAssets(map);
  if(sync.assets.requiresConsent&&!await this.adapter.mapStore.get('allow:'+sync.descriptor.hash)){
   if(this.mapSync===sync){sync.state='confirm';this.emit();}
  }else if(this.mapSync===sync)await this.installRoomMap();
 }
 async installRoomMap(){
  const sync=this.mapSync;
  if(!sync?.map||!['confirm','verifying'].includes(sync.state))return;
  const current=()=>this.mapSync===sync&&!this.closed&&this.view?.id===sync.roomId;
  sync.state='installing';this.emit();
  try{
   const binding=await this.adapter.installRoomMap(sync.map,sync.descriptor.hash,current,this.mapChat);
   if(!current())return;
   if(sync.assets.requiresConsent)await this.adapter.mapStore.put('allow:'+sync.descriptor.hash,true);
   if(this.adapter.verifyRoomMap)await this.adapter.mapStore.put('installed:'+sync.descriptor.hash,sync.assets);
   if(!current())return;
   this.mapChat=binding;
   sync.state='enable-assets';sync.map=null;
   if(this.view.map?.hash!==sync.descriptor.hash)this.prepareRoomMap();
   else await this.checkRoomAssets();
  }catch(error){this.failMap(sync,error.message);}
  this.emit();
 }
 async checkRoomAssets(){
  const sync=this.mapSync,binding=this.mapChat;
  if(sync?.state==='refreshing-assets'||sync?.state==='ready')return true;
  const current=()=>this.mapSync===sync&&!this.closed&&this.view?.id===sync.roomId
   &&this.view?.map?.hash===sync.descriptor.hash&&this.adapter.matchesChat?.(binding)!==false;
  if(!['enable-assets','asset-error'].includes(sync?.state)||!binding||!current()||!this.adapter.roomAssetsEnabled(binding,sync.assets))return false;
  if(this.adapter.redrawRoomRegexes&&(sync.assets.enableRegexes||sync.assets.enablePresetRegexes)){
   sync.state='refreshing-assets';sync.error='';this.emit();
   try{
    await this.adapter.redrawRoomRegexes(binding,sync.assets,current);
   }catch(error){
    if(current()){sync.state='asset-error';sync.error=error.message;this.emit();return false;}
   }
   if(!current()){
    if(this.mapSync===sync){sync.state='enable-assets';this.emit();}
    return false;
   }
  }
  sync.state='ready';sync.sent=!!this.connection?.open&&this.seatedConnection===this.connection;
  if(sync.sent){this.connection.send({type:'map-ready',hash:sync.descriptor.hash});this.resendRequests();}
  if(sync.sent)void this.attachments.pump();
  this.emit();return true;
 }
 chatBinding(){
  if(this.mode==='host'&&this.room?.state.binding)return this.room.state;
  if(this.mode==='guest')return this.mapChat??null;
  return null;
 }
 linkedHostChat(){
  const binding=this.chatBinding();
  return binding?this.adapter.describeChat?.(binding):null;
 }
 async returnToLinkedChat(){
  const roomId=this.view?.id,state=this.chatBinding();
  const isCurrent=()=>!!roomId&&this.view?.id===roomId&&!this.closed&&this.view.phase!=='ended';
  if(!state||!isCurrent())return false;
  const opened=await this.adapter.openLinkedChat(state,isCurrent);
  if(!opened||!isCurrent())return false;
  this.refreshHostChat();
  void this.syncTranscript();
  return true;
 }
 async syncTranscript(){
  const binding=this.chatBinding(),view=this.view;
  if(this.transcriptTask||this.transcriptError||!binding||!view?.map||!view.results.length||!this.adapter.matchesChat(binding)
    ||(this.mode==='guest'&&this.mapSync?.state!=='ready')||this.room?.state.operation?.kind==='branch')return;
  const task=this.transcriptTask={};
  const current=()=>this.transcriptTask===task&&view.id===this.view?.id&&!this.closed;
  try{
   for(const result of view.results){
    if(!current()||!await this.adapter.appendRound(binding,result,{host:this.mode==='host'}))return;
   }
   if(!current())return;
   if(this.mode==='host'){
    const floors=this.adapter.resultFloors?.(binding)??[];
    if(JSON.stringify(floors)!==JSON.stringify(this.branchFloors)){
     this.branchFloors=floors;this.broadcast();
    }
    this.scheduleNativeSync();
   }else if(view.branch&&view.branch.id===this.view.branch?.id){
    if(this.appliedBranch!==view.branch.id){
     const branched=await this.adapter.branchChat(binding,view.branch,()=>current()&&view.branch.id===this.view.branch?.id);
     if(!current())return;
     this.mapChat=branched;this.appliedBranch=view.branch.id;
     await this.adapter.mapStore.put('guest-branch:'+view.id,{id:view.branch.id,binding:branched});
    }
    if(current()&&this.connection?.open&&(this.branchAcknowledged?.connection!==this.connection||this.branchAcknowledged?.id!==view.branch.id)){
     this.connection.send({type:'branch-ready',branchId:view.branch.id});
     this.branchAcknowledged={connection:this.connection,id:view.branch.id};
    }
   }
   if(this.mode==='guest'&&current()&&view.extensions&&this.connection?.open){
    if(this.floorAcknowledged?.connection!==this.connection)this.floorAcknowledged={connection:this.connection,keys:new Set()};
    const {keys}=this.floorAcknowledged;
    for(const result of view.results){
     const key=resultKey(result);
     if(!result.displayRevision||keys.has(key))continue;
     this.connection.send({type:'floor-ready',resultId:result.id,variant:result.variant,revision:result.displayRevision});
     keys.add(key);
    }
   }
  }catch(error){
   if(view.id===this.view?.id){this.transcriptError=error.message;this.emit();}
  }finally{
   if(this.transcriptTask===task)this.transcriptTask=null;
   const latest=this.view;
   if(latest?.id===view.id&&(latest.results.length!==view.results.length
    ||latest.results.some((result,index)=>resultKey(result)!==resultKey(view.results[index]))
    ||latest.branch?.id!==view.branch?.id)){
    void this.syncTranscript();
   }
  }
 }
 async leave(){
  if(this.leaving||this.mode!=='guest')return;
  this.guestResume.clear();
  const connection=this.connection;
  if(!this.view||!this.connected||!connection?.open){this.close();return;}
  const requestId=uuid();
  let leave;
  try{
   await new Promise(resolve=>{
    const timer=setTimeout(resolve,4000);
    leave=this.leaving={requestId,finish(){clearTimeout(timer);resolve();}};
    try{connection.send({type:'leave',requestId});}catch{leave.finish();}
   });
  }finally{
   if(this.leaving===leave)this.close();
  }
 }
 receive(conn,m){
  const id=this.connections.get(conn);
  if(m.type==='join'||m.type==='takeover'){
   if(this.mapWire&&(m.mapSyncVersion!==2||m.collaborationProtocol!==1))throw Error('新版地图房间需要咩咩联机大厅 0.9.0 或更新版本');
   if(typeof m.token!=='string'||!/^[\w-]{32}$/.test(m.token))throw Error('重连凭据无效');
   if(this.room.state.revokedTokens?.includes(m.token)){conn.send({type:'kicked'});setTimeout(()=>conn.close(),100);return;}
   if(m.chatStream===1)this.chatStreams?.add(conn);
   if(m.voteProtocol===1)this.votePeers?.add(conn);
   if(m.collaborationProtocol===1)this.attachmentPeers?.add(conn);
   if(this.room.state.branch&&m.voteProtocol!==1)throw Error('此房间已进入联机分支，请更新联机大厅后再加入');
  }
  if(m.type==='join'){const playerId=this.room.join(m.profile,m.token);for(const [other,otherId]of this.connections)if(otherId===playerId&&other!==conn){this.connections.delete(other);other.close();}this.waiting.delete(conn);this.connections.set(conn,playerId);this.broadcast();return;}
  if(m.type==='takeover'){if(id)throw Error('已入座的玩家不能接管');if(['lobby','generating','ended'].includes(this.room.state.phase))throw Error('当前不能接管角色');if(![1,2,3].includes(m.seat)||!this.room.state.players[m.seat]||this.room.state.players[m.seat].online)throw Error('只能申请接管离线角色');this.pending=this.pending.filter(p=>p.conn!==conn);this.pending.push({conn,seat:m.seat,token:m.token});this.emit();return;}
  if(!id)throw Error('请先加入房间');
  if(m.type==='map-window'){
   if(!this.mapWire||!Number.isSafeInteger(m.start)||m.start<0||m.start%MAP_CHUNK_WINDOW!==0)throw Error('无效的地图分片请求');
   const {data,descriptor}=this.mapWire;
   if(m.hash&&descriptor&&m.hash!==descriptor.hash){this.sendState(conn,id);return;}
   const transfer=typeof m.transferId==='string'&&/^[\da-f-]{36}$/i.test(m.transferId)?{transferId:m.transferId}:{};
   for(let i=m.start;i<m.start+MAP_CHUNK_WINDOW&&i*MAP_CHUNK_SIZE<data.length;i++){
    conn.send({type:'map-chunk',index:i,data:data.slice(i*MAP_CHUNK_SIZE,(i+1)*MAP_CHUNK_SIZE),...transfer});
   }
   return;
  }
  if(m.type==='map-ready'){
   if(!this.mapWire||m.hash!==this.mapWire.descriptor.hash){this.sendState(conn,id);return;}
   this.installedPlayers.add(conn);this.broadcast();return;
  }
  if(m.type==='branch-ready'){
   if(this.room.state.branch?.id===m.branchId){this.branchAcks.set(conn,m.branchId);this.broadcast();}
   return;
  }
  if(m.type==='attachment-window') {
   if(!this.attachmentPeers?.has(conn)||this.mapWire&&!this.installedPlayers.has(conn))throw Error('请先同步房间');
   const room=this.room;
   return this.attachments.sendWindow(conn,room.state.id,m,()=>this.room===room&&room.state.phase!=='ended'&&conn.open&&this.connections.get(conn)===id);
  }
  if(m.type==='attachment-ready') {
   if(!this.attachmentPeers?.has(conn)||!this.room.state.results.some(result=>result.attachments?.some(entry=>entry.hash===m.hash)))return;
   const received=this.attachmentReceipts.get(conn)??new Set();
   if(received.has(m.hash))return;
   received.add(m.hash);this.attachmentReceipts.set(conn,received);this.broadcast();return;
  }
  if(m.type==='floor-ready'){
   if(!this.attachmentPeers?.has(conn))return;
   const floor=this.room.state.results.find(result=>result.id===m.resultId);
   if(!floor||floor.variant!==m.variant||floor.displayRevision!==m.revision)return;
   const receipts=this.floorReceipts.get(conn)??new Map(), key=resultKey(floor);
   if(receipts.get(floor.id)===key)return;
   receipts.set(floor.id,key);this.floorReceipts.set(conn,receipts);this.broadcast();return;
  }
  if(this.mapWire&&['ready','action'].includes(m.type)&&!this.installedPlayers.has(conn))throw Error('请先完成地图同步');
  if(m.type==='chat'){
   this.sendChat(m,id);
   conn.send({type:'ack',requestId:m.requestId});
   return;
  }
  if(m.type==='leave'){this.room.leave(id);this.connections.delete(conn);}
  else this.command(m,id);
  conn.send({type:'ack',requestId:m.requestId});this.broadcast();
 }
 command(m,id=this.myId){
  if(m.type==='ready')this.room.ready(id,m.ready);
  else if(m.type==='move')this.room.move(id,m.seat);
  else if(m.type==='action'){
    if(!this.branchesReady())throw Error('请等待在线队友打开联机分支');
   this.room.action(id,m);
  }else if(m.type==='propose-vote')this.proposeVote(id,m.kind,m.resultId);
  else if(m.type==='cast-vote'){
   const operation=this.room.castVote(id,m.voteId,m.yes);
   if(!this.room.state.vote)clearTimeout(this.voteTimer);
   if(operation)void this.runOperation(operation);
  }else throw Error('不支持的操作');
 }
 send(type,fields={}){
  this.error='';
  const m={type,id:uuid(),requestId:uuid(),round:this.view?.round,...fields};
  if(type==='chat'&&this.view)m.chatEpoch=this.view.chatEpoch;
  if(this.mode==='host'){
   if(type==='chat')this.sendChat(m,this.myId);
   else{this.command(m);this.broadcast();}
   return;
  }
  if(this.leaving||!this.connected||!this.connection?.open)throw Error('连接尚未恢复');
  this.requests.set(m.requestId,m);this.connection.send(m);this.emit();
 }
 sendChat(command,id){
  if(command.chatEpoch!==undefined&&command.chatEpoch!==this.room.state.chatEpoch)throw Error('聊天记录已清空，请重发这条消息');
  const message=this.room.chat(id,command);
  if(message)this.broadcastChat(message);
 }
 requireHost(){if(this.mode!=='host'||!this.room)throw Error('只有房主可以执行此操作');}
 lock(seat,locked){this.requireHost();this.room.lock(seat,locked);this.broadcast();}
 kick(seat){this.requireHost();const id=this.room.kick(seat);for(const [conn,player]of this.connections)if(player===id){this.connections.delete(conn);conn.send({type:'kicked'});setTimeout(()=>conn.close(),150);}this.broadcast();}
 skip(seat){this.requireHost();const p=this.room.state.players[seat];if(!p||p.online||seat===0)throw Error('只能跳过离线队友');this.room.action(p.id,{id:uuid(),round:this.room.state.round},true);this.broadcast();}
 requestTakeover(seat){if(!this.connection?.open)throw Error('请先连接房间');this.connection.send({type:'takeover',seat,token:this.token,mapProtocol:1,mapSyncVersion:2,chatStream:1,voteProtocol:1,collaborationProtocol:1});this.error='已申请接管，等待房主批准';this.emit();}
 approve(index){this.requireHost();const p=this.pending[index];if(!p?.conn.open)throw Error('申请者已离线');const id=this.room.takeover(p.seat,p.token);this.waiting.delete(p.conn);this.connections.set(p.conn,id);this.pending.splice(index,1);this.broadcast();}
 seatSnapshot(){return {type:'seats',seats:this.room.seats(),autoSeat:true,phase:this.room.state.phase};}
 mapsReady(includeOffline=true){
  return !this.mapWire||this.room.state.players.filter(p=>p?.seat>0&&(includeOffline||p.online)).every(p=>
   [...this.connections].some(([conn,id])=>id===p.id&&conn.open&&this.installedPlayers.has(conn)));
 }
 branchesReady(){
  const branch=this.room.state.branch;
  return !branch||this.room.state.players.filter(p=>p?.seat>0&&p.online).every(p=>
   [...this.connections].some(([conn,id])=>id===p.id&&conn.open&&this.branchAcks.get(conn)===branch.id));
 }
 viewExtras(){
  return {hostChatPaused:this.hostChatPaused,branchFloors:this.branchFloors,branchPending:!this.branchesReady(),
   scripts:this.scripts,processors:this.processors.list(this.room.state.disabledProcessors,this.room.state.round),
   extensions:this.extensions.list()};
 }
 roomView(id,extras) {
  const view={...this.room.view(id),...extras};
  const guests=view.players.filter(player=>player?.seat>0);
  const connected=[...this.connections].filter(([conn])=>conn.open);
  this.room.state.results.forEach((result,index)=>{
   if(result.displayRevision){
    const key=resultKey(result);
    view.results[index].displayReceipts={sent:guests.filter(player=>connected.some(([conn,seat])=>
     seat===player.id&&this.floorReceipts?.get(conn)?.get(result.id)===key)).length,total:guests.length};
   }
   if(!result.attachments?.length)return;
   view.results[index].attachments=result.attachments.map(({path,type,hash,bytes})=>({
    path,type,hash,bytes,
    receipts:{sent:guests.filter(player=>connected.some(([conn,seat])=>seat===player.id&&this.attachmentReceipts?.get(conn)?.has(hash))).length,
     total:guests.length},
   }));
  });
  return view;
 }
 captureFloor(messageId) {
  const room=this.room,binding=this.chatBinding();
  const state=this.mode==='host'?room?.state:this.view;
  if(this.closed||!binding||!state||state.phase==='ended'||room?.state.operation?.kind==='branch')return null;
  if(messageId!==undefined&&(!Number.isSafeInteger(messageId)||messageId<0))return null;
  const message=this.adapter.floorMessage?.(binding,messageId);
  const result=message&&state.results.find(row=>row.id===message.resultId&&(row.variant??0)===message.variant);
  if(!result)return null;
  return {room,roomId:state.id,role:this.mode,branch:state.branch?.id??null,resultId:result.id,variant:result.variant??0};
 }
 isCurrentFloor(target) {
  const state=target.role==='host'?this.room?.state:this.view,binding=this.chatBinding();
  return !this.closed&&this.mode===target.role&&this.room===target.room&&binding&&state?.id===target.roomId
   &&state.phase!=='ended'&&state.operation?.kind!=='branch'
   &&(state.branch?.id??null)===target.branch&&this.adapter.matchesChat?.(binding)!==false
   &&state.results.some(row=>row.id===target.resultId&&(row.variant??0)===target.variant);
 }
 async publishAttachment(target,owner,path,file,kind,current=()=>this.isCurrentFloor(target)) {
  if(target.role!=='host'||!current())throw Error('只有房主能向当前楼层共享附件');
  const {entry,blob}=await this.attachments.prepare(path,file,kind);
  const inspect=()=>{
   if(!current())throw Error('联机楼层已切换或过期');
   const result=target.room.state.results.find(row=>row.id===target.resultId);
   const entries=result.attachments??[];
   const previous=entries.find(row=>row.path.toLowerCase()===entry.path.toLowerCase());
   if(previous&&previous.owner!==owner)throw Error('该楼层的附件路径已被其他扩展使用');
   if(!previous&&(entries.length>=24||target.room.state.results.reduce((sum,row)=>sum+(row.attachments?.length??0),0)>=256))
    throw Error('已达到联机附件数量上限');
   return {result,entries,previous};
  };
  inspect();
  await this.attachments.save(target.room.state.id,entry,blob);
  const {result,entries,previous}=inspect();
  if(previous?.path===entry.path&&previous.hash===entry.hash&&previous.type===entry.type)return entry;
  target.room.change(()=>{result.attachments=[...entries.filter(row=>row!==previous),{...entry,owner}];});
  this.broadcast();
  return entry;
 }
 removeAttachment(target,owner,path) {
  if(target.role!=='host'||!this.isCurrentFloor(target))throw Error('只有房主能移除当前楼层的共享附件');
  const relative=attachmentPath(path);
  const result=target.room.state.results.find(row=>row.id===target.resultId);
  const entries=result.attachments??[];
  const rest=entries.filter(entry=>entry.owner!==owner||entry.path!==relative);
  if(rest.length===entries.length)return false;
  target.room.change(()=>{result.attachments=rest;});
  this.broadcast();
  return true;
 }
 scheduleNativeSync(messageId) {
  if(!this.room||this.closed||!this.adapter.floorMessage||!this.nativePending)return;
  if(Number.isSafeInteger(messageId)&&messageId>=0)this.nativePending.set(messageId,true);
  else for(const {floor} of this.branchFloors??[])if(!this.nativePending.has(floor))this.nativePending.set(floor,false);
  if(this.nativeWork||!this.nativePending.size||this.nativeTimer)return;
  this.nativeTimer=setTimeout(()=>{
   this.nativeTimer=null;
   void this.syncNativeFloors();
  },450);
 }
 async syncNativeFloors(){
  const room=this.room,queue=this.nativePending;
  if(this.nativeWork||!room||!queue?.size)return;
  const work=this.nativeWork={};
  const batch=[...queue];
  queue.clear();
  try{
   for(const [messageId,refreshFile] of batch){
    if(this.room!==room||this.nativeWork!==work)return;
    const target=this.captureFloor(messageId);
    if(!target||!this.isCurrentFloor(target))continue;
    const message=this.adapter.floorMessage(room.state,messageId);
    const result=room.state.results.find(row=>row.id===target.resultId);
    const ownerStatus=result.players.find(player=>player.playerId===this.myId)?.status;
    const story=publicStory(message.text,ownerStatus);
    if(story&&story!==(result.displayStory??result.story)){
     room.change(()=>{result.displayStory=story;result.displayRevision=(result.displayRevision??0)+1;});
     this.broadcast();
    }
    const native=this.adapter.nativeAttachments?.(message)??[];
    const existing=result.attachments?.filter(entry=>entry.owner===nativeSource)??[];
    for(const entry of existing){
     if(!native.some(file=>file.path===entry.path)&&this.isCurrentFloor(target))this.removeAttachment(target,nativeSource,entry.path);
    }
    for(const file of native){
     if(!refreshFile&&existing.some(entry=>entry.path===file.path))continue;
     try{
      const current=()=>this.isCurrentFloor(target)
       &&this.adapter.nativeAttachments(this.adapter.floorMessage(room.state,messageId)??{}).some(entry=>entry.url===file.url);
      const blob=await this.adapter.readNativeAttachment(file);
      if(current())await this.publishAttachment(target,nativeSource,file.path,blob,file.type.split('/')[0],current);
     }catch(error){console.warn('[咩咩联机大厅] 酒馆附件同步失败',error.message);}
    }
   }
  }catch(error){console.warn('[咩咩联机大厅] 酒馆楼层同步失败',error.message);}
  finally{
   if(this.nativeWork===work){
    this.nativeWork=null;
    if(queue.size)this.scheduleNativeSync();
   }
  }
 }
 async refreshRoomMap(){
  const room=this.room,previous=this.mapWire;
  if(this.mapTask)return this.mapTask;
  if(!room||!previous||this.hostChatPaused||room.state.operation||['generating','ended'].includes(room.state.phase))return;
  const current=()=>this.room===room&&this.mapWire===previous&&!this.closed;
  const key='host:'+room.state.id;
  const task=(async()=>{
   try{
    const map=await this.adapter.captureRoomMap(room.state.id,room.state.chatRef);
    const updated=await encodeRoomMap(map);
    updated.descriptor.resources=describeRoomMap(map);
    if(!current()||this.adapter.matchesChat?.(room.state)===false)return;
    const scripts=this.adapter.currentScripts?.()??[];
    const scriptsChanged=JSON.stringify(scripts)!==JSON.stringify(this.scripts);
    if(scriptsChanged)this.scripts=scripts;
    if(updated.descriptor.hash===previous.descriptor.hash){
     if(scriptsChanged){room.change(()=>{});this.broadcast();}
     return;
    }
    await this.adapter.mapStore.put(key,updated);
    if(!current())return;
    try{room.change(s=>{s.mapDescriptor=updated.descriptor;});}
    catch(error){await this.adapter.mapStore.put(key,previous);throw error;}
    this.mapWire=updated;this.installedPlayers=new WeakSet();
   this.broadcast();
   }catch(error){
    if(current()&&this.adapter.matchesChat?.(room.state)!==false)throw error;
   }
  })();
  this.mapTask=task;
  try{await task;}finally{if(this.mapTask===task)this.mapTask=null;}
 }
 sendState(conn,id){
  const frame={type:'state',myId:id,view:this.roomView(id,{...this.viewExtras(),mapsReady:this.mapsReady(false)})};
  if(this.chatSnapshotSent?.has(conn))delete frame.view.chat;
  if(conn.serialization==='json'&&frameEncoder.encode(JSON.stringify(frame)).length>=maxJsonFrameBytes){
   conn.send({type:'error',message:'房间记录已超过旧版传输上限，请更新联机大厅后重连。'});
   return;
  }
  conn.send(frame);
  if(this.chatStreams?.has(conn))this.chatSnapshotSent?.add(conn);
 }
 broadcast(){
  if(!this.room)return;
  this.view=this.roomView(this.myId,{...this.viewExtras(),mapsReady:this.mapsReady(this.room.state.phase==='lobby')});
  for(const [conn,id]of this.connections)if(conn.open)this.sendState(conn,id);
  for(const conn of this.waiting)if(conn.open)conn.send(this.seatSnapshot());
  this.emit();
 }
 broadcastChat(message){
  const {id:roomId,chatEpoch,revision,chat}=this.room.state;
  this.view={...this.view,chatEpoch,revision,chat};
  const update={type:'chat-update',roomId,chatEpoch,revision,message:message??null};
  for(const [conn,id]of this.connections){
   if(!conn.open)continue;
   if(this.chatStreams?.has(conn))conn.send(update);
   else this.sendState(conn,id);
  }
  this.emit();
 }
 async start(){
  this.requireHost();
  const room=this.room;
  this.refreshHostChat();
  if(this.hostChatPaused)throw Error(returnToChat);
  if(this.mapWire)await this.refreshRoomMap();
  if(this.room!==room||this.closed)return false;
  if(!this.mapsReady())throw Error('请等待所有玩家完成地图同步');
  const s=this.adapter.capture();
  this.room.start(s.binding,s.history,s.chatRef);
  this.hostChatPaused=false;
  this.broadcast();
  return true;
 }
 refreshHostChat(){
  const room=this.room;
  if(this.mode!=='host'||!room?.state.binding||room.state.phase==='ended')return;
  const paused=this.adapter.matchesChat?.(room.state)===false;
  if(paused===this.hostChatPaused)return;
  this.hostChatPaused=paused;
  if(paused&&room.state.phase==='generating'){
   this.adapter.cancel();this.processors.cancel();
   room.fail(room.state.attemptId,'房主切换了聊天，本轮行动已保留，可以重试');
  }
  this.broadcast();
 }
 async generate(){
  this.requireHost();
  const room=this.room;
  this.refreshHostChat();
  if(this.hostChatPaused)throw Error(returnToChat);
  if(this.mapWire)await this.refreshRoomMap();
  if(this.room!==room||this.closed)return;
  if(!this.mapsReady(false))throw Error('请等待在线队友完成地图同步');
  await this.generateAttempt(room,room.beginGeneration());
 }
 toggleProcessor(id){
  this.requireHost();
  if(this.room.state.phase==='generating')throw Error('请等本轮处理完毕');
  if(!this.processors.list().some(entry=>entry.id===id))throw Error('找不到已注册的联机脚本');
  this.room.change(s=>{
   const disabled=new Set(s.disabledProcessors??[]);
   if(disabled.has(id))disabled.delete(id);else disabled.add(id);
   s.disabledProcessors=[...disabled];
  });
  this.broadcast();
 }
 async generateAttempt(room,attempt){
  const reroll=room.state.generationKind==='reroll';
  this.broadcast();
  const current=()=>this.room===room&&!this.closed&&room.state.phase==='generating'&&room.state.attemptId===attempt;
  try{
   const state=reroll?{...room.state,results:room.state.results.slice(0,-1)}:room.state;
   const raw=await this.adapter.generate(state);
   if(!current())return;
   this.refreshHostChat();
   if(!current())return;
   if(typeof raw!=='string')throw Error('模型没有返回文本');
   splitReply(raw,state.frozen.players);
   const processed=await this.processors.run(raw,reroll?room.state.round-1:room.state.round,attempt,
    reroll?'reroll':'round',room.state.disabledProcessors??[],()=>{if(current())this.broadcast();});
   if(!current())return;
   this.refreshHostChat();
   if(current())room.commit(attempt,processed);
  }catch(e){
   if(!current())return;
   this.refreshHostChat();
   if(!current())return;
   room.fail(attempt,e.message);
  }
  this.broadcast();
 }
 proposeVote(id,kind,resultId){
  if(this.hostChatPaused||this.transcriptError||!this.mapsReady(false)||!this.branchesReady())throw Error('请先恢复联机对话并同步地图');
  if([...this.connections.keys()].some(conn=>conn.open&&!this.votePeers?.has(conn)))throw Error('请让全队升级联机大厅后再发起投票');
  if(!this.branchFloors?.some(target=>target.id===resultId))throw Error('请等待剧情写入酒馆后再投票');
  const room=this.room,vote=room.proposeVote(id,kind,resultId);
  clearTimeout(this.voteTimer);
  this.voteTimer=setTimeout(()=>{
   if(this.room!==room||room.state.vote?.id!==vote.id)return;
   room.expireVote(vote.id);this.broadcast();
  },Math.max(0,vote.expires-Date.now()));
 }
 async runOperation(operation){
  const room=this.room;
  const original=room.state.chatRef;
  const current=()=>this.room===room&&!this.closed&&room.state.operation?.id===operation.id;
  try{
   this.refreshHostChat();
   if(this.hostChatPaused)throw Error(returnToChat);
   if(operation.kind==='reroll'){
    await this.generateAttempt(room,room.beginReroll(operation));
   }else{
    this.broadcast();
    const binding=await this.adapter.branchChat(room.state,operation,current);
    if(!current())return;
    room.commitBranch(operation,binding);
    this.hostChatPaused=false;this.branchFloors=this.adapter.resultFloors(binding);
   }
  }catch(error){
   if(current()){
    if(operation.kind==='branch'&&original&&this.adapter.matchesChat?.(room.state)===false){
     try{await this.adapter.openLinkedChat({chatRef:original},current);}catch{/* The original chat remains on disk. */}
    }
    if(current())room.failOperation(operation,error.message);
   }
  }
  if(this.room===room)this.broadcast();
 }
 cancel(){this.requireHost();this.adapter.cancel();this.processors.cancel();this.room.fail(this.room.state.attemptId,'已取消生成，可以重试');this.broadcast();}
 clearChat(){this.requireHost();this.room.clearChat();this.broadcastChat();}
 async end(){this.requireHost();const room=this.room;this.adapter.cancel();this.processors.cancel();room.end();this.broadcast();if(room.state.mapDescriptor)void this.adapter.mapStore.remove('host:'+room.state.id).catch(()=>{});await new Promise(r=>setTimeout(r,300));if(this.room===room)this.close();}
 close(){if(this.mode==='host')this.adapter.cancel();this.processors.cancel();this.adapter.releaseMapPreset?.();clearInterval(this.mapPoll);clearTimeout(this.voteTimer);clearTimeout(this.nativeTimer);this.nativeTimer=null;this.nativePending?.clear();this.nativeWork=null;this.attachments.reset(true);this.floorAcknowledged=null;this.mapTask=null;this.leaving?.finish();this.leaving=null;this.expectedRoom=null;this.guestTokenKey=null;this.retryRevokedJoin=false;this.hostChatPaused=false;this.resend=false;this.closed=true;this.epoch++;clearTimeout(this.retry);this.connection?.close();this.peer?.destroy();this.connections.clear();this.waiting.clear();this.requests.clear();this.pending=[];this.connected=false;this.view=null;this.room=null;this.mode='none';this.seats=[];this.seatPhase=null;this.access=null;this.resetMapSync();this.mapWire=null;this.mapChat=null;this.appliedBranch=null;this.branchAcknowledged=null;this.transcriptTask=null;this.transcriptError='';this.emit();}
}
