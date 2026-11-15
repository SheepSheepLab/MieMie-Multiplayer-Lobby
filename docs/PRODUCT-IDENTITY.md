# 产品身份与工程命名

中文产品名：咩咩联机大厅。英文产品名：MieMie Multiplayer Lobby。
工程根目录与 GitHub 仓库名：`MieMie-Multiplayer-Lobby`。
Repository / Homepage：`https://github.com/SheepSheepLab/MieMie-Multiplayer-Lobby`。
npm 包名：`miemie-multiplayer-lobby`。产品 Author：`SheepSheep`；维护命名空间：`SheepSheepLab`。

`product.mjs` 是展示身份来源；既有 `src/presentation/product-identity.ts` 继续提供运行时入口，版本来自 `package.json`。0.5.1 起，主标题显示中文产品名与版本，副标题显示酒馆当前角色。
源码模块继续采用现有小写连字符命名；标准工程文件使用 `package.json`、`package-lock.json`、`build.mjs`、`README.md`、`BRAND.md`、`LICENSE`。不把每个内部模块改成产品全名。历史文档、测试视频及旧安装包保留原名、原语义。

## 稳定身份

- Tavern Helper Script ID：`4f0fd529-265d-47ba-9001-07ab3b830b2b`。
- 单实例标识：`__miemieMultiplayerLobbyV1`。
- 房主存档：`mm-lobby-host-v1`。
- 来宾凭据前缀：`mm-lobby-token:`、`mm-lobby-token3:`；房主指纹前缀：`mm-lobby-pin:`。
- 悬浮球设置：`miemie_multiplayer_lobby_launcher_appearance_v1`；主球位置：`miemie_multiplayer_lobby_dock_v1`。
- 长邀请 `MM1`、短号完整邀请 `MM3`、Peer 身份与网络消息格式均保持。

上述标识不随展示名、目录名和产品版本变更。业务及辅助窗口其他存储键也未改动。
Hub Extension ID 自 0.5.0 起为 `miemie.multiplayer-lobby`。Manifest、Runtime 注册与包身份行使用同一 ID。

## 兼容与授权

0.5.0 接入 Hub Runtime API 2 和 Package / Manifest / Metadata / Build Identity Schema v1，继续使用既有房间协议。
0.5.0 起，安装包使用 `MieMie-Multiplayer-Lobby-Extension-<version>.json`，机器更新元数据使用 `MieMie-Extension-update.json`。早期独立包仍使用 `MieMie-Multiplayer-Lobby-<version>.json`。
0.4.8 的独立脚本阶段结论保留在 [0.4.8 界面与 Hub 兼容性验收](EXPERIENCE-AND-HUB-AUDIT-0.4.8.md)。0.5.0 阶段的本地验证见 [0.5.0 Hub 兼容验收](HUB-COMPATIBILITY-0.5.0.md)。
软件为 GPL-3.0-or-later；图标与品牌遵循独立 ASSETS-LICENSE.md、BRAND.md。复用展示模块的真实贡献和许可证继续保留在 THIRD_PARTY_NOTICES.txt、provenance.json 与原代码中。
