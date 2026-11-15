import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium, webkit} from 'playwright';
import {PeerServer} from 'peer';

const engine = process.env.MIEMIE_UI_BROWSER === 'webkit' ? webkit : chromium;
const bundle = await readFile('dist/lobby.js');
const server = createServer((req, res) => {
  const script = req.url === '/lobby.js';
  res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html');
  res.end(script ? bundle : '<!doctype html><html><meta charset="utf-8"><body></body></html>');
});
let signaling, browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => PeerServer({host:'127.0.0.1', port:0, path:'/'}, listener => {
    signaling = listener;
    resolve();
  }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const network = {host:'127.0.0.1', port:signaling.address().port, path:'/', secure:false, config:{iceServers:[]}};
  const errors = [];
  browser = await engine.launch();
  async function player(name, width=1100) {
    const page = await browser.newPage({viewport:{width,height:900}, reducedMotion:'reduce'});
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(name => {
      const description = 'Test Persona';
      const context = {name1:name, characterId:0, chat:[], getCurrentChatId:()=> 'fixture',
        eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'prompt'},
        macros:{engine:{addPreProcessor(){},removePreProcessor(){}}},
        powerUserSettings:{experimental_macro_engine:true, persona_description:description, personas:{test:name}, persona_descriptions:{test:{description}}}};
      window.SillyTavern = {getContext:()=>context};
      window.TavernHelper = {generate:async()=>''};
    }, name);
    await page.goto(base);
    const main = page.locator('.mm-main');
    async function open() {
      await page.addScriptTag({url:base+'/lobby.js'});
      await page.locator('[data-lobby-main]').click();
      await main.locator('[data-act="settings"]').waitFor();
    }
    await open();
    const field = id => main.locator('[data-field="' + id + '"]');
    const control = id => main.locator('[data-act="' + id + '"]');
    const seat = id => main.locator('[data-seat="' + id + '"]');
    const card = id => seat(id).locator('.mm-avatar');
    await main.locator('[data-detail="network"] summary').click();
    await field('network').fill(JSON.stringify(network));
    await main.locator('[data-detail="network"] summary').click();
    return {page,main,field,control,seat,card,open};
  }
  const host = await player('房主');
  const alice = await player('来宾甲',390);
  const bob = await player('来宾乙');
  assert.equal(await alice.field('seat').count(),0);
  const [invite, password] = await Promise.all([alice.field('invite').boundingBox(),alice.field('password').boundingBox()]);
  assert.equal(invite.y,password.y);
  assert.ok(invite.x+invite.width<=password.x);
  assert.equal(await alice.main.locator('.mm-entry-form > .mm-join-fields').count(),1);
  assert.ok(invite.width>120&&password.width>120);
  await alice.main.screenshot({path:'test-results/seat-join-0.6.1-'+engine.name()+'.png'});

  await host.control('entry:create').click();
  await host.control('host').click();
  const code = await host.main.locator('.mm-invite').inputValue();
  // The avatar is within the hit area of the visible lock/move buttons.
  await host.card(1).click({force:true});
  await host.seat(1).getByText('席位锁定').waitFor();
  assert.equal(await host.seat(1).locator('.mm-avatar').innerText(),'×');
  async function join(guest){
    await guest.field('invite').fill(code);
    await guest.control('join').click();
  }
  await Promise.all([join(alice),join(bob)]);
  await host.seat(3).locator('.mm-seat-status').getByText('◇ 待准备').waitFor();
  const order = await host.main.locator('.mm-seat.occupied strong').allTextContents();
  assert.deepEqual(order.sort(),['房主','来宾乙','来宾甲'].sort());
  assert.equal(await host.seat(0).locator('strong').innerText(),'房主');
  assert.equal(await alice.control('move:1').count(),0);
  assert.equal(await bob.control('move:1').count(),0);

  await host.card(1).click({force:true});
  await alice.control('move:1').waitFor();
  await bob.control('move:1').waitFor();
  for (const guest of [alice,bob]) await guest.control('ready').click();
  await host.main.locator('[data-act="start"]:enabled').waitFor();
  await Promise.all([alice.card(1).click({force:true}),bob.card(1).click({force:true})]);
  await host.seat(1).locator('strong').getByText(/来宾/).waitFor();
  const winnerName = await host.seat(1).locator('strong').innerText();
  const loser = winnerName==='来宾甲'?bob:alice;
  const winner = winnerName==='来宾甲'?alice:bob;
  await winner.seat(1).locator('.mm-seat-status').getByText('◇ 待准备').waitFor();
  await loser.seat(1).getByText(winnerName,{exact:true}).waitFor();
  assert.equal(await loser.control('move:1').count(),0);
  assert.equal(await host.main.locator('.mm-seat.occupied').count(),3);

  await winner.page.reload();
  await winner.open();
  await winner.control('resume-guest').click();
  await winner.page.locator('[data-seat="1"].mine').waitFor();
  await winner.control('ready').click();
  await host.page.locator('[data-act="start"]:enabled').click();
  for(const guest of [alice,bob])await guest.page.getByRole('button',{name:'踏入故事'}).click();
  await host.page.getByRole('button',{name:'踏入故事'}).click();
  await winner.main.locator('.mm-in-session').waitFor();
  assert.equal(await winner.main.locator('[data-act^="move:"]').count(),0);
  await winner.control('leave').click();
  const newcomer = await player('接管者');
  await join(newcomer);
  await newcomer.control('takeover:1').click();
  await host.page.locator('[data-lobby-main]').click();
  await host.control('approve:0').click();
  await newcomer.page.locator('[data-seat="1"].mine').waitFor();
  assert.equal(await newcomer.seat(1).locator('strong').innerText(),winnerName);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine.name()+': split join form, lock hit area, simultaneous joins and seat changes, fixed host, moved-seat recovery, and explicit post-start takeover');
} finally {
  await browser?.close();
  server.close();
  signaling?.close();
}
process.exit(0);
