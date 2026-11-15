import {createServer} from 'node:http';
import {randomInt,randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const scrypt=promisify(scryptCallback);
const digest=s=>createHash('sha256').update(s).digest();
export function createDirectory({leaseMs=300000,now=Date.now,allocate=()=>String(randomInt(100000,1000000)),maxRooms=10000,rateLimit=true}={}){
 const rooms=new Map(),buckets=new Map();let hashing=0;
 const cleanup=()=>{const time=now();for(const [key,r]of rooms)if(r.expiresAt<=time)rooms.delete(key);for(const [key,b]of buckets)if(b.until<=time)buckets.delete(key);};
 const timer=setInterval(cleanup,30000);timer.unref();
 const limited=(key,max)=>{if(!rateLimit)return false;const current=buckets.get(key);if(!current||current.until<=now()){if(buckets.size>=50000)return true;buckets.set(key,{count:1,until:now()+60000});return false;}return ++current.count>max;};
 const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST,DELETE,OPTIONS,GET');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const url=new URL(req.url,'http://localhost'),ip=req.socket.remoteAddress||'unknown';
  if(req.method==='GET'&&url.pathname==='/health'){send(200,{ok:true,service:'miemie-lobby-directory',version:'0.2.0'});return;}
  if(limited('ip:'+ip,100)){send(429,{error:'请求过于频繁，请一分钟后再试'});return;}
  try{
   cleanup();let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096){send(413,{error:'请求过大'});return;}}
   let body;try{body=raw?JSON.parse(raw):{};}catch{send(400,{error:'请求格式无效'});return;}
   const pass=body.password??'';if(typeof pass!=='string'||pass.length>64){send(400,{error:'密码最多 64 个字符'});return;}
   if(req.method==='POST'&&url.pathname==='/rooms'){
    if(limited('create:'+ip,10)||rooms.size>=maxRooms){send(429,{error:'暂时不能创建更多房间'});return;}
    if(typeof body.invite!=='string'||!/^MM1\.[\w-]{10,100}\.[\w-]{32}\.[\w-]{43}$/.test(body.invite)||typeof body.ownerToken!=='string'||!/^[\w-]{32}$/.test(body.ownerToken)){send(400,{error:'房间信息无效'});return;}
    if(hashing>=8){send(503,{error:'服务繁忙，请稍后再试'});return;}
    hashing++;const salt=randomBytes(16).toString('hex');let hash;try{hash=await scrypt(pass,salt,32);}finally{hashing--;}
    let code;for(let i=0;i<100;i++){const candidate=allocate();if(/^\d{6}$/.test(candidate)&&!rooms.has(candidate)){code=candidate;break;}}
    if(!code){send(503,{error:'房间号分配失败，请重试'});return;}
    const expiresAt=now()+leaseMs;rooms.set(code,{invite:body.invite,ownerHash:digest(body.ownerToken),salt,hash,expiresAt});send(201,{code,expiresAt,leaseMs});return;
   }
   const match=url.pathname.match(/^\/rooms\/(\d{6})(?:\/(resolve|heartbeat))?$/);if(!match){send(404,{error:'接口不存在'});return;}
   const [,code,operation]=match,r=rooms.get(code);
   if(req.method==='POST'&&operation==='resolve'){
    if(limited('lookup:'+ip,20)||limited('code:'+code,30)){send(429,{error:'尝试过于频繁，请一分钟后再试'});return;}
    if(hashing>=8){send(503,{error:'服务繁忙，请稍后再试'});return;}
    hashing++;let hash;try{hash=await scrypt(pass,r?.salt||'unknown-room-salt',32);}finally{hashing--;}
    if(!r||r.expiresAt<=now()||rooms.get(code)!==r||!timingSafeEqual(hash,r.hash)){send(404,{error:'房间号或密码不正确，或房间已结束'});return;}
    send(200,{invite:r.invite,expiresAt:r.expiresAt});return;
   }
   const token=(req.headers.authorization||'').replace(/^Bearer /,'');if(!r||!timingSafeEqual(digest(token),r.ownerHash)){send(404,{error:'房间不存在或管理凭据无效'});return;}
   if(req.method==='POST'&&operation==='heartbeat'){r.expiresAt=now()+leaseMs;send(200,{expiresAt:r.expiresAt,leaseMs});return;}
   if(req.method==='DELETE'&&!operation){rooms.delete(code);send(200,{ok:true});return;}
   send(405,{error:'不支持的操作'});
  }catch{if(!res.headersSent)send(500,{error:'服务暂时不可用'});else res.end();}
 });
 server.on('close',()=>clearInterval(timer));server.requestTimeout=10000;server.headersTimeout=10000;
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PORT||18796),host=process.env.HOST||'127.0.0.1';createDirectory().listen(port,host,()=>console.log(`MieMie lobby directory listening on ${host}:${port}`));}
