import assert from 'node:assert/strict';
import test from 'node:test';
import {createRoundProcessors} from '../src/round-processors.mjs';

test('联机处理器依次等待，完成前不会提交结果，停用只影响该处理器',async()=>{
 const stages=[];
 const processors=createRoundProcessors();
 let finish;
 processors.register({id:'polisher',name:'润色工具',process({defer}){finish=defer().complete;}});
 processors.register({id:'memory',name:'记忆工具',process:async({raw})=>raw+' / 保存记忆'});
 processors.register({id:'disabled',name:'停用工具',process(){assert.fail('不应运行');}});
 const task=processors.run('原文',2,'attempt','round',['disabled'],()=>{
  stages.push(processors.list().map(entry=>entry.state));
 });
 await Promise.resolve();
 assert.equal(typeof finish,'function');
 assert.deepEqual(stages.at(-1),['running','waiting','idle']);
 finish('润色结果');
 assert.equal(await task,'润色结果 / 保存记忆');
 assert.deepEqual(processors.list([],3).map(entry=>entry.state),['done','done','idle']);
});

test('取消等待立即拒绝旧回复，随后新回合可继续',async()=>{
 const processors=createRoundProcessors();
 let finish;
 const unregister=processors.register({id:'slow',name:'外部脚本',process:({defer})=>{finish=defer().complete;}});
 const task=processors.run('原文',1,'old','round',[],()=>{});
 await Promise.resolve();
 processors.cancel();
 await assert.rejects(task,/取消/);
 finish('迟到文本');
 unregister();
 assert.equal(await processors.run('新文本',1,'new','round',[],()=>{}),'新文本');
});
