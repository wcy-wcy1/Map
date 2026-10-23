import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'hongkong-victoria-peak': scene(path('m5 60 16-30 17-14 17 18 20 26Z',G)+path('M5 58c25-12 45-1 70-10v14H5Z',W)+path('M25 29h33l-6 12H31Z',P)+rect(34,41,15,11,S),path('M27 32h29m-25 5h21M12 57V46h6v9m38 0V42h6v12m4 0V47h5v7','none',S)),
 'hongkong-big-buddha': scene(path('M5 62 18 45h44l13 17Z',G)+ellipse(40,53,23,7,A)+circle(40,22,8,S)+path('M24 50V39c0-16 31-16 31 0v11Z',S),path('M37 16v-3h7v4M29 48l8-11 10 12m3-10 5-10m-1 2 3-6','none',A)+path('M22 57h37m-42 5h46','none',P)),
 'hongkong-tang-pagoda': scene(path('M24 60 28 23l12-8 13 8 4 37Z',S)+path('M23 25h34M21 38h38M19 51h42',A),path('M35 60V52h11v8m-10-13v-6h8v6m-8-13v-6h8v6',I)+path('M40 15V9M18 62h45m-36-32h7m12 0h7','none',P)),
 'hongkong-tai-o': scene(path('M5 45h70v17H5Z',W)+house(6,29,27,20,S)+house(48,34,27,20,A)+path('M10 49v13m17-13v13m26-8v8m16-8v8',S),path('M14 34h6v8h-6m37-3h6v8h-6M31 46h18M35 56h11l-3 4h-5Z',R)+path('M9 58h10m38 3h7','none',P)),
} satisfies LandmarkPack
