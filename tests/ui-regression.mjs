import {chromium, webkit} from 'playwright';
const engine = process.env.MIEMIE_UI_BROWSER === 'webkit' ? webkit : chromium;
const edge=process.env.MIEMIE_UI_BROWSER==='edge';
const browserLabel=edge?'edge':engine.name();
const port=Number(process.env.MIEMIE_UI_PORT||18798);
const version = JSON.parse(await readFile('package.json')).version;
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const heroFilter=page=>page.locator('[data-multiplayer-lobby-header-hero]').evaluate(node=>getComputedStyle(node).filter);
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/lobby.js'?'application/javascript':'text/html');res.end(req.url==='/lobby.js'?await readFile('dist/lobby.js'):'<!doctype html><meta charset="utf-8"><body style="background:radial-gradient(ellipse at top,#30344c,#111522);min-height:100vh"><script>window.SillyTavern={getContext:()=>({name1:"星野",powerUserSettings:{persona_description:"旅途中的年轻记录者。",personas:{"a.png":"星野","b.png":"白夜"},persona_descriptions:{"a.png":{description:"旅途中的年轻记录者。"},"b.png":{description:"旅伴"}}}})}</script>');});
await new Promise(r=>server.listen(port,'127.0.0.1',r));let browser;
try{
 browser=await engine.launch(edge?{channel:'msedge'}:{});const page=await browser.newPage({viewport:{width:1100,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port);
 await page.evaluate(()=>{
  const el=document.createElement('div');el.className='mm-message';el.id='other-tool';el.textContent='Other tool';document.body.append(el);
  const context=SillyTavern.getContext(), events=new Map();
  const eventTypes={CHAT_CHANGED:'chat',CHARACTER_EDITED:'edit',CHARACTER_RENAMED:'rename',
   PERSONA_CREATED:'new-persona',PERSONA_UPDATED:'updated-persona',PERSONA_CHANGED:'active-persona',PERSONA_DELETED:'deleted-persona'};
  Object.assign(context,{characters:[{name:'沙盒角色'},{name:'第二位角色'}],eventTypes,eventSource:{
   on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
   removeListener(name,fn){events.get(name)?.delete(fn);}
  }});
  SillyTavern.getContext=()=>context;
  window.headerFixture={context,emit(key){for(const fn of events.get(eventTypes[key])??[])fn('test event payload');},
   count:()=>[...events.values()].reduce((sum,group)=>sum+group.size,0)};
 });
 await page.addScriptTag({url:'/lobby.js'});const panel=page.locator('.mm-main');const orb=page.locator('[data-lobby-main]');await orb.waitFor();assert.equal(await panel.isHidden(),true);await page.addScriptTag({url:'/lobby.js'});assert.equal(await panel.count(),1);assert.equal(await panel.isHidden(),true);await orb.click();await panel.locator('[data-act="settings"]').waitFor();await page.locator('.mm-main[data-surface-state="open"]').waitFor();
 assert.equal(await panel.locator('header h2').innerText(),'咩咩联机大厅 '+version);
 const subtitle=panel.locator('.mm-subtitle');
 assert.equal(await subtitle.innerText(),'请打开单人角色聊天');
 await page.evaluate(()=>{headerFixture.context.characterId=0;headerFixture.emit('CHAT_CHANGED');});
 assert.equal(await subtitle.innerText(),'当前角色：沙盒角色');
 await page.evaluate(()=>{headerFixture.context.characterId='1';headerFixture.emit('CHAT_CHANGED');});
 assert.equal(await subtitle.innerText(),'当前角色：第二位角色');
 await page.evaluate(()=>{headerFixture.context.characters[1].name='<b>角色改名</b>';headerFixture.emit('CHARACTER_RENAMED');});
 assert.equal(await subtitle.textContent(),'当前角色：<b>角色改名</b>');
 assert.equal(await subtitle.locator('b').count(),0);
 await page.evaluate(()=>{headerFixture.context.groupId='group-fixture';headerFixture.emit('CHAT_CHANGED');});
 assert.equal(await subtitle.innerText(),'请打开单人角色聊天');
 await page.evaluate(()=>{delete headerFixture.context.groupId;headerFixture.context.characterId=0;headerFixture.emit('CHARACTER_EDITED');});
 assert.equal(await subtitle.innerText(),'当前角色：沙盒角色');
 assert.equal(await page.evaluate(()=>headerFixture.count()),7);
 await panel.locator('header').screenshot({path:`test-results/header-${version}-${browserLabel}.png`});
 assert.equal(await page.locator('#other-tool').evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');assert.equal(await panel.locator('header [data-act="close"]').count(),0);assert.equal(await panel.locator('footer [data-act="close"]').innerText(),'返回');assert.equal(await panel.locator('footer [data-setting]').count(),0);
 assert.equal(await panel.locator('img[data-tool-icon]').evaluate(e=>e.complete&&e.naturalWidth===1254),true);assert.equal(await page.locator('[data-lobby-main] img').evaluate(e=>e.complete&&e.naturalWidth===1254),true);
 const settings=page.locator('[data-act="settings"]'),sb=await settings.boundingBox(),hb=await panel.locator('header').boundingBox();assert.ok(sb.x>hb.x+hb.width/2&&sb.y<hb.y+hb.height);
 const picker=panel.locator('.mm-persona-picker');
 await page.evaluate(()=>{
  const settings=headerFixture.context.powerUserSettings;
  settings.personas['a.png']='星野改名';
  settings.persona_descriptions['a.png'].description='新身份描述';
  headerFixture.context.name1='星野改名';
  settings.persona_description='新身份描述';
  headerFixture.emit('PERSONA_UPDATED');
  settings.personas['c.png']='静默新增';
 });
 assert.match(await picker.locator('summary').innerText(),/星野改名/);
 await picker.locator('summary').click();
 await picker.getByRole('button',{name:'静默新增'}).waitFor();
 await page.evaluate(()=>{
  headerFixture.context.name1='静默新增';
  delete headerFixture.context.powerUserSettings.personas['b.png'];
  headerFixture.context.powerUserSettings.personas['b2.png']='白夜';
  headerFixture.emit('PERSONA_CHANGED');
 });
 assert.match(await picker.locator('summary').innerText(),/静默新增/);
 await picker.locator('summary').click();
 await picker.locator('summary').focus();await page.keyboard.press('Enter');
 const choice=picker.getByRole('button',{name:'白夜'});await choice.focus();await page.keyboard.press('Escape');
 assert.equal(await picker.evaluate(e=>e.open),false);assert.equal(await panel.isVisible(),true);
 await page.keyboard.press('Enter');await choice.focus();await page.keyboard.press('Enter');
 assert.match(await picker.locator('summary').innerText(),/白夜/);
 assert.equal(await picker.locator('summary').evaluate(e=>e===document.activeElement),true);
 await page.locator('[data-act="entry:create"]').click();assert.equal(await page.locator('[data-act="entry:create"]').evaluate(e=>e===document.activeElement),true);await page.locator('[data-field="title"]').fill('未发送的房间草稿');
 assert.equal(await panel.locator('[data-act="host"]').isDisabled(),true);
 await page.evaluate(()=>{headerFixture.context.getCurrentChatId=()=> 'fixture-chat';headerFixture.emit('CHAT_CHANGED');});
 assert.equal(await panel.locator('[data-act="host"]').isEnabled(),true);
 await page.locator('.mm-scroll').evaluate(e=>e.scrollTop=350);const scroll=await page.locator('.mm-scroll').evaluate(e=>e.scrollTop);
 await settings.click();assert.equal(await page.locator('.mm-frame').evaluate(e=>e.inert),true);await page.locator('[data-setting="size"]').fill('125');await page.locator('[data-setting="tucked"]').click();assert.equal(await page.locator('[data-size-value]').innerText(),'125%');assert.equal(await page.locator('[data-setting="tucked"]').getAttribute('aria-checked'),'true');
 await page.waitForTimeout(250);await panel.screenshot({path:`test-results/settings-${version}.png`});
 await page.locator('[data-settings-back]').click();assert.equal(await settings.evaluate(e=>e===document.activeElement),true);assert.equal(await page.locator('[data-field="title"]').inputValue(),'未发送的房间草稿');assert.equal(await page.locator('.mm-scroll').evaluate(e=>e.scrollTop),scroll);
 await settings.click();await page.keyboard.press('Escape');assert.equal(await page.locator('.mm-settings-layer').isHidden(),true);assert.equal(await panel.isVisible(),true);
 await settings.click();await page.locator('[data-setting="size"]').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[data-settings-back]').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.locator('[data-setting="size"]').evaluate(e=>e===document.activeElement),true);await page.locator('[data-settings-back]').click();
 await settings.hover();await page.waitForTimeout(220);assert.equal(await settings.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');assert.match(await settings.evaluate(e=>getComputedStyle(e).backgroundColor),/^rgba\(197, 166, 107, 0\.12[0-9]*\)$/);await settings.screenshot({path:`test-results/settings-hover-${version}.png`});
 await settings.click();await page.locator('[data-act="preview-opening"]').click();
 const ceremony=page.locator('.mm-opening');await ceremony.waitFor({state:'visible'});
 assert.equal(await ceremony.evaluate(e=>e.matches(':modal')),true);
 await orb.evaluate(e=>e.focus());assert.equal(await ceremony.locator('button').evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.equal(await ceremony.locator('button').evaluate(e=>e===document.activeElement),true);

 await page.waitForTimeout(5500);assert.equal(await ceremony.isVisible(),true);
 await page.setViewportSize({width:640,height:320});
 const confirm=await ceremony.locator('button').boundingBox();
 assert.ok(confirm.y>=0&&confirm.y+confirm.height<=320);
 await page.setViewportSize({width:1100,height:950});
 assert.equal(await ceremony.locator('.mm-opening-spark').count(),16);
 assert.equal(await ceremony.locator('.mm-opening-ring i').first().evaluate(e=>getComputedStyle(e).animationIterationCount),'infinite');
 await page.keyboard.press('Escape');assert.equal(await ceremony.isVisible(),true);
 await ceremony.screenshot({path:`test-results/ceremony-${version}.png`});
 await ceremony.locator('button').click();assert.equal(await ceremony.count(),0);assert.equal(await page.locator('[data-act="preview-opening"]').evaluate(e=>e===document.activeElement),true);
 await page.locator('[data-settings-back]').click();
 await page.locator('.mm-scroll').evaluate(e=>e.scrollTop=0);await panel.screenshot({path:`test-results/lobby-${version}.png`});
 await page.locator('footer [data-act="close"]').click();await panel.waitFor({state:'hidden'});await page.evaluate(()=>{void window.__miemieMultiplayerLobbyV1.open()});await panel.waitFor({state:'visible'});const veil=page.locator('[data-multiplayer-lobby-surface-veil]');await veil.waitFor({state:'attached'});
 assert.match(await veil.evaluate(e=>getComputedStyle(e).backgroundColor), /^rgba\(5, 33, 58, 0\.72[0-9]*\)$/);
 const blurSource=page.locator('.mm-frame');
 assert.equal(await blurSource.evaluate(e=>getComputedStyle(e).filter),'blur(14px)');
 assert.equal(await heroFilter(page),'none');
 // Capture the centered icon before the veil fades, in the same phase on both engines.
 await page.evaluate(()=>{for(const animation of document.querySelector('.mm-main').getAnimations()) animation.finish();});
 const hero=panel.locator('[data-multiplayer-lobby-header-hero]');
 await page.waitForFunction(()=>document.querySelector('[data-multiplayer-lobby-header-hero]')?.getAnimations().length);
 await hero.evaluate(e=>{for(const animation of e.closest('.mm-main').getAnimations({subtree:true})){animation.pause();animation.currentTime=0;}});
 await panel.screenshot({path:`test-results/splash-${version}-${browserLabel}.png`,animations:'allow'});
 await hero.evaluate(e=>{for(const animation of e.closest('.mm-main').getAnimations({subtree:true})) animation.play();});
 await veil.waitFor({state:'detached'});assert.equal(await page.locator('[data-field="title"]').inputValue(),'未发送的房间草稿');
 await page.addScriptTag({url:'/lobby.js'});assert.equal(await panel.count(),1);
 await page.setViewportSize({width:390,height:844});await settings.click();await panel.screenshot({path:`test-results/settings-mobile-${version}.png`});const bounds=await page.locator('.mm-settings-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844);
 await page.setViewportSize({width:320,height:700});
 await page.locator('[data-settings-back]').click();
 const mobileHeader=await panel.locator('header').evaluate(header=>{
  const name=header.querySelector('h2'), text=header.querySelector('.mm-subtitle');
  return {headingFits:name.scrollWidth<=name.clientWidth, subtitleFits:text.scrollWidth<=text.clientWidth,
   clipped:header.scrollWidth>header.clientWidth};
 });
 assert.deepEqual(mobileHeader,{headingFits:true,subtitleFits:true,clipped:false});
 await page.evaluate(()=>window.__miemieMultiplayerLobbyV1.dispose());
 assert.equal(await page.evaluate(()=>headerFixture.count()),0);
 await page.reload();await page.addScriptTag({url:'/lobby.js'});await orb.waitFor();assert.equal(await panel.isHidden(),true);
 await page.evaluate(()=>window.__miemieMultiplayerLobbyV1.dispose());assert.equal(await panel.count(),0);assert.equal(await page.locator('[data-miemie-multiplayer-lobby-native]').count(),0);assert.deepEqual(errors,[]);console.log('PASS shared title / Tavern character changes / top-right settings / bottom return / modal focus / draft and scroll preservation / Escape / reopen / single instance / closed on refresh / mobile / cleanup');
}finally{await browser?.close();server.close();}
