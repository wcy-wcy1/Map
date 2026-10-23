import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'xizang-potala': scene(path('M5 61 18 34l25-17 25 23 7 21Z',S)+path('M10 54 14 35h14V24h33l7 30Z',P)+rect(30,17,23,28,R)+path('M27 18h29l-5-8H33Z',A),path('M18 40h6v5h-6m-1 5h6v5h-6m34-17h6v5h-6m1 5h6v5h-6m-29-25h5m8 0h5m-18 7h5m8 0h5','none',A)+path('M37 61V49h10v12',P)),
 'xizang-namtso': scene(path('m5 34 16-18 15 12L52 9l23 25Z',B)+path('m52 9-10 12 9-3 6 7 5-4Z',P)+ellipse(42,47,33,14,W)+path('M5 58 9 33l9-10 7 35Z',A),path('m14 29 2 21m14-7h19m-9 11h23','none',P)+path('m61 60 6-6 8 6',G)),
 'xizang-sakya': scene(path('M6 60V28h16v-7h36v7h16v32Z',S)+path('M7 35h66m-66 9h66','none',R)+path('M7 39h66','none',P)+rect(27,27,27,33,A),path('M35 60V44h11v16',I)+path('M12 48h6v8h-6m46-8h6v8h-6M32 34h16M31 22h18','none',P)),
 'xizang-guge': scene(path('m5 61 5-23 9-7 7 8 9-17 8 3 8-16 12 24 12 28Z',A)+rect(40,16,19,14,P)+path('M38 17v-6h6v5h7V9h6v8',A),path('m16 39-1 17m14-10-3 13m12-28-4 25m23-19 6 20','none',P)+path('M43 30v-6h5v6m-18 16v-6h5v6m12 3v-8h5v8',I)),
} satisfies LandmarkPack
