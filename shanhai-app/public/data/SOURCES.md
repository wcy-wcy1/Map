# 山海集地理示意 · 来源、重建与许可

## 全国省区扩展（2026-09-07）

`china-provinces.geojson` 保留 geoBoundaries CHN ADM1 的 34 个省级 Feature 原始几何，只规范本应用的中文名称、ID、来源属性；它不是完整景点目录、导航数据或经过审定的公开地图。

- 来源：[geoBoundaries 数据集 API](https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM1/)；固定提交 `9469f09592ced973a3448cf66b6100b741b64c0d`。
- [固定原始几何](https://github.com/wmgeolab/geoBoundaries/blob/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen/CHN/ADM1/geoBoundaries-CHN-ADM1.geojson)，SHA-256 `3a00467a0db9b4136facb5f2f3d0edbfd96adb15651cfdf63991da9281030e85`。
- 来源元数据标记的年份为 2019，来源为 geoBoundaries / Wikimedia Commons，原许可标记为 Public Domain。使用时保持 geoBoundaries 署名；[项目的许可与说明](https://www.geoboundaries.org/api.html)和原元数据均保留在构建证据中。本说明不改变云南 OSM 衍生层的 ODbL，也不重新授权应用代码或私人照片。
- 原数据中的 `Guangzhou Province` 对应本应用广东省，`Ningxia Ningxia Hui Autonomous Region` 对应宁夏回族自治区；名称映射公开记录，坐标没有手工移动或扩大。
- 轮廓较粗且非现势认证，澳门仅有 4 个独立顶点；不得用其证明精确行政归属、海岸线、岛屿完整性或国界审查通过。边缘与小岛地点可能无法通过当前录入校验，后续需更精细、经核验的数据支持。
- 生成器 `shanhai-app/scripts/build-national-geography.mjs` 用固定 SHA 核对来源，`--check` 离线比较全部生成物。云南记录校验仍使用原 OSM 省界，不以全国粗略轮廓改写旧回忆的接受范围。
- 本轮只在本机开发，公网地图需单独完成适用的地图审核与服务合规验收；参见[地图管理条例](https://www.mee.gov.cn/zcwj/gwywj/202001/t20200114_759322.shtml)，此处不作已通过审核的声明。

## 云南详细底图

本目录的 `data.json` 是可内嵌网页的 **WGS84 GeoJSON**。几何来自 OpenStreetMap（OSM）官方只读 API，不是根据图片描摹、手工绘制、GCJ-02/BD-09 转换或在线地图瓦片反推。

## 数据与使用边界

- 云南省外边界与全部 16 州市行政界。OSM 当前标签：省为 `admin_level=4`，州市为 `admin_level=5`。
- 明确列出的湖泊真实水面；三条主要河流真实主河道中心线，裁切到本地图省界。不是全部云南水系，不表示河道宽度、水位或导航路线。
- 这是旅行记忆示意底图，非官方审定行政区划、测绘成果或导航数据。社区数据的完整性和现势性不能保证；对外地图发布前应另行审核适用规范。
- 泸沽湖跨云南、四川，本数据保留完整天然湖面，并在其 `note` 中明确标注。不要把完整湖面都描述为云南辖域。
- 图标位置应从景点自身 WGS84 坐标投影；不得把本底图简化容差当作景点移动许可。

## 主来源

省关系 ID 首先由 [OSM Wiki：中国行政区](https://wiki.openstreetmap.org/wiki/China) 和 [Wikidata：云南](https://www.wikidata.org/wiki/Q43194) 交叉发现。最终以 [OSM 913094 原始关系](https://www.openstreetmap.org/api/0.6/relation/913094.json) 的 `subarea` 成员确定全部 16 个州市，而不是猜测关系编号或用县界冒充州市界。

| 数据 | OSM 关系 | divisionCode | regionId |
| --- | --- | --- | --- |
| 云南省 | [913094](https://www.openstreetmap.org/relation/913094) | 530000 | — |
| 昆明市 | [2723597](https://www.openstreetmap.org/relation/2723597) | 530100 | kunming |
| 曲靖市 | [2718030](https://www.openstreetmap.org/relation/2718030) | 530300 | qujing |
| 玉溪市 | [2723502](https://www.openstreetmap.org/relation/2723502) | 530400 | yuxi |
| 保山市 | [2727146](https://www.openstreetmap.org/relation/2727146) | 530500 | baoshan |
| 昭通市 | [2402650](https://www.openstreetmap.org/relation/2402650) | 530600 | zhaotong |
| 丽江市 | [2729779](https://www.openstreetmap.org/relation/2729779) | 530700 | lijiang |
| 普洱市 | [2716205](https://www.openstreetmap.org/relation/2716205) | 530800 | puer |
| 临沧市 | [2725393](https://www.openstreetmap.org/relation/2725393) | 530900 | lincang |
| 楚雄彝族自治州 | [2727342](https://www.openstreetmap.org/relation/2727342) | 532300 | chuxiong |
| 红河哈尼族彝族自治州 | [2723404](https://www.openstreetmap.org/relation/2723404) | 532500 | honghe |
| 文山壮族苗族自治州 | [2718941](https://www.openstreetmap.org/relation/2718941) | 532600 | wenshan |
| 西双版纳傣族自治州 | [2715398](https://www.openstreetmap.org/relation/2715398) | 532800 | xishuangbanna |
| 大理白族自治州 | [2727745](https://www.openstreetmap.org/relation/2727745) | 532900 | dali |
| 德宏傣族景颇族自治州 | [2717249](https://www.openstreetmap.org/relation/2717249) | 533100 | dehong |
| 怒江傈僳族自治州 | [2729768](https://www.openstreetmap.org/relation/2729768) | 533300 | nujiang |
| 迪庆藏族自治州 | [2729695](https://www.openstreetmap.org/relation/2729695) | 533400 | diqing |

| 水体 | OSM 原始关系 | 处理 |
| --- | --- | --- |
| 泸沽湖 | [13495](https://www.openstreetmap.org/relation/13495) | 保留完整跨省湖面及岛屿孔洞 |
| 抚仙湖 | [13499](https://www.openstreetmap.org/relation/13499) | 湖面及孔洞 |
| 昆明翠湖 | [167607](https://www.openstreetmap.org/relation/167607) | 湖面及孔洞 |
| 洱海 | [254433](https://www.openstreetmap.org/relation/254433) | 湖面及孔洞；原型已有来源，本次重新获取官方对象 |
| 滇池 | [254775](https://www.openstreetmap.org/relation/254775) | 湖面及孔洞 |
| 怒江 | [215411](https://www.openstreetmap.org/relation/215411) | 主干道；裁切至省界 |
| 澜沧江 | [215354](https://www.openstreetmap.org/relation/215354) | Mekong 关系的云南主干道；裁切至省界 |
| 金沙江 | [9075912](https://www.openstreetmap.org/relation/9075912) | 主干道；裁切至省界 |

水体关系通过 Wikidata/OSM 搜索发现，但名称、类型和几何最终以官方 OSM 原始对象核验。每个 Feature 保存 `sourceUrl`、`osmRelationId`，下载收据保存 URL、抓取时间、字节数和 SHA-256；构建报告保存对象版本及最后编辑时间。原始数据保存在 `raw/`，不会在客户端运行时访问 OSM API。

## 许可与署名

这些几何数据及其本地简化衍生数据依照 **Open Database License 1.0（ODbL-1.0）** 提供。可复制、改编和转载，须署名，并遵守数据库衍生作品的相同许可要求。依据：[OSM Copyright](https://www.openstreetmap.org/copyright)、[ODbL 完整许可](https://opendatacommons.org/licenses/odbl/1-0/)。此说明不将网页代码或用户私人照片重新授权为 ODbL；不同作品的许可应分别说明。

地图上应保持可见且可点击的署名，例如：

> 地理数据 © OpenStreetMap contributors · ODbL

其中 `OpenStreetMap contributors` 链接到 `https://www.openstreetmap.org/copyright`，提供数据包时同时附此来源文件和 ODbL 链接。不要仅把署名放在无法访问的源码注释里。

## 重建方法

1. `download.mjs` 从官方 `/api/0.6/relation/{id}/full.json` 顺序获取关系、成员 ways 和 nodes；使用已有原始缓存，不重复打扰 API。抓取失败会直接失败，不用假地形填补。
2. 用各关系外环/内环 way 的真实节点坐标重建。每个共享 way 按 `(way ID, version, tolerance)` 只简化一次，保留其真实端点与原始坐标；没有平移、投影回写或取整。
3. 采用 Douglas–Peucker 简化。行政界容差 `0.001°`（纬向约 111 m）、湖面 `0.0001°`（约 11 m）、河线 `0.0005°`（约 56 m）；是绘制容差，不是原数据测量精度保证。
4. 只连接端点坐标完全相同的 way；不能闭合就报错，绝不插入手绘闭合线。输出外环逆时针、内环顺时针，保留真实岛屿孔洞。网页可用 SVG `fill-rule="evenodd"`。
5. 河流只读取主河道成员及明确 `waterway=river` 的无角色 way，排除支流/侧流关系；线段与省界求交后裁切。裁切点位于原河线段上，不是猜测位置。
6. `verify-geography.mjs` 验证每个原始收据、全部行政区 ID、WGS84 经纬顺序和范围、真实节点来源、闭合与环方向、proper 自交、16 州市共享边一致性和面积差。该轻量检查不冒充完整 GEOS 拓扑认证。

云南外边界实际范围：`[97.5277841, 21.1421849, 106.1968123, 29.2257206]`，顺序为 west/south/east/north。

## 运行

```powershell
node --use-env-proxy output/shanhai-yunnan/geography/download.mjs
node output/shanhai-yunnan/geography/build.mjs
node output/shanhai-yunnan/verify-geography.mjs
```

Node 24+ 的 `--use-env-proxy` 仅用于需要代理的本地下载环境；网页运行不需要 Node、Python、地图密钥或第三方在线请求。数据包体积和最终检查结果以 `build-report.json`、`validation-report.json` 为准，原始证据不必内嵌到网页。

## 云南详细底图早期未采用的来源

Overpass 主端点返回 406，两个备用端点超时，因此当时改用官方 OSM 编辑 API 的有限只读对象获取。geoBoundaries 的 CHN ADM1 较粗，未混入云南详细底图或将其当作 16 州市界；全国总览单独采用的 ADM1 示意层见本文开头，二者范围、许可及校验边界分别保留。
