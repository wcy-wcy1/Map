import { A,G,I,P,R,S,W,path,rect,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'liaoning-mukden-palace': scene(path('M18 57V34l22-14 22 14v23Z',R)+path('m10 35 30-25 30 25Zm4 10h52',A),path('M25 36v20m10-24v24m10-24v24m10-20v20', 'none',P)+path('M30 60h20M40 10V6')+rect(36,44,8,14,I)),
 'liaoning-laohutan': scene(path('M5 45c15-21 28-24 42-11 12-7 19-4 28 7v20H5Z',W)+path('M5 45 14 26l11 11 13-6 12 18-19 7Z',G)+path('M43 43c10-14 19-9 24-3-8-1-11 3-14 8Z',S),path('M13 45 18 35l6 9m-6 6 9-2M47 55h18m-31 5h14','none',P)+path('m53 43 4-8m-4 8-3 6')),
 'liaoning-niuheliang': scene(path('M5 59c9-21 24-22 35-31 18-6 27 13 35 31Z',G)+ellipse(40,47,26,13,A)+ellipse(40,44,18,8,P)+ellipse(40,43,9,4,A),path('M16 48v6m8-5v8m9-7v9m14-9v9m9-11v9m8-11v8M20 37l4-8 7-4','none',S)),
 'liaoning-benxi-cave': scene(path('M5 60V30l14-17 28-5 23 19 5 33Z',S)+path('M17 60V38c0-24 46-24 46 0v22Z',I)+path('M18 51c15-5 30 3 45-3v12H18Z',W)+path('m25 25 4 20 7-24 6 17 6-17 8 23 4-15',A),path('M29 54h23l-5 5H34Z',R)+path('M40 54V43m-9 8h15','none',P)),
} satisfies LandmarkPack
