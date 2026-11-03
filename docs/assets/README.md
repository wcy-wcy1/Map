# README 视觉素材

## 品牌封面

- 文件：`shanhai-cover.png`
- 用途：山海集 README 品牌封面；属于概念插画，不是应用截图或真实地点摄影。
- 制作：2026-10-23，内置 `image_gen` 生成工具。
- 设计：冷瓷白、墨青、矿物青绿；中文宋体标题；山海景观与照片收藏意象。

生成提示词：

```text
Use case: ads-marketing.
Create a finished, exceptionally refined editorial brand cover image for the Chinese travel-memory product 山海集, used as the opening hero image in its GitHub README. This is a brand illustration, not an app interface or app screenshot. Landscape ratio about 2:1, high resolution.
Creative direction: contemporary Chinese travel art-book cover, quiet and confident, sensuous layered blue-green mountains becoming coastline and sea. Base palette: cool porcelain #EEF2EE, deep ink teal #183B3C, mineral jade #67958B, mountain blue #406778, tiny muted sandstone accents #C7AD77. Strong spatial composition, not a template or dashboard.
Composition: the left 40% is calm cool porcelain paper with very subtle tactile grain and beautiful intentional typography; the right 60% is an exquisite art-directed landscape vignette, like a delicate relief sculpture of mountains and islands in watercolor washes and translucent layers. Atmospheric mist, winding pale paths through mountains, one very small traditional pavilion, coastline and subtle contour-line details. A few small photographic-style travel frames are physically integrated into the lower-right landscape, evoking collecting memories, without UI frames or recognizable stock photos. Keep this restrained, spacious and sophisticated, not childish, no busy collage. Organic mountain silhouettes should sweep from lower center toward upper right. Fine luminous natural lighting, delicate shadows, controlled contrast.
Text, exact Chinese only: the large primary title on the left is “山海集”, vertically centered in the upper half, set in an elegant high contrast Chinese Song / Ming serif with beautiful clean strokes, not brush calligraphy. Below it, well spaced and much smaller on two lines: “把走过的地方” then “留在地图上”. Beneath this in smaller sober text: “旅行照片与手记的收藏地图”. Do not add any other text or badges, timestamps, fake statistics, navigation, software UI, logos, watermarks, or English taglines.
Ensure precise legible typography, excellent alignment, generous left padding and margins; the title should be clearly legible at GitHub content width. The cover should feel like a serious crafted travel journal brand. Avoid beige-and-terracotta generic editorial styling, black-and-neon, shiny plastic 3D, harsh gradients, giant sun disks, paper torn edges, repeated boxes, cartoon map pins, or a geographic country outline.
```

## 产品地标画廊

- 文件：`shanhai-landmark-gallery.svg`（桌面横幅）、`shanhai-landmark-gallery-mobile.svg`（窄屏竖版）
- 来源：`shanhai-app/src/map/landmarks/` 中已用于产品的原创地标 SVG。
- 生成源：`generate-landmark-gallery.mjs`。从仓库根目录执行 `node docs/assets/generate-landmark-gallery.mjs`；需先安装前端依赖。
- 本图是地标素材的编辑排版展示，不是产品界面截图。地标分类与名称来自当前目录。
