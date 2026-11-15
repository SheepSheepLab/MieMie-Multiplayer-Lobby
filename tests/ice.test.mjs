import test from 'node:test';
import assert from 'node:assert/strict';
import {connectWithRelay, hasTurn, peerIceOptions, trackIce} from '../src/ice.mjs';

const turn={urls:'turns:turn.example.test:443?transport=tcp',username:'test-user',credential:'test-credential'};

test('默认只使用可用于直连探测的 STUN，保留用户明确配置的 ICE 服务',()=>{
 const defaults=peerIceOptions({});
 assert.equal(hasTurn(defaults.config),false);
 assert.ok(defaults.config.iceServers.some(server=>server.urls==='stun:stun.cloudflare.com:3478'));
 assert.deepEqual(peerIceOptions({config:{iceServers:[]}}).config.iceServers,[]);
 assert.equal(hasTurn(peerIceOptions({config:{iceServers:[turn]}}).config),true);
 assert.deepEqual(peerIceOptions([turn]).config.iceServers,[turn]);
 assert.deepEqual(peerIceOptions({iceServers:[turn]}).config.iceServers,[turn]);
});

test('TURN 取证服务返回短期凭据，故障时可继续尝试直连',async t=>{
 const iceServers=[{urls:['stun:example.test',turn.urls,'https://example.test'],username:turn.username,credential:turn.credential}];
 const fetch=t.mock.method(globalThis,'fetch',async (url,options)=>{
  assert.equal(url.href,'https://relay.example.test/credentials');
  assert.equal(options.credentials,'omit');
  assert.equal(options.referrerPolicy,'no-referrer');
  return {ok:true,json:async()=>({iceServers})};
 });
 const settings={turnCredentialUrl:'https://relay.example.test/credentials',config:{iceServers:[]}};
 const configured=await peerIceOptions(settings);
 assert.deepEqual(configured.config.iceServers,[{...turn,urls:[turn.urls]}]);
 assert.deepEqual(settings.config.iceServers,[]);
 assert.equal(configured.turnCredentialUrl,undefined);
 fetch.mock.mockImplementation(async()=>({ok:false}));
 assert.equal((await peerIceOptions(settings)).turnServiceUnavailable,true);
 await assert.rejects(peerIceOptions({...settings,config:{iceTransportPolicy:'relay'}}),/无法取得 TURN/);
 assert.throws(()=>peerIceOptions({turnCredentialUrl:'http://relay.example.test/credentials'}),/HTTPS/);
});

test('连接只在 ICE 失败且有 TURN 时重试一次，并将后续连接恢复为原配置',async ()=>{
 const config={iceServers:[turn]};
 const peer={options:{config}};
 const iceError=Object.assign(Error('ICE stalled'),{code:'webrtc-ice-failed'});
 let attempts=0,retries=0;
 assert.equal(await connectWithRelay(peer,async ()=>{
  if(++attempts===1){assert.equal(peer.options.config,config);throw iceError;}
  assert.equal(peer.options.config.iceTransportPolicy,'relay');
  return 'connected';
 },()=>{retries++;}),'connected');
 assert.equal(peer.options.config,config);
 assert.equal(retries,1);
 await assert.rejects(connectWithRelay(peer,async()=>{throw Error('密码错误');},()=>{assert.fail();}),/密码错误/);
});

test('ICE 诊断只汇报候选类型和错误码',()=>{
 const pc=new EventTarget();
 pc.remoteDescription={sdp:'a=candidate:1 1 UDP 1 192.0.2.2 1234 typ relay'};
 const diagnostics=trackIce({peerConnection:pc},{});
 pc.dispatchEvent(Object.assign(new Event('icecandidate'),{candidate:{type:'host',address:'192.0.2.1'}}));
 pc.dispatchEvent(Object.assign(new Event('icecandidateerror'),{errorCode:701,url:'turns:relay.example.test:443'}));
 const error=diagnostics.error();
 assert.equal(error.code,'webrtc-ice-failed');
 assert.match(error.message,/本端候选 本机，房主候选 中继，ICE 错误码 701/);
 assert.doesNotMatch(error.message,/192\.0\.2|example\.test/);
 diagnostics.stop();
});
