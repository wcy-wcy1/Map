import { A, G, I, P, R, S, W, path, rect, circle, house, scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
  'shanxi-pingyao': scene(
    path('M5 61V44h70v17Z', S) + house(27, 27, 26, 23, A) + path('m22 28 11-12h14l11 12Zm-2 10h40', A) + path('M5 44v-6h6v6h8v-6h6v6m30 0v-6h6v6h8v-6h6v6', S),
    path('M34 61V51a6 6 0 0 1 12 0v10Z', I) + path('M33 30v6m14-6v6M31 41h18M8 53h16m33 0h15', 'none', P)),
  'shanxi-yungang': scene(
    path('M5 61V27l16-11 17 6 15-12 22 17v34Z', A) + path('M15 60V40c0-28 50-28 50 0v20Z', S) + circle(40, 32, 8, A) + path('M27 60V46c0-11 26-11 26 0v14Z', A),
    path('M35 31h2m6 0h2m-6 6h3M34 43l6 11 7-12M29 55h22M9 32l4-5m51-7 6 9', 'none', P)),
  'shanxi-foguang-temple': scene(
    path('m4 42 15-23 17 13 16-20 24 29', G) + house(12, 37, 56, 23, S) + path('M7 38 20 25h40l13 13Z', S),
    path('M19 39v20m10-20v20m22-20v20m10-20v20', 'none', R) + rect(34, 44, 12, 16, A) + path('M21 29h38M7 62h66m-64-28-4-5m67 5 4-5')),
  'shanxi-wooden-pagoda': scene(
    path('M24 60 29 17h22l5 43Z', A) + path('m24 18 16-11 16 11ZM22 27h36M20 36h40M18 45h44M16 54h48', S),
    path('M33 20v5m14-5v5m-15 4v5m16-5v5m-17 4v5m18-5v5m-19 4v5m20-5v5M40 7V3M35 60v-6h10v6', R) + path('M13 62h54', 'none', A)),
} satisfies LandmarkPack
