// SPDX-License-Identifier: GPL-3.0-or-later
import {createHmac, randomUUID} from 'node:crypto';
import {readFileSync, realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {isIPv4} from 'node:net';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const lifetimeSeconds = 24 * 60 * 60;
const windowMs = 60_000;
const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

export function createCredentialHandler({host, secret, clock = Date.now, clientLimit = 12, totalLimit = 120}) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host ?? '')) {
    throw Error('Invalid TURN host');
  }
  if (!/^[0-9a-f]{64}$/.test(secret ?? '')) throw Error('Invalid TURN secret');
  const urls = ['udp', 'tcp'].map(transport => `turn:${host}:3478?transport=${transport}`);
  const clients = new Map();
  let total = 0;
  let resetAt = 0;

  return (request, response) => {
    const respond = (status, data, extra = {}) => {
      response.writeHead(status, {...responseHeaders, ...extra});
      response.end(JSON.stringify(data));
    };
    // Caddy overwrites this header and only the local proxy can reach this server.
    if (request.url !== '/v1/ice') return respond(404, {error: 'Not found'});
    if (request.method !== 'GET') return respond(405, {error: 'Method not allowed'}, {Allow: 'GET'});
    const ip = request.headers['x-miemie-client-ip'];
    if (!isIPv4(ip)) return respond(403, {error: 'Missing client address'});

    const now = clock();
    if (now >= resetAt) {
      clients.clear();
      total = 0;
      resetAt = now + windowMs;
    }
    const count = clients.get(ip) ?? 0;
    if (total >= totalLimit || count >= clientLimit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      return respond(429, {error: 'Too many requests'}, {'Retry-After': retryAfter});
    }

    clients.set(ip, count + 1);
    total += 1;
    const username = `${Math.floor(now / 1000) + lifetimeSeconds}:${randomUUID()}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return respond(200, {iceServers: [{urls, username, credential}]});
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const {CREDENTIALS_DIRECTORY, MIEMIE_TURN_HOST} = process.env;
  const secret = readFileSync(join(CREDENTIALS_DIRECTORY, 'turn-secret'), 'utf8').trim();
  createServer({requestTimeout: 5000, headersTimeout: 5000}, createCredentialHandler({
    host: MIEMIE_TURN_HOST,
    secret,
  })).listen(18798, '127.0.0.1');
}
