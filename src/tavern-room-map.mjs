import {createRoomMapStore,decodeRoomMap,encodeRoomMap,fromBase64,resourceHash,roomMapAssets,toBase64} from './room-map.mjs';

function exportedScripts(items) {
  return Array.isArray(items) ? items.map(script => {
    if (Array.isArray(script?.scripts)) return {...script,scripts:exportedScripts(script.scripts)};
    if (typeof script?.content !== 'string') return script;
    const copy = {...script};
    if (!script.export_with?.data) copy.data = {};
    if (!script.export_with?.button && script.button) copy.button = {...script.button,buttons:[]};
    return copy;
  }) : [];
}

function sharePreset(preset) {
  const extensions = preset.extensions ?? {};
  return {settings:preset.settings,prompts:preset.prompts,prompts_unused:preset.prompts_unused,
    extensions:{
      regex_scripts:extensions.regex_scripts ?? [],
      ...(extensions.tavern_helper?.scripts ? {tavern_helper:{scripts:exportedScripts(extensions.tavern_helper.scripts)}} : {}),
    }};
}

function bookContent(book) {
  const {miemie_lobby_map,miemie_lobby_room,...data} = book;
  return data;
}
function shareCard(card) {
  const extensions = card.data.extensions;
  if (extensions?.tavern_helper?.scripts) extensions.tavern_helper.scripts = exportedScripts(extensions.tavern_helper.scripts);
  if (extensions?.TavernHelper_scripts) extensions.TavernHelper_scripts = exportedScripts(extensions.TavernHelper_scripts);
  return card;
}

export function createTavernMapAdapter(host, context, helper) {
  const store = createRoomMapStore(host.indexedDB);
  let presetLease;

  async function request(path, payload) {
    const headers = {...context().getRequestHeaders()};
    const multipart = payload instanceof FormData;
    if (multipart) delete headers['Content-Type'];
    const response = await host.fetch(path, {
      method:'POST',headers,body:multipart ? payload : JSON.stringify(payload),
    });
    if (!response.ok) throw Error('酒馆资源同步接口返回 ' + response.status);
    return response;
  }
  const readBook = async name => (await request('/api/worldinfo/get',{name})).json();

  async function readCard(avatar) {
    const {spec,spec_version,data} = await (await request('/api/characters/export',{format:'json',avatar_url:avatar})).json();
    if (!data?.name) throw Error('酒馆没有导出有效的角色卡');
    return {spec,spec_version,data};
  }

  async function readAvatar(avatar) {
    const response = await host.fetch('/thumbnail?type=avatar&file=' + encodeURIComponent(avatar),{cache:'no-store'});
    if (!response.ok) throw Error('未能读取角色头像');
    // Some Tavern hosts return the full card PNG when thumbnail generation fails.
    // Strip embedded card metadata and hash the visible image only.
    const image = await host.createImageBitmap(await response.blob());
    try {
      const canvas = host.document.createElement('canvas');
      const scale = Math.min(1,512/Math.max(image.width,image.height));
      canvas.width = Math.max(1,Math.round(image.width*scale));
      canvas.height = Math.max(1,Math.round(image.height*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const png = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if (!png) throw Error('无法打包角色头像');
      return toBase64(new Uint8Array(await png.arrayBuffer()));
    } finally {
      image.close();
    }
  }

  async function captureRoomMap(roomId, ref) {
    if (!ref?.avatar || /[/\\]/.test(ref.avatar)) throw Error('请先打开有效角色卡的对话');
    const links = helper?.getCharWorldbookNames?.(ref.avatar);
    if (!links || typeof helper?.getChatWorldbookName !== 'function') throw Error('地图同步需要酒馆助手 4.11.3');
    const bookLinks = {primary:links.primary || null,additional:links.additional || [],chat:helper.getChatWorldbookName('current') || null};
    const names = [...new Set([bookLinks.primary,...bookLinks.additional,bookLinks.chat].filter(Boolean))].sort();
    const presetName = context().mainApi === 'openai' && helper.getLoadedPresetName?.();
    const preset = presetName && helper.getPreset ? {name:presetName,data:sharePreset(helper.getPreset('in_use'))} : null;
    const [card,avatar,books] = await Promise.all([
      readCard(ref.avatar),readAvatar(ref.avatar),
      Promise.all(names.map(async name => ({name,data:bookContent(await readBook(name))}))),
    ]);
    return {schema:1,roomId,card:shareCard(card),avatar,books,links:bookLinks,...(preset?{preset}:{})};
  }

  async function findLocalRoomMap(roomId, descriptor, isCurrent) {
    const resources = descriptor.resources;
    if (!resources || typeof resources.card!=='string' || !Array.isArray(resources.books) || resources.books.length>64) return null;
    const names = helper.getWorldbookNames();
    if (!resources.books.every(name=>typeof name==='string'&&names.includes(name))) return null;
    const candidates = context().characters.filter(card=>card.name===resources.card).slice(0,8);
    if (!candidates.length) return null;
    const books = await Promise.all(resources.books.map(async name=>({name,data:bookContent(await readBook(name))})));
    const preset = resources.preset;
    const possiblePresets = !preset ? [null] : helper.getPresetNames?.().includes(preset)
      ? [helper.getLoadedPresetName()===preset?'in_use':preset,preset].filter((name,index,names)=>names.indexOf(name)===index)
      : [];
    for (const candidate of candidates) {
      if (!isCurrent()) return null;
      const [card,avatar] = await Promise.all([readCard(candidate.avatar),readAvatar(candidate.avatar)]);
      for (const name of possiblePresets) {
        const map = {schema:1,roomId,card:shareCard(card),avatar,books,links:resources.links,
          ...(name?{preset:{name:preset,data:sharePreset(helper.getPreset(name))}}:{})};
        const wire = await encodeRoomMap(map);
        if (wire.descriptor.hash===descriptor.hash) return decodeRoomMap(descriptor,wire.data);
      }
    }
    return null;
  }

  async function installBook(book, roomId, check) {
    const desired = await resourceHash(book.data);
    const names = helper.getWorldbookNames();
    const namesToTry = [book.name,book.name + ' · 联机 ' + roomId.slice(0,8)];
    for (const name of namesToTry) {
      if (names.includes(name)) {
        const current = await readBook(name);
        if (await resourceHash(bookContent(current))===desired) return name;
        if (current.miemie_lobby_room!==roomId && await store.get('pending:'+name)!==roomId) continue;
      } else {
        check();
        await store.put('pending:'+name,roomId);
        if (!await helper.createWorldbook(name,[])) continue;
      }
      check();
      await context().saveWorldInfo(name,{...book.data,miemie_lobby_room:roomId},true);
      await store.remove('pending:'+name);
      return name;
    }
    throw Error('已有同名世界书，无法安全更新「'+book.name+'」');
  }

  async function installPreset(preset, roomId, check) {
    if (!preset) return null;
    if (!helper.getPreset || !helper.getPresetNames || !helper.createOrReplacePreset) throw Error('当前酒馆助手无法导入联机预设');
    const hash = await resourceHash(preset.data);
    const names = helper.getPresetNames();
    const alias = preset.name + ' · 联机 ' + roomId.slice(0,8);
    for (const name of [preset.name,alias]) {
      const key = 'preset:'+name;
      if (name==='in_use') continue;
      if (names.includes(name)) {
        if (await resourceHash(sharePreset(helper.getPreset(name)))===hash) return name;
        if (await store.get(key)!==roomId) continue;
      }
      check();
      await store.put(key,roomId);
      await helper.createOrReplacePreset(name,sharePreset(preset.data));
      return name;
    }
    throw Error('已有同名预设，无法安全更新「'+preset.name+'」');
  }

  function changeApi(api) {
    const selector = host.document.querySelector('#main_api');
    if (!selector || !Array.from(selector.options).some(option=>option.value===api)) return false;
    selector.value=api;
    selector.dispatchEvent(new host.Event('change',{bubbles:true}));
    return context().mainApi===api;
  }

  function openMapPreset(binding, force = false) {
    if (!binding?.presetName || !helper.loadPreset) return;
    if (presetLease?.name!==binding.presetName) {
      releaseMapPreset();
      presetLease = {name:binding.presetName,previous:helper.getLoadedPresetName(),api:context().mainApi};
    }
    if (context().mainApi!=='openai'&&!changeApi('openai')) throw Error('无法为联机对话应用聊天补全预设');
    if (binding.presetRegexes) {
      const c = context(), settings = c.extensionSettings;
      settings.preset_allowed_regex ??= {};
      settings.preset_allowed_regex.openai ??= [];
      if (!settings.preset_allowed_regex.openai.includes(binding.presetName)) {
        settings.preset_allowed_regex.openai.push(binding.presetName);
        c.saveSettingsDebounced();
      }
    }
    if (force || helper.getLoadedPresetName()!==binding.presetName) {
      if (!helper.loadPreset(binding.presetName)) throw Error('无法加载联机预设');
    }
  }

  function releaseMapPreset() {
    const lease = presetLease;
    presetLease = null;
    if (lease?.previous && lease.previous!==lease.name && helper.getLoadedPresetName()===lease.name) helper.loadPreset(lease.previous);
    if (lease?.api && lease.api!=='openai' && context().mainApi==='openai') changeApi(lease.api);
  }

  function refreshMapPreset(binding, inLinkedChat) {
    if (!inLinkedChat) releaseMapPreset();
    else if (!presetLease && binding?.presetName) openMapPreset(binding);
  }

  async function editCard(avatar, existing, card) {
    const data = card.data, extensions = data.extensions;
    const depth = extensions.depth_prompt ?? {};
    await request('/api/characters/edit',{
      ...data,ch_name:data.name,avatar_url:avatar,chat:existing.chat,create_date:existing.create_date,
      json_data:JSON.stringify(card),world:extensions.world,fav:String(existing.fav === true || existing.fav === 'true'),
      depth_prompt_prompt:depth.prompt,depth_prompt_depth:depth.depth,depth_prompt_role:depth.role,
      talkativeness:extensions.talkativeness,
    });
  }

  async function installRoomMap(map, hash, isCurrent, linked) {
    if (!helper?.createWorldbook || !helper?.getWorldbookNames || !helper?.rebindCharWorldbooks
        || !helper?.rebindChatWorldbook) throw Error('地图同步需要酒馆助手 4.11.3');
    const check = () => {
      if (!isCurrent()) throw Error('已退出地图同步');
    };
    const prefix = 'MieMieLobby-' + map.roomId;
    const avatar = prefix + '.png';
    const localChat = linked?.chatRef?.avatar===avatar ? linked.chatRef.chatId : 'MieMie Lobby ' + map.roomId;
    const cacheKey = 'guest:'+map.roomId;
    const cached = await store.get(cacheKey);
    const c = context();
    await c.getCharacters();
    check();
    const existing = context().characters.find(character => character.avatar === avatar);
    const originalMarker = existing?.data?.extensions?.miemie_lobby_map;
    if (existing && !/^[a-f0-9]{64}$/.test(originalMarker ?? '')) throw Error('本地已有同名联机卡，无法安全覆盖');

    const bookNames = new Map();
    for (const book of map.books) bookNames.set(book.name,await installBook(book,map.roomId,check));
    const presetName = await installPreset(map.preset,map.roomId,check);
    const card = structuredClone(map.card);
    card.data.extensions = {...card.data.extensions,world:bookNames.get(map.links.primary) || '',miemie_lobby_map:hash};
    const sourceCardHash = await resourceHash({card:map.card,world:card.data.extensions.world});
    const sourceAvatarHash = await resourceHash(map.avatar);
    const refreshCard = !existing || cached?.sourceCardHash!==sourceCardHash
      || await resourceHash(await readCard(avatar))!==cached.cardHash;
    const refreshAvatar = !existing || cached?.sourceAvatarHash!==sourceAvatarHash
      || await resourceHash(await readAvatar(avatar))!==cached.avatarHash;
    check();
    if (!existing) {
      const upload = new FormData();
      upload.set('file_type','json');
      upload.set('preserved_name',avatar);
      upload.set('avatar',new Blob([JSON.stringify(card)],{type:'application/json'}),prefix + '.json');
      const result = await (await request('/api/characters/import',upload)).json();
      if (result.file_name !== prefix && result.file_name !== avatar) throw Error('酒馆未按联机编号导入角色卡');
    } else if (refreshCard) await editCard(avatar,existing,card);
    check();
    if (refreshAvatar) {
      const image = new FormData();
      image.set('avatar_url',avatar);
      image.set('avatar',new Blob([fromBase64(map.avatar)],{type:'image/png'}),avatar);
      await request('/api/characters/edit-avatar',image);
    }

    check();
    await c.getCharacters();
    const index = context().characters.findIndex(character => character.avatar === avatar);
    if (index < 0) throw Error('找不到刚同步的角色卡');
    if (String(context().characterId)!==String(index)) await c.selectCharacterById(index);
    check();
    if (context().getCurrentChatId() !== localChat) await context().openCharacterChat(localChat);
    check();
    if (context().getCurrentChatId() !== localChat ||
        context().characters[context().characterId]?.avatar !== avatar) throw Error('无法打开联机角色的聊天');
    const primary = bookNames.get(map.links.primary) || null;
    const extra = [...new Set(map.links.additional.map(name => bookNames.get(name)))].filter(Boolean);
    const chatBook = bookNames.get(map.links.chat) || null;
    const localLinks = helper.getCharWorldbookNames('current');
    if ((localLinks.primary||null)!==primary || JSON.stringify(localLinks.additional||[])!==JSON.stringify(extra))
      await helper.rebindCharWorldbooks('current',{primary,additional:extra});
    check();
    if ((helper.getChatWorldbookName('current')||null)!==chatBook) await helper.rebindChatWorldbook('current',chatBook);
    check();
    const binding = {binding:String(context().characterId) + ':' + localChat,chatRef:{avatar,chatId:localChat},presetName,
      presetRegexes:roomMapAssets(map).enablePresetRegexes===true};
    if (presetName) openMapPreset(binding,true);
    else releaseMapPreset();
    await store.put(cacheKey,{
      hash,sourceCardHash,sourceAvatarHash,cardHash:await resourceHash(await readCard(avatar)),avatarHash:await resourceHash(await readAvatar(avatar)),
      books:await Promise.all(map.books.map(async book => ({name:bookNames.get(book.name),hash:await resourceHash(book.data)}))),
      presetName,presetHash:presetName?await resourceHash(sharePreset(helper.getPreset(presetName))):null,
      links:{primary,additional:extra,chat:chatBook},binding,
    });
    check();
    return binding;
  }

  async function verifyRoomMap(roomId, hash, isCurrent, linked) {
    const saved = await store.get('guest:'+roomId);
    if (saved?.hash!==hash) return null;
    const c = context(), ref = linked?.chatRef ?? saved.binding.chatRef;
    const avatar = ref.avatar;
    try {
      if (await resourceHash(await readCard(avatar))!==saved.cardHash ||
          await resourceHash(await readAvatar(avatar))!==saved.avatarHash) return null;
      for (const book of saved.books) {
        if (await resourceHash(bookContent(await readBook(book.name)))!==book.hash) return null;
      }
      if (saved.presetName && await resourceHash(sharePreset(helper.getPreset(saved.presetName)))!==saved.presetHash) return null;
      if (!isCurrent()) return null;
      const index = context().characters.findIndex(character=>character.avatar===avatar);
      if (index<0) return null;
      const links = helper.getCharWorldbookNames(avatar);
      if ((links.primary||null)!==saved.links.primary ||
          JSON.stringify(links.additional||[])!==JSON.stringify(saved.links.additional)) return null;
      if (String(context().characterId)!==String(index)) await c.selectCharacterById(index);
      if (!isCurrent()) return null;
      if (context().getCurrentChatId()!==ref.chatId) await c.openCharacterChat(ref.chatId);
      if (!isCurrent() || context().getCurrentChatId()!==ref.chatId ||
          context().characters[context().characterId]?.avatar!==avatar ||
          (helper.getChatWorldbookName('current')||null)!==saved.links.chat) return null;
      const binding = {...saved.binding,binding:String(index)+':'+ref.chatId,chatRef:ref};
      openMapPreset(binding);
      return binding;
    } catch {
      return null;
    }
  }

  function roomAssetsEnabled(binding, assets) {
    const avatar = binding.chatRef.avatar, preset = binding.presetName;
    const settings = context()?.extensionSettings;
    return (!assets.enableScripts || !!settings?.tavern_helper?.script?.enabled?.characters?.includes(avatar))
      && (!assets.enableRegexes || !!settings?.character_allowed_regex?.includes(avatar))
      && (!assets.enablePresetScripts || !!settings?.tavern_helper?.script?.enabled?.presets?.includes(preset))
      && (!assets.enablePresetRegexes || !!settings?.preset_allowed_regex?.openai?.includes(preset));
  }

  return {mapStore:store,captureRoomMap,findLocalRoomMap,installRoomMap,verifyRoomMap,roomAssetsEnabled,refreshMapPreset,releaseMapPreset};
}
