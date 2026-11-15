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
const fixtureCard = 'Room Resume Test Card';
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
  browser = await chromium.launch();
  const errors = [], modelRequests = [];
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
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
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
    await page.evaluate(async ({isHost, fixtureCard, cardSecret, newEngine}) => {
      const st = await import('/script.js');
      const c = SillyTavern.getContext();
      const name = isHost ? '房主测试身份' : '来宾测试身份';
      const personaId = 'miemie-test-persona.png';
      const profile = '联机测试人员';
      Object.assign(c.powerUserSettings, {persona_description: profile, experimental_macro_engine: newEngine});
      c.powerUserSettings.personas[personaId] = name;
      c.powerUserSettings.persona_descriptions[personaId] = {description: profile};
      if (!isHost) return;
      if (!c.characters.some(card => card.name === fixtureCard)) {
        const card = new FormData();
        card.set('ch_name', fixtureCard);
        card.set('first_mes', '开场正文');
        card.set('description', cardSecret);
        const result = await fetch('/api/characters/create', {method: 'POST', headers: {'X-CSRF-Token': c.getRequestHeaders()['X-CSRF-Token']}, body: card});
        if (!result.ok) throw Error('Failed to create the test card');
        await st.getCharacters();
      }
      const index = SillyTavern.getContext().characters.findIndex(card => card.name === fixtureCard);
      await st.selectCharacterById(index);
      document.querySelector('#main_api').value = 'openai';
      document.querySelector('#main_api').dispatchEvent(new Event('change', {bubbles: true}));
      st.setOnlineStatus('Valid');
      const oai = await import('/scripts/openai.js');
      Object.assign(oai.oai_settings, {chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:18795/v1', custom_model: 'fixture', stream_openai: false});
    }, {isHost, fixtureCard, cardSecret, newEngine});
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
  }
  await join();
  await guest.click('leave');
  await host.main.locator('.mm-seat').nth(1).getByText('等待队友').waitFor();
  await join();
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
  assert.notEqual(await host.page.evaluate(() => SillyTavern.getContext().getCurrentChatId()), originalChat);
  await openTool(guest, 'action');
  await action(guest).locator('[data-field="action"]').fill('来宾查看车门');
  await actionClick(guest, 'action');
  await action(host).locator('[data-act="generate"]:disabled').waitFor();
  assert.match(await action(host).innerText(), /返回开局时绑定的酒馆聊天/);
  assert.match(await action(guest).innerText(), /等待房主返回联机聊天/);
  assert.equal(modelRequests.length, 0);

  // Reload both pages while the host has the wrong chat selected.
  await host.reload();
  await host.click('restore');
  assert.equal(await host.main.locator('.mm-invite').inputValue(), code);
  assert.match(await host.main.innerText(), /返回开局时绑定的酒馆聊天/);
  await guest.reload();
  assert.equal(await guest.main.locator('[data-field="resumePassword"]').inputValue(), '');
  await guest.main.locator('[data-field="resumePassword"]').fill(fixturePassword);
  await guest.click('resume-guest');
  await guest.main.locator('.mm-seat.mine').filter({hasText:'来宾测试身份'}).waitFor();
  assert.match(await guest.main.locator('.mm-public-scene').innerText(), /轮流搜查车厢/);
  assert.equal(await guest.page.evaluate(password => JSON.stringify(sessionStorage).includes(password), fixturePassword), false);
  await host.page.evaluate(async ({chat, fixtureCard, newEngine}) => {
    const st = await import('/script.js');
    const index = SillyTavern.getContext().characters.findIndex(card => card.name === fixtureCard);
    await st.selectCharacterById(index);
    await SillyTavern.getContext().openCharacterChat(chat);
    SillyTavern.getContext().powerUserSettings.experimental_macro_engine = newEngine;
    document.querySelector('#main_api').value = 'openai';
    document.querySelector('#main_api').dispatchEvent(new Event('change', {bubbles: true}));
    st.setOnlineStatus('Valid');
    const oai = await import('/scripts/openai.js');
    Object.assign(oai.oai_settings, {chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:18795/v1', custom_model: 'fixture', stream_openai: false});
  }, {chat: originalChat, fixtureCard, newEngine});

  await openTool(host, 'action');
  await actionClick(host, 'generate');
  await action(host).getByText('共同剧情测试。', {exact: true}).waitFor();
  await openTool(guest, 'action');
  const playerStatus = action(guest).locator('.mm-story pre');
  assert.equal(await playerStatus.textContent(), '<status>来宾专属</status>');
  assert.equal(modelRequests.length, 1);
  assert.match(JSON.stringify(modelRequests[0]), new RegExp(cardSecret));
  await action(guest).locator('[data-tool-back]').click();
  await guest.click('leave');
  await host.main.locator('.mm-seat').nth(1).getByText('离线 · 角色保留').waitFor();
  assert.equal(await guest.main.locator('[data-act="resume-guest"]').count(), 0);
  await action(host).locator('[data-tool-back]').click();
  await host.click('end');
  await host.main.locator('.mm-entry-tabs').waitFor();
  assert.equal(await host.main.locator('[data-act="restore"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS two disposable SillyTavern instances: host-only card and model, authenticated scene sync, leave/rejoin, wrong-chat pause, refresh/restore, own status, explicit room end');
} finally {
  await browser?.close();
  signalServer?.close();
}
process.exit(0);
