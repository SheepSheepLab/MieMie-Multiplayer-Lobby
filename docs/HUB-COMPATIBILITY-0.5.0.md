# 咩咩联机大厅 0.5.0 与咩咩 Hub 的兼容验收

对照咩咩 Hub 1.1.0、咩咩预设管理 1.1.0、咩咩润色工具 1.6.0 与咩咩故事导演 1.1.0 的 Runtime API 2 和 Managed Package v1。产品 Author 为 SheepSheep，发布命名空间为 SheepSheepLab。复用代码和原始产品图标的署名与授权见仓库现有声明。

## Runtime Compatibility

- 页面中只有一个大厅面板和联机控制器。蜂窝入口通过 Hub Surface 打开；扩展详情可控制独立悬浮球，潜航、大小和位置使用大厅自己的设置。
- Hub 前台显示时，回合行动和队伍聊天室在大厅面板内打开。回到酒馆后，两个悬浮球显示操作与未读提示。两种入口共用同一组草稿。
- 仅重载 Hub 时，等待旧 Hub 清理后交接入口，已连接的房间继续运行。通过 Hub 停用或注销大厅时，停止联机并撤回运行入口和临时生成钩子。若在 Hub 停用后关闭 Hub，独立悬浮球也保持停用。重新启用大厅可使用“恢复房主存档”。
- Chromium 与 WebKit 使用正式 Hub 1.1.0 脚本和本机真实两人 WebRTC，验证双启动顺序、蜂窝与独立入口交接、草稿、返回、开局确认、提交行动、Hub 重载、生成中停用、替换脚本和窄屏。

## Managed Package Compatibility

- 构建生成 `MieMie-Multiplayer-Lobby-Extension-0.5.0.json` 和 `MieMie-Extension-update.json`。Manifest / Build Identity / 机器更新元数据均为 Schema 1。安装包沿用大厅固定导出 ID，安装实例 ID 由宿主分配。
- 使用真实 Hub 包管理器、模拟 GitHub Release 及测试酒馆助手全局脚本树，通过发行字节校验、篡改拒绝、安全安装、更新保留原实例与 data、物理卸载。模拟更新版本仅用于测试。
- 从 0.4.x 迁移时，通过酒馆助手停用旧条目并导入新版。早期包缺少 Hub 构建身份行，Hub 无法自动判定它们是可在线升级的安装实例。大厅的本地房主存档与入口设置沿用原键。
- 正式在线安装与更新取决于公开 GitHub Release、两个资产的 GitHub SHA-256 digest，以及可达的下载服务。Hub 公开目录上架及官方分类由 Registry 的治理流程确认。

## 复测

先执行 `npm ci` 与 `npm run build`。普通回归运行 `npm test`、`node tests/ui-regression.mjs`、`node tests/short-browser.mjs`。运行 `node tests/hub-runtime.mjs` 时，通过 `MIEMIE_HUB_PACKAGE` 指定 Hub 1.1.0 JSON，设置 `MIEMIE_UI_BROWSER=webkit` 可复测 WebKit。运行 `node tests/hub-package.mjs` 时，默认从同级 `MieMie-Hub` 读取源码，或通过 `MIEMIE_HUB_SOURCE` 指定。浏览器回归使用本机网络和测试模型响应。
