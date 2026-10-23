import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'qinghai-qinghai-lake': scene(path('M5 33 22 21l16 7 17-12 20 17',G)+ellipse(40,46,35,14,W)+path('M5 57c24-6 44 7 70-2v7H5Z',A),path('M15 43h24m9 8h18m-40 4h17','none',P)+path('M12 58v-5m5 5v-6m6 7v-6m41 7v-6','none',G)),
 'qinghai-kumbum': scene(house(8,36,25,23,A)+house(35,24,34,35,A)+path('M31 25 51 11l22 14ZM5 60h70',A),path('M14 40h6v8h-6m5-8h6v8h-6m15-10h6v9h-6m10-9h6v9h-6M44 59V46h13v13',R)+path('M51 11V5m-4 5h8')),
 'qinghai-rongwo': scene(path('M5 34 19 12l18 15 18-13 20 22',G)+rect(8,38,26,22,P)+rect(30,27,34,33,P)+rect(61,43,13,17,A)+path('M27 28h40l-7-10H35Z',A),path('M9 45h24m-3-9h34','none',R)+path('M37 40h5v7h-5m12-7h5v7h-5M41 60V50h11v10',R)),
 'qinghai-qutan': scene(house(10,39,60,21,S)+house(23,26,35,18,S)+path('M18 27 31 14h19l13 13Z',S),path('M18 42v18m43-18v18m-32-31v13m22-13v13M33 60V47h14v13',R)+path('M8 62h64m-43-42h23','none',A)),
} satisfies LandmarkPack
