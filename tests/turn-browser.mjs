import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {PeerServer} from 'peer';
import {chromium} from 'playwright';

const fixture = process.env.MIEMIE_TEST_TURN_NETWORK;
assert.ok(fixture, 'Provide a test RTCIceServer JSON file via MIEMIE_TEST_TURN_NETWORK');
const credentials = JSON.parse(await readFile(fixture, 'utf8'));
let bundle;
const site = createServer((req,res)=>{
 if(req.url==='/turn'){
  res.setHeader('Content-Type','application/json');
  return res.end(JSON.stringify(credentials));
 }
 if(req.url==='/harness.js') {
  res.setHeader('Content-Type','application/javascript');
  return res.end(bundle.text);
 }
 res.setHeader('Content-Type','text/html');
 res.end('<!doctype html><script src="/harness.js"></script>');
});
let signal;
let browser;
try{
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 await new Promise(resolve=>PeerServer({host:'127.0.0.1',port:0,path:'/'},server=>{signal=server;resolve();}));
 const origin='http://127.0.0.1:'+site.address().port;
 const {outputFiles}=await build({entryPoints:['tests/browser-entry.mjs'],bundle:true,write:false,define:{
  __MIEMIE_TURN_CREDENTIAL_URL__:JSON.stringify(origin+'/turn'),
 }});
 [bundle]=outputFiles;
 const config={host:'127.0.0.1',port:signal.address().port,path:'/',secure:false,config:{}};
 browser=await chromium.launch(process.env.MIEMIE_LOBBY_BROWSER==='edge'?{channel:'msedge'}:{});
 async function player(blockDirect){
  const page=await browser.newPage();
  if(blockDirect){
   await page.addInitScript(()=>{
    const Real=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Real{
     constructor(options){
      // Let signaling through while removing all candidates from the first data connection.
      super(options?.iceTransportPolicy==='all'||!options?.iceTransportPolicy
       ?{...options,iceServers:[],iceTransportPolicy:'relay'}:options);
     }
    };
   });
  }
  await page.goto(origin);
  await page.evaluate(config=>{
   newController();
   c.config=config;
   const maps=new Map();
   c.adapter.hostChat=()=>({binding:'test-chat',chatRef:{name:'TURN test'}});
   c.adapter.matchesChat=()=>true;
   c.adapter.mapStore={put:async(key,value)=>maps.set(key,value),get:async key=>maps.get(key),remove:async key=>maps.delete(key)};
   c.adapter.captureRoomMap=async roomId=>({
    schema:1,roomId,avatar:'',card:{data:{name:'中继地图',description:'a'.repeat(2*1024*1024)}},
    books:[{name:'世界书',data:{entries:{0:{content:'同步到来宾'}}}}],
    links:{primary:'世界书',chat:null,additional:[]},
   });
   c.adapter.installRoomMap=async map=>{
    window.installedMap={name:map.card.data.name,bytes:map.card.data.description.length,book:map.books[0].data.entries[0].content};
    return {binding:'test-chat'};
   };
   c.adapter.roomAssetsEnabled=()=>true;
   c.adapter.appendRound=async()=>true;
   window.relayAttempts=0;
   c.notify=()=>{if(c.error?.startsWith('正在尝试通过 TURN'))window.relayAttempts++;};
  },config);
  return page;
 }
 const host=await player(false);
 await host.evaluate(()=>{c.config.config.iceTransportPolicy='relay';return c.host({name:'房主',description:'fixture'},'TURN 测试',false,'hidden',{password:'fixture'});});
 const guest=await player(true);
 const code=await host.evaluate(()=>c.roomCode);
 await guest.evaluate(code=>c.join(code,{name:'来宾',description:'fixture'},undefined,{password:'fixture'}),code);
 await guest.waitForFunction(()=>c.view?.players.filter(Boolean).length===2);
 assert.ok(await guest.evaluate(()=>window.relayAttempts>0));
 const selected=await guest.evaluate(async()=>{
  const stats=await c.connection.peerConnection.getStats();
  const transport=[...stats.values()].find(entry=>entry.type==='transport'&&entry.selectedCandidatePairId);
  const pair=stats.get(transport?.selectedCandidatePairId);
  const local=stats.get(pair?.localCandidateId);
  const remote=stats.get(pair?.remoteCandidateId);
  return {types:[local?.candidateType,remote?.candidateType],relayProtocol:local?.relayProtocol};
 });
 assert.deepEqual(selected.types,['relay','relay']);
 if(process.env.MIEMIE_TEST_EXPECT_RELAY_PROTOCOL){
  assert.equal(selected.relayProtocol,process.env.MIEMIE_TEST_EXPECT_RELAY_PROTOCOL);
 }
 await guest.waitForFunction(()=>c.mapSync?.state==='ready',null,{timeout:120000});
 assert.deepEqual(await guest.evaluate(()=>window.installedMap),{name:'中继地图',bytes:2*1024*1024,book:'同步到来宾'});
 await host.waitForFunction(()=>c.view.mapsReady);
 await guest.evaluate(()=>c.send('ready',{ready:true}));
 await host.waitForFunction(()=>c.view?.players.filter(player=>player?.ready).length===2);
 await host.evaluate(()=>{c.start();c.send('action',{content:'房主行动'});});
 await guest.waitForFunction(()=>c.view.phase==='actions');
 await guest.evaluate(()=>c.send('action',{content:'来宾行动'}));
 await host.waitForFunction(()=>c.view.phase==='ready');
 await host.evaluate(()=>c.generate());
 await guest.waitForFunction(()=>c.view.results.length===1);
 assert.equal(await guest.evaluate(()=>c.view.results[0].status),'<status>user1专属状态</status>');
 await host.evaluate(()=>c.end());
 console.log(`PASS direct negotiation blocked, automatic TURN relay/relay via ${selected.relayProtocol??'unknown transport'}, password, 2 MiB map, actions and private status`);
}finally{
 await browser?.close();
 site.close();
 signal?.close();
}
process.exit(0);
