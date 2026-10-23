import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'jiangsu-humble-garden': scene(ellipse(40,54,34,9,W)+house(30,30,26,23,S)+path('m24 31 19-16 19 16ZM5 49h25v5H5Z',P),path('M35 32v21m16-21v21M10 49V33m0 5-5-5m5 5 7-7')+path('M8 32c-8-14 14-18 16-6 6 9-8 14-16 6Z',G)+path('M25 58h12m13 2h15','none',P)),
 'jiangsu-sun-mausoleum': scene(path('M5 61 20 34h40l15 27Z',G)+path('M22 60 34 33h13l12 27Z',P)+house(25,25,30,14,B)+path('m21 26 12-13h15l11 13Z',B),path('M32 30h5v9h-5m12-9h5v9h-5M31 43h19m-21 5h23m-26 5h29m-32 5h35','none',S)),
 'jiangsu-huishan': scene(path('M5 34 24 15l17 14 17-11 17 19',G)+path('M25 36h27l13 26H13Z',W)+house(6,37,22,22,S)+house(51,29,23,26,S),path('M12 43h6v10h-6m42-17h6v9h-6m5-9h6v9h-6M23 53h35v5H23Z',A)+path('M32 60h15','none',P)),
 'jiangsu-ge-garden': scene(path('M7 60V32h66v28Z',P)+path('M29 60V44a11 11 0 0 1 22 0v16Z',G)+path('m48 60 6-24 7-7 5 19 8 12Z',S),path('M15 59V15m8 44V24m-8 2-9-8m9 16 9-12m-1 19 8-9M12 29h6m-6 10h6m-6 10h6')+path('m55 49 5-7 4 9M5 32h70','none',A)),
} satisfies LandmarkPack
