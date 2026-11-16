import test from 'node:test';
import assert from 'node:assert/strict';
import {createLobbyExtensionApi} from '../src/extension-api.mjs';
import {attachmentPath, createSharedAttachments} from '../src/shared-attachments.mjs';

test('一次注册只给出声明的能力，来宾可识别联机楼层，旧句柄随分支失效',async()=>{
 const result={id:'first',variant:0};
 const room={state:{id:'room',results:[result]}};
 const writes=[];
 let role='host';
 const controller={
  room,closed:false,view:{id:'room',results:[result]},broadcast(){},
  captureFloor:()=>({room,roomId:room.state.id,branch:room.state.branch?.id??null,variant:0,resultId:result.id,role}),
  isCurrentFloor:target=>target.role===role&&target.branch===(room.state.branch?.id??null),
  publishAttachment:(_target,owner,path,file,kind)=>writes.push({owner,path,file,kind}),
 };
 const api=createLobbyExtensionApi(controller);
 const base={id:'fixture',name:'示例',version:'1.0.0'};
 const source=api.register({...base,capabilities:['status']});
 assert.throws(()=>api.register(base),/已注册/);
 const initial=source.forMessage();
 assert.equal(initial,source.forMessage());
 assert.equal(initial.publishAttachment,undefined);
 initial.reportStatus('working','更新正文');
 assert.equal(api.list()[0].status.label,'更新正文');
 const image=api.register({...base,id:'asset',capabilities:['image']});
 const file=new Blob(['bytes'],{type:'image/png'});
 await image.forMessage().publishAttachment({path:'scene/cut.png',file});
 assert.equal(writes[0].owner,'asset');
 assert.equal(writes[0].kind,'image');
 room.state.branch={id:'new'};
 api.notify();
 assert.equal(initial.signal.aborted,true);
 assert.throws(()=>initial.reportStatus('complete'),/过期/);
 assert.equal(api.list().find(item=>item.id==='fixture').status,null);
 role='guest';
 const guest=image.forMessage();
 assert.equal(guest.role,'guest');
 assert.equal(guest.publishAttachment,undefined);
 image.release();
 assert.equal(guest.signal.aborted,true);
 api.dispose();
});

test('附件只接受对应 MIME 的相对路径，并在完整校验后保存',async()=>{
 for(const path of ['../x.png','/x.png','x\\y.png','aux.mp3','%2e%2e/x.png','file.png?key=abc']){
  assert.throws(()=>attachmentPath(path),/相对路径/);
 }
 assert.equal(attachmentPath('audio/场景/旁白.mp3'),'audio/场景/旁白.mp3');
 const blobs=new Map(), requests=[];
 const store={get:async key=>blobs.get(key),put:async(key,blob)=>blobs.set(key,blob)};
 const conn={open:true,send:message=>requests.push(message)};
 const room={id:'room',results:[{attachments:[]}]};
 const guest=createSharedAttachments({store,view:()=>room,connection:()=>conn,changed(){}});
 const file=new Blob(['1234'],{type:'audio/wav'});
 await assert.rejects(guest.prepare('scene/audio.mp3',file,'audio'),/后缀/);
 const {entry,blob}=await guest.prepare('scene/audio.wav',file,'audio');
 room.results[0].attachments.push(entry);
 await guest.pump();
 const started=requests.at(-1);
 await guest.receive({type:'attachment-chunk',hash:entry.hash,index:0,transferId:started.transferId,data:btoa('4321')});
 assert.equal(guest.status(entry.hash),'failed');
 assert.equal(blobs.size,0);
 guest.reset();
 await guest.pump();
 const next=requests.at(-1);
 await guest.receive({type:'attachment-chunk',hash:entry.hash,index:0,transferId:next.transferId,data:btoa('1234')});
 assert.equal(guest.status(entry.hash),'ready');
 assert.equal(requests.at(-1).type,'attachment-ready');
 assert.equal(await [...blobs.values()][0].text(),await blob.text());
 guest.reset();
 await guest.pump();
 assert.equal(requests.at(-1).type,'attachment-ready');
 guest.reset(true);
});
