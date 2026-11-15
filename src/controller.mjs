import {Room,uuid} from './room.mjs';
import {createGuestResume} from './guest-resume.mjs';
import {identity,inviteFor,openPeer,listen,connect,secret,parseInvite} from './transport.mjs';
import {allocatePeer,peerIdFor,listenShort,connectShort} from './short-transport.mjs';
import {parseShort,fingerprint,passwordKey,nonce} from './short-auth.mjs';
import {decodeRoomMap,encodeRoomMap,MAP_CHUNK_SIZE,MAP_CHUNK_WINDOW,roomMapAssets,validateMapDescriptor} from './room-map.mjs';
const hostSaveKey='mm-lobby-host-v1';
const returnToChat='请返回联机房间绑定的酒馆聊天';
export class Controller {
 constructor(storage,adapter,notify=()=>{},transport={identity,openPeer,allocatePeer},session){Object.assign(this,{storage,adapter,notify,transport,connections:new Map(),waiting:new Set(),requests:new Map(),pending:[],guestResume:createGuestResume(session),hostChatPaused:false,mode:'none',view:null,connected:false,closed:true,config:{},epoch:0});}
 emit(){this.notify(this);}
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
   if(restore){const saved=JSON.parse(this.storage.getItem(hostSaveKey)||'null');if(!saved)throw Error('没有可恢复的房间');if(saved.state.phase==='ended')throw Error('这个房间已经结束');if(saved.lease)throw Error('旧目录测试房间不支持直接迁移，请新建房间');room=new Room(saved.state);key=saved.key;invite=saved.invite;protocol=saved.protocol||'legacy';roomCode=saved.roomCode||null;network=saved.network??network;for(const p of room.state.players)if(p)p.online=p.seat===0;if(room.state.phase==='generating'){room.state.phase='error';room.state.error='房主刷新中断了生成，可重试本轮';}room.state.revision++;peer=await this.transport.openPeer(key.peerId,network,8);}
   else{
    const chat=this.adapter.hostChat();
    protocol=access.mode==='long'?'legacy':'short';if(protocol==='legacy'&&access.password)throw Error('密码功能需要 6 位房间号模式');key=await this.transport.identity();if(!current())return;
    room=Room.create(profile,secret(),title,actionVisibility,access.scene);
    Object.assign(room.state,chat);
    if(chat.chatRef){
     mapWire=await encodeRoomMap(await this.adapter.captureRoomMap(room.state.id,chat.chatRef));
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
   Object.assign(this,{room,key,invite,protocol,roomCode,peer,config:network,mapWire,installedPlayers:new WeakSet()});
   this.hostChatPaused=!!room.state.binding&&this.adapter.matchesChat?.(room.state)===false;
   room.save=()=>{if(current())this.save();};this.myId=room.state.players[0].id;this.save();committedMap=true;
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
  if(this.protocol==='short'){const info=parseShort(this.invite);this.roomCode=info.code;this.pinKey='mm-lobby-pin:'+this.namespace()+':'+info.code;const pin=this.storage.getItem(this.pinKey);this.access.fingerprint=info.fingerprint||pin||undefined;}
  else{parseInvite(this.invite);if(access.password)throw Error('旧版邀请码不支持密码');this.roomCode=null;this.token=this.storage.getItem('mm-lobby-token:'+this.invite)||secret();this.storage.setItem('mm-lobby-token:'+this.invite,this.token);}
  this.closed=false;this.mode='guest';await this.reconnect();
 }
 async reconnect(){
  if(this.closed||this.leaving)return;const epoch=++this.epoch;clearTimeout(this.retry);this.seatedConnection=null;this.connection?.close();this.peer?.destroy();this.connected=false;
  if(this.mapSync?.state==='downloading'||this.mapSync?.state==='verifying')this.resetMapSync();
  else if(this.mapSync?.state==='ready')this.mapSync.sent=false;
  this.emit();
  let initialSeats, sendJoin;
  try{const p=await openPeer(undefined,this.config);if(this.closed||this.epoch!==epoch){p.destroy();return;}this.peer=p;
   const callbacks={message:m=>{
    if(this.epoch!==epoch)return;
    if(m.type==='seats'&&!initialSeats){initialSeats=m;sendJoin?.();}
    this.guestReceive(m);
   },closed:()=>{
    if(this.epoch!==epoch)return;
    this.connected=false;this.emit();
    if(!this.closed&&!this.leaving)this.retry=setTimeout(()=>this.reconnect().catch(()=>{}),5000);
   },authenticated:fp=>{if(this.epoch!==epoch)return;this.storage.setItem(this.pinKey,fp);const k='mm-lobby-token3:'+this.namespace()+':'+fp;this.token=this.storage.getItem(k)||secret();this.storage.setItem(k,this.token);}};
   const connection=await(this.protocol==='short'?connectShort(p,this.invite,this.access,callbacks):connect(p,this.invite,callbacks));if(this.closed||this.epoch!==epoch){connection.close();return;}this.connection=connection;this.connected=true;this.resend=true;
   let sent=false,timer;
   sendJoin=()=>{
    if(sent||this.epoch!==epoch||!connection.open)return;
    sent=true;clearTimeout(timer);
    const request={type:'join',profile:this.profile,token:this.token,mapProtocol:1};
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
  if(m.type==='kicked'){this.guestResume.clear();this.close();this.error='你已被房主移出，本次入房凭据已失效';this.emit();return;}
  if(m.type==='state'){
   if(this.expectedRoom&&m.view.id!==this.expectedRoom){
    this.guestResume.clear();this.close();this.error='原房间已变更，请确认新的邀请';this.emit();return;
   }
   this.error='';
   this.seatedConnection=this.connection;
   if(!this.view||m.view.id!==this.view.id||m.view.revision>=this.view.revision){this.view=m.view;this.myId=m.myId;}
   if(m.view.phase==='ended'){
    this.guestResume.clear();this.close();this.error='房主已结束联机，本地房间记录已清空';
   }else{
    this.expectedRoom=this.view.id;
    if(this.resend){
     this.resend=false;this.rememberGuest();
     if(!this.view.map)this.resendRequests();
    }
    if(this.view.map&&this.connection?.open){
     if(!this.mapSync)this.requestRoomMap();
     else if(this.mapSync.state==='ready'&&!this.mapSync.sent){
      this.mapSync.sent=true;this.connection.send({type:'map-ready',hash:this.view.map.hash});this.resendRequests();
     }
    }
   }
  }
  else if(m.type==='map-chunk'){void this.receiveMapChunk(m);}
  else if(m.type==='seats'){this.seats=m.seats;this.seatPhase=m.phase;}else if(m.type==='ack')this.requests.delete(m.requestId);else if(m.type==='error'){this.requests.delete(m.requestId);this.error=m.message;}this.emit();
 }
 resendRequests(){for(const request of this.requests.values())this.connection?.send(request);}
 resetMapSync(){
  clearTimeout(this.mapSync?.timer);
  this.mapSync=null;
 }
 requestRoomMap(){
  if(!this.view?.map||!this.connection?.open)return;
  this.resetMapSync();
  try{
   const total=validateMapDescriptor(this.view.map);
   this.mapSync={state:'downloading',parts:[],total,descriptor:this.view.map,roomId:this.view.id};
   this.requestMapWindow(this.mapSync);
  }catch(error){this.mapSync={state:'error',error:error.message};}
  this.emit();
 }
 requestMapWindow(sync){
  clearTimeout(sync.timer);
  sync.timer=setTimeout(()=>this.failMap(sync,'下载地图超时，可重新同步。'),25000);
  this.connection.send({type:'map-window',start:sync.parts.length});
 }
 failMap(sync,error){
  if(this.mapSync!==sync)return;
  clearTimeout(sync.timer);
  sync.state='error';sync.error=error;sync.parts=[];
  this.emit();
 }
 async receiveMapChunk(message){
  const sync=this.mapSync;
  if(sync?.state!=='downloading')return;
  try{
   if(message.index!==sync.parts.length||typeof message.data!=='string'||message.data.length>MAP_CHUNK_SIZE
     ||(message.index<sync.total-1&&message.data.length!==MAP_CHUNK_SIZE))throw Error('收到的地图分片无效');
   sync.parts.push(message.data);
   if(sync.parts.length===sync.total){
    clearTimeout(sync.timer);sync.state='verifying';
    const map=await decodeRoomMap(sync.descriptor,sync.parts.join(''));
    if(this.mapSync!==sync)return;
    sync.parts=[];
    if(map.roomId!==sync.roomId)throw Error('地图属于另一个房间');
    sync.map=map;sync.assets=roomMapAssets(map);
    if(sync.assets.requiresConsent&&!await this.adapter.mapStore.get('allow:'+sync.descriptor.hash)){
     if(this.mapSync===sync){sync.state='confirm';this.emit();}
    }else if(this.mapSync===sync)await this.installRoomMap();
   }else if(sync.parts.length%MAP_CHUNK_WINDOW===0){this.requestMapWindow(sync);this.emit();}
  }catch(error){this.failMap(sync,error.message);}
 }
 async installRoomMap(){
  const sync=this.mapSync;
  if(!sync?.map||!['confirm','verifying'].includes(sync.state))return;
  const current=()=>this.mapSync===sync&&!this.closed&&this.view?.id===sync.roomId;
  sync.state='installing';this.emit();
  try{
   const binding=await this.adapter.installRoomMap(sync.map,sync.descriptor.hash,current);
   if(!current())return;
   if(sync.assets.requiresConsent)await this.adapter.mapStore.put('allow:'+sync.descriptor.hash,true);
   if(!current())return;
   this.mapChat=binding;
   sync.state='enable-assets';sync.map=null;
   this.checkRoomAssets();
  }catch(error){this.failMap(sync,error.message);}
  this.emit();
 }
 checkRoomAssets(){
  const sync=this.mapSync;
  if(sync?.state!=='enable-assets'||!this.mapChat||!this.adapter.roomAssetsEnabled(this.mapChat,sync.assets))return false;
  sync.state='ready';sync.sent=!!this.connection?.open&&this.seatedConnection===this.connection;
  if(sync.sent){this.connection.send({type:'map-ready',hash:sync.descriptor.hash});this.resendRequests();}
  this.emit();return true;
 }
 chatBinding(){
  if(this.mode==='host'&&this.room?.state.binding)return this.room.state;
  if(this.mode==='guest')return this.mapChat??null;
  return null;
 }
 linkedHostChat(){
  const binding=this.mode==='host'&&this.chatBinding();
  return binding?this.adapter.describeChat?.(binding):null;
 }
 async returnToLinkedChat(){
  this.requireHost();
  const room=this.room,state=this.chatBinding();
  const isCurrent=()=>this.room===room&&!this.closed&&room.state.phase!=='ended';
  if(!state||!isCurrent())return false;
  const opened=await this.adapter.openLinkedChat(state,isCurrent);
  if(!opened||!isCurrent())return false;
  this.refreshHostChat();
  return true;
 }
 async syncTranscript(){
  const binding=this.chatBinding(),view=this.view;
  if(this.transcriptTask||this.transcriptError||!binding||!view?.map||!view.results.length||!this.adapter.matchesChat(binding))return;
  this.transcriptTask=true;
  try{
   for(const result of view.results){
    if(view.id!==this.view?.id||!await this.adapter.appendRound(binding,result))break;
   }
  }catch(error){
   if(view.id===this.view?.id){this.transcriptError=error.message;this.emit();}
  }finally{
   this.transcriptTask=false;
   if(this.view?.id===view.id&&this.view.results.length>view.results.length)void this.syncTranscript();
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
    const timer=setTimeout(resolve,900);
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
   if(this.mapWire&&m.mapProtocol!==1)throw Error('此房间需要支持地图同步的咩咩联机大厅，请更新脚本后加入');
   if(typeof m.token!=='string'||!/^[\w-]{32}$/.test(m.token))throw Error('重连凭据无效');
   if(this.room.state.revokedTokens?.includes(m.token)){conn.send({type:'kicked'});setTimeout(()=>conn.close(),100);return;}
  }
  if(m.type==='join'){const playerId=this.room.join(m.profile,m.token);for(const [other,otherId]of this.connections)if(otherId===playerId&&other!==conn){this.connections.delete(other);other.close();}this.waiting.delete(conn);this.connections.set(conn,playerId);this.broadcast();return;}
  if(m.type==='takeover'){if(id)throw Error('已入座的玩家不能接管');if(['lobby','generating','ended'].includes(this.room.state.phase))throw Error('当前不能接管角色');if(![1,2,3].includes(m.seat)||!this.room.state.players[m.seat]||this.room.state.players[m.seat].online)throw Error('只能申请接管离线角色');this.pending=this.pending.filter(p=>p.conn!==conn);this.pending.push({conn,seat:m.seat,token:m.token});this.emit();return;}
  if(!id)throw Error('请先加入房间');
  if(m.type==='map-window'){
   if(!this.mapWire||!Number.isSafeInteger(m.start)||m.start<0||m.start%MAP_CHUNK_WINDOW!==0)throw Error('无效的地图分片请求');
   const {data}=this.mapWire;
   for(let i=m.start;i<m.start+MAP_CHUNK_WINDOW&&i*MAP_CHUNK_SIZE<data.length;i++){
    conn.send({type:'map-chunk',index:i,data:data.slice(i*MAP_CHUNK_SIZE,(i+1)*MAP_CHUNK_SIZE)});
   }
   return;
  }
  if(m.type==='map-ready'){
   if(!this.mapWire||m.hash!==this.mapWire.descriptor.hash)throw Error('地图版本不匹配');
   this.installedPlayers.add(conn);this.broadcast();return;
  }
  if(this.mapWire&&['ready','action'].includes(m.type)&&!this.installedPlayers.has(conn))throw Error('请先完成地图同步');
  if(m.type==='leave'){this.room.leave(id);this.connections.delete(conn);}
  else this.command(m,id);
  conn.send({type:'ack',requestId:m.requestId});this.broadcast();
 }
 command(m,id=this.myId){if(m.type==='ready')this.room.ready(id,m.ready);else if(m.type==='move')this.room.move(id,m.seat);else if(m.type==='action')this.room.action(id,m);else if(m.type==='chat')this.room.chat(id,m);else throw Error('不支持的操作');}
 send(type,fields={}){this.error='';const m={type,id:uuid(),requestId:uuid(),round:this.view?.round,...fields};if(this.mode==='host'){this.command(m);this.broadcast();}else{if(this.leaving||!this.connected||!this.connection?.open)throw Error('连接尚未恢复');this.requests.set(m.requestId,m);this.connection.send(m);}this.emit();}
 requireHost(){if(this.mode!=='host'||!this.room)throw Error('只有房主可以执行此操作');}
 lock(seat,locked){this.requireHost();this.room.lock(seat,locked);this.broadcast();}
 kick(seat){this.requireHost();const id=this.room.kick(seat);for(const [conn,player]of this.connections)if(player===id){this.connections.delete(conn);conn.send({type:'kicked'});setTimeout(()=>conn.close(),150);}this.broadcast();}
 skip(seat){this.requireHost();const p=this.room.state.players[seat];if(!p||p.online||seat===0)throw Error('只能跳过离线队友');this.room.action(p.id,{id:uuid(),round:this.room.state.round},true);this.broadcast();}
 requestTakeover(seat){if(!this.connection?.open)throw Error('请先连接房间');this.connection.send({type:'takeover',seat,token:this.token,mapProtocol:1});this.error='已申请接管，等待房主批准';this.emit();}
 approve(index){this.requireHost();const p=this.pending[index];if(!p?.conn.open)throw Error('申请者已离线');const id=this.room.takeover(p.seat,p.token);this.waiting.delete(p.conn);this.connections.set(p.conn,id);this.pending.splice(index,1);this.broadcast();}
 seatSnapshot(){return {type:'seats',seats:this.room.seats(),autoSeat:true,phase:this.room.state.phase};}
 mapsReady(){
  return !this.mapWire||this.room.state.players.filter(p=>p?.seat>0).every(p=>
   [...this.connections].some(([conn,id])=>id===p.id&&conn.open&&this.installedPlayers.has(conn)));
 }
 broadcast(){if(!this.room)return;this.view={...this.room.view(this.myId),hostChatPaused:this.hostChatPaused,mapsReady:this.mapsReady()};for(const [conn,id]of this.connections)if(conn.open)conn.send({type:'state',myId:id,view:{...this.room.view(id),hostChatPaused:this.hostChatPaused}});for(const conn of this.waiting)if(conn.open)conn.send(this.seatSnapshot());this.emit();}
 start(){
  this.requireHost();
  this.refreshHostChat();
  if(this.hostChatPaused)throw Error(returnToChat);
  if(!this.mapsReady())throw Error('请等待所有玩家完成地图同步');
  const s=this.adapter.capture();
  this.room.start(s.binding,s.history,s.chatRef);
  this.hostChatPaused=false;
  this.broadcast();
 }
 refreshHostChat(){
  const room=this.room;
  if(this.mode!=='host'||!room?.state.binding||room.state.phase==='ended')return;
  const paused=this.adapter.matchesChat?.(room.state)===false;
  if(paused===this.hostChatPaused)return;
  this.hostChatPaused=paused;
  if(paused&&room.state.phase==='generating'){
   this.adapter.cancel();
   room.fail(room.state.attemptId,'房主切换了聊天，本轮行动已保留，可以重试');
  }
  this.broadcast();
 }
 async generate(){
  this.requireHost();
  this.refreshHostChat();
  if(this.hostChatPaused)throw Error(returnToChat);
  const room=this.room,attempt=room.beginGeneration();
  this.broadcast();
  const current=()=>this.room===room&&!this.closed&&room.state.phase==='generating'&&room.state.attemptId===attempt;
  try{
   const raw=await this.adapter.generate(room.state);
   if(!current())return;
   this.refreshHostChat();
   if(!current())return;
   if(typeof raw!=='string')throw Error('模型没有返回文本');
   room.commit(attempt,raw);
  }catch(e){
   if(!current())return;
   this.refreshHostChat();
   if(!current())return;
   room.fail(attempt,e.message);
  }
  this.broadcast();
 }
 cancel(){this.requireHost();this.adapter.cancel();this.room.fail(this.room.state.attemptId,'已取消生成，可以重试');this.broadcast();}
 clearChat(){this.requireHost();this.room.clearChat();this.broadcast();}
 async end(){this.requireHost();const room=this.room;this.adapter.cancel();room.end();this.broadcast();if(room.state.mapDescriptor)void this.adapter.mapStore.remove('host:'+room.state.id).catch(()=>{});await new Promise(r=>setTimeout(r,300));if(this.room===room)this.close();}
 close(){if(this.mode==='host')this.adapter.cancel();this.leaving?.finish();this.leaving=null;this.expectedRoom=null;this.hostChatPaused=false;this.resend=false;this.closed=true;this.epoch++;clearTimeout(this.retry);this.connection?.close();this.peer?.destroy();this.connections.clear();this.waiting.clear();this.requests.clear();this.pending=[];this.connected=false;this.view=null;this.room=null;this.mode='none';this.seats=[];this.seatPhase=null;this.access=null;this.resetMapSync();this.mapWire=null;this.mapChat=null;this.transcriptError='';this.emit();}
}
