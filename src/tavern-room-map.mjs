import {createRoomMapStore,fromBase64,toBase64} from './room-map.mjs';

export function createTavernMapAdapter(host, context, helper) {
  const store = createRoomMapStore(host.indexedDB);

  async function request(path, payload) {
    const headers = {...context().getRequestHeaders()};
    const multipart = payload instanceof FormData;
    if (multipart) delete headers['Content-Type'];
    const response = await host.fetch(path, {
      method: 'POST', headers, body: multipart ? payload : JSON.stringify(payload),
    });
    if (!response.ok) throw Error('酒馆资源同步接口返回 ' + response.status);
    return response;
  }

  async function captureRoomMap(roomId, ref) {
    if (!ref?.avatar || ref.avatar.includes('/') || ref.avatar.includes('\\')) throw Error('请先打开有效角色卡的对话');
    const links = helper?.getCharWorldbookNames?.(ref.avatar);
    if (!links || typeof helper?.getChatWorldbookName !== 'function') throw Error('地图同步需要酒馆助手 4.11.3');
    const bookLinks = {...links, chat: helper.getChatWorldbookName('current')};
    const names = [...new Set([bookLinks.primary, ...bookLinks.additional, bookLinks.chat].filter(Boolean))];
    const exportCard = async () => {
      const exported = await request('/api/characters/export', {format:'json',avatar_url:ref.avatar});
      const {spec,spec_version,data} = await exported.json();
      if (!data?.name) throw Error('酒馆没有导出有效的角色卡');
      const prepareScripts = items => {
        if (!Array.isArray(items)) return;
        for (const script of items) {
          if (typeof script?.content === 'string') {
            if (!script.export_with?.data) script.data = {};
            if (!script.export_with?.button && script.button) script.button.buttons = [];
          }
          prepareScripts(script?.scripts);
        }
      };
      prepareScripts(data.extensions?.tavern_helper?.scripts ?? data.extensions?.TavernHelper_scripts);
      return {spec,spec_version,data};
    };
    const exportAvatar = async () => {
      const avatar = await host.fetch('/thumbnail?type=avatar&file=' + encodeURIComponent(ref.avatar));
      if (!avatar.ok) throw Error('未能读取角色头像');
      return toBase64(new Uint8Array(await avatar.arrayBuffer()));
    };
    const readBooks = async () => Promise.all(names.map(async name => ({
      name,
      data: await context().loadWorldInfo(name),
    })));
    const [card,avatar,books] = await Promise.all([exportCard(),exportAvatar(),readBooks()]);
    return {schema:1,roomId,card,avatar,books,links:bookLinks};
  }

  async function installRoomMap(map, hash, isCurrent) {
    if (!helper?.createWorldbook || !helper?.getWorldbookNames || !helper?.rebindCharWorldbooks
        || !helper?.rebindChatWorldbook) throw Error('地图同步需要酒馆助手 4.11.3');
    const check = () => {
      if (!isCurrent()) throw Error('已退出地图同步');
    };
    const prefix = 'MieMieLobby-' + map.roomId;
    const avatar = prefix + '.png';
    const localChat = 'MieMie Lobby ' + map.roomId;
    const bookNames = new Map();
    const c = context();
    await c.getCharacters();
    check();
    const existing = context().characters.find(character => character.avatar === avatar);
    if (existing && existing.data?.extensions?.miemie_lobby_map !== hash) {
      throw Error('本地已有同名联机卡，无法安全覆盖');
    }

    for (const [index, book] of map.books.entries()) {
      check();
      const name = prefix + '-world-' + (index + 1);
      bookNames.set(book.name, name);
      if (helper.getWorldbookNames().includes(name)) {
        const data = await (await request('/api/worldinfo/get', {name})).json();
        if (data.miemie_lobby_map !== hash) {
          const empty = data.miemie_lobby_map == null && Object.keys(data.entries ?? {}).length === 0;
          if (!empty || await store.get('pending:' + name) !== hash) throw Error('本地已有同名联机世界书，无法安全覆盖');
        }
      } else {
        await store.put('pending:' + name, hash);
        if (!await helper.createWorldbook(name, [])) throw Error('无法创建联机世界书');
      }
      check();
      await c.saveWorldInfo(name,{...book.data,miemie_lobby_map:hash},true);
      await store.remove('pending:' + name);
    }
    if (!existing) {
      const card = structuredClone(map.card);
      card.data.extensions = {...card.data.extensions, world:bookNames.get(map.links.primary) || '',miemie_lobby_map:hash};
      if (card.data.character_book) card.data.character_book.name = prefix + '-embedded';
      const upload = new FormData();
      upload.set('file_type','json');
      upload.set('preserved_name',avatar);
      upload.set('avatar',new Blob([JSON.stringify(card)],{type:'application/json'}),prefix + '.json');
      check();
      const result = await (await request('/api/characters/import',upload)).json();
      if (result.file_name !== prefix && result.file_name !== avatar) throw Error('酒馆未按联机编号导入角色卡');
    }

    check();
    const image = new FormData();
    image.set('avatar_url',avatar);
    image.set('avatar',new Blob([fromBase64(map.avatar)],{type:'image/png'}),avatar);
    await request('/api/characters/edit-avatar',image);
    await c.getCharacters();
    check();
    const index = context().characters.findIndex(character => character.avatar === avatar);
    if (index < 0) throw Error('找不到刚同步的角色卡');
    await c.selectCharacterById(index);
    check();
    if (context().getCurrentChatId() !== localChat) await context().openCharacterChat(localChat);
    check();
    if (context().getCurrentChatId() !== localChat ||
        context().characters[context().characterId]?.avatar !== avatar) throw Error('无法打开联机角色的聊天');
    const extra = [...new Set(map.links.additional.map(name => bookNames.get(name)))].filter(Boolean);
    if (extra.length) await helper.rebindCharWorldbooks('current',{additional:extra});
    check();
    if (map.links.chat) await helper.rebindChatWorldbook('current',bookNames.get(map.links.chat));
    check();
    return {binding:String(context().characterId) + ':' + localChat,chatRef:{avatar,chatId:localChat}};
  }

  function roomAssetsEnabled(binding, assets) {
    const avatar = binding.chatRef.avatar;
    const settings = context()?.extensionSettings;
    return (!assets.enableScripts || !!settings?.tavern_helper?.script?.enabled?.characters?.includes(avatar))
      && (!assets.enableRegexes || !!settings?.character_allowed_regex?.includes(avatar));
  }

  return {mapStore:store,captureRoomMap,installRoomMap,roomAssetsEnabled};
}
