import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'anhui-huangshan': scene(path('m5 60 13-27 10-6 10-17 9 22 11-11 17 39Z',S)+path('M19 58 24 37l14-27-1 28 11 22Z',G)+path('M57 52V25m0 8-13-6m13 4 13-7'),path('M43 27c0-7 16-10 20-4 12-3 13 7 3 7Z',G)+path('m27 33 3 13m31-17 4 17M8 54h13m23 4h26','none',P)),
 'anhui-hongcun': scene(ellipse(40,53,35,10,W)+house(6,32,22,19,S)+house(31,26,20,25,S)+house(55,35,18,17,S)+path('M29 51V29h5V18h5v8h8v-7h5v32Z',P),path('M12 39h5v9h-5m24-12h5v14h-5m20-7h5v7h-5')+path('M13 57h15m10 3h22','none',P)),
 'anhui-chengkan': scene(house(7,39,21,22,S)+house(28,24,24,24,S)+house(48,42,26,19,S)+path('M7 40v-9h5v-5h7v5h9v9M28 25v-9h6v-5h8v5h10v9',P),path('M14 46h6v10h-6m20-25h7v12h-7m15 5h7v11h-7M29 61V49h17v12',R)+path('M5 63h70')),
 'anhui-tangyue': scene(path('M10 60V32h5v28m15 0V24h5v36m15 0V24h5v36m15 0V32h5v28',A)+path('M6 33h73M25 25l17-12 18 12ZM7 43h70',S),path('M14 36h16m25 0h15M35 29h15M19 32V22h5v10m36 0V22h5v10M8 61h67')+path('m12 18 8-6 9 6m25 0 8-6 9 6',G)),
} satisfies LandmarkPack
