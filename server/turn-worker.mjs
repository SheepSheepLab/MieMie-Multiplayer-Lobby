const credentialLifetime=24*60*60;
const headers={
 'Access-Control-Allow-Origin':'*',
 'Cache-Control':'no-store',
 'Content-Type':'application/json; charset=utf-8',
};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});

export async function issueTurn(request,env,requestUpstream=fetch){
 if(new URL(request.url).pathname!=='/v1/ice')return respond({error:'Not found'},404);
 if(request.method!=='GET')return respond({error:'Method not allowed'},405);
 const ip=request.headers.get('CF-Connecting-IP');
 if(!ip)return respond({error:'Missing client address'},403);
 const key=env.MIEMIE_TURN_KEY_ID,token=env.MIEMIE_TURN_KEY_TOKEN;
 if(!key||!token)return respond({error:'Relay service unavailable'},503);
 try{
  const {success}=await env.TURN_CLIENT_LIMIT.limit({key:ip});
  if(!success)return respond({error:'Too many requests'},429);
  const budget=await env.TURN_TOTAL_LIMIT.limit({key:'turn-issuance'});
  if(!budget.success)return respond({error:'Too many requests'},429);
  const url=`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`;
  const upstream=await requestUpstream(url,{
   method:'POST',
   headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({ttl:credentialLifetime}),
   signal:AbortSignal.timeout(4000),
   redirect:'error',
  });
  if(!upstream.ok)throw Error();
  const {iceServers}=await upstream.json();
  const servers=iceServers.flatMap(server=>{
   const urls=(Array.isArray(server.urls)?server.urls:[server.urls])
    .filter(url=>/^turns?:turn\.cloudflare\.com:(?:80|443|3478|5349)(?:\?transport=(?:udp|tcp))?$/i.test(url));
   return urls.length&&typeof server.username==='string'&&typeof server.credential==='string'
    ?[{urls,username:server.username,credential:server.credential}]:[];
  });
  if(!servers.length)throw Error();
  return respond({iceServers:servers});
 }catch{
  return respond({error:'Relay service unavailable'},503);
 }
}

export default {fetch:(request,env)=>issueTurn(request,env)};
