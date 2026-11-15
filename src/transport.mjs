import Peer from 'peerjs';
import {peerIceOptions,trackIce} from './ice.mjs';
const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const secret=()=>b64(crypto.getRandomValues(new Uint8Array(24)));
const fingerprint=async jwk=>b64(await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y}))));
export async function identity(){if(!crypto.subtle)throw Error('创建房间需要 HTTPS 或 localhost 的安全网页环境');const k=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {publicKey:await crypto.subtle.exportKey('jwk',k.publicKey),privateKey:await crypto.subtle.exportKey('jwk',k.privateKey),secret:secret(),peerId:'mm-'+secret()};}
export async function inviteFor(key){return `MM1.${key.peerId}.${key.secret}.${await fingerprint(key.publicKey)}`;}
export function parseInvite(value){const a=value.trim().split('.');if(a.length!==4||a[0]!=='MM1'||!a.slice(1).every(x=>/^[\w-]+$/.test(x)))throw Error('邀请码格式不正确');return {peerId:a[1],secret:a[2],fingerprint:a[3]};}
export function openPeer(id,config={},attempt=0,PeerType=Peer){
 const options=peerIceOptions(config);
 return options.then?options.then(resolved=>startPeer(id,resolved,attempt,PeerType)):startPeer(id,options,attempt,PeerType);
}
function startPeer(id,config,attempt,PeerType){return new Promise((resolve,reject)=>{
 const p=new PeerType(id,{debug:0,...config});let settled=false;
 const cleanup=()=>{clearTimeout(timer);p.off('open',opened);p.off('error',failed);};
 const opened=()=>{if(settled)return;settled=true;cleanup();resolve(p);};
 const failed=e=>{if(settled)return;settled=true;cleanup();p.destroy();if(e.type==='unavailable-id'&&attempt<8)setTimeout(()=>startPeer(id,config,attempt+1,PeerType).then(resolve,reject),1000);else reject(e);};
 const timer=setTimeout(()=>failed(Error('信令连接超时，请检查网络')),20000);
 p.on('open',opened);p.on('error',failed);
});}

export function listen(peer,key,callbacks){const pending=new Set();peer.on('connection',conn=>{pending.add(conn);let verified=false;const timer=setTimeout(()=>{if(!verified)conn.close();},15000);conn.on('data',async m=>{try{if(!m||typeof m!=='object'||JSON.stringify(m).length>70000)throw Error('消息格式错误');if(!verified){if(m.type!=='hello'||m.secret!==key.secret||typeof m.nonce!=='string'||m.nonce.length>100)throw Error('邀请码无效');const privateKey=await crypto.subtle.importKey('jwk',key.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,enc.encode(`${key.peerId}:${m.nonce}`)));verified=true;clearTimeout(timer);conn.send({type:'welcome',publicKey:key.publicKey,signature});callbacks.connected(conn);}else if(m.type==='ping')conn.send({type:'pong'});else await callbacks.message(conn,m);}catch(e){conn.send({type:'error',message:e.message,requestId:m?.requestId});if(!verified)conn.close();}});conn.on('close',()=>{clearTimeout(timer);pending.delete(conn);callbacks.closed(conn);});conn.on('error',()=>conn.close());});return ()=>{for(const c of pending)c.close();};}
export async function connect(peer,invite,callbacks){
 const info=parseInvite(invite),nonce=secret();
 return new Promise((resolve,reject)=>{
  const conn=peer.connect(info.peerId,{reliable:true,serialization:'json'});
  if(!conn)throw Error('信令连接已断开，请重新连接');
  const ice=trackIce(conn,peer);
  let verified=false,finished=false,last=Date.now();
  const stopHandshake=()=>{clearTimeout(timeout);ice.stop();peer.off('error',peerError);};
  const fail=error=>{
   if(finished)return;
   finished=true;stopHandshake();clearInterval(heartbeat);
   if(!verified)reject(error);
   conn.close();
  };
  const peerError=error=>{
   if(error.type==='peer-unavailable')fail(Error('信令服务未找到房主，请确认邀请及房主已在线'));
  };
  const timeout=setTimeout(()=>fail(!conn.open&&ice.answered?ice.error():Error('房主连接或身份校验超时')),20000);
  const heartbeat=setInterval(()=>{if(Date.now()-last>35000)conn.close();else if(verified)conn.send({type:'ping'});},10000);
  peer.on('error',peerError);
  conn.on('open',()=>conn.send({type:'hello',secret:info.secret,nonce}));
  conn.on('data',async m=>{
   if(finished)return;
   try{
    last=Date.now();
    if(!verified){
     if(m.type!=='welcome'||await fingerprint(m.publicKey)!==info.fingerprint)throw Error('房主身份校验失败');
     const pub=await crypto.subtle.importKey('jwk',m.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
     if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,bytes(m.signature),enc.encode(`${info.peerId}:${nonce}`)))throw Error('房主签名无效');
     if(finished)return;
     verified=true;stopHandshake();resolve(conn);
    }else if(m.type!=='pong')callbacks.message(m);
   }catch(e){fail(e);}
  });
  conn.on('close',()=>{if(verified)callbacks.closed();fail(Error('连接已关闭'));});
  conn.on('error',e=>fail(!conn.open&&e.type==='negotiation-failed'?ice.error():e));
 });
}
