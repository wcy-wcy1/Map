import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'guangdong-canton-tower': scene(path('M5 57h70v6H5Z',W)+path('M27 58c12-21 10-27 3-44h22c-7 18-7 25 2 44Z',P)+path('M43 14V3',S),path('m30 16 17 40m4-40L33 57m-1-33h17m-14 8h12m-11 8h10m-13 8h16','none',S)+ellipse(41,15,11,3,R)),
 'guangdong-kaiping': scene(path('M5 55c15-12 39-10 70 0v7H5Z',G)+rect(14,28,21,31,A)+rect(42,21,24,38,P)+path('M10 29v-7h29v7ZM39 22l15-11 15 11Z',S),path('M19 34h5v6h-5m0 7h5v6h-5m25-25h5v6h-5m5-6h5v6h-5m-13 8h5v6h-5m8-6h5v6h-5M50 59V49h8v10',R)),
 'guangdong-chen-clan': scene(house(9,37,62,23,S)+path('M8 31 18 24l10 4 12-9 12 9 10-4 10 7',A)+path('M20 28v8m40-8v8',R),path('M17 40v20m46-20v20M31 60V45h18v15',R)+path('m15 28-3-9 7 5m46 4 4-9-7 5M33 26l7-4 7 4','none',G)+rect(32,35,16,6,A)),
 'guangdong-guangji': scene(path('M5 50h70v13H5Z',W)+path('M5 45h25v7H5Zm45 0h25v7H50Z',A)+house(8,31,17,16,S)+house(55,31,17,16,S)+path('M30 50h20',R),path('M12 47v13m9-13v13m39-13v13m9-13v13M30 53l3 4 3-4m0 0 4 4 4-4m0 0 3 4 3-4',A)+path('M13 34v10m46-10v10M34 61h14','none',P)),
} satisfies LandmarkPack
