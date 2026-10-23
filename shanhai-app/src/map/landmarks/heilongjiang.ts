import { A,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'heilongjiang-saint-sophia': scene(rect(18,35,44,25,R)+rect(31,24,18,17,R)+path('M28 25c-2-13 12-12 12-21 0 9 14 8 12 21Z',S)+path('M10 38c-2-11 10-12 10-17 0 5 11 6 10 17Zm41 0c-2-11 9-12 9-17 0 5 12 6 11 17Z',S),path('M34 60V49a6 6 0 0 1 12 0v11Z',I)+path('M22 43h5v9h-5m26-9h5v9h-5M40 5V1m-3 3h6','none',A)),
 'heilongjiang-wudalianchi': scene(path('M5 40 23 16h16l17 24Z',S)+ellipse(31,17,9,4,A)+ellipse(20,43,14,6,W)+ellipse(43,41,13,6,W)+ellipse(61,47,13,6,W)+ellipse(42,54,14,6,W)+ellipse(18,57,12,5,W),path('M24 17h14m-17 11-5 9M13 43h10m31 4h10m-30 7h10','none',P)),
 'heilongjiang-hengdaohezi': scene(house(8,36,64,22,A)+house(31,22,19,36,A)+path('M5 62h70M9 57h62',S),path('M14 42h7v9h-7m11-9h7v9h-7m21-9h7v9h-7m11-9h6v9h-6')+circle(40,29,4,P)+path('M40 26v4h3M36 58V43h9v15m-34 3v4m12-4v4m33-4v4m12-4v4')),
 'heilongjiang-zhalong': scene(ellipse(40,52,34,10,W)+path('M12 48V22m8 27V31m45 16V19',S)+path('M12 22v-8m8 17v-8m45-4v-8','none',A)+path('M28 46c6 7 18 6 20-1l-6-4c-6-6-3-15 3-15l4 3-5 1c-3 2-2 7 1 11l7 5',P),path('M34 50v9m8-10v10M8 37l4 4 5-6m44-6 4 4 6-6')+circle(45,27,1.5,R)+path('M20 57h8m23 0h13','none',P)),
} satisfies LandmarkPack
