const idPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const capabilities = new Set(['status','image','audio']);
const states = new Set(['working','complete','failed']);

export function createLobbyExtensionApi(controller) {
  const sources = new Map();
  let closed = false;
  let statusRoom;
  const statuses = new Map();
  const watchers = new Set();

  function manifestOf(input) {
    const {id,name,version,capabilities: requested = []} = input ?? {};
    if (!idPattern.test(id ?? '') || id==='tavern-native' || typeof name!=='string' || !name.trim() || name.length>100
        || typeof version!=='string' || !version.trim() || version.length>40
        || !Array.isArray(requested) || !requested.every(value=>capabilities.has(value))) {
      throw new TypeError('联机扩展注册资料或能力无效');
    }
    return Object.freeze({id,name:name.trim(),version,capabilities:Object.freeze([...new Set(requested)])});
  }

  function roomStatuses() {
    if (statusRoom!==controller.room) {
      statusRoom = controller.room;
      statuses.clear();
    }
    return statuses;
  }

  function publishState() {
    if (controller.room && !controller.closed) controller.broadcast();
  }

  function register(input) {
    if (closed) throw Error('联机大厅已停止');
    const manifest = manifestOf(input);
    if (sources.has(manifest.id)) throw Error('该联机扩展 ID 已注册');
    if (sources.size>=48) throw Error('此页面注册的联机扩展过多');
    const source = {manifest,scopes:new Map(),watchers:new Set()};
    sources.set(manifest.id,source);
    publishState();

    function forMessage(messageId) {
      if (closed || sources.get(manifest.id)!==source) return null;
      const target = controller.captureFloor(messageId);
      if (!target) return null;
      const key = [target.roomId,target.branch,target.resultId,target.variant].join(':');
      const existing = source.scopes.get(key);
      if (existing && !existing.abort.signal.aborted && controller.isCurrentFloor(existing.target))return existing.api;
      const abort = new AbortController();
      const current = () => !abort.signal.aborted && controller.isCurrentFloor(target);
      function requireCurrent() {
        if (!current()) throw Error('联机楼层已切换或过期');
      }
      const reportStatus = (state,label='') => {
        requireCurrent();
        if (!states.has(state) || typeof label!=='string' || label.length>120) throw Error('联机扩展状态无效');
        const entries = roomStatuses();
        const previous = entries.get(manifest.id);
        if (previous?.resultId===target.resultId && previous.variant===target.variant && previous.branch===target.branch
            && previous.state===state && previous.label===label.trim()) return;
        entries.set(manifest.id,{resultId:target.resultId,variant:target.variant,branch:target.branch,
          state,label:label.trim()});
        publishState();
      };
      const publishAttachment = async ({path,file}={}) => {
        requireCurrent();
        const kind = typeof file?.type==='string' ? file.type.split('/')[0] : null;
        if (!manifest.capabilities.includes(kind)) throw Error('该扩展未声明此附件能力');
        return controller.publishAttachment(target,manifest.id,path,file,kind,current);
      };
      const removeAttachment = path => {
        requireCurrent();
        return controller.removeAttachment(target,manifest.id,path);
      };
      const api = Object.freeze({
        role:target.role,signal:abort.signal,
        ...(target.role==='host'&&manifest.capabilities.includes('status')?{reportStatus}:{}),
        ...(target.role==='host'&&manifest.capabilities.some(value=>value!=='status')?{publishAttachment,removeAttachment}:{}),
      });
      source.scopes.set(key,{target,abort,api});
      return api;
    }

    function release() {
      if (sources.get(manifest.id)!==source) return;
      sources.delete(manifest.id);
      source.scopes.forEach(({abort})=>abort.abort());
      source.watchers.forEach(watcher=>watchers.delete(watcher));
      roomStatuses().delete(manifest.id);
      publishState();
    }

    return Object.freeze({
      forMessage,
      release,
      subscribe(listener) {
        if (typeof listener!=='function') throw new TypeError('状态订阅需要函数');
        if (sources.get(manifest.id)!==source) return ()=>{};
        const watcher = {listener,last:null};
        watchers.add(watcher);
        source.watchers.add(watcher);
        queueMicrotask(notify);
        return ()=>{watchers.delete(watcher);source.watchers.delete(watcher);};
      },
    });
  }

  function list() {
    const entries = roomStatuses();
    const state = controller.room?.state;
    return [...sources.values()].map(({manifest})=>{
      const entry = entries.get(manifest.id);
      const current = entry&&entry.branch===(state?.branch?.id??null)
        && state?.results.some(result=>result.id===entry.resultId&&result.variant===entry.variant);
      return {...manifest,status:current?{...entry}:null};
    });
  }

  function notify() {
    for (const source of sources.values()) {
      for (const [key,scope] of source.scopes) {
        if (!controller.isCurrentFloor(scope.target)) {
          scope.abort.abort();
          source.scopes.delete(key);
        }
      }
    }
    if (!watchers.size) return;
    const view = controller.view;
    const snapshot = view?{
      roomId:view.id,
      branchId:view.branch?.id??null,
      extensions:view.extensions??[],
      attachments:(view.results??[]).flatMap(result=>(result.attachments??[]).map(entry=>({
        round:result.round,resultId:result.id,path:entry.path,receipts:entry.receipts??null,
      }))),
    }:null;
    const signature = JSON.stringify(snapshot);
    for (const watcher of watchers) {
      if (signature===watcher.last) continue;
      watcher.last=signature;
      try{watcher.listener(JSON.parse(signature));}catch(error){console.warn('[咩咩联机大厅] 联机状态订阅回调失败',error);}
    }
  }

  function dispose() {
    closed = true;
    for (const source of sources.values()) source.scopes.forEach(({abort})=>abort.abort());
    sources.clear();
    statuses.clear();
    watchers.clear();
  }

  return {register,list,notify,dispose};
}
