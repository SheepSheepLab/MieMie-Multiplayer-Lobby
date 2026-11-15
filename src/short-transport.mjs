import {openPeer} from './transport.mjs';
import {roomCode,nonce,fingerprint,passwordKey,proof,verifyProof,sign,verify,transcript,parseShort} from './short-auth.mjs';
export const peerIdFor=code=>'miemie-lobby-v3-'+code;
export async function allocatePeer(config,create=openPeer,choose=roomCode){for(let i=0;i<12;i++){const code=choose();try{return {peer:await create(peerIdFor(code),config,8),code};}catch(e){if(e.type!=='unavailable-id')throw e;}}throw Error('房间号暂时繁忙，请稍后再试');}
export function listenShort(peer,key,callbacks){const connections=new Set();let pending=0,windowStart=Date.now(),attempts=0;
 peer.on('connection',conn=>{if(Date.now()-windowStart>60000){windowStart=Date.now();attempts=0;}if(++attempts>60||pending>=16){conn.close();return;}pending++;connections.add(conn);let stage='hello',context='',serverNonce='',clientNonce='',busy=false,counted=true;
 const release=()=>{if(counted){pending--;counted=false;}};
 const timer=setTimeout(()=>{if(stage!=='verified')conn.close();},20000);
 const process=async m=>{if(!m||typeof m!=='object'||JSON.stringify(m).length>70000)throw Error('消息格式错误');
  if(stage==='hello'){if(m.type!=='hello3'||typeof m.nonce!=='string'||!/^[\w-]{32}$/.test(m.nonce))throw Error('请使用 0.3.0 或更新版本加入');clientNonce=m.nonce;serverNonce=nonce();const fp=await fingerprint(key.publicKey);context=transcript(peer.id,clientNonce,serverNonce,fp,key.password?.salt);stage='auth';conn.send({type:'challenge3',publicKey:key.publicKey,nonce:serverNonce,salt:key.password?.salt||'',signature:await sign(key.privateKey,context)});return;}
  if(stage==='auth'){if(m.type!=='auth3'||(key.password&&!await verifyProof(key.password.key,'guest:'+context,m.proof)))throw Error('入房密码不正确');stage='verified';clearTimeout(timer);release();conn.send({type:'welcome3',proof:key.password?await proof(key.password.key,'host:'+context):'',signature:await sign(key.privateKey,'welcome:'+context)});callbacks.connected(conn);return;}
  if(m.type==='ping')conn.send({type:'pong'});else await callbacks.message(conn,m);
 };
 conn.on('data',m=>{if(busy&&stage!=='verified'){conn.close();return;}busy=true;Promise.resolve(process(m)).catch(e=>{if(conn.open)conn.send({type:'error',message:e.message,requestId:m?.requestId});if(stage!=='verified')setTimeout(()=>conn.close(),100);}).finally(()=>{busy=false;});});
 conn.on('close',()=>{clearTimeout(timer);release();connections.delete(conn);callbacks.closed(conn);});conn.on('error',()=>conn.close());
 });return ()=>{for(const c of connections)c.close();};
}
export async function connectShort(peer,invitation,access,callbacks){const info=parseShort(invitation),clientNonce=nonce(),peerId=peerIdFor(info.code);
 return new Promise((resolve,reject)=>{const conn=peer.connect(peerId,{reliable:true,serialization:'json'});let stage='challenge',context='',pub=null,fp='',key='',last=Date.now(),chain=Promise.resolve(),settled=false;
 const directFailed='已找到房主，但 WebRTC 连线未建立。可让两端使用同一局域网，或在高级连接设置配置可用的 TURN 中继。';
 const stopHandshake=()=>{
  clearTimeout(timer);
  peer.off('error',peerError);peer.off('disconnected',signalingClosed);peer.off('close',signalingClosed);
 };
 const fail=(message,fatal=true)=>{
  if(!settled){settled=true;const e=Error(message);e.fatal=fatal;reject(e);}
  stopHandshake();clearInterval(heartbeat);conn.close();
 };
 const signalingClosed=()=>fail('与 PeerJS 信令服务的连接已断开，请检查网络或代理。',false);
 const peerError=e=>{
  if(e.type==='peer-unavailable'){
   fail('信令服务未找到房主。请确认房间号、房主大厅在线，且两端使用同一个信令服务。',false);
  }else if(['network','socket-error','socket-closed','disconnected','server-error'].includes(e.type))signalingClosed();
 };
 const timer=setTimeout(()=>{
  const message=conn.open?'已连到房主，但等不到房主身份校验，请让房主检查页面是否仍在线。'
   :conn.peerConnection?.remoteDescription?directFailed
   :'已连到信令服务，但还没有收到房主回应。请确认房间号、房主页面在线和两端信令配置。';
  fail(message,false);
 },25000);
 const heartbeat=setInterval(()=>{if(Date.now()-last>35000)conn.close();else if(stage==='verified')conn.send({type:'ping'});},10000);
 peer.on('error',peerError);peer.on('disconnected',signalingClosed);peer.on('close',signalingClosed);
 conn.on('open',()=>conn.send({type:'hello3',nonce:clientNonce}));
 const process=async m=>{last=Date.now();if(m?.type==='error'&&stage!=='verified'){fail(m.message||'入房失败');return;}
  if(stage==='challenge'){if(m?.type!=='challenge3'||typeof m.nonce!=='string'||!/^[\w-]{32}$/.test(m.nonce)||!(m.salt===''||/^[\w-]{32}$/.test(m.salt)))throw Error('房主认证数据无效');pub=m.publicKey;fp=await fingerprint(pub);const expected=info.fingerprint||access.fingerprint;if(expected&&fp!==expected)throw Error('房间号对应的房主身份已改变，请向房主取得新的完整邀请');context=transcript(peerId,clientNonce,m.nonce,fp,m.salt);if(!await verify(pub,context,m.signature))throw Error('房主签名校验失败');if(m.salt){key=access.passwordKey?.salt===m.salt?access.passwordKey.key:await passwordKey(access.password||'',m.salt);access.passwordKey={salt:m.salt,key};}else if(access.password)throw Error('此房间没有设置密码，与输入的邀请不符');stage='welcome';conn.send({type:'auth3',proof:m.salt?await proof(key,'guest:'+context):''});return;}
  if(stage==='welcome'){if(m?.type!=='welcome3'||!await verify(pub,'welcome:'+context,m.signature)||(key&&!await verifyProof(key,'host:'+context,m.proof)))throw Error('房主密码证明校验失败');if(settled)return;stage='verified';stopHandshake();access.fingerprint=fp;access.password='';callbacks.authenticated?.(fp);settled=true;resolve(conn);return;}
  if(m?.type!=='pong')callbacks.message(m);
 };
 conn.on('data',m=>{chain=chain.then(()=>process(m)).catch(e=>fail(e.message));});
 conn.on('close',()=>{stopHandshake();clearInterval(heartbeat);callbacks.closed();if(!settled){settled=true;const e=Error('与房主的连接已关闭');e.fatal=false;reject(e);}});
 conn.on('error',e=>fail(e.type==='negotiation-failed'?directFailed:e.message,false));
 });
}
