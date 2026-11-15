# 0.4.5 命名校准记录

日期：2026-11-14。本记录是本地开发基线校准，不是正式发布验收。

## 依据与结果

已读取本项目品牌、授权、来源记录及说明，并对照当前 MieMie Hub 身份文档、README、BRAND，以及预设管理、润色工具、故事导演的官方身份字段。本机对应工程目录采用 `MieMie-Preset-Manager`、`MieMie-Polisher`、`MieMie-Story-Director` 等命名。

| 项目 | 校准结果 |
| --- | --- |
| 中文名 | 咩咩联机大厅 |
| 英文名 | MieMie Multiplayer Lobby |
| 工程目录／规划仓库名 | MieMie-Multiplayer-Lobby |
| npm 包名 | miemie-multiplayer-lobby |
| 产品 author | SheepSheep |
| GitHub 维护命名空间 | SheepSheepLab |
| 实际开发基线 | 0.4.5 |
| 当前安装文件 | dist/MieMie-Multiplayer-Lobby-0.4.5.json |

## 修改范围

- 工程根目录从 `multiplayer-lobby` 改为 `MieMie-Multiplayer-Lobby`。
- `README.txt` 改为 `README.md`，增量补充当前状态，原历史内容完整保留。
- 新增 `product.mjs` 作为展示身份来源，运行时身份入口引用它；版本统一读取 `package.json`。
- 构建时校验纯三段版本、产品身份及锁文件一致性，安装文件和显示版本共同使用版本源。
- 新增 `.gitignore`、产品身份说明、版本规范及本记录；核心差异见 `NAMING-CHANGES-0.4.5.diff`。
- 保留历史文档、历史产物文件名、第三方署名、版权和来源记录。未新增正式 Manifest。

修改前后源码与资产摘要比较显示：原有 `src/` 与 `assets/` 中仅产品身份入口发生变化。业务代码、存储键、邀请格式、网络协议、脚本 UUID、图标与样式保持原状。

## 验证

- `npm test`：29 / 29 通过。首次受限环境运行有 3 项因本机端口监听 EPERM 失败；允许本机测试服务后全部通过。
- `node tests/ui-regression.mjs`：通过；涵盖桌面与移动布局、焦点和清理，以及点击关闭的循环仪式、16 个粒子与设置图标悬停。
- `npm run build`：通过。目录更名后连续两次构建字节一致；这是同一工作目录的重复构建，不代表独立洁净环境可复现性认证。
- 当前安装 JSON SHA-256：`a4c19064919c4c5c243e83f479679e851c1ec83cb438948f59f70a1f7165cb30`。
- Safari 的独立验收酒馆已导入本轮构建，停用原 0.4.5 条目并启用新条目，观察到大厅正常打开并显示 0.4.5。旧条目保留供回退。

## 范围边界与发布前待办

当前工程没有本地 Git 历史。本轮没有 Commit、Push、Tag、Release，也未核验目标远程仓库完整历史或创建远程仓库；规划仓库地址不代表已发布。现有 Git 配置身份符合 Owner 要求，但未来任何提交或发布仍须重新执行包含环境变量的实际身份预检与待发布内容检查，签名及 GitHub Verified 状态本轮未验收。

对工程文本（排除依赖、构建和测试产物）及当前安装脚本进行了本机路径、私钥头和常见 GitHub token 格式检查，未发现匹配；这不是完整秘密扫描或 Git 历史审计。历史打包文件没有重新封装或批准公开分发。

本轮没有重新进行真实跨网络多人联机、实际 AI 请求或实体 iOS 设备测试。Hub Runtime Compatibility 未验收，Managed Package Compatibility 未实现；独立脚本在酒馆打开不代表支持 Hub 在线安装更新。
