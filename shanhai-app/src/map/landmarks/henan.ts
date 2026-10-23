import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'henan-longmen': scene(path('M5 56V25l15-12 19 7 14-11 22 18v29Z',A)+path('M25 55V31c0-16 30-16 30 0v24Z',S)+circle(40,30,6,P)+path('M30 54V43c0-12 20-12 20 0v11Z',P)+path('M5 56h70v7H5Z',W),path('M10 43V32h8v11m45 2V31h8v14',I)+path('M35 39l5 9 6-9M31 51h19m-37 9h18m21 0h13','none',G)),
 'henan-shaolin': scene(house(8,39,40,21,S)+path('M58 59V20h12v39Z',A)+path('m54 21 10-11 10 11ZM54 30h20m-20 9h20m-20 9h20',S),rect(21,47,13,13,R)+path('M15 42v18m26-18v18m21-35v4m0 6v4m0 6v4M8 62h66')),
 'henan-guanlin': scene(house(27,36,44,24,R)+path('M15 59V20m0 12-8-8m8 14 12-14'),path('M5 22c-2-15 19-20 23-6 10 6 3 17-8 12-7 7-16 4-15-6Z',G)+path('M33 39v20m30-20v20M43 60V46h12v14',R)+path('M32 29h30m-6-10h11','none',A)),
 'henan-shedian': scene(house(10,38,59,22,S)+rect(27,23,26,16,R)+path('m21 24 12-13h14l12 13Zm-15 15h48',A),path('M17 42v18m45-18v18M34 60V47h13v13',R)+rect(34,27,12,7,A)+path('M6 54V37m68 17V37')+circle(6,42,3,R)+circle(68,42,3,R)),
} satisfies LandmarkPack
