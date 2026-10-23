import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'shanghai-oriental-pearl': scene(path('M5 56h70v6H5Z',W)+path('M29 58 38 18h4l9 40M40 18V5',S)+circle(40,23,6,R)+circle(40,44,12,R)+rect(11,37,10,20,P)+rect(60,30,10,28,P),path('M29 44h22m-16-5v10m10-10v10M16 41v11m49-16v16','none',P)+circle(40,11,2,A)),
 'shanghai-yu-garden': scene(ellipse(40,54,34,8,W)+house(27,33,39,19,S)+path('m23 34 23-17 24 17Zm-16 22 12-7 12 7 10-7',A),path('M33 35v17m25-17v17M43 40h7v12h-7')+path('M8 48 13 30l8 5 5 17Z',S)+path('m14 36 3 8m15 15h26','none',P)),
 'shanghai-slaughterhouse': scene(rect(8,21,64,39,S)+rect(15,29,50,31,P)+ellipse(40,28,24,10,A)+ellipse(40,28,13,5,P)+path('M16 43 62 30v8L16 52Z',S),path('M22 34v25m12-24v24m12-24v24m12-25v25M11 24h4m50 0h4m-40 18 24 11','none',I)),
 'shanghai-xujiahui-cathedral': scene(rect(14,28,13,32,R)+rect(53,28,13,32,R)+path('m12 29 9-21 9 21Zm39 0 9-21 9 21Z',S)+path('M27 60V39l13-12 13 12v21Z',R),circle(40,39,5,P)+path('M35 60V52a5 5 0 0 1 10 0v8Z',I)+path('M18 34h5v12h-5m33-12h5v12h-5M21 8V3m39 5V3','none',A)),
} satisfies LandmarkPack
