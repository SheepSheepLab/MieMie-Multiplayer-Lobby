import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {PeerServer} from 'peer';

const hostOrigin = process.env.MIEMIE_HOST_TAVERN ?? 'http://127.0.0.1:18831';
const guestOrigin = process.env.MIEMIE_GUEST_TAVERN ?? 'http://127.0.0.1:18832';
const newEngine = process.env.MIEMIE_MACRO_ENGINE !== 'legacy';
assert.notEqual(hostOrigin, guestOrigin, 'Use two disposable Tavern installations');
const metadata = JSON.parse(await readFile('dist/MieMie-Extension-update.json'));
const script = JSON.parse(await readFile('dist/' + metadata.asset.name));
const fixtureCard = 'Room Resume Test Card ' + Date.now();
const fixturePreset = fixtureCard + ' Preset';
const fixtureBooks = ['Lore','Side Lore','Chat Lore'].map(name=>fixtureCard+' '+name);
const sideCard = fixtureCard + ' (other card)';
const cardSecret = 'PRIVATE_CARD_CONTEXT_TEST_ONLY';
const fixturePassword = 'test-room-password';
let signalServer;
let browser;

try {
  await new Promise(resolve => PeerServer({host: '127.0.0.1', port: 0, path: '/'}, server => {
    signalServer = server;
    resolve();
  }));
  const network = {host: '127.0.0.1', port: signalServer.address().port, path: '/', secure: false, config: {iceServers: []}};
  browser = await chromium.launch(process.env.MIEMIE_LOBBY_BROWSER === 'edge' ? {channel:'msedge'} : {});
  const errors = [], modelRequests = [];
  let guestAvatarWrites = 0;
  async function client(origin, isHost) {
    const page = await browser.newPage({viewport: {width: 1100, height: 950}, reducedMotion: 'reduce'});
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    if (process.env.MIEMIE_NO_POPOVER === '1') {
      await page.addInitScript(() => {
        const matches = Element.prototype.matches;
        Element.prototype.matches = function (selector) {
          if (selector.includes(':popover-open')) throw new DOMException('Unsupported selector', 'SyntaxError');
          return matches.call(this, selector);
        };
        delete HTMLElement.prototype.showPopover;
        delete HTMLElement.prototype.hidePopover;
      });
    }
    const onboardingSelector = 'dialog[open]:has(.onboarding) .popup-button-ok';
    const onboarding = page.locator(onboardingSelector);
    const dismissOnboarding = () => page.evaluate(selector => document.querySelector(selector)?.click(), onboardingSelector);
    await page.addLocatorHandler(onboarding, dismissOnboarding);
    const nativeNotice = page.locator('dialog[open].popup:not(:has(.onboarding)):has(.popup-button-ok)').last();
    await page.addLocatorHandler(nativeNotice, () => page.evaluate(() => {
      const dialogs=[...document.querySelectorAll('dialog[open].popup:not(:has(.onboarding))')];
      dialogs.at(-1)?.querySelector('.popup-button-ok')?.click();
    }), {noWaitAfter:true});
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if(!isHost&&url.pathname==='/api/characters/edit-avatar')guestAvatarWrites++;
      if (url.origin === origin && url.pathname === '/api/backends/chat-completions/generate') {
        assert.ok(isHost, 'Guest must never call the model');
        modelRequests.push(route.request().postDataJSON());
        return route.fulfill({json: {choices: [{message: {role: 'assistant', content:
          '共同剧情测试。<user0><status>房主专属</status></user0><user1><status>来宾专属</status></user1>'}, finish_reason: 'stop'}]}});
      }
      if (url.pathname.endsWith('/log.js') && url.hostname.endsWith('jsdelivr.net')) return route.fulfill({body: ''});
      if (url.origin === origin || url.origin === 'http://127.0.0.1:' + network.port || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
      return route.abort();
    });
    await page.goto(origin);
    async function ready() {
      await page.waitForFunction(() => window.SillyTavern && window.TavernHelper, null, {timeout: 60000});
      await dismissOnboarding();
      await page.waitForFunction(() => !!SillyTavern.getContext().powerUserSettings?.personas);
    }
    await ready();
    await page.evaluate(async ({isHost, fixtureCard, fixturePreset, fixtureBooks, sideCard, cardSecret, newEngine}) => {
      const st = await import('/script.js');
      const c = SillyTavern.getContext();
      const name = isHost ? '房主测试身份' : '来宾测试身份';
      const personaId = 'miemie-test-persona.png';
      const profile = '联机测试人员';
      Object.assign(c.powerUserSettings, {persona_description: profile, experimental_macro_engine: newEngine});
      c.powerUserSettings.personas[personaId] = name;
      c.powerUserSettings.persona_descriptions[personaId] = {description: profile};
      if (!isHost) return;
      const createCard = async card => {
        const result = await fetch('/api/characters/create', {method: 'POST', headers: {'X-CSRF-Token': c.getRequestHeaders()['X-CSRF-Token']}, body: card});
        if (!result.ok) throw Error('Failed to create the test card');
        await st.getCharacters();
      };
      if (!c.characters.some(card => card.name === sideCard)) {
        const card = new FormData();
        card.set('ch_name', sideCard);
        card.set('first_mes', '另一张角色卡的开场');
        await createCard(card);
      }
      if (!c.characters.some(card => card.name === fixtureCard)) {
        const card = new FormData();
        card.set('ch_name', fixtureCard);
        card.set('first_mes', '开场正文');
        card.set('description', cardSecret);
        card.set('creator_notes', '地图资源分片测试。'.repeat(7000));
        await createCard(card);
      }
      const index = SillyTavern.getContext().characters.findIndex(card => card.name === fixtureCard);
      await st.selectCharacterById(index);
      document.querySelector('#main_api').value = 'openai';
      document.querySelector('#main_api').dispatchEvent(new Event('change', {bubbles: true}));
      st.setOnlineStatus('Valid');
      const oai = await import('/scripts/openai.js');
      Object.assign(oai.oai_settings, {chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:18795/v1', custom_model: 'fixture', stream_openai: false});
      const books=fixtureBooks;
      for(const [index,book] of books.entries()){
        if(!TavernHelper.getWorldbookNames().includes(book))await TavernHelper.createWorldbook(book,[]);
        await TavernHelper.replaceWorldbook(book,[]);
        await TavernHelper.createWorldbookEntries(book,[{
          name:'地图秘密',enabled:true,strategy:{type:'constant',keys:[]},content:'LOBBY_IMPORTED_WORLD_ENTRY_'+index,
        }]);
        await c.saveWorldInfo(book,await c.loadWorldInfo(book),true);
      }
      await TavernHelper.rebindCharWorldbooks('current',{primary:books[0],additional:[books[1]]});
      await TavernHelper.rebindChatWorldbook('current',books[2]);
      const scripts=TavernHelper.getScriptTrees({type:'character'});
      if(!scripts.some(script=>script.name==='同步测试脚本')){
        TavernHelper.replaceScriptTrees([...scripts,{name:'同步测试脚本',type:'script',enabled:true,
          content:'window.parent.__miemieFixtureCardScript=true;'}],{type:'character'});
      }
      await TavernHelper.replaceTavernRegexes([{
        id:crypto.randomUUID(),script_name:'同步测试正则',enabled:true,find_regex:'FIXTURE_NEVER_MATCH',
        replace_string:'REPLACED',trim_strings:[],source:{ai_output:true},destination:{display:true,prompt:false},
        run_on_edit:false,min_depth:null,max_depth:null,
      }],{type:'character'});
      const preset=TavernHelper.getPreset('in_use');
      preset.extensions.regex_scripts=[{
        id:crypto.randomUUID(),script_name:'预设状态栏正则',enabled:true,find_regex:'FIXTURE_PRESET_NEVER_MATCH',
        replace_string:'REPLACED',trim_strings:[],source:{ai_output:true},destination:{display:true,prompt:false},
        run_on_edit:false,min_depth:null,max_depth:null,
      }];
      await TavernHelper.createPreset(fixturePreset,preset);
      TavernHelper.loadPreset(fixturePreset);
    }, {isHost, fixtureCard, fixturePreset, fixtureBooks, sideCard, cardSecret, newEngine});
    await page.evaluate(artifact => TavernHelper.replaceScriptTrees([artifact], {type: 'global'}), script);
    await page.waitForFunction(() => window.__miemieMultiplayerLobbyV1);
    const main = page.locator('.mm-main');
    async function open() {
      await page.evaluate(() => window.__miemieMultiplayerLobbyV1.open());
      await main.locator('[data-act="settings"]').waitFor({state:'visible'});
    }
    async function reload() {
      await page.reload();
      await ready();
      await page.waitForFunction(() => window.__miemieMultiplayerLobbyV1);
      assert.equal(await main.isHidden(), true);
      await open();
    }
    await open();
    await main.locator('.mm-persona-picker summary').click();
    await main.getByRole('button', {name: isHost ? '房主测试身份' : '来宾测试身份', exact: true}).click();
    await main.locator('[data-detail="network"] summary').click();
    await main.locator('[data-field="network"]').fill(JSON.stringify(network));
    await main.locator('[data-detail="network"] summary').click();
    return {page, main, open, reload, click: action => main.locator('[data-act="' + action + '"]').click()};
  }

  const host = await client(hostOrigin, true);
  const guest = await client(guestOrigin, false);
  assert.equal(await guest.page.evaluate(name => SillyTavern.getContext().characters.some(c => c.name === name), fixtureCard), false);
  const originalChat = await host.page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
  await host.click('entry:create');
  await host.main.locator('[data-field="title"]').fill('夜间列车');
  await host.main.locator('[data-field="password"]').fill(fixturePassword);
  await host.click('mode:hidden');
  await host.main.locator('[data-detail="scene-draft"] summary').click();
  await host.main.locator('[data-field="intro"]').fill('公开简介 <img src="/private-card-test">');
  await host.main.locator('[data-field="rules"]').fill('轮流搜查车厢');
  await host.main.locator('[data-field="opening"]').fill('灯光忽明忽暗');
  await host.click('host');
  const code = await host.main.locator('.mm-invite').inputValue();
  assert.match(code, /^\d{6}$/);
  await host.page.waitForFunction(()=>document.querySelector('#send_textarea').readOnly);
  const linkedChat=host.main.getByRole('region',{name:'联机对话'});
  assert.equal(await linkedChat.locator('strong').textContent(),fixtureCard);
  assert.equal(await linkedChat.locator('small').textContent(),originalChat);
  assert.equal(await linkedChat.getByRole('status').textContent(),'当前已打开');
  assert.equal(await linkedChat.getByRole('button').count(),0);
  async function join() {
    await guest.main.locator('[data-field="invite"]').fill(code);
    await guest.main.locator('[data-field="password"]').fill(fixturePassword);
    await guest.click('join');
    await guest.main.locator('.mm-roomhead, .mm-notice').first().waitFor();
    const notice = guest.main.locator('.mm-notice:visible');
    if (await notice.count()) throw Error(await notice.innerText());
    assert.match(await guest.main.locator('.mm-public-scene').innerText(), /公开简介 <img.*轮流搜查车厢.*灯光忽明忽暗/s);
    assert.equal(await guest.main.locator('.mm-public-scene img').count(), 0);
    assert.ok(!(await guest.main.innerText()).includes(cardSecret));
    const confirmMap=guest.main.locator('[data-act="map-confirm"]');
    await guest.main.getByText(/地图已同步|随包脚本可在你的酒馆中运行/).first().waitFor();
    if(await confirmMap.isVisible()){
      assert.equal(await guest.main.locator('[data-act="ready"]').isDisabled(),true);
      assert.equal(await guest.page.evaluate(()=>!!window.__miemieFixtureCardScript),false);
      assert.match(await guest.main.innerText(),/同步测试脚本|角色正则/);
      await confirmMap.click();
      await guest.page.locator('.TH-popup .popup-button-ok:visible').click();
      await guest.open();
    }
    await guest.main.getByText('地图已同步 · 联机对话已打开').waitFor();
    assert.equal(await guest.main.getByRole('region',{name:'联机对话'}).count(),1);
    await guest.page.waitForFunction(()=>window.__miemieFixtureCardScript);
    assert.deepEqual(await guest.page.evaluate(async ({secret,preset})=>{
      const c=SillyTavern.getContext(),card=c.characters[c.characterId];
      const {primary,additional}=TavernHelper.getCharWorldbookNames('current');
      const books=[primary,...additional,TavernHelper.getChatWorldbookName('current')];
      return {card:card.data.description.includes(secret)&&card.data.creator_notes.length>=56000,
        books:await Promise.all(books.map(async (book,i)=>(await TavernHelper.getWorldbook(book)).some(x=>x.content==='LOBBY_IMPORTED_WORLD_ENTRY_'+i))),
        bookNames:books,preset:TavernHelper.getPreset(preset).extensions.regex_scripts.some(r=>r.script_name==='预设状态栏正则'),
        regex:card.data.extensions.regex_scripts.some(x=>x.scriptName==='同步测试正则')&&TavernHelper.isCharacterTavernRegexesEnabled(),
        locked:document.querySelector('#send_textarea').readOnly};
    },{secret:cardSecret,preset:fixturePreset}),{card:true,books:[true,true,true],
      bookNames:fixtureBooks,preset:true,regex:true,locked:true});
  }
  await join();
  await guest.click('leave');
  await guest.page.locator('[data-confirm-cancel]').click();
  assert.equal(await guest.main.locator('.mm-seat.mine').count(),1);
  await guest.click('leave');
  await guest.page.locator('[data-confirm-accept]').click();
  await host.main.locator('.mm-seat').nth(1).getByText('等待队友').waitFor();
  await join();
  assert.equal(guestAvatarWrites,1);
  await host.page.evaluate(async ({book,preset})=>{
    const c=SillyTavern.getContext(),data=await c.loadWorldInfo(book);
    data.entries[Object.keys(data.entries)[0]].content='LOBBY_LIVE_MAP_UPDATE';
    await c.saveWorldInfo(book,data,true);
    await TavernHelper.updateCharacterWith('current',card=>{
      card.description+=' LOBBY_LIVE_CARD_UPDATE';
      return card;
    });
    const updated=TavernHelper.getPreset('in_use');
    updated.extensions.regex_scripts[0].replace_string='LOBBY_LIVE_PRESET_UPDATE';
    await TavernHelper.createOrReplacePreset(preset,updated);
    TavernHelper.loadPreset(preset);
  },{book:fixtureBooks[2],preset:fixturePreset});
  await guest.click('map-confirm');
  await guest.main.getByText('地图已同步 · 联机对话已打开').waitFor();
  assert.equal(guestAvatarWrites,1);
  assert.deepEqual(await guest.page.evaluate(async ({book,preset})=>{
    const c=SillyTavern.getContext();
    return [(await TavernHelper.getWorldbook(book))[0].content,c.characters[c.characterId].description.includes('LOBBY_LIVE_CARD_UPDATE'),
      TavernHelper.getPreset(preset).extensions.regex_scripts[0].replace_string];
  },{book:fixtureBooks[2],preset:fixturePreset}),['LOBBY_LIVE_MAP_UPDATE',true,'LOBBY_LIVE_PRESET_UPDATE']);
  await guest.click('ready');
  await host.click('start');
  await host.page.getByRole('button', {name:'踏入故事'}).click();
  await guest.page.getByRole('button', {name:'踏入故事'}).click();
  await host.main.waitFor({state:'hidden'});
  const action = player => player.page.locator('.mm-action-window');
  const actionClick = (player, name) => action(player).locator('[data-act="' + name + '"]').click();
  async function openTool(player, kind) {
    await player.page.locator('[data-lobby-tool="' + kind + '"]').click();
    await player.page.locator('.mm-' + kind + '-window[data-surface-state="open"]').waitFor();
  }

  await openTool(host, 'action');
  await action(host).locator('[data-field="action"]').fill('房主先调查座位');
  await actionClick(host, 'action');
  await host.page.evaluate(chat => SillyTavern.getContext().openCharacterChat(chat), 'Unrelated test chat ' + Date.now());
  await host.page.waitForFunction(()=>!document.querySelector('#send_textarea').readOnly);
  assert.notEqual(await host.page.evaluate(() => SillyTavern.getContext().getCurrentChatId()), originalChat);
  async function returnToChat() {
    await linkedChat.getByRole('status').filter({hasText:'已切离'}).waitFor();
    assert.equal(await linkedChat.locator('small').textContent(),originalChat);
    await linkedChat.getByRole('button',{name:'返回联机对话'}).click();
    await host.main.waitFor({state:'hidden'});
    assert.deepEqual(await host.page.evaluate(()=>{
      const c=SillyTavern.getContext();
      return [c.characters[c.characterId].name,c.getCurrentChatId()];
    }),[fixtureCard,originalChat]);
    await host.page.waitForFunction(()=>document.querySelector('#send_textarea').readOnly);
  }
  async function openSideCard() {
    await host.page.evaluate(async name=>{
      const c=SillyTavern.getContext();
      const index=c.characters.findIndex(card=>card.name===name);
      await c.selectCharacterById(index);
      if(String(SillyTavern.getContext().characterId)!==String(index))throw Error('Failed to switch cards');
    },sideCard);
    await host.page.waitForFunction(()=>!document.querySelector('#send_textarea').readOnly);
  }
  await host.open();
  await returnToChat();
  await openSideCard();
  await host.open();
  await returnToChat();
  await openSideCard();
  await openTool(guest, 'action');
  await action(guest).locator('[data-field="action"]').fill('来宾查看车门');
  await actionClick(guest, 'action');
  await action(host).locator('[data-act="generate"]:disabled').waitFor();
  assert.match(await action(host).innerText(), /返回联机房间绑定的酒馆聊天/);
  assert.match(await action(guest).innerText(), /等待房主返回联机聊天/);
  assert.equal(modelRequests.length, 0);

  // Reload both pages while the host has the wrong chat selected.
  await host.reload();
  await host.click('restore');
  assert.equal(await host.main.locator('.mm-invite').inputValue(), code);
  await linkedChat.getByRole('button',{name:'返回联机对话'}).waitFor();
  await guest.reload();
  assert.equal(await guest.main.locator('[data-field="resumePassword"]').inputValue(), '');
  await guest.main.locator('[data-field="resumePassword"]').fill(fixturePassword);
  await guest.click('resume-guest');
  await guest.main.locator('.mm-seat.mine').filter({hasText:'来宾测试身份'}).waitFor();
  await guest.main.getByText('地图已同步 · 联机对话已打开').waitFor();
  assert.match(await guest.main.locator('.mm-public-scene').innerText(), /轮流搜查车厢/);
  assert.equal(await guest.page.evaluate(password => JSON.stringify(sessionStorage).includes(password), fixturePassword), false);
  await host.page.setViewportSize({width:390,height:844});
  assert.equal(await linkedChat.evaluate(card=>card.scrollWidth===card.clientWidth),true);
  await returnToChat();
  await host.page.setViewportSize({width:1100,height:950});
  await host.page.evaluate(async newEngine => {
    const st = await import('/script.js');
    SillyTavern.getContext().powerUserSettings.experimental_macro_engine = newEngine;
    document.querySelector('#main_api').value = 'openai';
    document.querySelector('#main_api').dispatchEvent(new Event('change', {bubbles: true}));
    st.setOnlineStatus('Valid');
    const oai = await import('/scripts/openai.js');
    Object.assign(oai.oai_settings, {chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:18795/v1', custom_model: 'fixture', stream_openai: false});
  }, newEngine);

  await openTool(host, 'action');
  await host.page.evaluate(()=>window.MieMieMultiplayerLobby.registerRoundProcessor({
    id:'test-polisher',name:'润色测试',
    process({raw,kind,defer}){
      if(kind==='reroll')return raw.replace('共同剧情测试。','重 Roll 后的剧情。');
      window.finishFixturePolish=()=>deferred.complete(raw.replace('共同剧情测试。','润色后的剧情。'));
      const deferred=defer();
    },
  }));
  await actionClick(host, 'generate');
  await action(host).getByText('等待脚本处理后同步').waitFor();
  assert.equal(await guest.page.evaluate(()=>SillyTavern.getContext().chat.some(message=>message.extra?.miemie_lobby_result)),false);
  await host.page.evaluate(()=>window.finishFixturePolish());
  await action(host).locator('[data-detail=history] summary').click();
  await action(host).getByText('润色后的剧情。', {exact: true}).waitFor();
  await openTool(guest, 'action');
  await action(guest).locator('[data-detail=history] summary').click();
  const playerStatus = action(guest).locator('.mm-story pre');
  assert.equal(await playerStatus.textContent(), '<status>来宾专属</status>');
  assert.equal(modelRequests.length, 1);
  assert.match(JSON.stringify(modelRequests[0]), new RegExp(cardSecret));
  assert.match(JSON.stringify(modelRequests[0]), /房主先调查座位.*来宾查看车门/s);
  await guest.page.waitForFunction(()=>SillyTavern.getContext().chat.some(message=>message.extra?.miemie_lobby_result));
  await host.page.waitForFunction(()=>SillyTavern.getContext().chat.some(message=>message.extra?.miemie_lobby_result));
  const guestNative=await guest.page.evaluate(()=>SillyTavern.getContext().chat.filter(message=>
    message.extra?.miemie_lobby_result||message.extra?.miemie_lobby_action).map(message=>message.mes));
  assert.match(guestNative.join('\n'),/来宾查看车门.*润色后的剧情。.*来宾专属/s);
  assert.doesNotMatch(guestNative.join('\n'),/房主先调查座位|房主专属/);
  const guestOriginal=await guest.page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
  const reroll=action(host).locator('[data-act^="reroll:"]');
  await reroll.click();
  await host.page.locator('[data-confirm-accept]').click();
  try{await actionClick(guest,'vote:no');}catch(error){
    throw Error((await action(host).innerText())+'\n---\n'+(await action(guest).innerText()),{cause:error});
  }
  assert.equal(modelRequests.length,1);
  await reroll.click();
  await host.page.locator('[data-confirm-accept]').click();
  await actionClick(guest,'vote:yes');
  for(const player of [host,guest])await player.page.waitForFunction(()=>{
    const owned=SillyTavern.getContext().chat.filter(m=>m.extra?.miemie_lobby_result);
    return owned.length===1&&owned[0].extra.miemie_lobby_variant===1&&owned[0].mes.includes('重 Roll 后的剧情');
  });
  assert.equal(modelRequests.length,2);
  assert.doesNotMatch(JSON.stringify(modelRequests[1]),/润色后的剧情/);
  await action(guest).locator('[data-act^="branch:"]').click();
  await guest.page.locator('[data-confirm-accept]').click();
  await actionClick(host,'vote:yes');
  for(const player of [host,guest])await player.page.waitForFunction(()=>{
    const c=SillyTavern.getContext();
    return c.getCurrentChatId().startsWith('咩咩联机分支 ')&&c.chatMetadata.miemie_lobby_branch
      &&c.chat.some(m=>m.extra?.miemie_lobby_variant===1);
  });
  assert.equal(await host.page.evaluate(()=>SillyTavern.getContext().chatMetadata.main_chat),originalChat);
  assert.equal(await guest.page.evaluate(()=>SillyTavern.getContext().chatMetadata.main_chat),guestOriginal);
  await action(host).locator('[data-act=action]:enabled').waitFor();
  assert.equal(modelRequests.length,2);
  await action(guest).locator('[data-tool-back]').click();
  await guest.click('leave');
  await guest.page.locator('[data-confirm-accept]').click();
  await action(host).locator('[data-tool-back]').click();
  await host.open();
  await host.main.locator('.mm-seat').nth(1).getByText('离线 · 角色保留').waitFor();
  assert.equal(await guest.main.locator('[data-act="resume-guest"]').count(), 0);
  await host.click('end');
  await host.page.locator('[data-confirm-accept]').click();
  await host.main.locator('.mm-entry-tabs').waitFor();
  await host.page.waitForFunction(()=>!document.querySelector('#send_textarea').readOnly);
  assert.equal(await host.main.locator('[data-act="restore"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS two SillyTavern instances: map transfer, chat guard, shortcut across chats and cards, refresh and rejoin, preserved actions, host-only generation, private transcript');
} finally {
  await browser?.close();
  signalServer?.close();
}
process.exit(0);
