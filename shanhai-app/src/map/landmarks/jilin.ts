import { A,B,G,I,P,R,S,W,path,rect,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'jilin-heaven-lake': scene(path('m5 57 5-21 13-17 14 7 12-15 17 15 9 31Z',S)+ellipse(40,44,25,11,W)+path('m12 34 11-15 14 7-7 7-8-4Zm26-6 11-17 17 15-12-4-5 7Z',P),path('M21 45h16m8 5h13','none',P)+path('m11 48 6-5m46-6 7 8','none',G)),
 'jilin-puppet-palace': scene(rect(9,34,62,26,A)+rect(29,21,24,39,P)+path('m5 35 13-12h43l14 12Zm20-13 16-12 16 12Z',S),path('M15 40h6v7h-6m43-7h6v7h-6M35 28h5v8h-5m9-8h5v8h-5')+rect(35,45,12,15,R)+path('M7 62h66')),
 'jilin-goguryeo': scene(path('M5 61 10 42l22-9 38 8 5 20Z',G)+path('M10 54V39l22-9 38 8v18l-38-8Z',S)+path('M10 39v-5l22-9 38 8v5l-38-8Z',A),path('M32 30v18m-17-6 12-5m-13 12 13-5m11-9 27 6m-27 2 27 6','none',P)+path('M42 61V49h9v12',R)),
 'jilin-fangchuan': scene(path('M5 39c17-11 39-7 70-15v37H5Z',G)+path('M5 47c19-9 48 0 70-14v9C54 55 32 50 11 61H5Z',W)+rect(47,22,17,22,P)+path('m43 23 13-10 12 10Zm0 9h24',A),house(11,33,19,15,S)+path('M17 40h6v8h-6m35-20v11m7-11v11M31 58h17','none',P)),
} satisfies LandmarkPack
