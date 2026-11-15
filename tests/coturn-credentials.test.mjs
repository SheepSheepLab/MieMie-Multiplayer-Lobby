// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {createCredentialHandler} from '../server/turn/credentials.mjs';

const host = 'relay.example.test';
const secret = 'a'.repeat(64);

function call(handler, ip, method = 'GET', url = '/v1/ice') {
  const result = {};
  handler({url, method, headers: {'x-miemie-client-ip': ip}}, {
    writeHead(status, headers) { Object.assign(result, {status, headers}); },
    end(body) { result.body = JSON.parse(body); },
  });
  return result;
}

test('自建 TURN 签发可被 coturn 验证的限期凭据', () => {
  const now = 1_700_000_000_000;
  const handler = createCredentialHandler({host, secret, clock: () => now});
  const first = call(handler, '192.0.2.8');
  assert.equal(first.status, 200);
  assert.equal(first.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(first.headers['Cache-Control'], 'no-store');
  const [server] = first.body.iceServers;
  assert.deepEqual(server.urls, ['turn:relay.example.test:3478?transport=udp', 'turn:relay.example.test:3478?transport=tcp']);
  assert.equal(server.username.split(':')[0], String(now / 1000 + 86400));
  assert.equal(server.credential, createHmac('sha1', secret).update(server.username).digest('base64'));
  assert.notEqual(server.username, call(handler, '192.0.2.8').body.iceServers[0].username);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(secret));
});

test('自建 TURN 签发限制来源、方法、单个客户端和总请求量', () => {
  let now = 1000;
  const handler = createCredentialHandler({host, secret, clock: () => now, clientLimit: 1, totalLimit: 2});
  const client = '192.0.2.8';
  assert.equal(call(handler, '192.0.2.7, 192.0.2.8').status, 403);
  assert.equal(call(handler, client, 'POST').status, 405);
  assert.equal(call(handler, client, 'GET', '/v1/ice?user=1').status, 404);
  assert.equal(call(handler, client).status, 200);
  assert.equal(call(handler, client).headers['Retry-After'], 60);
  assert.equal(call(handler, '192.0.2.9').status, 200);
  assert.equal(call(handler, '192.0.2.10').status, 429);
  now += 60_000;
  assert.equal(call(handler, client).status, 200);
});
