import {secret,parseInvite} from './transport.mjs';
export function directoryUrl(value){const url=new URL(value);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('房间目录地址需要 HTTPS（本机测试可用 HTTP）');if(url.username||url.password||url.search||url.hash)throw Error('房间目录地址不应含密码、参数或锚点');return url.href.replace(/\/$/,'');}
export class Directory{
 constructor(url){this.url=directoryUrl(url);}
 async request(path,body,ownerToken,method='POST'){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(this.url+path,{method,headers:{'Content-Type':'application/json',...(ownerToken?{Authorization:'Bearer '+ownerToken}:{})},credentials:'omit',cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok){const error=Error(data.error||'房间目录暂时不可用');error.status=response.status;throw error;}return data;}finally{clearTimeout(timeout);}}
 async create(invite,password=''){parseInvite(invite);const ownerToken=secret();const data=await this.request('/rooms',{invite,password,ownerToken});if(!/^\d{6}$/.test(data.code))throw Error('房间目录返回了无效房间号');return {...data,ownerToken,url:this.url};}
 async resolve(code,password=''){if(!/^\d{6}$/.test(code))throw Error('请输入 6 位数字房间号');const data=await this.request(`/rooms/${code}/resolve`,{password});parseInvite(data.invite);return data.invite;}
 heartbeat(lease){return this.request(`/rooms/${lease.code}/heartbeat`,{},lease.ownerToken);}
 remove(lease){return this.request(`/rooms/${lease.code}`,null,lease.ownerToken,'DELETE');}
}
