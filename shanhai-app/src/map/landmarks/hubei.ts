import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'hubei-yellow-crane': scene(rect(27,19,26,39,R)+path('m22 20 18-12 18 12ZM19 30h42M16 40h48M11 51h58M8 61h64',A),path('M32 22v6m16-6v6m-20 5v5m24-5v5m-28 6v5m32-5v5M35 59v-6h10v6','none',P)+path('M40 8V4')),
 'hubei-wudang': scene(path('m5 61 13-23 9 3 12-27 12 21 10-4 14 30Z',G)+house(30,27,22,16,A)+path('M24 61 37 43h8l12 18Z',P),path('M36 30v11m10-11v11M32 49h18m-22 6h26','none',R)+path('m16 46 9 4m31-8 9 8','none',S)),
 'hubei-longzhong': scene(path('M5 38 19 19l18 12 20-17 18 25',G)+rect(24,29,6,31,A)+rect(50,29,6,31,A)+path('M19 30 29 18h22l10 12ZM22 41h36',S),rect(32,28,16,8,P)+path('M8 59V34m0 8-5-6m5 2 7-8m54 30V33m0 7 6-6M24 62h32','none',S)),
 'hubei-guqin-terrace': scene(ellipse(40,55,35,8,W)+house(31,31,34,23,S)+path('M7 47h21v9H7Z',A),path('M37 34v19m22-19v19M14 44l11 3m-11 1 11 3m-11-7v9M46 39h6v15h-6',R)+path('M10 35v-14m0 8 8-7m-8 8-6-5','none',G)),
} satisfies LandmarkPack
