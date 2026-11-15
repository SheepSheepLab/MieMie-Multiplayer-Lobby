import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Controller} from '../src/controller.mjs';
import {openPeer,identity} from '../src/transport.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
const adapter={cancel(){},hostChat:()=>({binding:'0:bound'})};
class FakePeer extends EventEmitter {destroy(){this.destroyed=true;} }
test('closing during host allocation destroys late peer without reviving room or writing storage',async()=>{
 const pending=deferred(),entered=deferred(),saved=storage(),key=await identity();
 const c=new Controller(saved,adapter,()=>{},{identity:async()=>key,allocatePeer:()=>{entered.resolve();return pending.promise;}});
 const work=c.host({name:'A',description:'A'},'old');await entered.promise;c.close();const p=new FakePeer();pending.resolve({peer:p,code:'123456'});await work;
 assert.equal(p.destroyed,true);assert.equal(c.mode,'none');assert.equal(c.room,null);assert.equal(saved.getItem('mm-lobby-host-v1'),null);
});
test('stale creation failure cannot close a newer room',async()=>{
 const pending=deferred(),entered=deferred(),key=await identity();let count=0;
 const c=new Controller(storage(),adapter,()=>{},{identity:async()=>key,allocatePeer:()=>{if(++count===1){entered.resolve();return pending.promise;}return Promise.resolve({peer:new FakePeer(),code:'234567'});}});
 const old=c.host({name:'A',description:'A'},'old');await entered.promise;await c.host({name:'B',description:'B'},'new');pending.reject(Error('old failed'));await old;
 assert.equal(c.mode,'host');assert.equal(c.room.state.title,'new');assert.equal(c.peer.destroyed,undefined);c.close();
});
test('openPeer removes startup handlers after opening so later recoverable errors do not destroy active peer',async()=>{
 let p;class Peer extends FakePeer {constructor(){super();p=this;}}
 const opening=openPeer('test',{},0,Peer);p.emit('open');assert.equal(await opening,p);assert.equal(p.listenerCount('open'),0);assert.equal(p.listenerCount('error'),0);
 p.on('error',()=>{});p.emit('error',{type:'peer-unavailable'});assert.equal(p.destroyed,undefined);
});

test('switching away during generation cancels and ignores a late reply; the original chat can retry',async()=>{
 const first=deferred(), next=deferred();
 let correctChat=true, stopped=0, generated=0;
 const key=await identity();
 const c=new Controller(storage(),{
  capture:()=>({binding:'0:bound',history:[]}),
  hostChat:adapter.hostChat,
  matchesChat:()=>correctChat,
  cancel:()=>{stopped++;},
  generate:()=>++generated===1?first.promise:next.promise,
 },()=>{},{identity:async()=>key,allocatePeer:async()=>({peer:new FakePeer(),code:'555555'})});
 await c.host({name:'A',description:'A'},'chat binding');
 const guest=c.room.join({name:'B',description:'B'},'test-token',1);
 c.room.ready(guest,true);
 c.start();
 c.send('action',{content:'A intent'});
 c.room.action(guest,{id:'B1',round:1,content:'B intent'});
 const pending=c.generate();
 assert.equal(c.view.phase,'generating');
 correctChat=false;
 c.refreshHostChat();
 assert.equal(stopped,1);
 assert.equal(c.view.hostChatPaused,true);
 assert.equal(c.view.phase,'error');
 assert.equal(c.view.actions.length,2);
 await assert.rejects(c.generate(),/返回联机房间/);
 correctChat=true;
 c.refreshHostChat();
 const retry=c.generate();
 const reply='Scene. <user0><status>A</status></user0><user1><status>B</status></user1>';
 first.resolve(reply);await pending;
 assert.equal(c.view.phase,'generating');
 assert.equal(c.view.results.length,0);
 next.resolve(reply);await retry;
 assert.equal(c.view.round,2);
 assert.equal(c.view.results.length,1);
 c.close();
});
