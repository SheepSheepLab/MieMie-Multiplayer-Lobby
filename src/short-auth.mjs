const enc=new TextEncoder();
export const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export const decode=s=>{if(typeof s!=='string'||!/^[\w-]+$/.test(s)||s.length>200)throw Error('认证数据无效');return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
export const nonce=()=>encode(crypto.getRandomValues(new Uint8Array(24)));
export const fingerprint=async k=>encode(await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify({kty:k.kty,crv:k.crv,x:k.x,y:k.y}))));
export function roomCode(){const n=new Uint32Array(1);do{crypto.getRandomValues(n);}while(n[0]>=4294800000);return String(100000+n[0]%900000);}
export async function passwordKey(password,salt){if(typeof password!=='string'||password.length>64)throw Error('密码最多 64 个字符');const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return encode(await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode(salt),iterations:210000,hash:'SHA-256'},base,256));}
export async function passwordSetup(password=''){return password?{salt:nonce(),key:null}:null;}
export async function proof(key,transcript){const k=await crypto.subtle.importKey('raw',decode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return encode(await crypto.subtle.sign('HMAC',k,enc.encode(transcript)));}
export async function verifyProof(key,transcript,value){try{const k=await crypto.subtle.importKey('raw',decode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('HMAC',k,decode(value),enc.encode(transcript));}catch{return false;}}
export async function sign(key,transcript){const k=await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);return encode(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k,enc.encode(transcript)));}
export async function verify(key,transcript,value){try{const k=await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},k,decode(value),enc.encode(transcript));}catch{return false;}}
export const transcript=(peerId,clientNonce,serverNonce,fp,salt)=>JSON.stringify(['MM3',peerId,clientNonce,serverNonce,fp,salt||'']);
export function parseShort(value){const s=value.trim();if(/^\d{6}$/.test(s))return {code:s};const match=s.match(/^MM3\.(\d{6})\.([\w-]{43})$/);if(match)return {code:match[1],fingerprint:match[2]};throw Error('请输入 6 位房间号或完整邀请');}
