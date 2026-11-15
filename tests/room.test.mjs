import test from 'node:test';import assert from 'node:assert/strict';import {Room} from '../src/room.mjs';
const p=n=>({name:n,description:n+'的人物设定'});
function fixture(count=4){const r=Room.create(p('同名'),'host','测试');for(let i=1;i<count;i++){const id=r.join(p('同名'),'token'+i,i);r.ready(id,true);}r.start('chat',[]);return r;}
const action=(r,i)=>r.action(r.state.players[i].id,{id:'action'+i,round:r.state.round,content:'行动'+i});
const raw=count=>'共享正文\n'+Array.from({length:count},(_,i)=>`<user${i}><status>私有状态${i}</status></user${i}>`).join('\n');
test('2–4人：房主先行动、全员锁定、一次提交、状态隔离',()=>{for(let count=2;count<=4;count++){const r=fixture(count);assert.throws(()=>action(r,1),/房主/);action(r,0);assert.equal(action(r,0).id,'action0');for(let i=1;i<count;i++)action(r,i);assert.equal(r.state.phase,'ready');assert.throws(()=>r.action(r.state.players[1].id,{id:'changed',round:1,content:'篡改'}),/锁定/);const attempt=r.beginGeneration();assert.throws(()=>r.beginGeneration());r.commit(attempt,raw(count));assert.equal(r.state.round,2);for(let i=0;i<count;i++){const view=r.view(r.state.players[i].id);assert.equal(view.results[0].status,`<status>私有状态${i}</status>`);for(let j=0;j<count;j++)if(i!==j)assert.ok(!JSON.stringify(view).includes('私有状态'+j));assert.ok(!JSON.stringify(view).includes('token'));}assert.throws(()=>r.commit(attempt,raw(count)));}});
test('生成失败保留冻结行动，可取消及重试，拒收过期结果',()=>{const r=fixture(2);action(r,0);action(r,1);const old=r.beginGeneration();assert.throws(()=>r.commit(old,'缺状态'));r.fail(old,'缺状态');assert.equal(r.state.results.length,0);const next=r.beginGeneration();assert.throws(()=>r.commit(old,raw(2)));r.commit(next,raw(2));assert.equal(r.state.results.length,1);});
test('原玩家重连保留角色；接管需要离线且保留身份、行动',()=>{const r=fixture(2);action(r,0);action(r,1);const id=r.state.players[1].id;r.disconnect(id);assert.equal(r.join(p('新名字'),'token1',3),id);assert.equal(r.player(id).name,'同名');assert.throws(()=>r.takeover(1,'replacement'));r.disconnect(id);assert.equal(r.takeover(1,'replacement'),id);assert.equal(r.state.actions[1].playerId,id);assert.throws(()=>r.join(p('旧人'),'token1',1));});
test('聊天去重、房主清空、结束清空、持久化失败回滚',()=>{const r=fixture(2),id=r.state.players[0].id;const m={id:'m1',content:'hello'};r.chat(id,m);r.chat(id,m);assert.equal(r.state.chat.length,1);r.clearChat();assert.equal(r.state.chat.length,0);assert.equal(r.state.chatEpoch,1);r.save=()=>{throw Error('quota');};assert.throws(()=>r.chat(id,m),/quota/);assert.equal(r.state.chat.length,0);r.save=()=>{};r.chat(id,m);r.end();assert.equal(r.state.chat.length,0);assert.throws(()=>r.chat(id,m));});
test('单人不能开始，未准备或离线不能开始',()=>{const r=Room.create(p('a'),'h','room');assert.throws(()=>r.start('x',[]));const id=r.join(p('b'),'b',1);assert.throws(()=>r.start('x',[]));r.ready(id,true);r.disconnect(id);assert.throws(()=>r.start('x',[]));});
test('暗行动：实时、历史、重连视图均仅暴露自己的行动，冻结输入保留全员行动',()=>{const r=Room.create(p('host'),'h','暗行动','hidden');const guest=r.join(p('guest'),'g',1);r.ready(guest,true);r.start('bound',[]);const host=r.state.players[0].id;r.action(host,{id:'h',round:1,content:'房主的秘密计划'});r.action(guest,{id:'g',round:1,content:'来宾的秘密计划'});for(const [viewer,hiddenText]of [[host,'来宾的秘密计划'],[guest,'房主的秘密计划']]){const v=r.view(viewer);assert.ok(!JSON.stringify(v).includes(hiddenText));assert.equal(v.actions.find(a=>a.playerId!==viewer).submitted,true);}assert.equal(r.state.frozen.actions[1].content,'来宾的秘密计划');const attempt=r.beginGeneration();r.commit(attempt,raw(2));assert.ok(!JSON.stringify(r.view(guest)).includes('房主的秘密计划'));r.disconnect(guest);r.join(p('guest'),'g',1);assert.ok(!JSON.stringify(r.view(guest)).includes('房主的秘密计划'));});
test('生成期间结束房间，不接收晚到回复',()=>{const r=fixture(2);action(r,0);action(r,1);const a=r.beginGeneration();r.end();assert.throws(()=>r.commit(a,raw(2)),/取消或过期/);assert.equal(r.state.results.length,0);});
test('锁位限制最低两席，锁位不能入座，开局后席位固定',()=>{const r=Room.create(p('host'),'h','room');r.lock(3,true);r.lock(2,true);assert.equal(r.view(r.state.players[0].id).capacity,2);assert.throws(()=>r.lock(1,true),/两个/);assert.throws(()=>r.lock(0,true));const id=r.join(p('guest'),'g',2);assert.equal(r.player(id).seat,1);assert.throws(()=>r.join(p('other'),'other'),/没有可用席位/);r.lock(2,false);assert.throws(()=>r.lock(1,true));r.ready(id,true);r.start('bound',[]);assert.throws(()=>r.lock(3,false),/开局/);});
test('踢人撤销原凭据，开局前释放槽位，开局后保留角色行动，可接管',()=>{const r=Room.create(p('host'),'h','room');r.join(p('g'),'g',1);r.kick(1);assert.equal(r.state.players[1],null);assert.throws(()=>r.join(p('g'),'g',2),/移除/);const id=r.join(p('new'),'new',1);r.ready(id,true);r.start('b',[]);action(r,0);action(r,1);r.kick(1);assert.equal(r.state.players[1].id,id);assert.equal(r.state.players[1].online,false);assert.equal(r.state.actions[1].playerId,id);assert.throws(()=>r.takeover(1,'new'),/移除/);assert.equal(r.takeover(1,'replacement'),id);assert.throws(()=>r.kick(0));});

test('public scene contains only approved fields and survives rejoin; a pregame leave frees the seat',()=>{
 const scene={intro:'  营地  ',rules:'休息后出发',opening:'<img src=x>',privateCard:'secret card',scripts:['code']};
 const room=Room.create({name:'Host',description:'host'},'host-token','Test','hidden',scene);
 const guest=room.join({name:'Guest',description:'guest'},'guest-token',1);
 assert.deepEqual(room.view(guest).scene,{intro:'营地',rules:'休息后出发',opening:'<img src=x>'});
 room.leave(guest);
 assert.equal(room.seats()[1],null);
 const replacement=room.join({name:'Next',description:'guest'},'next-token',1);
 assert.deepEqual(room.view(replacement).scene,room.view(room.state.players[0].id).scene);
 const legacy=structuredClone(room.state);
 delete legacy.scene;
 assert.deepEqual(new Room(legacy).view(replacement).scene,{});
 assert.throws(()=>Room.create({name:'Host',description:'host'},'host-token','Test','public',{opening:'a'.repeat(3201)}),/开场白/);
});

test('first available seat is assigned at join; moving is atomic and keeps the seat through reconnect',()=>{
 const room=Room.create(p('Host'),'host','房间');
 const host=room.state.players[0].id;
 room.lock(1,true);
 const first=room.join(p('First'),'first',3);
 const second=room.join(p('Second'),'second',1);
 assert.equal(room.player(first).seat,2);
 assert.equal(room.player(second).seat,3);
 assert.throws(()=>room.join(p('Third'),'third'),/没有可用席位/);
 assert.throws(()=>room.move(first,1),/已被占用或锁定/);
 assert.throws(()=>room.move(first,3),/已被占用或锁定/);
 room.lock(1,false);
 assert.throws(()=>room.move(host,1),/房主席位固定/);
 room.ready(first,true);
 room.move(first,1);
 assert.equal(room.state.players[2],null);
 assert.equal(room.player(first).ready,false);
 assert.throws(()=>room.move(second,1),/已被占用或锁定/);
 room.disconnect(first);
 assert.equal(room.join(p('New profile'),'first'),first);
 assert.equal(room.player(first).seat,1);
 assert.equal(room.player(first).name,'First');
 room.ready(first,true);
 room.ready(second,true);
 room.start('bound',[]);
 assert.throws(()=>room.move(second,2),/开局后席位固定/);
});

test('恢复尚未开始的房间只显示现有连接，原队友返回后重新准备',()=>{
 const room=Room.create(p('主机'),'host','房间');
 const id=room.join(p('来宾'),'guest');
 room.ready(id,true);
 const restored=Room.restore(structuredClone(room.state));
 assert.equal(restored.seats()[1],null);
 assert.equal(restored.join(p('临时身份'),'guest'),id);
 assert.equal(restored.player(id).name,'来宾');
 assert.equal(restored.player(id).ready,false);
});

test('重 Roll 或指定楼层分支需在线队友一致同意，撤销保留原剧情',()=>{
 const room=fixture(3);
 const [host,guest,third]=room.state.players;
 const generate=()=>{
  for(let i=0;i<3;i++)action(room,i);
  return room.commit(room.beginGeneration(),raw(3));
 };
 const first=generate(), second=generate();
 assert.throws(()=>room.proposeVote(host.id,'reroll',first.id),/楼层/);
 const denied=room.proposeVote(host.id,'reroll',second.id);
 assert.throws(()=>action(room,0),/投票/);
 assert.equal(room.castVote(guest.id,denied.id,true),null);
 room.castVote(third.id,denied.id,false);
 assert.equal(room.state.results.at(-1),second);
 const overtaken=room.proposeVote(host.id,'reroll',second.id,0);
 assert.throws(()=>room.castVote(guest.id,overtaken.id,true,60000),/失效/);
 room.expireVote(overtaken.id);
 const yes=room.proposeVote(host.id,'reroll',second.id);
 room.castVote(guest.id,yes.id,true);
 const op=room.castVote(third.id,yes.id,true);
 const failed=room.beginReroll(op);
 room.fail(failed,'失败');
 assert.equal(room.state.results.at(-1),second);
 const again=room.proposeVote(host.id,'reroll',second.id);
 room.castVote(guest.id,again.id,true);
 const attempt=room.beginReroll(room.castVote(third.id,again.id,true));
 const result=room.commit(attempt,raw(3).replace('共享正文','重写'));
 assert.equal(result.id,second.id);
 assert.equal(result.variant,1);
 assert.equal(room.state.round,3);
 const branch=room.proposeVote(guest.id,'branch',first.id);
 room.castVote(host.id,branch.id,true);
 const branchOp=room.castVote(third.id,branch.id,true);
 room.commitBranch(branchOp,{binding:'new-chat'});
 assert.deepEqual(room.state.results,[first]);
 assert.equal(room.state.round,2);
 assert.equal(room.state.binding,'new-chat');
 assert.equal(room.state.branch.resultId,first.id);
 assert.equal(room.state.players[1].id,guest.id);
});
