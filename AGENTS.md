# 咩咩联机大厅开发规范

- 产品作者与生态发起人为 SheepSheep，SheepSheepLab 用于官方仓库及维护发布命名空间。保留各项目的原始代码署名、版权、贡献与提交历史。变更身份前核对 [产品身份](docs/PRODUCT-IDENTITY.md)、[品牌说明](BRAND.md) 和 [来源记录](THIRD_PARTY_NOTICES.txt)。
- Commit、Push、Tag 或 Release 前核对实际生效的 Git Author 与 Committer，包括配置和环境覆盖。Owner 提交统一使用 `SheepSheep <331468872+SheepSheepLab@users.noreply.github.com>`，使用现有登记的 SSH Ed25519 密钥签名。核验待上传 Git 对象、历史与文件，排除私人邮箱、本机信息、密钥及用户数据。任一检查失败应停止相关操作并报告 Owner。未经授权不得重写历史、强推或发布。
- 修改既有文档前先完整阅读原文，沿用用途和结构并增量维护。历史测试、审计、设计和版本结论应保留原义，需要删减或迁移时先取得 Owner 同意。
- 分别验证 Hub Runtime Compatibility 与 Managed Package Compatibility。阶段性或本地测试应注明覆盖范围。
- 产品版本和发行标记遵守 [版本规范](docs/VERSIONING.md)。图标与软件授权分别见 [素材说明](ASSETS-LICENSE.md) 和 [许可](LICENSE)。
