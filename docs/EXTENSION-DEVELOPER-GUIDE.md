# 咩咩联机大厅扩展接入指南

面向想共享润色状态、插图或旁白的 SillyTavern 扩展作者。最低大厅版本为 0.9.0，协作接口版本为 1。Tavern Helper 脚本或酒馆原生扩展都从酒馆主窗口接入。Hub 的入口注册与大厅的协作注册可以同时使用。

## 选择能力

| 声明 | 用途 |
| --- | --- |
| `status` | 向队友显示指定楼层的处理状态。适用于润色、翻译和生成进度。 |
| `image`、`audio` | 向指定楼层共享图片或音频文件。两种媒体可分别启用，也可以和 `status` 一起声明。 |

只需调用一次 `register(manifest)`。房主成功注册的扩展会出现在房间的「已支持的扩展」中。普通的酒馆正文写回和标准本地媒体附件可以由大厅自动同步。

## 注册与清理

```js
const host = window.parent?.SillyTavern ? window.parent : window;
let source, lobbyApi;

function connect(api) {
  if (api === lobbyApi || api?.apiVersion !== 1) return;
  source?.release();
  lobbyApi = api;
  source = api.register({
    id: 'example-illustrator',
    name: '示例插图',
    version: '1.0.0',
    capabilities: ['status', 'image'],
  });
}

const lobbyReady = event => connect(event.detail);
host.addEventListener('miemie:lobby:ready', lobbyReady);
connect(host.MieMieMultiplayerLobby);

function dispose() {
  host.removeEventListener('miemie:lobby:ready', lobbyReady);
  source?.release();
}
```

- `id` 使用稳定的小写 ID，以字母开头，可含数字、点、下划线和连字符，最多 64 个字符。同一 ID 在同一页面注册一次。`tavern-native` 由大厅保留。
- `version` 是扩展自己的版本，`apiVersion` 是大厅接口版本。扩展根据 `apiVersion` 决定是否连接。
- 大厅先加载时直接连接。扩展先加载时等待 `miemie:lobby:ready`。在扩展停用时撤销事件订阅并调用 `release()`。
- `release()` 会移除状态列表项并终止该扩展正在使用的楼层句柄。已经共享的附件随剧情保留。

## 在处理开始时绑定楼层

`source.forMessage(messageId)` 接受酒馆消息索引。省略时使用当前联机对话里最后一个已同步的 AI 回复。返回值是绑定这次任务的句柄，包含 `role` 与 `signal`。普通聊天、其他种类的消息或尚未写入酒馆的楼层返回 `null`。

打开联机对话后，扩展可以调用 `forMessage()`，根据 `role: 'host' | 'guest'` 决定谁生成。房主负责提交结果，来宾由大厅接收。请在请求生成之前捕获句柄并把 `signal` 传给可取消的请求。切换对话、分支、重 Roll 同一楼层、退房或停用扩展会让旧句柄失效。

### 只上报状态

用 `capabilities: ['status']` 注册。房主的楼层句柄提供 `reportStatus(state, label?)`，其中 `state` 为 `working`、`complete` 或 `failed`。可选说明最多 120 个字符，用于向队友展示公开的简短进度。

扩展照常通过酒馆接口写回同一楼正文，保留 `<status>…</status>` 区块和大厅的楼层标记 `extra.miemie_lobby_result`。保存后上报完成。大厅监听酒馆更新事件，合并连续写回，按各玩家视角同步展示正文。模型输入继续由负责该请求的脚本与设置决定。原有等待处理接口仍可用于已有集成，见 [回合处理 API](ROUND-PROCESSOR-API.md)。

### 提交图片或音频

```js
async function shareIllustration(messageId, generateImage) {
  const floor = source?.forMessage(messageId);
  if (floor?.role === 'guest') return;

  floor?.reportStatus?.('working', '插图生成中');
  try {
    const file = await generateImage({ signal: floor?.signal });
    if (!floor?.signal.aborted) {
      await floor?.publishAttachment({
        path: 'images/车站/插图.png',
        file,
      });
      floor?.reportStatus?.('complete', '插图生成完成');
    }
    return file;
  } catch (error) {
    if (!floor?.signal.aborted) floor?.reportStatus?.('failed', '插图生成失败');
    throw error;
  }
}
```

- `file` 是已有结果的 `Blob` 或 `File`，必须设置准确的 MIME 类型。支持 PNG、JPEG、WebP、GIF、AVIF、MP3、Ogg、WAV、WebM 音频和 M4A。只有房主的句柄提供附件写入。
- `path` 为楼层内的相对路径，例如 `audio/第12回合/旁白.mp3`。每个玩家看到相同的目录和文件名，下载使用末尾的文件名。文件字节保存在各自酒馆浏览器的本地缓存中。
- 同一扩展可在同一楼层用相同路径替换文件，或用 `removeAttachment(path)` 从楼层移除它。每个文件最多 16 MiB，每楼最多 24 个、每房间最多 256 个，房间本地缓存最多 128 MiB。缓存包含已接收的旧版本。
- `publishAttachment()` 返回 `{path, type, bytes, hash}`，表示房主已保存可分发的文件。各来宾校验并保存完毕后独立确认送达。大厅按内容校验值复用文件，重连补齐本地缺件。
- 原生同步覆盖已经绑定到联机剧情楼层的 `extra.media` 和旧版 `extra.image` 内受支持的酒馆本地文件。扩展管理的缓存、临时 URL 或自己渲染的图片，可在生成完成时将文件交给大厅。
- 内容跟随楼层的生成版本。重 Roll 后旧版本附件退出当前剧情，创建分支时仅继承分叉点之前的有效楼层。大厅在酒馆对应楼层和回合行动记录提供预览。

## 订阅状态与验收

可选的 `source.subscribe(listener)` 返回取消订阅函数。回调接收当前房间的 `roomId`、`branchId`、`extensions` 和附件送达统计，退出房间后收到 `null`。扩展上报的是自己任务的状态。文件送达人数和文本版本的收件确认由大厅统计。

至少测试普通单人聊天、房主与来宾各一个，以及来宾刷新后重连。检查状态列表、文件字节相同、路径相同、旧楼层任务结束后不会写入新分支。接入图片或音频的扩展可用同一个房间检查来宾只接收成品，模型的连接、密钥和请求配置由房主端扩展保留。
