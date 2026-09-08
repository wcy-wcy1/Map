# 山海集 Vue 工程（迁移中）

更新日期：2026-09-07 · 文档修订：1.10（Vue已接通本机后端，核心流程限定验收；不是应用、数据库或备份格式版本）。

Vue 3 + TypeScript + Vite 的独立工程。当前可选择34个省区、保存跨省个人地点；49个Region由云南旧16州市和其他33个省级区域组成，43个公共地点仍全部属于云南。地图照片叠片/精选封面/避让、检索、详情、本机记录与草稿、照片查看、编辑、删除撤销、增量分卷导出/恢复和回忆卡已接入Vue组件及类型化服务。`/connected` 已通过相同组件接通真实本机后端并完成核心流程限定验收；账号模式不支持备份恢复/旧库迁移/删除撤销。正式身份/云同步、全国公共目录、完整原生异常矩阵与真实手机尚未完成。当前不替换 `http://127.0.0.1:8767/app` 原构建。

## 本机后端与已接通的独立账号模式

[shanhai-api](../shanhai-api/README.md) 已使用 NestJS 12.0.1、TypeScript 5.9.3、pg 8.23.0、sharp 0.35.4 与真实本机 PostgreSQL 17.10（非超级用户），实现测试会话、私人上传/真实重编码、回忆/封面、幂等/CAS及提交级墓碑。14项PG/HTTP自动测试、14组独立HTTP、5个VM场景、真正进程重启和5190原生QA证据分别见 [后端报告](../shanhai-api/qa/backend-20260907/REPORT.md)，不与前端569项累加；5190工具页不是Vue地图。

当前 `http://127.0.0.1:5192/connected` 是已接通本机API的独立Vue模式；普通 `/app` 保留本机，不自动扫描、迁移或上传旧库。仅在本机测试能力检测通过后开放测试登录，秘密不写入构建；[启动器](../shanhai-api/qa/vue-integration-20260907/start-vue.mjs) 读取现有受控配置并托管固定白名单dist，默认API不托管Vue。最终修复进程PID49388、故障注入关闭；不可将测试身份服务暴露到局域网/公网。没有新ZIP，8767和5183旧包保持不变。

`main.ts` 仅在127.0.0.1且路径恰为 `/connected` 时懒加载 `RemoteApp.vue`，经 `TravelServices` 注入实际 `App.vue`；`remote/api.ts` 负责同源/账号/CSRF/20秒请求边界，`remote/index.ts` 编排照片、收据、同步，`remote/store.ts` 管理独立 `shanhai-account-v1-<UUID>` schema1的cache/draft/outbox。普通本机主库schema4、导出暂存schema1和v1/v2格式不变。账号摘要/游标按完整commit同事务更新；首次从保留变更回放，不是固定快照。输入照片和原幂等键留在未确认outbox，完成后清除输入；草稿不上传，退出不删除账号本机草稿/队列。

### 1.10固定证据与限制

[最终验证](qa/vue-integration-20260907/verification.json) 于 `2026-09-06T20:29:00.451Z` 完成内核/来源一致性、类型、38文件/630项及构建，`changedDuringRun: []`；[交付核对](qa/vue-integration-20260907/delivery-checks.json) 绑定同一源码/产物及5192公开字节。最终HTML SHA-256为 `34160c772a7e58d561396c1192747380dfc92ec70024bc8e3738f1633d8123be`；[报告](qa/vue-integration-20260907/REPORT.md) 和 [8组证据一致性核对](qa/vue-integration-20260907/native-checks.json) 区分原生观察、真实HTTP/PG和受控协议测试。

619项是 [修复前历史](qa/vue-integration-20260907/pre-fix-verification.json)，包括结果未知→重启保留草稿/待处理→原收据确认的限定故障实验，不覆盖后来的修复。630项最终构建复验：删除冲突草稿明确另存成新visit/photo、刷新无孤立pending，旧visit410/旧photo授权404；新封面照片真实解码1200×800；编辑时另页删除后仅关闭编辑器自动4→3；多页看图时退出清私人树，A/B及匿名模式隔离。单次丢响应被透明重试恢复的早期观察不算持久化证明。

630不与619、569或后端14项累加；8组核对不是8个完整端到端自动测试。封面ABA、过期上传/取消丢响应和全部迟到排列未全部原生验证；无真机、正式身份或云部署。账号模式明确禁用备份导入导出和删除撤销；固定快照/显式迁移、账号备份与云存储仍待完成。2并发/12缓存不保证outbox整库读取的固定内存上界。

## 前端开发命令

使用 Node 22.22.2+（22 系列）、24.15.0+（24 系列）或 26+。本次实际验证运行时为 24.19.0，不能把系统旧版 Node 的依赖引擎警告当作通过。

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
npm run verify
npm run measure:bundle
npm run package:trial
```

开发入口为 `http://127.0.0.1:5173`，生产构建预览为 `http://127.0.0.1:5174`，均只监听本机且端口占用时直接失败。新端口与旧版不共享 IndexedDB；新版空库不能证明数据迁移完成。默认库名仍为 `shanhai-lijiang-local-v1`，当前开发内核主库 schema 为 4；原 8767 构建使用 schema 2，更早的 5176 包使用 schema 3。历史 5175 旧 UI 写入与 5177 合成历史结构已验证 schema 1/2→3；照片索引阶段在同一隔离来源继续验证已有 schema 3→4，正式记录、封面、草稿签名不变。均非用户 8767 数据库。本轮导出使用独立 `${dbName}-exports-v1` schema 1 暂存库，主库保持 schema 4。

`npm run qa:cutover -- 5175`（或 `5177`）只用于开发隔离验收，`/qa` 提供可见只读检查与仅空来源建立 schema 1 合成库，`/legacy` 提供哈希固定的旧构建，`/app` 提供当前构建。需要完整工作区、当前 `dist/.vite/manifest.json`，且启动前先确认端口无其他服务。QA 页面/脚本/夹具不进入试用包。升级后旧程序可能拒绝读取新版库；换回旧 HTML 不是数据库回滚，不以清库解决兼容问题。

`src/domain` 保存领域模型与纯算法；`src/components` 包含地图、列表、详情、`MemoryEditor`、`PhotoViewer`、`BackupPanel`、其导出子组件 `BackupExport.vue`、`MemoryCard.vue` 及 `memory-card.css`。`src/sharing/card-types.ts` 与 `card-renderer.ts` 提供卡片契约和 PNG 渲染；`src/editor` 处理草稿与照片输入，`src/services` 提供显式依赖注入、持久化契约和恢复流程，其中 `export-types.ts/export-store.ts/export-service.ts` 提供导出契约、独立暂存及生成/校验/恢复/清理。`src/generated` 保留机械生成的备份与存储内核。导入服务时不会访问数据库，也不向 `globalThis` 安装旧接口。

`domain/provinces.ts` 提供 34 项 Province、全国粗略几何与旧云南轮廓；`catalogue.ts` 通过 `provinceForRegion` 推导归属，`map-layout.ts` 支持省区筛选。云南省 ID 保持 `yunnan`，`lijiang` 等旧 region 和 `yulong` 等旧 place ID 不变；其他省使用已登记的 `cn-11`、`cn-51` 等 ID。自定义地点仍是 `{id,name,regionId,coordinates}`，不向 `Visit/Draft` 新增持久化 `provinceId`，主库 schema 4、独立导出 schema 1 和备份 v1/v2 均不变。云南继续选旧州市，其他省先记录省级区域；换省清空旧坐标，按所选省多边形与孔洞拒绝越界位置。

基础 `province-boundaries.json/yunnan-boundary.json` 随 `regions` 哈希 JS 块同步加载。`services/geography-service.ts` 仅在进入云南时 fetch 同源 `/data/yunnan-geography.geojson`，15 秒超时、失败可重试，基础省界和回忆仍可使用；完整几何不再用动态 JS import。App 使用请求代次和取消信号忽略旧省份晚到响应，并让选中地点的定位优先于通用省区缩放。失败或拒绝选点不丢草稿、不修改正式记录。

分享卡从受信目录冻结地点名，每次打开复制一份独立记录选择，随后刷新同条记录不会重置选择。默认不带原手记或日期；PNG 只含选中 0–3 张照片、主动填写/带入的分享文字及主动勾选的日期，不改写原记录。输出 1080×1440，预览 `<img>` 预留该尺寸比例，避免解码后布局跳动；纯文字和 60 字自定义地点标题已做桌面浏览器检查。

生成内核的权威源码在 `../output/shanhai-lijiang-records/backup-codec.js` 与 `local-store.js`。修改权威源码后运行 `npm run sync:kernels`；禁止手改生成 JS。`npm run verify` 会检查内核是否与权威源码一致，因此该检查需要完整工作区。正常开发及构建只读取工程内已有模块。`npm run sync:reference-assets` 是另一个显式维护命令，会覆盖清单中的公共数据与参考样式，不在构建中自动运行。

全国地理生成使用 `node scripts/build-national-geography.mjs`，固定 geoBoundaries 提交和两个输入 SHA256，原坐标不手改；已有缓存优先，缺失时才下载固定源。`node scripts/build-national-geography.mjs --check` 完全离线比对输入及生成物，已纳入 `verify`。来源原件存于 `qa/national-map-20260907/data`，开发交接需保留；只有获准的生成数据进入交付包。新增测试见 `provinces.test.ts`、`geography-service.test.ts`、`national-map-ui.test.ts`、`national-storage.test.ts` 和 App 竞态回归。

备份保留单文件 v1 兼容；分卷 v2 恢复使用整套预检、逐条解码与等待暂存写入、确认后原子合并。导入暂存会话支持 `ready` 恢复、`committed` 收据识别和仅清理本会话临时数据。旧 `prepareExport` 和 v1/全量 collector 入口保留，v1 恢复仍会读取完整库；普通交互导出已切换增量服务，不再完整 `load()`。

增量导出先 `loadIndex()` 固定摘要、封面及 revision，串行 `readVisit(id,{expectedRevision,signal})` 并核对摘要投影；权威 codec 的 `writeVolumes` 按 canonical v2 顺序写入逐卷 sink，等待每卷提交后继续。服务逐卷读回并以 `wrapVolume` 校验内容和精确封装字节数，最后调用只读 `libraryMeta` 的 `assertRevision`，通过后才把会话标为 `ready`。`sessions` 只存状态/元数据，`parts` 按 `[sessionId,part]` 存 payload Blob；主库照片、封面和草稿不因导出而改变。

`BackupExport` 一次准备一卷、只保留一个活动 object URL；切卷、关闭或清理会释放链接。刷新后主动查看临时备份，`resumeReady` 逐卷复核后可继续下载；未完成或损坏副本只能清理后重建。有效 id/sourceDbName 下的损坏元数据显示为 `damaged` 并保留清理入口，不阻塞其他有效会话。写入 token 属于内部数据，ready 提交后仍保留私有归属供本次取消清理核对，不暴露给调用者；取消/关闭等待真实事务及工作结束，失败只清理本会话，清理失败可重试。UI 明示临时副本未加密、含照片/手记，并区分已生成、已发起下载和用户核对文件；下载后由用户明确确认清理。

导出不收集全库照片或全套封装 Blob，但摘要、单条最多 9 张照片的 Visit、当前卷和浏览器内部开销仍存在。单条照片仍内嵌于 Visit，尚不能承诺整个应用或大型照片库的固定总峰值。

schema 4 增加 `visitIndex/libraryMeta`：`VisitSummary.photos` 只有 `id/name`，`loadIndex()` 返回摘要、封面和 revision；首页/查重不读全库图片，`hasDraft()` 不读完整照片草稿。看图、编辑、删除、分享按 ID 调用 `readVisit(id,{expectedRevision,signal})`，拒绝过期目录；正式写事务同步更新摘要和库版本，原照片仍内嵌在 Visit 中。摘要/完整读取不合法时整次拒绝，不静默跳过成成功或空库，保留画面并要求重新读取。

`services/photo-loader.ts` 与 `components/PhotoThumbnail.vue` 通过注入协作：IntersectionObserver 可见时读取、离屏释放，最多 2 条正在读取的 Visit、12 张指定原照片 LRU；可见组件持有的图片不计入缓存上限。没有整条 Visit 缓存，没有物理照片分表或额外压缩缩略图。迁移 8 秒超时或关闭时，活跃升级先 abort 并等待终止确认，已过提交点不假称回滚；真实大库/慢设备能否完成迁移仍待测。

全国省区源为 geoBoundaries/Wikimedia 的 2019 年粗略数据，上游许可字段 Public Domain；源 `Guangzhou Province` 映射为广东省显示名称，澳门只有 4 个独立顶点，未补画或挪动坐标。上游 Wikimedia 链接不完整，不能声称逐个原始文件许可已核验。云南几何仍保留 OSM/ODbL 署名；来源分别见 [全国证据](qa/national-map-20260907/data/DATA-SOURCE.md) 与 `public/data/SOURCES.md`。这些都不是官方标准地图或精确行政归属依据，未完成公开地图上线审核。普通本机 `/app` 的运行时仅请求同源公开 JSON，不上传私人照片或自动调用远程地图、AI、收费接口；独立 `/connected` 的显式上传属于本机API流程，不自动带入旧库。

## 前端1.8全国省区固定证据（接通前）

[固定验证](qa/national-map-20260907/verification.json) 于 `2026-09-06T19:09:12.165Z` 通过内核/地理新鲜度、类型、33 个文件/569 项测试及构建，`changedDuringRun: []`。[交付检查](qa/national-map-20260907/delivery-checks.json) 重核101个源码项、12个产物与实际ZIP。569是该阶段全量结果，不覆盖之后的Vue接通修改，也不与更早525/408/373/299/213/121项相加；汇总见 [全国省区报告](qa/national-map-20260907/REPORT.md)。

5182 桌面合成来源创建北京、四川个人地点和云南 `yulong` 共 3 条/4 图，真实导出文件在 5183 官方解压包通过 OS 文件选择、预检完整图片解码、确认恢复及刷新后再导出。[往返核验](qa/national-map-20260907/roundtrip-checks.json) 确认两个文件各 1,460,194 字节；原始 NDJSON 1,459,452 字节、8 行逐字节一致，地点/区域/坐标、记录/照片身份和 3 个记录 `coverId` 不变。独立地图 `covers` 覆盖为 0，本轮不声称再次验证显式地图精选覆盖。

5184 合成网络实验的 [初始请求](qa/national-map-20260907/network-initial.json) 未加载完整云南 JSON，[重试记录](qa/national-map-20260907/network-retry.json) 是首次 503、点击重试后 200。[越界拒绝](qa/national-map-20260907/outside-boundary-rejected.txt) 与 [实验前](qa/national-map-20260907/network-data-before.json)/[实验后](qa/national-map-20260907/network-data-after.json) 证明正式 3 条记录及照片/封面引用不变，异常流程中新建的未完成草稿保留；草稿由 0 增至 1，不能称整个库未发生任何变化。

本轮桌面窄屏替代复验已通过：浏览器 viewport 设置未实际生效，改用 QA 同源 iframe 加载原始 ZIP 生产页面字节。[320](qa/national-map-20260907/release-320.json)/[390](qa/national-map-20260907/release-390.json) 的 `innerWidth` 为 320/390，`scrollWidth` 为 305/375，无水平溢出；受检可见按钮、输入与下拉控件均至少 44×44px，不含行内文字链接。见 [原生证据核验](qa/national-map-20260907/native-checks.json)。这是桌面 iframe 布局测试，不是真正的浏览器 viewport、手机真机或触摸测试，不证明全部可访问性或任意密度布局；历史结果仍独立保留。真实手机、原生配额耗尽、系统分享和真人试用尚未验收。

接口和后续设计见 [全国地点数据契约](../docs/山海集/全国地点数据契约.md)、[账号、照片与同步接口草案](../docs/山海集/账号照片与同步接口草案.md)。后者的本机API首轮已有实现，正式身份、快照/迁移和云端部分仍为后续约束；不能把全篇草案视为已经交付。

## 历史验证阶段（各自保留）

分享卡接入前，[核心验证报告](qa/core-20260907/report.json) 的时间为 `2026-09-06T16:38:56.163Z`（北京时间 9 月 7 日）：内核一致性、类型检查、13 个文件中的 121 项测试及构建通过，测试期间源码未变。该结果已固定保存，不覆盖其后的分享卡改动；新改动须重新验证并更新 `qa/current`。浏览器证据、手机系统分享与真实用户结果分别记录，不能互相替代。

分享卡阶段的历史结果见 [验收报告](qa/sharecard-20260907/REPORT.md) 与 [验证记录](qa/sharecard-20260907/verification.json)：15 个文件共 213 项测试、内核一致性、类型检查和构建通过，运行期间源码未变。5174 桌面生产预览验证了 50 个分卷文件恢复 2 条记录/2 张照片并刷新、详情入口、3 张限制及原顺序、分享内容隔离、390/320 宽度无横向溢出和 16px 输入；照片入口另有开发版浏览器证据。该阶段证据不替代下面的新构建结果。

切换阶段 [试用包报告](qa/cutover-20260907/REPORT.md)、[验证记录](qa/cutover-20260907/verification.json) 于 `2026-09-06T17:14:33.264Z` 通过内核一致性、类型检查、19 个文件共 299 项测试和构建，`changedDuringRun: []`。原生浏览器验证了 schema 2 旧 UI 写入的 2 条回忆、照片、非首张记录封面、自定义地点和未选地点的照片草稿升级保留；schema 1 合成结构的记录、照片及显式地点封面也保留。草稿续写、手记检索、编辑与删除撤销已做部分全链路检查；不代表所有 R01–R08 原生异常分支完成。当时真实系统落盘/发送、iPhone/Android、大图库和真人试用尚未通过验收。

切换阶段 ZIP 实际解压包另完成桌面原生检查：v1 恢复 3 条/1 照片，有效/损坏照片混选时保留成功项并明确失败，新增、看图、地点封面、照片进卡、390 宽度和刷新检索通过；独立分享文字未改原手记。v2 的 50 文件合计 828,532 字节，导入 2 条/2 照片后刷新合计 6 条/3 足迹，不可解码图片备份被拒且暂存清理。该阶段 6 条/4 照片生成 1,622,574 字节的 v1 备份并发起下载，但未确认系统落盘或该文件回导；小型合成备份不证明大型库容量，窄屏不等于手机。

照片索引阶段 [报告](qa/photo-index-20260907/REPORT.md)、[验证记录](qa/photo-index-20260907/verification.json) 于 `2026-09-06T17:40:34.191Z` 通过内核/类型、22 文件/373 项及构建，`changedDuringRun: []`。原生 5175 三条/三照片、自定义地点及 5177 一条/一照片显式地点封面库的 schema 3→4 三表签名一致；5175 实际按 ID 看图、非首张封面、照片进卡、编辑、删除撤销通过，390/320 卡片预览无横向溢出。该阶段 5178 解压包 v1/v2 恢复后刷新五条/三个足迹，日期检索命中“合成测试湖边小店”并实际解码完整照片为 1200×800。历史 299/213 项不累计，不用旧包证据替代当前结果。

地图封面阶段 [报告](qa/map-covers-20260907/REPORT.md)、[固定验证](qa/map-covers-20260907/verification.json) 于 `2026-09-06T18:06:26.388Z` 通过内核/类型、25 文件/408 项及构建，运行期间源码未变。43 地点/86 张合成照片的精选 B→A 同步地图/列表、390/320 无横向溢出与受检矩形重叠、最终构建边缘锚点场景已通过桌面原生复验；[7 组布局检查](qa/map-covers-20260907/layout-checks.json) 单独保存。该阶段实际解压服务 5179 刷新仍保留 43 条/86 图及玉龙雪山 `photo-a` 封面、revision 2。当时不改 schema 4，也未认证真机、完整原生异常矩阵、OS 实际下载/发送或真人试用。

历史 [增量导出报告](qa/incremental-export-20260907/REPORT.md)、[固定验证](qa/incremental-export-20260907/verification.json) 于 `2026-09-06T18:32:35.281Z` 通过内核/类型、[29 文件/525 项](qa/incremental-export-20260907/tests.log) 及构建，`changedDuringRun: []`。该阶段新增测试覆盖 canonical v2 串行 sink、最终版本确认、精确封装大小、独立暂存事务、取消/并发、损坏元数据/私有写入归属与单 URL UI。525 是当时全量结果，不与其他阶段相加。

5180 桌面原生隔离库含 2,101 条记录、360 张合成照片，标准化记录为 146,730,695 字节；生成前后和取消后记录/封面签名一致。九个实际下载文件合计 146,881,900 字节，[下载检查](qa/incremental-export-20260907/downloads-checks.json) 已核对每卷 wrapper、payload 和整套 manifest 校验和。5181 实际解压包通过原生文件选择器读回全部文件、完整照片解码后，[导入预览](qa/incremental-export-20260907/release-import-preview.txt) 显示 2,101 条/360 图，[提交结果](qa/incremental-export-20260907/release-restored.txt) 确认导入 2,101 条；[刷新后继续下载](qa/incremental-export-20260907/release-resumed.txt) 记录正式数据与 ready 副本保留。[独立往返检查](qa/incremental-export-20260907/roundtrip-checks.json) 比较原导出与回导后再导出的两套实际落盘文件，2,463 行与完整 NDJSON 流哈希一致，重建记录/封面签名匹配原生源库；不同 archive ID/时间会产生不同封装文件哈希。

[原生检查](qa/incremental-export-20260907/native-checks.json) 另确认取消保留原 ready 副本、跨页改封面拒绝版本混合、明确清理后 `sessions=0/parts=0/payloadBytes=0`。封面实验曾主动将源 revision 从 2102 改为 2103；清理不将它回滚。`storage.estimate()` 清理后未立即下降，不能声称物理磁盘已立即回收。5180 实验服务与开发页面已关闭，5181 实际解压服务及其合成记录/ready 副本保留。

历史增量导出阶段的 [320 宽度](qa/incremental-export-20260907/release-320.json) / [390 宽度](qa/incremental-export-20260907/release-390.json) 仅记录当时受检桌面视口无横向溢出、44px 控件和一个活动下载链接。heap/storage 快照不是峰值内存测量或原生配额耗尽验收；慢设备、iPhone/Android、完整 R01–R08 原生异常矩阵、系统分享与真人试用仍待测。

完整目标、当前证据和外部验收门槛见 [开发执行记录](../docs/山海集/开发执行记录.md) 与 [下一步计划](../docs/山海集/下一步计划.md)。省区/跨省个人地点及本机API首轮已实现；公共云南43处/16州市仍是样板，北京/四川 [六点候选](qa/catalogue-expansion-20260907/place-candidates.json) 未发布。正式身份/云同步、全国公共目录、攻略、旅程、AI地标与3D继续推进，不重新列本机API为待选型。

## 当前交付与资源

原始核心需求“地图照片叠放、精选一张、密集时自适应”已接入。`domain/place-cover.ts` 统一地图/列表的精选与搜索规则；`map/cover-layout.ts` 保留真实坐标并避开地标、地名、控件和其他照片；`map/photo-cover.ts` / `photo-cover.css` 通过共享 loader 可见加载、离屏/重绘释放。地标保留 54/58/64px；照片纸面最大 48×44px、紧凑 44×44px，外框 52×48px/48×48px。空间不足紧凑或折叠，聚合仅用锚点地点自己的照片；单张不假叠片，锚点离屏不留下孤立封面。它不属于 AI/3D，手机触摸与更多真实密度场景仍待验。

`verify` 将内核/地理新鲜度、类型检查、单元/组件测试、生产构建日志及完整源码/产物哈希写入 `qa/current`。`package:trial` 要求 24 小时内通过的报告，且源码、公共资源、脚本与当前构建哈希仍完全匹配；拒绝额外文件、符号链接、缺失依赖或孤立资源。它只打包审核的 `dist` 文件，再加入独立 `serve.mjs`、生成说明和发布清单，不打包 QA、源码、用户照片或私人备份，也不自动部署。

当前 [全国省区试用 ZIP](release/shanhai-vue-local-trial-20260906T190920Z-9f37edbd.zip) 为 758,751 字节，SHA-256 `cba77af6fb8a7861c2655db485e875cc6c3af6071817f34f624df9747112b6d5`；[外部回执](release/shanhai-vue-local-trial-20260906T190920Z-9f37edbd.release.json) 记录清单与验证报告摘要。完整解压后进入包含 `serve.mjs` 的目录；默认 `node serve.mjs` 使用 5176，本轮显式执行 `node serve.mjs 5183`，打开 `http://127.0.0.1:5183/app`。无需 npm 依赖，仍需 Node；不支持双击 HTML。[交付检查](qa/national-map-20260907/delivery-checks.json) 核对实际 ZIP/解压 15 文件、12 个公开资源 GET/HEAD/哈希与安全头、16 私有路径 404、POST 405、恶意 Host 403；旧 8767/5178/5179/5181 哈希不变。服务仅监听本机，启动时核验清单并缓存获准字节，不提供任意文件、QA、上传或业务 API。

历史增量导出 [ZIP](release/shanhai-vue-local-trial-20260906T183259Z-9deb263e.zip) 为 916,545 字节，SHA-256 `47d08e628c78fa00718b09d977a0862e8b8841394ba437ae137f7dd72844ba3a`；[历史回执](release/shanhai-vue-local-trial-20260906T183259Z-9deb263e.release.json) 和 [交付检查](qa/incremental-export-20260907/delivery-checks.json) 保留 5181、14 文件/11 公开资源及当时大备份结果，不替代当前包验收。

地图封面阶段的 [历史 ZIP](release/shanhai-vue-local-trial-20260906T180635Z-10d1afd6.zip) 为 909,122 字节、SHA-256 `b966657b1338c136568b38f97fa3537924ab8d178a34f07b0c13728195723c8d`，对应 [历史回执](release/shanhai-vue-local-trial-20260906T180635Z-10d1afd6.release.json)、[地图阶段交付检查](qa/map-covers-20260907/delivery-checks.json) 和 5179 服务，保留用于追溯。

当前 [体积记录](qa/national-map-20260907/bundle-measurement.json)：入口 JS 208,675 字节，首次必需 5 个 JS 共 907,471 字节、逐文件 gzip（Node zlib，level 6）287,177 字节；CSS 48,662 字节。同步 `regions` 块 448,763 字节，包含基础轮廓；按需云南 JSON 为 1,042,040 字节/gzip 373,914 字节，单独列入 `deferredGeography`，不在初始 JS 内。请求时机有独立原生证据，离线 gzip 数字不是实际 HTTP 压缩、耗时或手机性能承诺。

历史增量导出阶段入口/首次 JS/gzip 为 199,286 / 1,490,843 / 515,658 字节，CSS 47,952 字节，完整几何当时为静态 JS 1,041,524 字节，见 [历史导出测量](qa/incremental-export-20260907/bundle-measurement.json)。地图阶段 172,851 / 1,464,408 / 508,339 字节见 [历史地图测量](qa/map-covers-20260907/bundle-measurement.json)；索引阶段 167,924 / 1,459,481 / 506,691 字节见 [历史索引测量](qa/photo-index-20260907/bundle-measurement.json)；更早切换阶段见 [历史测量](qa/cutover-20260907/bundle-measurement.json)。分别保留，不混算资源或测试结果。

[大备份增量导出方案](../docs/山海集/大备份增量导出方案.md)、历史大库与跨省小库往返、5192接通核心闭环已有独立证据。下一安全工程优先持久固定快照/显式旧库迁移，并行推进六点候选审查发布和可维护公共目录；旅程/攻略继续目标。正式身份、私有云存储、部署与费用需要用户选择。容量、原生配额、慢设备与完整异常验证继续，真机/F01/独立观察仍待实际参与。普通本机备份不依赖上传或收费服务；单条Visit仍含最多9图，不能承诺固定总峰值，白名单试用包不等于公网部署或全量上线验收。
