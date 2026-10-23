import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'chongqing-hongya': scene(path('M5 56h70v7H5Z',W)+rect(10,39,60,18,A)+rect(19,26,43,20,A)+rect(29,15,25,16,A)+path('m23 16 18-11 18 11ZM13 28h55M5 41h70M8 50h64',S),path('M16 43v13m10-13v13m10-13v13m10-13v13m10-13v13m10-13v13M25 30v7m11-7v7m11-7v7m11-7v7M35 19v6m12-6v6','none',R)),
 'chongqing-dazu': scene(path('M5 60V27l20-15 22 6 23-6 5 48Z',A)+path('M10 45c19-9 40-9 60 0v15H10Z',S)+circle(22,35,6,P)+circle(40,31,7,P)+circle(58,35,6,P),path('M15 55V47c0-10 14-10 14 0v8Zm16 1V45c0-13 18-13 18 0v11Zm20-1V47c0-10 14-10 14 0v8Z',P)+path('M19 46l4 6m13-9 5 11m13-7 5 5','none',R)),
 'chongqing-gongtan': scene(path('M5 61V36l25-10 22 11 23 17v7Z',S)+path('M5 56c20-8 44-7 70-2v9H5Z',W)+house(9,33,25,17,A)+house(45,40,25,15,A),path('M13 50v10m15-10v8m22-3v7m14-7v7M34 59l4-21 6-4','none',P)+path('M15 38h7v7h-7m37 1h7v7h-7',R)),
 'chongqing-diaoyu': scene(path('M5 61 14 36l23-17 20 11 18 31Z',G)+path('M11 57 23 37h38l11 20Z',S)+path('M20 38v-7h7v7h9v-7h8v7h9v-7h8v7',A),path('M33 57V49a8 8 0 0 1 16 0v8Z',I)+path('M24 44h7m21 0h9M16 53h14m22 0h16','none',P)+path('M30 61h22','none',A)),
} satisfies LandmarkPack
