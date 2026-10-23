import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'shandong-taishan': scene(path('m5 61 12-19 10-6 9-21 11 7 13 14 15 25Z',S)+path('M23 61 36 25h9L55 61Z',P)+house(28,23,24,14,R),path('M34 38h13m-15 6h17m-20 7h23m-25 6h26M36 36v-8h8v8',I)+path('m8 50 9-4m46-3 7 12','none',G)),
 'shandong-confucius-temple': scene(house(18,34,54,25,A)+path('m13 35 15-15h32l17 15Z',A)+path('M9 59V25m0 8-6-6m6 10 8-13'),path('M24 37v22m10-22v22m20-22v22m10-22v22','none',R)+path('M4 25c-2-12 14-14 17-4 6 8-10 12-17 4Z',G)+rect(39,45,10,15,R)),
 'shandong-qingzhou': scene(path('M5 61V42h70v19Z',A)+house(22,31,36,14,S)+path('m17 32 12-12h23l12 12Z',S),path('M31 61V52c0-13 18-13 18 0v9Z',I)+path('M7 42v-5h8v5m49 0v-5h9v5M28 35h6v7h-6m12-7h6v7h-6M10 52h15m30 0h14','none',P)),
 'shandong-penglai': scene(path('M5 53h70v9H5Z',W)+path('M13 59 23 40l35-8 10 25Z',S)+house(30,29,29,19,R)+path('m25 30 19-16 20 16Zm-2 9h43',A),path('M35 32v7m17-7v7m-12 3h8v6h-8M20 53l9-7m28-1 5 9','none',P)+path('M6 59h9m48 2h11','none',P)),
} satisfies LandmarkPack
