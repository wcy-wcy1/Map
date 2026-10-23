import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'hunan-wulingyuan': scene(path('M6 61 10 31h11l4 30m2 0 4-48h12l2 48m5 0 3-36h12l5 36',S)+path('M8 31h15m6-18h16m7 12h15','none',G),path('M15 36v18m22-35v34m21-22v22','none',P)+path('M6 52c14-6 26 7 39 0m4-8c8-4 18 3 25 0','none',W)),
 'hunan-yueyang': scene(ellipse(40,56,34,7,W)+rect(25,26,30,30,R)+path('m19 27 21-14 21 14Zm-3 12h48m-53 13h58',A),path('M31 29v8m18-8v8m-20 5v8m22-8v8M35 56v-5h10v5','none',P)+path('M19 59h43m-47-11-4-4m54 4 4-4')),
 'hunan-hongjiang': scene(path('M5 61V43l25-15 40-7 5 40Z',G)+house(7,43,22,18,S)+house(32,27,21,19,S)+house(51,43,23,18,S),path('M29 62V49h14V37M16 49h5v12h-5m23-28h5v10h-5m15 16V49h6v12',R)+path('M27 58h10m-8-5h10m-3-6h9','none',P)),
 'hunan-qianyang': scene(path('M5 52h70v11H5Z',W)+path('M7 54V37h66v17Z',A)+house(23,27,32,15,S)+path('M7 37 15 30h7m34 0h8l9 7',S),path('M33 54V46a7 7 0 0 1 14 0v8Z',I)+path('M28 31h6v7h-6m12-7h6v7h-6M10 43h15m30 0h14M20 60h20m14-2h12','none',P)),
} satisfies LandmarkPack
