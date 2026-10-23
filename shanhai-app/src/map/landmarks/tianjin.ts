import { A, G, I, P, R, S, W, path, rect, circle, house, scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
  'tianjin-eye': scene(
    path('M5 55h70v8H5Z', W) + circle(40, 29, 22) + path('M13 58 40 30 67 58M6 55h68', P),
    path('M40 7v44M18 29h44M24 13l32 32M24 45l32-32', 'none', S) + [0, 1, 2, 3, 4, 5, 6, 7].map(n => circle(40 + Math.cos(n * Math.PI / 4) * 22, 29 + Math.sin(n * Math.PI / 4) * 22, 2.7, A)).join('') + path('M14 60h14m25 0h13', 'none', P)),
  'tianjin-ancient-culture-street': scene(
    house(5, 40, 17, 20) + house(58, 40, 17, 20) + rect(25, 24, 5, 36, R) + rect(50, 24, 5, 36, R) + path('M19 25 28 14h23l10 11ZM24 34h31', A),
    rect(32, 23, 16, 7, G) + path('M29 16h22M9 46h8v8H9m54-8h8v8h-8M29 59h22M36 30v5m8-5v5') + circle(22, 39, 3, R) + circle(58, 39, 3, R)),
  'tianjin-dule-temple': scene(
    rect(16, 30, 48, 29) + path('m8 31 15-14h34l15 14Zm-3 17 13-11h44l13 11Z', S) + path('M10 60h60', A),
    path('M25 32v10m10-10v10m10-10v10m10-10v10M22 49v10m36-10v10') + rect(32, 49, 16, 10, R) + path('M29 20h22m-38 8-3-4m57 4 3-4', 'none', A)),
  'tianjin-jingyuan': scene(
    path('M7 58c12-15 46-15 66 0Z', G) + rect(15, 29, 49, 28) + path('m11 30 11-15h34l12 15Z', R) + rect(46, 22, 15, 35, A) + path('M45 23v-7h18v7Z', R),
    path('M21 36h7v9h-7m10-9h7v9h-7m-17 15v-6m12 6v-6M51 29h5v8h-5m0 8h5v12h-5') + path('M10 61h60M6 54V37m0 8 7-5', 'none', S)),
} satisfies LandmarkPack
