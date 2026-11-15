import test from 'node:test';
import assert from 'node:assert/strict';
import {issueTurn} from '../server/turn-worker.mjs';

const request=(path='/v1/ice',method='GET')=>new Request('https://relay.example.test'+path,{
 method,headers:{'CF-Connecting-IP':'192.0.2.1'},
});
const allow={limit:async()=>({success:true})};
const env={
 MIEMIE_TURN_KEY_ID:'fixture-key',
 MIEMIE_TURN_KEY_TOKEN:'fixture-server-token',
 TURN_CLIENT_LIMIT:allow,
 TURN_TOTAL_LIMIT:allow,
};

test('签发接口只返回短期 TURN 凭据，保留 TLS 443，过滤浏览器禁用的 53 端口',async ()=>{
 const response=await issueTurn(request(),env,async (url,options)=>{
  assert.equal(url,'https://rtc.live.cloudflare.com/v1/turn/keys/fixture-key/credentials/generate-ice-servers');
  assert.equal(options.headers.Authorization,'Bearer fixture-server-token');
  assert.equal(JSON.parse(options.body).ttl,86400);
  return Response.json({iceServers:[
   {urls:['stun:stun.cloudflare.com:3478']},
   {urls:['turns:turn.cloudflare.com:443?transport=tcp','turn:turn.cloudflare.com:53'],username:'session',credential:'temporary'},
  ]});
 });
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await response.json(),{iceServers:[{
  urls:['turns:turn.cloudflare.com:443?transport=tcp'],username:'session',credential:'temporary',
 }]});
});

test('限流、配置缺失和上游错误不会向客户端显示密钥',async ()=>{
 const never=()=>assert.fail('The provider must not be called');
 assert.equal((await issueTurn(request('/'),env,never)).status,404);
 assert.equal((await issueTurn(request('/v1/ice','POST'),env,never)).status,405);
 assert.equal((await issueTurn(request(),{},never)).status,503);
 const blocked={limit:async()=>({success:false})};
 for(const key of ['TURN_CLIENT_LIMIT','TURN_TOTAL_LIMIT']){
  assert.equal((await issueTurn(request(),{...env,[key]:blocked},never)).status,429);
 }
 const error=await issueTurn(request(),env,async()=>new Response('fixture-server-token',{status:502}));
 assert.equal(error.status,503);
 assert.doesNotMatch(await error.text(),/fixture-server-token/);
});
