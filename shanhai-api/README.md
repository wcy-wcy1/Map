# 山海集：本机业务后端验证切片

这是可运行的 NestJS / TypeScript / **真实 PostgreSQL** / sharp 垂直闭环，不是正式云同步或生产账号服务。默认入口仅提供 API，不提供前端、QA 页面或静态照片目录。只允许绑定 `127.0.0.1`，必须显式开启测试身份；`NODE_ENV=production`、公网 origin、关闭测试开关或短秘密都会拒绝启动。不要将它映射到公网、反向代理、隧道或普通发布服务。

首个闭环：测试身份登录 → 准备并上传一张合成照片 → 服务端真实解码、转正、重编码去元数据 → 在有效私人地点保存回忆 → 第二会话读取、按需查看私有照片 → CAS 修改 → 地图精选 → 原子删除及提交级同步墓碑 → 可重试对象清理。业务数据来自 PostgreSQL；没有内存数据库替代品。

## 安装与启动

锁文件固定 NestJS `12.0.1`、pg `8.23.0`、sharp `0.35.4`；Node 要求 `>=24.15.0`，本轮使用 `24.19.0`。安装后先迁移，再启动：

```text
npm ci
npm run build
npm run migrate
npm start
```

每条运行迁移/服务的进程需要显式环境配置，秘密不应出现在命令行参数、共享日志或提交文件中：

| 环境变量 | 要求 |
| --- | --- |
| `SHANHAI_DATABASE_URL` | 本机 PostgreSQL 连接串；专用非超级用户角色；不能使用开发/测试混用的库 |
| `SHANHAI_STORAGE_ROOT` | 私有对象的绝对子目录；不能是磁盘根或符号链接；不得放进公开静态目录 |
| `SHANHAI_ORIGIN` | 精确 `http://127.0.0.1:<port>`，不带尾 `/` |
| `SHANHAI_PORT` | 与 origin 相同，1024–65535 |
| `SHANHAI_TEST_AUTH` | 必须显式 `1` |
| `SHANHAI_TEST_AUTH_SECRET` | 至少 32 字符的随机本机秘密；不要写进浏览器脚本 |

此工作区的隔离运行时配置位于被忽略的 `.local/runtime.json`；其中 `developmentDatabaseUrl` / `testDatabaseUrl` 分离。运行时辅助脚本由工作区独立维护，不是生产安装程序。数据库、会话签名密钥和对象目录必须作为同一部署配套保留；改变对象目录不会迁移照片。Windows 文件 `mode` 不能替代 NTFS ACL，应保持目录只对当前测试用户和必要系统主体可读。

`createApp(config, configure?)` 从 `dist/app.js` 导出，返回已经 `init()`、尚未监听的 Nest application。可选异步 `configure(app)` 在公共安全中间件之后、初始化之前执行，仅供独立 QA 启动器注入同源页面；`npm start` 不调用它。`app.listen(config.port, '127.0.0.1')` 是唯一允许的监听地址，`app.close()` 关闭连接池，不删除数据。真实 OIDC、Secure Cookie / TLS 和非测试启动路径尚未实现。

## 协议约定

所有数据都是合成验收资料。登录为 `POST /api/v1/testing/login`，JSON `{subject:"alice"|"bob",secret}`，需要精确 `Origin`。返回 `200 {account,csrfToken,expiresAt,testIdentityOnly:true}`，设置 12 小时 `HttpOnly; SameSite=Strict` 会话 Cookie。仅此 HTTP loopback 测试模式不使用 `Secure`。

私人端点从会话推导 owner，绝不信任请求体中的 `userId`；字段白名单拒绝额外字段。私人 JSON 响应带 `X-Shanhai-Account`。客户端应将其与请求发起时账号核对，错配立即清空私人视图；可在请求携带该头尽早得到 `409 ACCOUNT_CHANGED`，它不是授权凭据。所有业务写入需要 Cookie、精确 `Origin`、`X-CSRF-Token` 和 `Idempotency-Key`。登录、退出及按需 download-url 是认证/短期能力操作，不生成业务幂等收据；签名 PUT/GET 自身携带受限能力，不额外要求 Cookie 或 CSRF。

数据库只存会话、CSRF、上传/下载令牌的哈希；持久服务签名密钥单独保存在数据库。签名 URL 不写入业务收据或 change。服务不记录请求正文、照片字节、秘密或完整 URL。所有响应 `private, no-store`、`nosniff`、`no-referrer`；普通路径禁止嵌入。错误格式为 `{error:{code,message,details?,requestId}}`，不回传 SQL、栈或磁盘路径。

| 方法和路径（前缀 `/api/v1`） | 请求 / 返回 |
| --- | --- |
| `GET /health`、`GET /capabilities` | 本机健康和能力，不泄露账号数据；34 省区、49 region、43 公共点，明确不是全国完整公共目录 |
| `GET /session` | 当前账号、CSRF、会话期限；重启后仍可用 |
| `POST /auth/logout` | `{}` → 204；只撤销当前会话，不删其他设备或资料 |
| `POST /custom-places` | `{clientId,name,regionId,coordinates:[lng,lat],validationVersion}` → `{customPlace,...receipt}` |
| `GET /custom-places/:id` | 仅自己未删除地点；他人或非法 ID 为 404 |
| `DELETE /custom-places/:id` | `{}` + `If-Match`；仍被回忆引用为 409 |
| `POST /photos/uploads` | `{clientPhotoId,name,contentType,bytes,sha256}` → 201 `{uploadId,photoId,state,upload:{method,url,headers,expiresAt,maxBytes},receipt}` |
| `PUT <upload.url>` | 原始图片字节；唯一不可变代次，成功一次后重传 409 |
| `GET /photos/uploads/:id` | 状态、期限、ready 照片元数据；不返回内部对象 key |
| `POST /photos/uploads/:id/complete` | `{}` → `{photo:{id,state,version,name,inputSha256,storedSha256,sha256,mime,bytes,width,height},receipt}` |
| `DELETE /photos/uploads/:id` | `{}`，取消未被引用照片并安排持久清理；已引用 409 |
| `POST /photos/:id/download-url` | `{}` → `{url,expiresAt,mime,bytes,sha256}`；只有 ready 且挂在未删除自有回忆的照片可读 |
| `GET <download.url>` | 私有 JPEG；每次重核照片、回忆、账号和签发会话状态 |
| `POST /visits` | 下面的请求 → 201 `{visit,changeSequence,receipt}`，`ETag: "1"` |
| `GET /visits/:id` | 自有详情和 ETag；不包含图片字节或 URL |
| `PATCH /visits/:id` | 只允许 `place,date,note,photos,coverPhotoId`；CAS，返回新版本和 ETag |
| `DELETE /visits/:id` | 原子回忆/照片/地图封面墓碑，返回 `{deleted,changeSequence,receipt}` |
| `GET /visits?limit=50&cursor=…` | `{items,nextCursor,snapshotVersion}`；最大 100；库变化后旧列表 cursor 返回 409，需重新列举 |
| `GET /map-covers` | 当前账号有效精选关系列表 |
| `PUT /map-covers/:encodedPlaceKey` | `{visitId,photoId}`；创建 `If-None-Match:*`，更新 `If-Match`；严格检查照片/回忆/地点从属 |
| `DELETE /map-covers/:encodedPlaceKey` | `{}` + `If-Match`；仅删精选关系 |
| `GET /mutations/:operationId` | `{operationId,status,result}`，只查当前账号已提交收据，否则 404 |
| `GET /sync/changes?limit=100&cursor=…` | `{commits:[{id,sequence,changes}],nextCursor,hasMore}`；limit 按完整 commit，不拆事务 |
| `GET /cleanup-tasks` | 当前账号最多 100 条清理任务状态，无对象路径 |
| `POST /cleanup/retry` | `{}` → `{cleanup:{examined,deferred,done,failed},receipt}`；分阶段、精确 key、安全重试 |

回忆请求示例（ID 和版本从前面响应取得）：

```json
{
  "clientId": "a-stable-local-memory-id",
  "clientCreatedAt": 1788739200000,
  "place": { "kind": "custom", "id": "<server-custom-place-id>" },
  "date": "2026-09-01",
  "note": "合成测试：成都的小茶馆。",
  "photos": [{ "id": "<ready-photo-id>", "position": 0 }],
  "coverPhotoId": "<ready-photo-id>"
}
```

无照片用 `photos:[]`、`coverPhotoId:null`，此时必须有手记。最多 9 图，位置从 0 连续，不重号，内部封面必须来自照片数组，手记最多 2000 字符。日期为真实 `YYYY-MM-DD`，不得晚于上海时区今日。公共地点引用为 `{kind:"public",id:"yulong",catalogueVersion:"<capabilities value>"}`。地图 key 为 `public:<id>` / `custom:<id>`，作为单个 URI 编码片段传递。

## 一致性与对象生命周期

- 每次业务变更在同一 PostgreSQL connection / transaction 中锁定账号、重新检查会话、校验 owner 和关联、执行 CAS、记录完整 change 与幂等收据。关联表同时使用带 owner 的复合外键。相同键不同请求为 409；相同键重放返回原业务结果，不重复提交。
- `If-Match` 为带双引号的正整数版本，缺失 428、陈旧 412。删除后的 clientId 映射不释放；新操作键也不能复活旧身份。原创建键可能重放旧创建收据，这不代表当前对象仍存活，必须应用后续墓碑或查询当前状态。
- cursor 是签名的账号/epoch/服务端 sequence，不以客户端时钟排序。历史 change 存储提交时快照，后续修改不重写历史。本批永久保留测试期 change、收据与墓碑，没有压缩/到期；这里的列表版本保护不是持久固定快照 API。
- 上传有效期 5 分钟，单图输入 10 MiB，只允许实际 JPEG/PNG/WebP，最大 4000 万解码像素。真实转正、缩至最长边 2400、JPEG 编码；不调用保留 EXIF 的方法。动画多帧拒绝。全进程最多 2 次上传、2 次转换，图片转换 5 秒、HTTP 请求 15 秒上限。
- 账号最多 500 个占用中的照片身份、100 MiB 保守对象预算。预算计输入预留和实际输出，未完成清理的删除/取消对象仍占用；输出扩张在正式文件写入前重核。空间不足可先取消并完成 GC，再用新 complete 操作键重试。
- 文件只接受服务端生成的固定 UUID key，排他创建；完成后拒绝再上传该代次。暂存读取 EBUSY/EIO 等是可重试 503，保持 uploaded 且不写失败收据；实际哈希/格式/解码错误才持久 rejected。已上传未完成及未挂接 ready 照片有 24 小时宽限期；本批没有 renew，过期上传需取消后采用新 clientPhotoId 发起。
- prepare 事务在任何文件写入之前持久创建暂存和输出清理任务。GC 先提交退休状态/墓碑，再独立物理删除和确认；即使删除成功后确认 COMMIT 失败，也仅留下已退休对象与可重试任务，不会出现 ready 指向已删文件。每个对象再核对引用；不能删除已挂接输出。当前由显式 `/cleanup/retry` 驱动，没有后台定时执行器，因此超期不会自动宣称已清理。
- 60 秒下载能力仍逐次核对持久会话，因此本实现退出可阻止该会话之后的新下载请求，但不能追回已下载、正在传输或用户另存的副本。签名 URL 是短期 bearer，客户端不得持久保存或跨账号沿用。

## 全国目录与受控来源

启动读取相邻前端 `src/data/province-boundaries.json`、`yunnan-boundary.json`、`places.json` 并比对固定 SHA-256；变更需显式审查更新，不能静默接受来源漂移。当前 `validationVersion=national-20260907-b6918bc0`、`catalogueVersion=yunnan43-3ecd736f`。保留 `yunnan`、`lijiang` 等历史 identity，不改写成行政代码。49 region 是云南 16 州市加其余 33 省级范围；43 公共地点只在云南，非全国城市/景点完备目录。

自定义点由 regionId 推导省区，使用受控粗略轮廓、WGS84 数值和旧云南兼容规则校验，拒绝洞内点和跨省误配。它不是导航、测绘或官方疆界判定，边境附近可能拒绝合法地点。服务器保存公共稳定引用，不会因前端懒加载/卸载目录分片而删除已保存回忆；未来目录来源和版本升级仍需实现有审查的身份映射。

## 测试与交付边界

`npm test` 先 TypeScript build，再运行 `tests/api.test.mjs`，要求 `.local/runtime.json` 的专用 `testDatabaseUrl` 指向 `shanhai_api_test`。使用真实 PostgreSQL 和 5191；不碰 development 库、根代理 5190 或其他服务。不截断/重置数据库，生成新合成 ID；测试会取消/删除自己的对象并触发账号内到期合成对象清理。`.local/api-test-objects` 为可持续测试对象目录；旧测试目录和数据不自动删除。当前运行证据见 `tests/last-run.txt`，14/14；这是原生 HTTP/数据库测试，不是浏览器、手机或公网验收。

| 验收项 | 当前证据 |
| --- | --- |
| 真实 PG、非超级用户、34/49/43、旧云南 ID | 自动测试 |
| Host / Origin / CSRF / owner 注入、私有路径、大小限制 | 原生 HTTP 自动测试；错误 Host 用 Node http，不用忽略 Host 的 fetch |
| A / A2 / B 会话、跨账号引用、响应账号绑定 | 自动测试 |
| 成功重传拒绝、坏哈希/格式、真实去 EXIF | 自动测试 + sharp 解码输出 |
| 会话、记录、对象、签名重启持久性 | 同进程关闭重建 Nest 自动测试；真实进程重启由独立 QA 补充 |
| 幂等 / CAS 单胜者 / 删除不复活 / 整组墓碑 | 实际 PostgreSQL 并发 HTTP 测试 |
| 物理删除后确认失败、瞬时读取失败、引用保护 | 故障注入自动测试 |
| 压缩输入展开为大 JPEG、取消不能逃配额 | 2400×2400 合成棋盘自动测试 |

未实现：真实身份/OIDC、生产部署与安全评审、前端自动同步接入、旧 IndexedDB 自动迁移与断点 UI、持久固定快照、同步压缩、上传续期、账号删除/审计与清除策略、后台 GC 作业、云对象存储、多节点限流。删除当前对象是逻辑墓碑加可重试文件回收，不等于所有数据库历史、收据、备份立即不可恢复地擦除；正式保留期及账号清除需要另行设计。备份/导出文件也不等于多端云同步。

实现参考：[NestJS 12 迁移说明](https://docs.nestjs.com/migration-guide)、[node-postgres 事务](https://node-postgres.com/features/transactions)、[sharp 输入边界](https://sharp.pixelplumbing.com/api-constructor/)、[sharp 输出与默认去元数据](https://sharp.pixelplumbing.com/api-output/)。框架实际锁定依赖以 `package-lock.json` 为准。
