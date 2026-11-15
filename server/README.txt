咩咩联机大厅 · 可选房间目录服务 0.2.0（本机验收版）

当前没有公网部署，也没有绑定官方服务器。此方案不是已确定的最终架构：可继续评估直接利用既有 PeerJS 信令分配短号，减少独立目录服务。

本机启动：node server/directory.mjs
默认仅监听 127.0.0.1:18796。脚本创建/加入房间时填写 http://127.0.0.1:18796；此地址仅用于同机测试，不可发给异地玩家。
外网部署需独立 HTTPS 地址，服务端不应直接暴露未加密 HTTP。不要因此修改现有 Registry 服务。

接口
POST /rooms：注册连接信息、可选密码与随机房主管理凭据，返回 6 位房间号。
POST /rooms/:code/resolve：正确密码才返回连接信息；无密码房间使用空密码。
POST /rooms/:code/heartbeat：房主管理凭据续租。
DELETE /rooms/:code：房主管理凭据结束登记。
GET /health：只返回服务健康状态。

边界
只保存房间连接信息、加盐 scrypt 密码散列、管理凭据散列及过期时间；不接收角色、行动、剧情、AI 密钥或聊天记录。
登记保存在内存中，默认租期 5 分钟，房主页面定时续租。服务重启或租期结束后号码失效；已建立的玩家连接不依赖目录持续运行。
结束时删除登记；若目录不可达，登记到期后自动失效。过期密码房恢复时必须重新输入密码，不能悄悄变成无密码房。
有号码碰撞重试、请求大小限制、IP/房间尝试限流和密码计算并发限制。无身份账户或高级反滥用系统，不应把本机验收当作公开服务安全验收。
反向代理部署前需专门配置客户端 IP 信任边界与限流；本版本只认 socket 来源地址，不信任任意 X-Forwarded-For。
公共目录服务能看到连接登记，必须信任其运营者；密码通过 HTTPS 提交。本版本不声称零信任目录。
STUN / TURN 与 PeerJS 信令是另外的职责。部署目录不能自动解决大陆可达性或 NAT 穿透。

0.7.2 Cloudflare TURN 私测配置

独立的 turn-worker.mjs 向 Cloudflare Realtime TURN 请求 24 小时凭据，供客户端通过 GET /v1/ice 自动获取。房间仍使用 PeerJS 信令。该接口不接收房间号、房间密码、角色资源或行动。

在 Cloudflare 建立独立的 Realtime TURN key，使用 wrangler.turn.jsonc 部署 Worker。部署后用 Worker Secrets 设置 MIEMIE_TURN_KEY_ID 和 MIEMIE_TURN_KEY_TOKEN。部署时核对两个限流命名空间在该账号下为独立用途。限流按 Cloudflare 节点计算，账户级用量以服务商统计为准。

用 Worker 可公开访问的 HTTPS /v1/ice 地址设置构建环境变量 MIEMIE_TURN_CREDENTIAL_URL，再运行 npm run build。使用两条实际网络测试成品，确认房主和来宾无需填写高级设置即可发起连接。若需独立检查中继，验证浏览器实际选用 relay 候选及 TLS 443 可达性。

0.7.2 自建 TURN 部署

server/turn 包含 coturn、凭据接口、systemd 和 Caddy 的部署模板。香港测试版继续使用 PeerJS 公共信令。coturn 转发 WebRTC 数据，凭据接口只签发限期凭据。房主本地保存角色资源和房间数据。

1. Ubuntu 安装 coturn，提供 /opt/miemie-node/bin/node（项目使用 Node.js 24）。服务器上的自建服务通过独立 systemd 单元运行。Ubuntu 的默认 coturn.service 应保持停用，避免重复监听。
2. 从此次 GitHub Release 对应的源码包运行 bash server/turn/configure.sh <域名> <公网IPv4> <网卡IPv4>。发布文件位于 /opt/MieMie-Multiplayer-Lobby/releases/<版本>，current 指向运行版本。配置及私有密钥位于 /etc/miemie-multiplayer-lobby，密钥首次部署时生成。
3. 在 Caddy 主配置中加入 import /etc/caddy/miemie-multiplayer-lobby.Caddyfile，再校验和重载 Caddy。凭据接口只监听回环地址 18798，Caddy 为公网 /v1/ice 提供 HTTPS 并覆盖内部客户端地址头。启动 miemie-multiplayer-lobby-turn.service 和 miemie-multiplayer-lobby-turn-credentials.service。
4. 确认为该实例放行 TCP 和 UDP 3478 及 UDP 49160–49223。TCP 3478 是客户端到 TURN 的回退传输，分配端口仍使用 UDP。coturn 限制并发、带宽及内网目的地址。服务端验证时应分别确认 UDP、TCP 和 relay/relay 实际传输。
5. 正式测试包的构建命令为 MIEMIE_TURN_CREDENTIAL_URL=https://turn.sheepsheeplab.com/v1/ice npm run build。自建部署可把该地址换成自己的 HTTPS 端点。安装包包含公开端点，HMAC 密钥仅存于运行服务器。

验收应下载一张来宾原本没有的地图，确认其角色卡与世界书校验、打开对话、一轮行动和结果分发都能完成。公网配置、实际运营商网络及玩家端结果分别记录。
