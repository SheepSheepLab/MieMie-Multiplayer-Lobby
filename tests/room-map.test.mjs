import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {decodeRoomMap, encodeRoomMap, roomMapAssets, validateMapDescriptor} from '../src/room-map.mjs';
import {connectShort} from '../src/short-transport.mjs';

test('完整地图分片可复原中文角色资料，校验拒绝篡改和过大的包', async () => {
  const map = {
    schema: 1, roomId: crypto.randomUUID(), avatar: 'AAAA',
    card: {data: {name: '联机角色', description: '完整设定'.repeat(8000), extensions: {
      tavern_helper: {scripts: [{name: '角色脚本',content:'window.example=true;'}]},
      regex_scripts: [{scriptName:'样例正则'}],
    }}},
    books: [{name:'房间世界书',data:{entries:{0:{content:'私下设定'}}}}],
    links: {primary:'房间世界书',additional:[],chat:null},
  };
  const {descriptor,data} = await encodeRoomMap(map);
  assert.ok(validateMapDescriptor(descriptor) > 1);
  const result = await decodeRoomMap(descriptor,data);
  assert.deepEqual(result,map);
  assert.deepEqual(roomMapAssets(result), {scripts:['角色脚本'],regexCount:1,enableScripts:true,enableRegexes:true,requiresConsent:true});
  await assert.rejects(decodeRoomMap(descriptor,(data[0]==='A'?'B':'A')+data.slice(1)),/地图校验失败/);
  assert.throws(()=>validateMapDescriptor({...descriptor,bytes:17*1024*1024}),/地图大小/);
});

test('信令明确找不到房主，连接在数据通道未打开时清理定时器和监听', async () => {
  const peer = new EventEmitter();
  const conn = new EventEmitter();
  let closes = 0;
  peer.connect = () => conn;
  conn.close = () => { closes++; };
  const pending = connectShort(peer,'123456',{},{});
  peer.emit('error',{type:'peer-unavailable'});
  await assert.rejects(pending,/信令服务未找到房主/);
  assert.equal(closes,1);
  assert.equal(peer.listenerCount('error'),0);
  assert.equal(peer.listenerCount('close'),0);
});

test('信令找到房主但 ICE 协商失败时明确提示 TURN', async () => {
  const peer = new EventEmitter();
  const conn = new EventEmitter();
  peer.connect = () => conn;
  conn.close = () => {};
  const pending = connectShort(peer,'123456',{},{});
  conn.emit('error',{type:'negotiation-failed'});
  await assert.rejects(pending,/WebRTC.*TURN/);
});
