import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'neimenggu-xiangshawan': scene(path('M5 60V43C18 17 35 12 47 23c15-13 23-6 28 4v33Z',A)+path('M5 60c13-22 30-14 42-37-5 22 15 15 28 37Z',P),path('M13 48c8-8 15-9 20-14m24-5 11-5M48 50c11-2 18 4 24 8','none',S)+path('M20 58h14m24 3h13','none',A)),
 'neimenggu-hulun-lake': scene(path('M5 38c21-14 40-9 70-4v28H5Z',G)+ellipse(43,47,31,12,W)+path('M6 46V36c0-15 22-15 22 0v10Z',P),path('M5 36h25M14 46v-8h7v8',R)+path('M36 44h18m-8 9h18','none',P)+path('M9 60v-8m-4 3 4 2 5-5')),
 'neimenggu-wudang': scene(path('M5 43 21 15l18 17 19-22 17 33',G)+rect(7,40,26,20,P)+rect(28,27,30,33,P)+rect(56,37,18,23,P)+path('M27 28h32l-5-9H33Z',A),path('M9 45h22m-2-10h28m1 9h14','none',R)+path('M34 40h5v7h-5m10-7h5v7h-5M39 60V50h10v10',R)),
 'neimenggu-asihatu': scene(path('M5 61h70l-8-12-53 3Z',G)+path('M10 55V27l13-9 12 9v28Zm31 0V18l11-9 16 9v37Z',A),path('M9 29h27M8 36h28M9 44h27M40 21h29m-29 8h29m-29 8h29m-29 8h29','none',S)+path('M19 21v32m34-40v40','none',P)),
} satisfies LandmarkPack
