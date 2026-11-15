import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {decodeRoomMap, encodeRoomMap, MAP_CHUNK_SIZE, roomMapAssets, validateMapDescriptor} from '../src/room-map.mjs';
import {Controller} from '../src/controller.mjs';
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

function mapTransfer(descriptor) {
  const requests = [];
  const guest = new Controller({}, {
    mapStore: {},
    installRoomMap: async map => ({name: map.card.data.name}),
    roomAssetsEnabled: () => true,
  });
  guest.closed = false;
  guest.view = {id: crypto.randomUUID(), map: descriptor};
  guest.connection = {open: true, send: message => requests.push(message)};
  return {guest, requests};
}

test('缓慢但持续收到地图分片可完成同步，兼容不会回传下载标识的旧房主', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {guest, requests} = mapTransfer(null);
  const {descriptor, data} = await encodeRoomMap({
    schema: 1, roomId: guest.view.id, avatar: '',
    card: {data: {name: '联机角色', description: '慢速下载'.repeat(10000)}},
    books: [], links: {primary: null, chat: null, additional: []},
  });
  guest.view.map = descriptor;
  guest.requestRoomMap();
  t.mock.timers.tick(50000);
  const total = validateMapDescriptor(descriptor);
  for (let index = 0; index < total; index++) {
    await guest.receiveMapChunk({index, data: data.slice(index * MAP_CHUNK_SIZE, (index + 1) * MAP_CHUNK_SIZE)});
    t.mock.timers.tick(5000);
  }
  assert.deepEqual(requests.map(request => request.start), [0, 8]);
  assert.equal(guest.mapSync.state, 'ready');
  assert.equal(guest.mapChat.name, '联机角色');
  t.mock.timers.tick(600000);
  assert.equal(guest.mapSync.state, 'ready');
});

test('等待首片与下载停滞分别提示，重试忽略上一轮分片', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {guest, requests} = mapTransfer({hash: '0'.repeat(64), bytes: 18000});
  const host = new Controller({}, {});
  host.mapWire = {data: 'A'.repeat(24000)};
  const late = [];
  const conn = {send: message => late.push(message)};
  host.connections.set(conn, 'guest');
  guest.requestRoomMap();
  host.receive(conn, requests[0]);
  t.mock.timers.tick(60000);
  assert.match(guest.mapSync.error, /首个分片/);
  assert.equal(late[0].transferId, requests[0].transferId);
  guest.requestRoomMap();
  await guest.receiveMapChunk(late[0]);
  assert.deepEqual(guest.mapSync.parts, []);
  await guest.receiveMapChunk({...late[0], transferId: requests[1].transferId});
  t.mock.timers.tick(30000);
  assert.match(guest.mapSync.error, /50%.*30 秒/);
});

test('下载一直有进度也不能超过总时限', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {guest} = mapTransfer({hash: '0'.repeat(64), bytes: 1000000});
  guest.requestRoomMap();
  for (let index = 0; index < 24; index++) {
    await guest.receiveMapChunk({index, data: 'A'.repeat(MAP_CHUNK_SIZE)});
    t.mock.timers.tick(25000);
  }
  assert.match(guest.mapSync.error, /总时限/);
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
