// PeerJS still lists the TURN service it retired. STUN helps discover direct routes.
const publicStun=[
 {urls:'stun:stun.cloudflare.com:3478'},
 {urls:'stun:stun.l.google.com:19302'},
];
const urlsOf=server=>Array.isArray(server?.urls)?server.urls:[server?.urls];
export const hasTurn=config=>config?.iceServers?.some(server=>urlsOf(server).some(url=>/^turns?:/i.test(url??'')))??false;
const defaultTurnUrl=typeof __MIEMIE_TURN_CREDENTIAL_URL__==='string'?__MIEMIE_TURN_CREDENTIAL_URL__:'';

export function peerIceOptions(settings){
 const {config,turnCredentialUrl,iceServers,...options}=Array.isArray(settings)?{iceServers:settings}:settings;
 const peerOptions={...options,config:{iceServers:iceServers??publicStun,sdpSemantics:'unified-plan',...config}};
 const endpoint=turnCredentialUrl??(config?.iceServers||iceServers?'':defaultTurnUrl);
 if(!endpoint)return peerOptions;
 const url=new URL(endpoint);
 if(url.username||url.password||!(url.protocol==='https:'||
  (url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))){
  throw Error('TURN 凭据服务需要 HTTPS 地址');
 }
 return appendTurnCredentials(peerOptions,url);
}

async function appendTurnCredentials(options,url){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch(url,{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  if(!response.ok)throw Error();
  const {iceServers}=await response.json();
  if(!Array.isArray(iceServers)||iceServers.length>8)throw Error();
  const servers=[];
  for(const server of iceServers){
   const urls=urlsOf(server).filter(url=>typeof url==='string'&&/^turns?:[^\s@/?#]+(?:\?transport=(?:udp|tcp))?$/i.test(url));
   if(urls.length&&typeof server.username==='string'&&server.username&&typeof server.credential==='string'&&server.credential){
    servers.push({urls,username:server.username,credential:server.credential});
   }
  }
  if(!servers.length)throw Error();
  return {...options,config:{...options.config,iceServers:[...options.config.iceServers,...servers]}};
 }catch{
  if(options.config.iceTransportPolicy==='relay'&&!hasTurn(options.config))throw Error('无法取得 TURN 连接凭据，请检查中继服务是否在线');
  return {...options,turnServiceUnavailable:true};
 }finally{
  clearTimeout(timeout);
 }
}

export function trackIce(connection,peer){
 const pc=connection.peerConnection;
 const types=new Set(),codes=new Set();
 const candidate=event=>{
  const type=event.candidate?.type;
  if(['host','srflx','prflx','relay'].includes(type))types.add(type);
 };
 const failure=event=>{if(Number.isInteger(event.errorCode))codes.add(event.errorCode);};
 pc?.addEventListener?.('icecandidate',candidate);
 pc?.addEventListener?.('icecandidateerror',failure);
 return {
  get answered(){return !!pc?.remoteDescription;},
  stop(){
   pc?.removeEventListener?.('icecandidate',candidate);
   pc?.removeEventListener?.('icecandidateerror',failure);
  },
  error(){
   const remote=new Set(Array.from((pc?.remoteDescription?.sdp??'').matchAll(/ typ (host|srflx|prflx|relay)\b/g),match=>match[1]));
   const route=set=>[set.has('host')?'本机':'',set.has('srflx')||set.has('prflx')?'公网':'',set.has('relay')?'中继':''].filter(Boolean).join('、')||'无';
   const details=`本端候选 ${route(types)}，房主候选 ${route(remote)}${codes.size?`，ICE 错误码 ${[...codes].join('、')}`:''}`;
   const hint=peer.options?.turnServiceUnavailable?'TURN 凭据服务暂时不可用。':'跨网连接需要可达的 TURN 中继。';
   const prefix=pc?.remoteDescription?'已收到房主回应，但 ':'';
   const error=Error(`${prefix}WebRTC 未能建立数据通道。${hint}（${details}）`);
   return Object.assign(error,{code:'webrtc-ice-failed',fatal:false});
  },
 };
}

// ICE normally tries direct and relay candidates in the same negotiation.
// Retry with relay candidates alone when the initial negotiation stalls.
export async function connectWithRelay(peer,join,onRetry){
 try{
  return await join();
 }catch(error){
  const options=peer.options,rtc=options?.config;
  if(error.code!=='webrtc-ice-failed'||peer.destroyed||peer.disconnected||!hasTurn(rtc)||rtc.iceTransportPolicy==='relay')throw error;
  onRetry();
  options.config={...rtc,iceTransportPolicy:'relay'};
  let retry;
  try{retry=join();}
  finally{options.config=rtc;}
  return await retry;
 }
}
