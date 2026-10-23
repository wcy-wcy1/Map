import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'ningxia-sand-lake': scene(path('M5 47c14-23 22-25 39-16 14-14 24-10 31 5v25H5Z',A)+path('M5 50c23-10 41 0 70-5v16H5Z',W),path('M12 49V28m8 23V34m45 12V27','none',S)+path('M12 28v-8m8 14v-8m45 1v-8','none',A)+path('M30 54h16m8 5h15','none',P)),
 'ningxia-western-xia': scene(path('M5 61c24-14 42-12 70-2Z',G)+path('M19 59 29 26l10-13 12 13 11 33Z',A)+path('m8 49 6-18 9 18m40 3 5-18 7 18',A),path('M26 35h27m-30 9h33m-36 9h39m-25-29 5-4 5 4','none',P)+path('M37 28v28m11-20 4 20','none',S)),
 'ningxia-shuidonggou': scene(path('M5 60V27l17-14 12 15-7 17 9 15Zm70 0V20L58 9 47 28l7 18-10 14Z',A)+path('M34 60 40 38l7 22Z',G),path('m11 33 13-8m-13 18 13-8m35-17 9 7m-12 5 13 7m-13 8 14 7','none',P)+path('M13 60V49h9v11m37 0V49h9v11',I)),
 'ningxia-zhenbeibu': scene(path('M7 60V27h12v-6h9v6h24v-6h9v6h12v33Z',A)+path('M31 60V45c0-17 20-17 20 0v15Z',I),path('M13 34h10m-10 9h10m-10 10h10m34-19h10m-10 9h10m-10 10h10M24 27l2 9m27-9-2 7','none',P)+path('M7 62h66','none',S)),
} satisfies LandmarkPack
