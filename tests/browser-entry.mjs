import {Controller} from '../src/controller.mjs';
const adapter={profile:()=>({name:'测试玩家',description:'测试人物'}),hostChat:()=>({binding:'test-chat'}),capture:()=>({binding:'test-chat',history:[]}),cancel:()=>{},async generate(state){return '四位玩家走进同一间旅店。\n'+state.frozen.players.map(p=>`<user${p.seat}><status>user${p.seat}专属状态</status></user${p.seat}>`).join('\n');}};
window.newController=()=>{window.c?.close();window.c=new Controller(localStorage,adapter);window.c.config={host:'127.0.0.1',port:18793,path:'/',secure:false,config:{iceServers:[]}};return true;};
