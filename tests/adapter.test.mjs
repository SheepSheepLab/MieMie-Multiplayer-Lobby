import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createAdapter} from '../src/adapter.mjs';
function mock(fail=false){const hooks=[];const events=new EventEmitter();let received;const context={characterId:0,getCurrentChatId:()=> 'bound',chat:[],powerUserSettings:{experimental_macro_engine:true},eventSource:events,eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'final'},macros:{engine:{addPreProcessor:f=>hooks.push(f),removePreProcessor:f=>hooks.splice(hooks.indexOf(f),1)}}};const helper={async generate(config){const transform=s=>hooks.reduce((s,f)=>f(s),s);const data={messages:[{role:'system',content:transform('扮演{{user}}。<user>身份：{{persona}}')},{role:'user',content:transform(config.user_input)},...config.injects.map(m=>({role:m.role,content:transform(m.content)}))]};assert.ok(!data.messages[1].content.includes('{{setvar'));events.emit('final',data);received={config,data};if(fail)throw Error('provider failure');return 'ok';}};return {adapter:createAdapter({SillyTavern:{getContext:()=>context}},helper),hooks,events,get:()=>received};}
const state={binding:'0:bound',baseHistory:[],results:[],frozen:{players:[{id:'a',seat:0,name:'A',description:'host'},{id:'b',seat:1,name:'B',description:'guest {{setvar::x::unsafe}}'}],actions:[{seat:0,name:'A',content:'开始'},{seat:1,name:'B',content:'原样{{setvar::attack::1}}和<user>'}]}};
test('每次生成展开多人身份，来宾宏只作为字面文本，结束后移除钩子',async()=>{const m=mock();await m.adapter.generate(state);const {data,config}=m.get();assert.match(data.messages[0].content,/A（user0）、B（user1）/);assert.match(data.messages[0].content,/<user1>/);assert.match(data.messages[1].content,/原样\{\{setvar::attack::1\}\}和<user>/);assert.equal(config.should_stream,false);assert.equal(m.hooks.length,0);assert.equal(m.events.listenerCount('final'),0);});
test('生成失败也清理钩子',async()=>{const m=mock(true);await assert.rejects(()=>m.adapter.generate(state),/provider failure/);assert.equal(m.hooks.length,0);assert.equal(m.events.listenerCount('final'),0);});

function legacyAdapter(generate) {
  const overrides = new Map();
  const events = new EventEmitter();
  const context = {
    characterId: 0,
    getCurrentChatId: () => 'bound',
    eventSource: events,
    eventTypes: {CHAT_COMPLETION_SETTINGS_READY: 'final'},
    registerMacro: (key, callback) => overrides.set(key, callback),
    unregisterMacro: key => overrides.delete(key),
    substituteParamsExtended: (text, defaults = {}) => text.replace(/<USER>|\{\{(user|persona)\}\}/gi, (_, key = 'user') =>
      overrides.get(key)?.() ?? defaults[key] ?? 'Single player'),
  };
  const adapter = createAdapter({SillyTavern: {getContext: () => context}}, {generate});
  return {adapter, context, overrides, events};
}

test('旧引擎保留其他脚本注册的宏', async () => {
  const {adapter, overrides, events} = legacyAdapter(() => assert.fail('Conflicting generation must not run'));
  const existing = () => 'Another tool';
  overrides.set('persona', existing);
  await assert.rejects(() => adapter.generate(state), /其他脚本接管/);
  assert.deepEqual([...overrides], [['persona', existing]]);
  assert.equal(events.listenerCount('final'), 0);
});

test('旧引擎在取消或自己的请求组装完成时立即清理', async () => {
  let finish, generateConfig;
  const {adapter, events, overrides} = legacyAdapter(config => {
    generateConfig = config;
    return new Promise(resolve => {finish = resolve;});
  });
  const pending = adapter.generate(state);
  const unrelated = {messages: [{role: 'system', content: '{{ user }}'}]};
  events.emit('final', unrelated);
  assert.equal(unrelated.messages[0].content, '{{ user }}');
  assert.equal(overrides.size, 2);
  const own = {messages: [{role: 'user', content: generateConfig.user_input}]};
  events.emit('final', own);
  assert.match(own.messages[0].content, /\{\{setvar::attack::1\}\}和<user>/);
  assert.doesNotMatch(own.messages[0].content, /REQUESTX/);
  assert.equal(overrides.size, 0);
  finish('ok');
  await pending;

  const cancelled = adapter.generate(state);
  assert.equal(overrides.size, 2);
  adapter.cancel();
  assert.equal(overrides.size, 0);
  assert.equal(events.listenerCount('final'), 0);
  finish('stopped');
  await cancelled;
});
