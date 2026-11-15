import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium, webkit} from 'playwright';
import {splitReply} from '../src/context.mjs';

// Use disposable Tavern data with Tavern Helper 4.11.3 enabled.
const defaults = [14, 15, 16, 17, 18, 19].map(minor =>
  'http://127.0.0.1:' + (18900 + minor) + ',1.' + minor + '.0');
const targets = (process.argv.slice(2).length ? process.argv.slice(2) : defaults)
  .map(arg => arg.split(','));
const browsers = {chromium, webkit};
const browser = await browsers[process.env.MIEMIE_BROWSER || 'chromium'].launch();
const {asset} = JSON.parse(await readFile('dist/MieMie-Extension-update.json', 'utf8'));
const artifact = JSON.parse(await readFile('dist/' + asset.name, 'utf8'));
const harness = await build({
  stdin: {
    contents: "import {createAdapter} from './src/adapter.mjs'; window.lobbyAdapter = createAdapter(window);",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
});

const players = ['Hoshino', 'Rin', 'Byakuya', 'Karasu'].map((name, seat) => ({
  id: String(seat), seat, name, description: 'LOBBY_PERSONA_' + seat,
}));
players[3].description += ' {{setvar::lobby_unsafe::yes}}';
const reply = 'JOINT_STORY\n' + players.map(({seat}) =>
  '<user' + seat + '><status>PRIVATE_STATUS_' + seat + '</status></user' + seat + '>'
).join('\n');
const names = players.map(p => p.name + '（user' + p.seat + '）').join('、');

async function checkTavern([origin, version, selectedEngine]) {
  const page = await browser.newPage({reducedMotion: 'reduce'});
  const newEngine = selectedEngine ? selectedEngine === 'new' : version === '1.19.0';
  const requests = [];
  let rejectModel = false;
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === '/api/backends/chat-completions/generate') {
        requests.push(route.request().postDataJSON());
        if (rejectModel) return route.fulfill({status: 500, json: {error: {message: 'Test provider failure'}}});
        return route.fulfill({json: {choices: [{message: {role: 'assistant', content: reply}, finish_reason: 'stop'}]}});
      }
      if (url.pathname.endsWith('/log.js') && url.hostname.endsWith('jsdelivr.net')) return route.fulfill({body: ''});
      return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    await page.goto(origin);
    await page.waitForFunction(() => window.SillyTavern && window.TavernHelper, null, {timeout: 60000});
    const okay = page.locator('dialog[open] .popup-button-ok').getByText('OK', {exact: true}).first();
    if (await okay.isVisible()) await okay.click();
    await page.waitForFunction(() => !!SillyTavern.getContext().powerUserSettings?.personas);
    const baseline = await page.evaluate(async newEngine => {
      const c = SillyTavern.getContext();
      const st = await import('/script.js');
      const oai = await import('/scripts/openai.js');
      const cardName = 'Multiplayer Compatibility Fixture';
      const cardDescription = 'CARD_USER={{user}}; CARD_LEGACY=<USER>; CARD_PERSONA={{persona}}';
      if (!c.characters.some(card => card.name === cardName)) {
        const form = new FormData();
        form.set('ch_name', cardName);
        form.set('description', cardDescription);
        form.set('first_mes', 'Fixture opening');
        const response = await fetch('/api/characters/create', {
          method: 'POST', headers: {'X-CSRF-Token': c.getRequestHeaders()['X-CSRF-Token']}, body: form,
        });
        if (!response.ok) throw Error('Could not create the fixture card');
        await st.getCharacters();
      }
      await st.selectCharacterById(SillyTavern.getContext().characters.findIndex(card => card.name === cardName));
      document.querySelector('#main_api').value = 'openai';
      document.querySelector('#main_api').dispatchEvent(new Event('change', {bubbles: true}));
      c.powerUserSettings.experimental_macro_engine = newEngine;
      c.powerUserSettings.persona_description = 'HOST_ORIGINAL_PERSONA';
      const preset = c.getPresetManager('openai');
      const name = 'Multiplayer Compatibility Preset';
      const settings = structuredClone(oai.oai_settings);
      settings.prompts = settings.prompts.map(prompt => prompt.identifier === 'main'
        ? {...prompt, content: 'PRESET_USER={{user}}; PRESET_LEGACY=<USER>; PRESET_PERSONA={{ persona }}'}
        : prompt);
      const model = {chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:18795/v1',
        custom_model: 'fixture', stream_openai: false, openai_max_context: 32768, openai_max_tokens: 2000};
      await preset.savePreset(name, {...settings, ...model});
      preset.selectPreset(preset.findPreset(name));
      Object.assign(oai.oai_settings, model);
      st.setOnlineStatus('Valid');
      const book = 'Multiplayer Compatibility Lore';
      const entry = (name, key, secondary, content) => ({
        name, enabled: true, strategy: {type: 'selective', keys: [key],
          keys_secondary: {logic: 'and_all', keys: [secondary]}}, content,
      });
      await TavernHelper.createWorldbook(book, []);
      await TavernHelper.replaceWorldbook(book, []);
      await TavernHelper.createWorldbookEntries(book, [
        entry('Guest hit', '{{user}}', 'GUEST_ACTION', 'WORLD_HIT={{user}}'),
        entry('Guest missing secondary', '<USER>', 'ABSENT_SECONDARY', 'WORLD_FALSE_POSITIVE'),
      ]);
      await TavernHelper.rebindGlobalWorldbooks([book]);
      return c.substituteParamsExtended('{{user}}|<USER>|{{persona}}');
    }, newEngine);
    assert.match(baseline, /HOST_ORIGINAL_PERSONA/);
    await page.evaluate(artifact => TavernHelper.replaceScriptTrees([artifact], {type: 'global'}), artifact);
    await page.waitForFunction(() => window.__miemieMultiplayerLobbyV1);
    await page.evaluate(() => window.__miemieMultiplayerLobbyV1.open());
    await page.getByRole('heading', {name: artifact.name}).waitFor();
    await page.addScriptTag({content: harness.outputFiles[0].text});

    const generate = () => page.evaluate(async players => {
      const snapshot = lobbyAdapter.capture();
      return lobbyAdapter.generate({
        ...snapshot, baseHistory: snapshot.history, results: [], actionVisibility: 'hidden',
        frozen: {players, actions: players.map(({seat, name}) => ({
          seat, name, content: seat === 1 ? 'GUEST_ACTION' : 'ACTION_' + seat +
            (seat === 3 ? ' {{ user }} <USER> {{setvar::lobby_unsafe::yes}}' : ''),
        }))},
      });
    }, players);
    assert.equal(await generate(), reply);
    assert.equal(requests.length, 1);
    const messages = requests[0].messages.map(m => m.content).join('\n');
    for (const source of ['CARD_USER', 'CARD_LEGACY', 'PRESET_USER', 'PRESET_LEGACY', 'WORLD_HIT']) {
      assert.ok(messages.includes(source + '=' + names), source + ' did not expand to the roster:\n' + messages);
    }
    for (const source of ['CARD_PERSONA', 'PRESET_PERSONA']) {
      assert.ok(messages.includes(source + '=<user0>'), source + ' did not expand to a wrapped Persona:\n' + messages);
    }
    for (const player of players) {
      assert.ok(messages.includes('<user' + player.seat + '>\n姓名：' + player.name + '\n' + player.description));
    }
    assert.match(messages, /ACTION_3 \{\{ user \}\} <USER> \{\{setvar::lobby_unsafe::yes\}\}/);
    assert.doesNotMatch(messages, /WORLD_FALSE_POSITIVE|HOST_ORIGINAL_PERSONA|MM[a-f0-9]{32}(?:L\d+|REQUEST)X/);
    assert.deepEqual(splitReply(reply, players).players.map(p => p.status),
      players.map(p => '<status>PRIVATE_STATUS_' + p.seat + '</status>'));

    const readMacros = () => page.evaluate(() => {
      const c = SillyTavern.getContext();
      return [c.substituteParamsExtended('{{user}}|<USER>|{{persona}}'), c.chatMetadata.variables?.lobby_unsafe];
    });
    assert.deepEqual(await readMacros(), [baseline, undefined]);
    rejectModel = true;
    await assert.rejects(generate);
    assert.deepEqual(await readMacros(), [baseline, undefined]);
    console.log('PASS SillyTavern ' + version + ' · ' + (newEngine ? 'new' : 'legacy') +
      ' macros · packaged import, four-player card/preset/lore/Persona and provider failure cleanup');
  } finally {
    await page.close();
  }
}

try {
  const results = await Promise.allSettled(targets.map(checkTavern));
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error(targets[index].join(' '), result.reason);
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
}
