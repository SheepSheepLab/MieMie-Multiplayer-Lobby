# 回合处理 API

咩咩联机大厅 0.8.0 在酒馆主窗口提供版本 1 的回合处理接口。脚本可注册润色、翻译或记忆更新，在房主生成完整回复后处理，然后由大厅写入房主和来宾各自的联机聊天。房主可在房间的「脚本同步」里启停已注册的处理器。

```js
const host = window.parent?.SillyTavern ? window.parent : window;
let unregister;

function register(api) {
  if (api?.version !== 1) return;
  unregister?.();
  unregister = api.registerRoundProcessor({
    id: 'example-memory',
    name: '记忆处理',
    isEnabled: () => settings.autoRemember,
    async process({raw, round, attemptId, kind, signal}) {
      await updateMemory({raw, round, attemptId, kind, signal});
    },
  });
}

const lobbyReady = event => register(event.detail);
host.addEventListener('miemie:lobby:ready', lobbyReady);
register(host.MieMieMultiplayerLobby);

// 脚本停用时调用。
function dispose() {
  host.removeEventListener('miemie:lobby:ready', lobbyReady);
  unregister?.();
}
```

- `id` 为稳定 ID，由字母开头，可包含字母、数字、点、下划线和连字符。一个主窗口同一时间可注册一个同名 ID。
- `kind` 为 `round` 或 `reroll`。返回新的字符串可替换回复，返回 `undefined` 保存当前回复。请用 `attemptId` 给副作用去重，重试会获得新编号。
- 返回 Promise 可让大厅等到处理完成。对回调式 API，在 `process` 调用期间用 `const hold = defer()` 获取本次等待的控制柄，再调用 `hold.complete(text?)` 或 `hold.fail(error)`。完成一个处理器后继续后续处理器，全部完成后大厅提交一次。
- 每个处理器最多等待 120 秒。出错或超时时大厅保留原有剧情和行动，房主可以重试或停用对应处理器。取消生成、离开绑定聊天或结束房间会触发 `AbortSignal`。脚本应同时终止自己的请求并丢弃迟到结果。
- 原文含每位玩家独立的状态段。改写公开剧情时应保留 `<userN><status>…</status></userN>`。如果需调用外部服务，应只发送该处理所需内容。已保存的联机楼层带有 `extra.miemie_lobby_result`，处理器在发布前工作。
