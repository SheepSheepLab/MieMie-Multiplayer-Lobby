import { validatePlayers, splitReply } from './context.mjs';
export const uuid = () => crypto.randomUUID();
export function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}为空或过长`);
  return value.trim();
}
export function persona(value) {
  const description = value?.description ?? '';
  if (typeof description !== 'string' || description.length > 16000) throw Error('角色描述无效或过长');
  return { name: text(value?.name, 80, '角色名'), description: description.trim() };
}
export const sceneFields = [
  ['intro', '场景简介', 900],
  ['rules', '公开规则', 1800],
  ['opening', '开场白', 3200],
];
export function publicScene(value) {
  return Object.fromEntries(sceneFields.flatMap(([key, label, max]) => {
    const input = value?.[key];
    return input == null || input === '' || (typeof input === 'string' && !input.trim())
      ? [] : [[key, text(input, max, label)]];
  }));
}
export class Room {
  constructor(state, save = () => {}) { this.state = state; this.save = save; }
  static restore(state) {
    const room = new Room(state);
    state.players[0].online = true;
    if (state.phase === 'lobby') {
      // A restored lobby has no live guest connections. Reclaim an old seat
      // only when its guest actually returns and the seat is still available.
      room.restoredGuests = state.players.slice(1).filter(Boolean);
      state.players.fill(null, 1);
    } else {
      for (const player of state.players.slice(1)) if (player) player.online = false;
    }
    if (state.phase === 'generating') {
      const reroll = state.generationKind==='reroll';
      state.phase = reroll?'host-action':'error';
      if(reroll)state.frozen=null;
      state.error = reroll?'房主刷新中断了重 Roll，已保留原回复':'房主刷新中断了生成，可重试本轮';
    }
    state.vote=null;state.operation=null;state.generationKind=null;
    state.revision++;
    return room;
  }
  static create(profile, token, title, actionVisibility = 'public', scene) {
    if(!['public','hidden'].includes(actionVisibility)) throw new Error('行动模式无效');
    return new Room({ actionVisibility, scene: publicScene(scene), id: uuid(), title: text(title,80,'房间名称'), revision: 0, phase: 'lobby', round: 1,
      players: [{...persona(profile), id: uuid(), seat: 0, token, online: true, ready: true}, null, null, null],
      lockedSeats:[false,false,false,false],revokedTokens:[],chat: [], chatEpoch: 0, actions: [], results: [], members: [], frozen: null, error: '', binding: null, baseHistory: [] });
  }
  change(fn) {
    const before = structuredClone(this.state);
    try { const result = fn(this.state); this.state.revision++; this.save(this.state); return result; }
    catch (error) { this.state = before; throw error; }
  }
  player(id) { const p = this.state.players.find(p => p?.id === id); if (!p) throw new Error('角色不在房间中'); return p; }
  isOpenSeat(seat) {
    return [1,2,3].includes(seat) && !this.state.players[seat] && !this.state.lockedSeats?.[seat];
  }
  join(profile, token) {
    if (this.state.phase === 'ended') throw new Error('房间已经结束');
    if(this.state.revokedTokens?.includes(token))throw new Error('该入房凭据已被房主移除');
    const found = this.state.players.find(p => p?.token === token);
    if (found) return this.change(() => {
      if (this.state.phase === 'lobby' && !found.online) found.ready = false;
      found.online = true;
      return found.id;
    });
    if (this.state.phase !== 'lobby') throw new Error('剧情已经开始，请向房主申请接管离线角色');
    const restored = this.restoredGuests?.find(player => player.token === token);
    const seat = restored && this.isOpenSeat(restored.seat)
      ? restored.seat : [1,2,3].find(index => this.isOpenSeat(index));
    if (seat === undefined) throw Error('房间没有可用席位');
    const id = this.change(s => {
      const player = {...(restored ?? {...persona(profile), id: uuid(), token}), seat, online:true, ready:false};
      s.players[seat] = player;
      return player.id;
    });
    if (restored) this.restoredGuests = this.restoredGuests.filter(player => player !== restored);
    return id;
  }
  move(id, seat) {
    const player = this.player(id);
    if (player.seat === 0) throw Error('房主席位固定');
    if (player.seat === seat) return;
    if (this.state.phase !== 'lobby') throw Error('开局后席位固定，不能换位');
    if (!this.isOpenSeat(seat)) throw Error('这个席位已被占用或锁定');
    this.change(state => {
      state.players[player.seat] = null;
      state.players[seat] = {...player, seat, ready:false};
    });
  }
  takeover(seat, token) {
    if(this.state.revokedTokens?.includes(token))throw new Error('该入房凭据已被房主移除');
    const old=this.state.players[seat];
    if (!old || seat===0 || old.online || this.state.phase==='lobby' || this.state.phase==='generating' || this.state.phase==='ended') throw new Error('当前不能接管这个角色');
    return this.change(() => { old.token=token; old.online=true; return old.id; });
  }
  lock(seat, locked) {
    if(this.state.phase!=='lobby')throw new Error('开局后席位固定，不能锁位');
    if(![1,2,3].includes(seat)||this.state.players[seat])throw new Error('只能锁定空的队友席位');
    const seats=[...(this.state.lockedSeats||[false,false,false,false])];seats[seat]=!!locked;
    if(seats.filter(x=>!x).length<2)throw new Error('至少保留两个可用席位');
    this.change(s=>{s.lockedSeats=seats;});
  }
  kick(seat) {
    if(![1,2,3].includes(seat)||!this.state.players[seat]||this.state.phase==='ended')throw new Error('不能移除这个席位');
    const p=this.state.players[seat];
    return this.change(s=>{s.revokedTokens??=[];s.revokedTokens.push(p.token);if(s.phase==='lobby')s.players[seat]=null;else{p.token=uuid();p.online=false;}this.cancelVoteFor(p.id);return p.id;});
  }
  leave(id) {
    const player = this.player(id);
    if (player.seat === 0) throw Error('房主可结束联机');
    this.change(s => {
      if (s.phase === 'lobby') s.players[player.seat] = null;
      else player.online = false;
      this.cancelVoteFor(id);
    });
  }
  disconnect(id) { this.change(() => { this.player(id).online=false;this.cancelVoteFor(id); }); }
  ready(id, ready) {
    if (this.state.phase!=='lobby') throw new Error('已开始的角色不能修改准备状态');
    this.change(() => { this.player(id).ready=ready===true; });
  }
  start(binding, baseHistory, chatRef) {
    if (this.state.phase!=='lobby') throw new Error('房间已经开始');
    const players=this.state.players.filter(Boolean);
    validatePlayers(players);
    if(players.some(p=>!p.online||!p.ready)) throw new Error('请等待所有玩家上线并准备');
    this.change(s=>{s.binding=binding;if(chatRef)s.chatRef=chatRef;s.baseHistory=structuredClone(baseHistory);s.members=players.map(p=>p.id);s.phase='host-action';});
  }
  action(id, command, skip=false) {
    const s=this.state, p=this.player(id);
    if(s.vote||s.operation)throw Error('请等当前投票处理结束');
    if(command.round!==s.round || !s.members.includes(id)) throw new Error('回合已经改变，请重新同步');
    const prior=s.actions.find(a=>a.playerId===id);
    if(prior) {
      if(prior.id===command.id) return prior;
      throw new Error('本轮行动已锁定');
    }
    if(!['host-action','actions'].includes(s.phase)) throw new Error('当前不能提交行动');
    if(p.seat!==0 && s.phase==='host-action') throw new Error('请等待房主先公布行动');
    return this.change(state=>{
      const action={id:text(command.id,80,'行动编号'),round:s.round,playerId:id,seat:p.seat,name:p.name,
        content:skip?'本轮跳过':text(command.content,12000,'行动'),skip,order:s.actions.length};
      state.actions.push(action);state.phase='actions';
      if(state.members.every(id=>state.actions.some(a=>a.playerId===id))) {
        state.phase='ready';
        state.frozen={round:state.round,players:state.members.map(id=>{const {token,...p}=this.player(id);return structuredClone(p);}),
          actions:structuredClone(state.actions).sort((a,b)=>a.seat-b.seat)};
      }
      return action;
    });
  }
  beginGeneration() {
    if(!['ready','error'].includes(this.state.phase)||!this.state.frozen) throw new Error('本轮尚未收齐行动');
    return this.change(s=>{s.phase='generating';s.generationKind=null;s.error='';s.attemptId=uuid();return s.attemptId;});
  }
  fail(attemptId, error) {
    if(this.state.phase!=='generating'||this.state.attemptId!==attemptId) return;
    this.change(s=>{
      if(s.generationKind==='reroll'){s.phase='host-action';s.frozen=null;s.operation=null;}
      else s.phase='error';
      s.generationKind=null;s.error=String(error).slice(0,500);
    });
  }
  commit(attemptId, raw) {
    if(this.state.phase!=='generating'||this.state.attemptId!==attemptId) throw new Error('生成已取消或过期');
    text(raw,500000,'模型回复');
    const parsed=splitReply(raw,this.state.frozen.players);
    return this.change(s=>{
      const prior=s.generationKind==='reroll'?s.results.at(-1):null;
      const result={id:prior?.id??uuid(),round:prior?.round??s.round,variant:(prior?.variant??-1)+1,raw,
        story:parsed.story,players:parsed.players,actions:structuredClone(s.frozen.actions)};
      if(prior){s.results[s.results.length-1]=result;s.operation=null;}
      else{s.results.push(result);s.round++;}
      s.actions=[];s.frozen=null;s.generationKind=null;s.phase='host-action';s.error='';
      return result;
    });
  }
  proposeVote(id,kind,resultId,now=Date.now()) {
    const s=this.state;
    if(s.phase!=='host-action'||s.vote||s.operation||!s.results.length)throw Error('请在下一轮行动开始前发起投票');
    if(!['reroll','branch'].includes(kind))throw Error('不支持的投票');
    const result=s.results.find(entry=>entry.id===resultId);
    if(!result||(kind==='reroll'&&result!==s.results.at(-1)))throw Error('请选择有效的剧情楼层');
    const voters=s.players.filter(p=>p?.online&&s.members.includes(p.id)).map(p=>p.id);
    if(voters.length<2||!voters.includes(id))throw Error('至少需要两名在线玩家参与投票');
    return this.change(state=>state.vote={id:uuid(),kind,resultId,round:result.round,voters,yes:[id],expires:now+60000});
  }
  castVote(id, voteId, yes, now=Date.now()) {
    const vote=this.state.vote;
    if(vote?.id!==voteId||!vote.voters.includes(id)||now>=vote.expires)throw Error('投票已经结束或失效');
    if(typeof yes!=='boolean')throw Error('无效的投票选项');
    if(vote.yes.includes(id))return null;
    return this.change(s=>{
      if(!yes){s.vote=null;s.error='投票未通过，当前剧情保留';return null;}
      vote.yes.push(id);
      if(vote.yes.length!==vote.voters.length)return null;
      s.vote=null;s.error='';
      return s.operation={id:vote.id,kind:vote.kind,resultId:vote.resultId};
    });
  }
  cancelVoteFor(id) {
    if(this.state.vote?.voters.includes(id)){
      this.state.vote=null;
      this.state.error='投票期间有玩家离线，当前剧情保留';
    }
  }
  expireVote(voteId) {
    if(this.state.vote?.id===voteId)this.change(s=>{s.vote=null;s.error='投票超时，当前剧情保留';});
  }
  beginReroll(operation) {
    const s=this.state,prior=s.results.at(-1);
    if(s.operation!==operation||operation.kind!=='reroll'||prior?.id!==operation.resultId)throw Error('重 Roll 请求已过期');
    return this.change(state=>{
      state.frozen={actions:structuredClone(prior.actions),players:state.members.map(id=>{
        const {token,...player}=this.player(id);
        return structuredClone(player);
      })};
      state.phase='generating';state.generationKind='reroll';state.attemptId=uuid();return state.attemptId;
    });
  }
  commitBranch(operation, binding) {
    const s=this.state,index=s.results.findIndex(result=>result.id===operation.resultId);
    if(s.operation!==operation||operation.kind!=='branch'||index<0)throw Error('分支请求已过期');
    this.change(state=>{
      state.results=state.results.slice(0,index+1);
      state.round=state.results.at(-1).round+1;
      state.branch={id:operation.id,resultId:operation.resultId,round:state.round-1};
      Object.assign(state,binding);
      state.operation=null;state.error='';
    });
  }
  failOperation(operation,error) {
    if(this.state.operation?.id===operation.id)this.change(s=>{s.operation=null;s.error=String(error).slice(0,500);});
  }
  chat(id, command) {
    if(this.state.phase==='ended') throw new Error('房间已经结束');
    const p=this.player(id);
    if(this.state.chat.some(m=>m.id===command.id&&m.playerId===id)) return;
    return this.change(s=>{
      const message = {id:text(command.id,80,'消息编号'),playerId:id,name:p.name,seat:p.seat,
        content:text(command.content,3000,'聊天消息'),time:Date.now()};
      s.chat.push(message);
      s.chat=s.chat.slice(-300);
      return message;
    });
  }
  clearChat() { this.change(s=>{s.chat=[];s.chatEpoch++;}); }
  end() { this.change(s=>{s.phase='ended';s.chat=[];s.chatEpoch++;s.error='';s.vote=null;s.operation=null;}); }
  view(id) {
    const s=this.state;
    const visibleActions=actions=>structuredClone(actions.map(a=>s.actionVisibility==='hidden'&&a.playerId!==id?{id:a.id,round:a.round,playerId:a.playerId,seat:a.seat,name:a.name,submitted:true}:a));
    return {lockedSeats:[...(s.lockedSeats||[false,false,false,false])],capacity:(s.lockedSeats||[false,false,false,false]).filter(x=>!x).length,actionVisibility:s.actionVisibility||'public',id:s.id,title:s.title,revision:s.revision,phase:s.phase,round:s.round,error:s.error,chatEpoch:s.chatEpoch,
      players:s.players.map(p=>p?{id:p.id,seat:p.seat,name:p.name,description:p.description,online:p.online,ready:p.ready}:null),
      scene:publicScene(s.scene),map:s.mapDescriptor,actions:visibleActions(s.actions),chat:structuredClone(s.chat),members:[...s.members],
      vote:s.vote&&structuredClone(s.vote),operation:s.operation?.kind??null,branch:s.branch&&structuredClone(s.branch),
      results:s.results.map(r=>{
        const status=r.players.find(p=>p.playerId===id)?.status||'';
        const story=r.displayStory??r.story;
        return {id:r.id,round:r.round,variant:r.variant??0,displayRevision:r.displayRevision??0,story,
          actions:visibleActions(r.actions),status,message:status?story+'\n\n'+status:story};
      })};
  }
  seats() { return this.state.players.map((p,i)=>p?{seat:p.seat,name:p.name,online:p.online}:this.state.lockedSeats?.[i]?{seat:i,locked:true}:null); }
}
