import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'shaanxi-terracotta': scene(circle(17,26,5,A)+circle(40,19,6,A)+circle(63,26,5,A)+path('M9 59V40c0-12 16-12 16 0v19Zm20 0V35c0-15 22-15 22 0v24Zm26 0V40c0-12 16-12 16 0v19Z',A),path('M35 14v-4h8v5M14 22v-4h5v4m41 0v-4h5v4M13 40h8m-8 6h8m12-11h14m-14 7h14m-14 7h14m-14 7h14m12-16h8m-8 6h8M16 59V49m24 10V50m23 9V49','none',S)),
 'shaanxi-wild-goose': scene(path('M20 60 29 12h22l9 48Z',A)+path('M28 20h24m-26 8h28m-30 8h32m-34 8h36m-38 8h40','none',S),path('M38 18v-3h4v3m-4 8v-3h4v3m-4 8v-3h4v3m-4 8v-3h4v3m-4 8v-3h4v3M35 60v-6h10v6',I)+path('M40 12V6M16 62h48')),
 'shaanxi-dangjia': scene(house(7,32,23,28,S)+house(49,27,24,33,S)+path('M30 60V45h20v15Z',A)+path('m28 45 12-11 13 11Z',S),path('M13 39h6v9h-6m37-14h6v10h-6m7-10h6v10h-6M35 60V50h10v10',R)+path('M8 53h20m23-3h20M31 63h18')),
 'shaanxi-famen': scene(house(5,42,29,18,A)+path('M45 60 49 17h14l5 43Z',A)+path('m45 18 11-12 11 12ZM44 27h24m-25 9h26m-27 9h28m-29 9h30',S),path('M14 60V48h10v12',R)+path('M54 22h5m-5 8h5m-5 9h5m-5 9h5M53 60v-6h8v6',I)),
} satisfies LandmarkPack
