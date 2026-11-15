const timeoutMs = 120000;
const idPattern = /^[a-z][a-z0-9._-]{0,63}$/i;

export function createRoundProcessors(onChange=()=>{}) {
  const registered = new Map();
  let active, finished;

  function register(descriptor) {
    const {id,name,process,isEnabled} = descriptor ?? {};
    if (!idPattern.test(id ?? '') || typeof name !== 'string' || !name.trim() || typeof process !== 'function') {
      throw new TypeError('需要提供脚本 id、名称与处理函数');
    }
    if (registered.has(id)) throw Error('该联机脚本接口 ID 已注册');
    const entry = {id,name:name.trim().slice(0,100),process,isEnabled};
    registered.set(id,entry);
    onChange();
    return () => {
      if (registered.get(id)===entry) {
        registered.delete(id);
        onChange();
      }
    };
  }

  const usable = ({isEnabled}) => {
    try{return !isEnabled || isEnabled()===true;}catch{return false;}
  };
  function list(disabled=[],round) {
    const states = active?.states ?? (finished?.round===round-1 ? finished.states : undefined);
    return [...registered.values()].map(entry=>({
      id:entry.id,name:entry.name,enabled:!disabled.includes(entry.id),available:usable(entry),
      state:states?.get(entry.id) ?? 'idle',
    }));
  }

  function cancel() {
    active?.controller.abort();
  }

  async function run(raw, round, attemptId, kind, disabled, update) {
    if (active) throw Error('上一轮脚本仍在收尾');
    finished = null;
    const processors = [...registered.values()].filter(entry=>!disabled.includes(entry.id)&&usable(entry));
    if (!processors.length) return raw;
    const controller = new AbortController();
    const signal = controller.signal;
    const states = new Map(processors.map(({id})=>[id,'waiting']));
    const session = active = {controller,states};
    try {
      update();
      for (const {id,name,process} of processors) {
        if (signal.aborted) throw Error('已取消本轮同步');
        states.set(id,'running');
        update();
        let timer, onAbort;
        let finish, fail;
        let deferred = false;
        const completion = new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
        const interruption = new Promise((_,reject)=>{
          onAbort = ()=>reject(Error('已取消本轮同步'));
          signal.addEventListener('abort',onAbort,{once:true});
          timer = setTimeout(()=>reject(Error('等待「'+name+'」处理超时')),timeoutMs);
        });
        try {
          const work = Promise.resolve().then(()=>process(Object.freeze({
            raw,round,attemptId,kind,signal,
            defer(){
              deferred = true;
              return Object.freeze({complete:finish,fail});
            },
          }))).then(result=>deferred?completion:result);
          // A callback may fail synchronously before the processor has returned.
          completion.catch(()=>{});
          const next = await Promise.race([work,interruption]);
          if (next!==undefined && typeof next!=='string') throw Error('「'+name+'」返回了无效的回复');
          if (typeof next==='string') raw=next;
        } catch(error) {
          states.set(id,'failed');
          update();
          throw error;
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort',onAbort);
        }
        states.set(id,'done');
        update();
      }
      return raw;
    } finally {
      controller.abort();
      finished = {round,states};
      if (active===session) active=null;
    }
  }

  return {register,list,run,cancel};
}
