import { A, G, I, P, R, S, W, path, rect, ellipse, house, scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
  'hebei-shanhaiguan': scene(
    path('M5 61V41h12v-6h8v6h30v-6h8v6h12v20Z', A) + house(24, 28, 32, 15, S) + path('M19 28 28 17h24l10 11Z', S),
    path('M34 61V50a6 6 0 0 1 12 0v11Z', I) + path('M29 32h5v7h-5m8-7h5v7h-5m7-7h5v7h-5M7 49h19m29 0h18M7 56h19m29 0h18', 'none', P)),
  'hebei-mountain-resort': scene(
    path('M5 36 20 15l17 18 16-19 22 23', G) + ellipse(40, 52, 34, 10, W) + house(27, 34, 30, 19, A) + path('m23 34 19-15 19 15Z', A),
    path('M33 36v17m18-17v17M39 41h6v12h-6') + path('M11 50h11m35 8h9', 'none', P) + path('M12 47V30m0 5-6-5m6 7 7-7', 'none', S)),
  'hebei-longxing-temple': scene(
    house(11, 35, 58, 24, S) + path('m7 36 14-11h38l14 11ZM23 24l17-12 17 12Z', S) + rect(29, 24, 22, 12, A),
    path('M19 39v20m10-20v20m22-20v20m10-20v20M34 29h12M35 59V46h10v13', R) + path('M8 62h64m-42-2h20', 'none', A)),
  'hebei-jimingyi': scene(
    path('M5 61V42h70v19Z', A) + path('M5 42v-6h6v6h8v-6h6v6m30 0v-6h6v6h8v-6h6v6', A) + house(25, 30, 30, 15),
    path('M34 61V50a6 6 0 0 1 12 0v11Z', I) + path('M31 34h6v7h-6m12-7h6v7h-6M8 51h18m27 0h20M13 58h13m27 0h14') + path('m28 20 12-8 13 8', 'none', R)),
} satisfies LandmarkPack
