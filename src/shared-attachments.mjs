import {fromBase64, toBase64} from './room-map.mjs';

export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_ROOM_ATTACHMENT_BYTES = 128 * 1024 * 1024;
export const ATTACHMENT_TYPES = Object.freeze({
  'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif', 'image/avif':'avif',
  'audio/mpeg':'mp3', 'audio/ogg':'ogg', 'audio/wav':'wav', 'audio/webm':'webm', 'audio/mp4':'m4a',
});
const chunkSize = 8192;
const windowSize = 4;
const idleMs = 30000;
const hashPattern = /^[a-f0-9]{64}$/;

export async function attachmentHash(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2,'0')).join('');
}

export function attachmentPath(path) {
  if (typeof path!=='string' || path.length>240) throw Error('附件路径过长或无效');
  const parts = path.normalize('NFC').split('/');
  if (parts.length>12 || parts.some(part=>!part || part!==part.trim() || part.endsWith('.') || part.startsWith('.')
      || /[\\<>:"|?*%#\u0000-\u001f\u007f]/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw Error('附件需要使用有效的相对路径');
  }
  return parts.join('/');
}

export function validAttachment(entry) {
  if (!entry || typeof entry.hash!=='string' || !hashPattern.test(entry.hash)
      || typeof entry.type!=='string' || !Object.hasOwn(ATTACHMENT_TYPES,entry.type)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes<1 || entry.bytes>MAX_ATTACHMENT_BYTES) return false;
  try{
    const suffix=entry.path.split('.').at(-1).toLowerCase();
    const format=ATTACHMENT_TYPES[entry.type];
    return entry.path===attachmentPath(entry.path)&&(suffix===format||format==='jpg'&&suffix==='jpeg');
  }catch{return false;}
}

const allAttachments = view => (view?.results ?? []).flatMap(result=>result.attachments ?? []);
const cacheKey = (roomId,hash) => 'attachment:'+roomId+':'+hash;

export function createSharedAttachments({store,view,connection,changed}) {
  const urls = new Map(), verified = new Set(), failed = new Map(), acknowledged = new Set();
  const sending = new WeakSet();
  let transfer, pumping = false, generation = 0;
  const makeBlob = (parts,type) => new Blob(parts,{type});

  async function save(roomId,entry,blob) {
    const key = cacheKey(roomId,entry.hash);
    if (!verified.has(key)) {
      if(store.saveAttachment)await store.saveAttachment(roomId,entry.hash,blob,MAX_ROOM_ATTACHMENT_BYTES);
      else await store.put(key,blob);
    }
    verified.add(key);
  }

  async function get(roomId,entry) {
    const key = cacheKey(roomId,entry.hash);
    const blob = await store.get(key);
    if (!blob || blob.size!==entry.bytes) return null;
    if (!verified.has(key)) {
      if (await attachmentHash(blob)!==entry.hash) return null;
      verified.add(key);
    }
    return blob;
  }

  async function prepare(path,file,expectedKind) {
    const type = file?.type;
    if (typeof file?.arrayBuffer!=='function' || typeof file?.slice!=='function'
        || !Object.hasOwn(ATTACHMENT_TYPES,type) || !type.startsWith(expectedKind+'/')
        || !Number.isSafeInteger(file.size) || file.size<1 || file.size>MAX_ATTACHMENT_BYTES) {
      throw Error('请提交不超过 16 MiB 的受支持图片或音频文件');
    }
    const relative = attachmentPath(path);
    const blob = makeBlob([await file.arrayBuffer()],type);
    if(blob.size!==file.size)throw Error('附件长度有误');
    const entry = {path:relative,type,bytes:blob.size,hash:await attachmentHash(blob)};
    if(!validAttachment(entry))throw Error('文件后缀需要与图片或音频的实际类型一致');
    return {entry,blob};
  }

  function descriptors(hash) {
    return allAttachments(view()).filter(entry=>entry.hash===hash && validAttachment(entry));
  }

  async function sendWindow(conn,roomId,message,current) {
    const entry = descriptors(message.hash)[0];
    const first = message.start;
    if (!entry || !Number.isSafeInteger(first) || first<0 || first%windowSize!==0
        || first*chunkSize>=entry.bytes || typeof message.transferId!=='string'
        || !/^[a-f0-9-]{36}$/i.test(message.transferId)) throw Error('附件请求已过期或格式无效');
    if(sending.has(conn))return;
    sending.add(conn);
    try {
      const blob = await get(roomId,entry);
      if (!current() || !descriptors(entry.hash).length) return;
      if (!blob) {
        conn.send({type:'attachment-error',hash:entry.hash,transferId:message.transferId});
        return;
      }
      for (let index=first; index<first+windowSize && index*chunkSize<blob.size; index++) {
        const part = await blob.slice(index*chunkSize,(index+1)*chunkSize).arrayBuffer();
        if (!current()) return;
        conn.send({type:'attachment-chunk',hash:entry.hash,transferId:message.transferId,index,data:toBase64(new Uint8Array(part))});
      }
    } finally {sending.delete(conn);}
  }

  function stop() {
    clearTimeout(transfer?.timer);
    transfer = null;
  }
  function fail(current,error) {
    if (transfer!==current) return;
    failed.set(current.entry.hash,error);
    stop();
    changed();
    void pump();
  }
  function request(current) {
    clearTimeout(current.timer);
    current.timer = setTimeout(()=>fail(current,'附件同步超时'),idleMs);
    current.conn.send({type:'attachment-window',hash:current.entry.hash,start:current.parts.length,transferId:current.id});
  }
  function acknowledge(conn,hash) {
    if (acknowledged.has(hash)) return;
    conn.send({type:'attachment-ready',hash});
    acknowledged.add(hash);
    changed();
  }

  async function pump() {
    const roomId = view()?.id, conn = connection(), lease = generation;
    if (!conn?.open || !roomId) return;
    if (transfer && !descriptors(transfer.entry.hash).length) stop();
    if (transfer || pumping) return;
    const entry = allAttachments(view()).find(item=>validAttachment(item)&&!acknowledged.has(item.hash)&&!failed.has(item.hash));
    if (!entry) return;
    pumping = true;
    let again = false;
    try {
      const blob = await get(roomId,entry);
      if (lease!==generation || conn!==connection() || roomId!==view()?.id || !descriptors(entry.hash).length) return;
      if (blob) {
        acknowledge(conn,entry.hash);
        again = true;
      } else {
        const current = transfer = {entry,conn,id:crypto.randomUUID(),roomId,parts:[]};
        request(current);
      }
    } catch(error) {
      if (lease!==generation) return;
      failed.set(entry.hash,error.message);
      stop();
      changed();
      again = true;
    } finally {
      pumping = false;
      if (again || lease!==generation) void pump();
    }
  }

  async function receive(message) {
    const current = transfer;
    if (!current || message.hash!==current.entry.hash || message.transferId!==current.id) return;
    try {
      if (message.type==='attachment-error') throw Error('房主端找不到附件');
      const {entry,parts} = current;
      const index = parts.length;
      const remaining = Math.min(chunkSize,entry.bytes-index*chunkSize);
      if (message.index!==index || remaining<=0 || typeof message.data!=='string'
          || message.data.length!==4*Math.ceil(remaining/3)) throw Error('附件分片无效');
      const bytes = fromBase64(message.data);
      if (bytes.length!==remaining) throw Error('附件分片长度不符');
      parts.push(bytes);
      if ((index+1)*chunkSize>=entry.bytes) {
        clearTimeout(current.timer);
        const blob = makeBlob(parts,entry.type);
        if (await attachmentHash(blob)!==entry.hash) throw Error('附件完整性校验失败');
        if (transfer!==current || current.conn!==connection() || !descriptors(entry.hash).length) return;
        await save(current.roomId,entry,blob);
        if (transfer!==current || current.conn!==connection()) return;
        stop();
        acknowledge(current.conn,entry.hash);
        void pump();
      } else if (parts.length%windowSize===0) {
        request(current);
      } else {
        clearTimeout(current.timer);
        current.timer = setTimeout(()=>fail(current,'附件同步超时'),idleMs);
      }
    } catch(error) {fail(current,error.message);}
  }

  function reset(full=false) {
    generation++;
    stop();
    acknowledged.clear();
    failed.clear();
    if (full) {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      verified.clear();
    }
  }

  async function open(entry) {
    const roomId = view()?.id;
    if (!descriptors(entry.hash).length) return null;
    let url = urls.get(entry.hash);
    if (url) return url;
    const blob = await get(roomId,entry);
    if (!blob || roomId!==view()?.id || !descriptors(entry.hash).length) return null;
    url = urls.get(entry.hash);
    if (!url) {
      url = URL.createObjectURL(makeBlob([blob],entry.type));
      urls.set(entry.hash,url);
    }
    return url;
  }

  return {
    prepare, save, sendWindow, receive, pump, reset, open,
    status: hash => acknowledged.has(hash)?'ready':failed.has(hash)?'failed':'pending',
    retry(hash) {failed.delete(hash);void pump();},
  };
}
