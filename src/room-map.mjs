const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
export const MAP_CHUNK_SIZE = 12000;
export const MAP_CHUNK_WINDOW = 8;
const maxBytes = 16 * 1024 * 1024;
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const keyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

export function toBase64(bytes) {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(raw);
}
export const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export function validateMapDescriptor(map) {
  if (!isRecord(map) || !/^[a-f0-9]{64}$/.test(map.hash) || !Number.isSafeInteger(map.bytes)
      || map.bytes < 1 || map.bytes > maxBytes) throw Error('房主提供的地图大小或校验值无效');
  return Math.ceil(4 * Math.ceil(map.bytes / 3) / MAP_CHUNK_SIZE);
}

export async function encodeRoomMap(map) {
  const bytes = encoder.encode(JSON.stringify(map));
  if (bytes.length > maxBytes) throw Error('地图包含的资源超过 16 MB，请缩小图片或移除过大的附件');
  const descriptor = {hash: await sha256(bytes), bytes: bytes.length};
  return {descriptor, data: toBase64(bytes)};
}

export async function decodeRoomMap(descriptor, data) {
  validateMapDescriptor(descriptor);
  if (data.length !== 4 * Math.ceil(descriptor.bytes / 3)) throw Error('地图下载长度不符');
  const bytes = fromBase64(data);
  if (bytes.length !== descriptor.bytes || await sha256(bytes) !== descriptor.hash) throw Error('地图校验失败，请重新同步');
  const map = JSON.parse(decoder.decode(bytes), (key, value) =>
    ['__proto__', 'constructor', 'prototype'].includes(key) ? undefined : value);
  if (map?.schema !== 1 || !keyPattern.test(map.roomId) || !isRecord(map.card?.data)
      || typeof map.card.data.name !== 'string' || !map.card.data.name.trim()
      || map.card.data.name.length > 300 || typeof map.avatar !== 'string'
      || !Array.isArray(map.books) || map.books.length > 64
      || !map.books.every(book => typeof book?.name === 'string' && isRecord(book.data?.entries))
      || !map.links || !Array.isArray(map.links.additional)) throw Error('同步的角色卡或世界书格式无效');
  for (const name of [map.links.primary, map.links.chat, ...map.links.additional]) {
    if (name !== null && !map.books.some(book => book.name === name)) throw Error('地图缺少引用的世界书');
  }
  return map;
}

export function roomMapAssets(map) {
  const scripts = [];
  let enableScripts = false;
  const visit = (items, enabled = true) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const active = enabled && item?.enabled !== false;
      if (typeof item?.content === 'string') {
        scripts.push(String(item.name || '未命名脚本').slice(0, 100));
        if (active) enableScripts = true;
      }
      if (Array.isArray(item?.scripts)) visit(item.scripts,active);
    }
  };
  const extensions = map.card.data.extensions;
  visit(extensions?.tavern_helper?.scripts ?? extensions?.TavernHelper_scripts);
  const regexes = extensions?.regex_scripts;
  const regexCount = Array.isArray(regexes) ? regexes.length : 0;
  const enableRegexes = regexCount > 0 && regexes.some(regex => !regex?.disabled);
  const embeddedCode = /<\s*(?:script|iframe|object|embed)\b|\bon\w+\s*=|javascript\s*:/i.test(JSON.stringify(map.card.data));
  return {scripts,regexCount,enableScripts,enableRegexes,requiresConsent: scripts.length > 0 || regexCount > 0 || embeddedCode};
}

export function createRoomMapStore(indexedDB) {
  let opened;
  function database() {
    if (!indexedDB) throw Error('当前酒馆不提供地图存储');
    if (!opened) opened = new Promise((resolve, reject) => {
      const request = indexedDB.open('miemie-multiplayer-lobby-maps', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('maps');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opened = null; reject(request.error); };
    });
    return opened;
  }
  async function access(mode, run) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('maps', mode);
      const request = run(transaction.objectStore('maps'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || Error('地图存储失败'));
    });
  }
  return {
    get: key => access('readonly', store => store.get(key)),
    put: (key, value) => access('readwrite', store => store.put(value, key)),
    remove: key => access('readwrite', store => store.delete(key)),
  };
}
