import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'taiwan-taipei-101': scene(rect(29,17,23,43,B)+path('M26 58h29l-3-10H29Zm0-12h29l-3-10H29Zm0-12h29l-3-10H29Zm0-12h29l-3-10H29Z',S)+path('M40 12V3'),path('M34 14v7m12-7v7m-12 5v7m12-7v7m-12 5v7m12-7v7m-12 5v7m12-7v7','none',P)+path('M20 62h41',A)),
 'taiwan-sun-moon-lake': scene(path('M5 39 18 18l15 12 18-19 24 28',G)+ellipse(40,49,35,12,W)+ellipse(43,48,8,4,G),path('M19 44h15m16 11h15','none',P)+house(49,31,14,11,R)+path('M54 33v8m-11 5v-7m-3 3 3-5 3 5','none',S)),
 'taiwan-lin-garden': scene(ellipse(40,54,34,8,W)+house(31,33,34,22,R)+path('M5 51V31h23v24H5Z',P)+circle(16,44,8,G),path('M38 35v20m19-20v20M45 42h6v13h-6',S)+path('M7 31h23m-23 29h22m15 1h16','none',A)),
 'taiwan-lukang': scene(house(11,37,59,23,R)+path('M6 38 24 22l17 8 16-8 18 16Z',R),path('m17 27-5-9 9 5m44 4 5-9-9 5M21 40v20m39-20v20M34 60V46h13v14',A)+path('M27 31h27M8 62h65','none',S)),
} satisfies LandmarkPack
