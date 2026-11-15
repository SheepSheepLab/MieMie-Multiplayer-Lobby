import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {PeerServer} from 'peer';
import {chromium, webkit} from 'playwright';

const hubFile = process.env.MIEMIE_HUB_PACKAGE;
if (!hubFile) throw Error('Set MIEMIE_HUB_PACKAGE to the Hub 1.1.0 script JSON for testing.');
const hubScript = JSON.parse(await readFile(hubFile)).content;
const lobbyScript = await readFile('dist/lobby.js');
const hubId = 'miemie.multiplayer-lobby';
const productName = '咩咩联机大厅';
const engine = process.env.MIEMIE_UI_BROWSER === 'webkit' ? webkit : chromium;
const output = 'test-results/hub-' + engine.name();
await mkdir(output, {recursive: true});
const harness = await build({entryPoints: ['tests/browser-entry.mjs'], bundle: true, write: false});
const server = createServer((req, res) => {
  const script = {'/hub.js': hubScript, '/lobby.js': lobbyScript, '/guest.js': harness.outputFiles[0].contents}[req.url];
  res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html');
  res.end(script || '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body></body>');
});
let signalServer, browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  await new Promise(resolve => PeerServer({host: '127.0.0.1', port: 0, path: '/'}, listener => {
    signalServer = listener;
    resolve();
  }));
  const network = {host: '127.0.0.1', port: signalServer.address().port, path: '/', secure: false, config: {iceServers: []}};
  browser = await engine.launch();
  const errors = [];
  const lobbyVersion = JSON.parse(await readFile('package.json')).version;
  async function setup(width = 1100) {
    const page = await browser.newPage({viewport: {width, height: 920}, reducedMotion: 'reduce'});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(() => {
      const name = '联机试验玩家';
      const hooks = new Set(), events = new Map();
      const context = {
        name1: name, characterId: 0, chat: [], mainApi: 'openai', getCurrentChatId: () => 'hub-runtime-fixture',
        powerUserSettings: {experimental_macro_engine: true, persona_description: '自动化测试用身份', personas: {'host.png': name}, persona_descriptions: {'host.png': {description: '自动化测试用身份'}}},
        eventTypes: {CHAT_COMPLETION_SETTINGS_READY: 'prompt', WORLDINFO_ENTRIES_LOADED: 'lore'},
        eventSource: {on: (key, callback) => events.set(key, callback), removeListener: (key, callback) => {
          if (events.get(key) === callback) events.delete(key);
        }},
        macros: {engine: {addPreProcessor: hook => hooks.add(hook), removePreProcessor: hook => hooks.delete(hook)}},
      };
      window.testHooks = () => [hooks.size, events.size];
      window.SillyTavern = {getContext: () => context};
      window.TavernHelper = {
        generate: () => new Promise(resolve => {window.finishGeneration = resolve;}),
        stopGenerationById: () => {window.stopCalled = true;},
      };
    });
    return page;
  }
  async function loadScript(page, name) {
    const handle = await page.evaluateHandle(name => {
      const iframe = document.createElement('iframe');
      iframe.dataset.fixture = name;
      iframe.hidden = true;
      document.body.append(iframe);
      return iframe;
    }, name);
    const frame = await handle.asElement().contentFrame();
    await frame.addScriptTag({url: base + '/' + name + '.js'});
    return frame;
  }
  async function unloadScript(frame) {
    await frame.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  }
  async function openFromHub(page) {
    await page.evaluate(() => window.__MieMieHub.open());
    await page.locator('[data-hub-app="' + hubId + '"]').click();
    const surface = page.locator('.mm-main[data-surface-state="open"][data-presentation="hub"]');
    await surface.waitFor();
    assert.equal(await surface.locator('header h2').innerText(), productName + ' ' + lobbyVersion);
  }
  async function waitForRuntime(page) {
    await page.waitForFunction(id => window.__MieMieHub?.extensions.get(id)?.launcherAvailable, hubId);
    assert.equal(await page.evaluate(id => window.__MieMieHub.extensions.get(id).manifest.name, hubId), productName);
    assert.equal(await page.locator('.mm-main').count(), 1);
    assert.equal(await page.locator('[data-lobby-main]').count(), 0);
  }

  const host = await setup();
  let lobby = await loadScript(host, 'lobby');
  const native = host.locator('[data-lobby-main]');
  const panel = host.locator('.mm-main');
  await native.click();
  await panel.locator('[data-act="entry:create"]').click();
  await panel.locator('[data-field="title"]').fill('Hub 切换保留的房间');
  await panel.locator('[data-detail="network"] summary').click();
  await panel.locator('[data-field="network"]').fill(JSON.stringify(network));
  await panel.locator('[data-act="host"]').click();
  await panel.locator('.mm-invite, .mm-notice').first().waitFor({timeout: 10000});
  if (await panel.locator('.mm-notice').count()) throw Error(await panel.locator('.mm-notice').textContent());
  const code = await panel.locator('.mm-invite').inputValue();
  const mainPanel = await panel.elementHandle();

  await host.evaluate(id => localStorage.setItem('miemie_hub_shortcuts_v1', JSON.stringify({[id]: true})), hubId);
  let hub = await loadScript(host, 'hub');
  await host.waitForFunction(id => window.__MieMieHub?.extensions.get(id)?.nativeWindowAvailable, hubId);
  assert.equal(await host.locator('[data-lobby-main][data-miemie-multiplayer-lobby-mode="standalone"]').count(), 0);
  assert.equal(await native.count(), 1);
  assert.equal(await panel.evaluate((node, old) => node === old, mainPanel), true);
  await openFromHub(host);
  assert.equal(await panel.locator('.mm-invite').inputValue(), code);
  assert.equal(await panel.evaluate(node => node.hasAttribute('data-miemie-window-layer')), false);
  assert.equal(await host.locator('[data-lobby-tool]:visible').count(), 0);
  await panel.screenshot({path: output + '/lobby.png'});
  await panel.locator('[data-act="settings"]').click();
  await host.keyboard.press('Escape');
  assert.equal(await panel.locator('.mm-settings-layer').isHidden(), true);
  assert.equal(await panel.isVisible(), true);

  await panel.locator('[data-act="open:chat"]').click();
  await panel.getByRole('region', {name: '队伍聊天室'}).waitFor();
  assert.equal(await panel.locator('header h2').innerText(), productName + ' ' + lobbyVersion);
  await panel.locator('[data-field="chat"]').fill('跨入口保留聊天草稿');
  await host.keyboard.press('Escape');
  await panel.locator('[data-act="open:chat"]').waitFor();
  await host.keyboard.press('Escape');
  await panel.waitFor({state: 'hidden'});
  await host.keyboard.press('Escape');
  await native.waitFor();
  await host.locator('[data-lobby-tool="chat"]').click();
  const chatWindow = host.locator('.mm-chat-window');
  assert.equal(await chatWindow.locator('[data-field="chat"]').inputValue(), '跨入口保留聊天草稿');
  await chatWindow.locator('[data-tool-back]').click();
  await chatWindow.waitFor({state: 'hidden'});
  await native.click();
  await host.locator('.mm-main[data-surface-state="open"][data-presentation="native"]').waitFor();
  assert.equal(await panel.locator('.mm-invite').inputValue(), code);

  const guest = await setup();
  await guest.addScriptTag({url: base + '/guest.js'});
  await guest.evaluate(async ({code, network}) => {
    newController();
    c.config = network;
    await c.join(code, {name: 'Hub 测试队友', description: '测试用身份'}, 1);
  }, {code, network});
  await guest.waitForFunction(() => c.view?.players[1]);
  await guest.evaluate(() => c.send('ready', {ready: true}));
  await openFromHub(host);
  await panel.locator('[data-act="start"]:enabled').click();
  await host.getByRole('button', {name: '踏入故事'}).click();
  await panel.locator('[data-field="action"]').fill('在 Hub 内提交房主行动');
  await panel.locator('[data-act="action"]').click();
  await guest.waitForFunction(() => c.view?.phase === 'actions');
  await guest.evaluate(() => c.send('action', {content: '协助调查'}));
  await panel.locator('[data-act="generate"]').click();
  assert.deepEqual(await host.evaluate(() => testHooks()), [1, 2]);
  await panel.screenshot({path: output + '/action.png'});

  // A Hub-only reload preserves the same connection and active generation.
  await unloadScript(hub);
  await native.waitFor();
  await host.locator('[data-lobby-main][data-miemie-multiplayer-lobby-mode="standalone"]').waitFor();
  assert.deepEqual(await host.evaluate(() => testHooks()), [1, 2]);
  hub = await loadScript(host, 'hub');
  await host.waitForFunction(id => window.__MieMieHub?.extensions.get(id)?.launcherAvailable, hubId);
  await openFromHub(host);
  assert.equal(await panel.locator('.mm-invite').inputValue(), code);

  // Explicit disable tears down the room, auxiliary orbs, and in-flight hooks.
  assert.equal((await host.evaluate(id => window.__MieMieHub.extensions.disable(id), hubId)).ok, true);
  assert.equal(await host.locator('[data-lobby-main], [data-lobby-tool]').count(), 0);
  assert.equal(await panel.isHidden(), true);
  assert.deepEqual(await host.evaluate(() => testHooks()), [0, 0]);
  assert.equal(await host.evaluate(() => window.stopCalled), true);
  await host.evaluate(() => window.finishGeneration('late response'));
  await unloadScript(hub);
  await host.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await native.count(), 0);
  hub = await loadScript(host, 'hub');
  await host.waitForFunction(id => window.__MieMieHub?.extensions.get(id)?.state === 'disabled', hubId);
  assert.equal((await host.evaluate(id => window.__MieMieHub.extensions.enable(id), hubId)).ok, true);
  await openFromHub(host);
  await panel.locator('[data-act="host"]').waitFor();
  await unloadScript(lobby);
  // Helper may begin loading the replacement before the prior registration has released.
  lobby = await loadScript(host, 'lobby');
  await host.waitForFunction(id => window.__MieMieHub?.extensions.get(id)?.launcherAvailable, hubId);
  await openFromHub(host);
  await unloadScript(lobby);
  await host.waitForFunction(id => !window.__MieMieHub.extensions.get(id) && !window.__miemieMultiplayerLobbyV1, hubId);
  assert.equal(await panel.count(), 0);
  await unloadScript(hub);

  const hubFirst = await setup(390);
  await loadScript(hubFirst, 'hub');
  await loadScript(hubFirst, 'lobby');
  await waitForRuntime(hubFirst);
  await openFromHub(hubFirst);
  const bounds = await hubFirst.locator('.mm-main').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  assert.deepEqual(errors, []);
  console.log('PASS ' + engine.name() + ' Hub Runtime: both load orders, honeycomb + optional native, one panel, drafts, real WebRTC room, in-panel action, Hub reload, disable and source cleanup');
} finally {
  await browser?.close();
  server.close();
  signalServer?.close();
}
process.exit(0);
