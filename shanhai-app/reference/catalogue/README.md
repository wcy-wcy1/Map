# 全国地点目录的固定输入

研究日期：2026-10-23。保留云南 43 点，新增 33 省区各 4 点（经典 2 点、地方发现 2 点），总计 175 点。分类是编辑选择，不是实时热度或客流统计。

本目录是版本管理中的公开参考资料，不依赖被忽略的 `qa/`。只保存构建实际使用的候选、消歧结果与坐标证据；不含截图、照片、用户回忆、凭据或完整研究工作区。所有坐标保持来源中的 WGS84 数值，景区代表点不等于导航入口。

## 文件与来源

- `first-batch/selections.json`：首批 32 个地点的稳定身份、所属省份、分类和原创简介。`evidence.json` 保存其中 29 个地点采用的 Wikidata P625 原始 statement、OSM 对象、版本、标签和必要几何。它是公开 API 响应的具名字段摘录，非完整原始响应；每条保留原始对象 URL 和修订号。
- `legacy/place-candidates.json`：从早期 6 个候选中仅保留实际采用的故宫、天坛、都江堰。其余 3 个 JSON 是对应固定修订的 Wikidata 原始实体响应。
- `expansion/other-candidates.json` 与 `other-resolved.json`：后续 100 个候选和 Wikipedia 页面身份／修订记录。候选表是研究初稿，最终覆盖以生成数据库为准；构建脚本明确处理被替换与消歧的条目。
- `expansion/other-wikidata-01..05.json`、`other-wikidata-a-*.json`、`b-wikidata-extra.json`：固定修订的原始实体响应，包含 P625 statement、精度、等级和参考信息。优先采用非废弃、地球坐标的 preferred statement；无 preferred 时采用第一个合格 statement。Wikidata 社区坐标不被描述为官方实测。
- `other-wikipedia-a-*.json`：五台佛光寺、五大连池火山群、关林、古琴台、汉阳峰等消歧与修订依据。
- `b-osm-yudai.json` 和 `b-osm-asihatu-way.json`：具名沙滩／石林面的原始 way 与 nodes。代表点取包围框中纬度上最长内部水平线段的中点，不使用行政区中心。
- `b-osm-gongtan.json` 仅摘录现龚滩镇节点 `2886574248`；`b-osm-sand-lake.json` 仅摘录沙湖关系 `16906759`。两文件标注了提取行为，对象字段未改；无关地图对象没有进入本目录。`b-nominatim.json` 仅保留同一沙湖关系的原始搜索结果，生成坐标采用其显示点。

JSON 快照按仓库 `.gitattributes` 使用 LF；`coordinateSource.evidenceSha256` 校验这里的固定文件字节，不冒充网络传输原始字节哈希。每个发布地点都指向这里可读取的 `evidenceFile`，并保留外部原始 URL、对象 ID、修订或版本。

## 离线重建

从 `shanhai-app` 执行，仅需项目的 Node.js 环境：

```powershell
node scripts/build-national-catalogue.mjs
node scripts/build-catalogue-manifest.mjs
node scripts/build-national-catalogue.mjs --check
node scripts/build-catalogue-manifest.mjs --check
```

第一步从固定输入重建 A/B 分片、全国新增目录和可下载副本；`--check` 重新推导三份数据并拒绝任何漂移。无需 Python、网络、地理编码服务或 `qa/`。原 Python A 批研究辅助脚本保留供复核；正式生成链统一使用 Node。

目录清单使用解析后 JSON 的 SHA256，内容改变仍失败关闭，LF/CRLF 不会改变目录版本。旧版本仅接受该版本发布过的 ID 白名单。`sourceSnapshot` 对本目录采用精确文件及目录白名单，缺失、额外文件和链接均拒绝；参考资料不会被自动打包成网页资源。

## 重要消歧与代表点

- 漓江使用杨堤码头代表河段；龙脊使用千层天梯观景点；程阳使用永济桥；福建土楼明确为田螺坑土楼群。
- 陈家铺、奇达与堂安的模糊同名搜索曾命中外省地点，均拒用，最终采用具名 OSM 节点。
- 庐山明确为汉阳峰；泰山是与 UNESCO 登记一致的整体代表点；平遥采用古城实体而非同名高铁站；瑶里是古镇代表点。
- 广济桥、郑家大屋、沙湖不采用同名消歧页；关林替换缺乏可靠坐标的嵩阳书院，古琴台替换恩施土司城候选。
- 鹿港龙山寺拒用偏南约一纬度的中文 Wikipedia 坐标；塔尔寺采用与 OSM 一致的 Wikidata 寺院位置；龚滩采用重建古镇所在现镇节点而非沉没旧址。
- 11 个公开点落在应用的粗化轮廓之外：鼓浪屿、奇达村、扎尕那、小七孔、堂安、老虎滩、防川、玉带滩、龚滩、聚星楼、大澳。保留真实坐标与省份身份，不移动坐标，也不放宽用户自定义地点校验。

## 许可

Wikidata 结构化数据采用 [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing)，Wikipedia 页面元数据及内容按各来源所述许可；OSM 数据及其衍生数据库采用 [ODbL 1.0](https://www.openstreetmap.org/copyright)，署名 © OpenStreetMap contributors。混合地点数据库依 ODbL 提供，见 `public/data/national-places.json`。该许可不扩展到应用代码、原创 SVG 或用户照片。目录没有复制来源照片。
