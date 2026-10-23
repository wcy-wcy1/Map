import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'jiangxi-lushan': scene(path('m5 60 12-30 11 7 14-26 12 16 9-8 12 41Z',G)+path('M38 28h10L39 56H27Z',W)+path('M7 40c10-6 20 5 31-1m6 10c10-7 20 3 29-2','none',P),path('m42 11 1 17-10 14m30-23-6 18','none',S)+path('M34 33 30 49','none',P)+house(55,46,15,14,A)),
 'jiangxi-tengwang': scene(path('M5 55h70v8H5Z',W)+rect(19,42,43,16,P)+rect(27,26,27,20,R)+path('m23 27 17-16 18 16Zm-4 10h44m-52 9h60M13 59h55',A),path('M32 29v7m15-7v7m-20 2v7m27-7v7M25 48v10m29-10v10M37 59V49h9v10',R)+path('M40 11V7')),
 'jiangxi-yaoli': scene(path('M5 39 19 19l20 15 19-20 17 23',G)+path('M5 49c25-8 47 5 70-2v15H5Z',W)+house(6,34,22,19,S)+house(49,29,25,22,S),path('M22 57v-7c9-11 23-11 32 0v7h-6c-4-10-15-10-20 0Z',A)+path('M12 40h5v10h-5m38-15h6v9h-6M32 60h12','none',P)),
 'jiangxi-white-deer': scene(path('M5 42 21 20l19 9 15-16 20 27',G)+house(14,38,52,22,S)+house(28,25,25,14,S),path('M21 41v18m36-18v18M34 45h12v15h-12',R)+path('M6 59V35m0 6 7-7m61 25V33m0 9 7-6M12 62h56','none',S)),
} satisfies LandmarkPack
