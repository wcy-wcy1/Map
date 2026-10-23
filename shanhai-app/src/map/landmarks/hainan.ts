import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'hainan-tianya': scene(path('M5 41h70v21H5Z',W)+path('M5 58c19-10 38 0 70-7v11H5Z',A)+path('M16 56V36l12-13 13 5 5 28Zm32-2 3-16 10-6 9 23Z',S),path('m24 33-2 16m11-12 4 9m20-7-2 9','none',P)+path('M8 48h8m30-4h11m6 16h9','none',P)),
 'hainan-nanshan': scene(path('M5 51h70v12H5Z',W)+path('M7 55c20-9 44-9 66 0Z',G)+house(25,30,39,25,A)+path('m20 31 24-17 24 17Z',A),path('M31 34v20m27-20v20M39 55V41h12v14',R)+path('M12 53V26m0 7C2 19 6 17 12 26c5-14 13-9 10-5m-10 9 10-1','none',S)),
 'hainan-boao': scene(path('M5 29h70v33H5Z',W)+path('M5 57c21-18 41-12 70-30v9C53 53 30 49 9 62H5Z',A)+path('M5 29c12-1 23 4 31 10L5 53Z',G),path('M18 29v-12m0 3-8-3m8 4 8-7m-10 39 23-9m8-2 16-8','none',P)+path('M50 56h17m-55-22h8','none',P)),
 'hainan-dongpo': scene(path('M5 58c16-14 43-15 70 0Z',G)+house(16,34,50,24,S)+house(27,23,27,15,S),path('M23 37v21m35-21v21M35 58V44h13v14',R)+path('M9 58V24m0 7L3 21m6 9 10-11m49 39V26m0 8 7-8','none',S)+rect(31,32,18,5,A)),
} satisfies LandmarkPack
