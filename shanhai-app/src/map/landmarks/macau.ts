import { A,B,G,I,P,R,S,W,path,rect,circle,ellipse,house,scene } from './shapes'
import type { LandmarkPack } from './shared'
export default {
 'macau-saint-paul': scene(path('M16 58V35h9V23h8l7-11 7 11h8v12h9v23Z',A)+path('M10 62h60m-56-4h52','none',S),path('M34 58V47a6 6 0 0 1 12 0v11Z',I)+circle(40,30,4,P)+path('M21 39h38M29 26v30m22-30v30M20 45h5m30 0h5M40 12V6m-3 3h6','none',P)),
 'macau-a-ma': scene(path('M5 61 13 32l13-14 18 11 17-9 14 41Z',S)+house(14,39,42,21,R)+path('m10 40 16-14 13 6 15-5 7 13Z',R),path('M20 42v18m30-18v18M29 60V47h13v13',A)+path('m61-29 5 13m-48-16 5-5','none',P)+path('M9 62h55','none',A)),
 'macau-mandarin-house': scene(house(7,31,26,29,S)+house(47,24,27,36,S)+path('M30 61V43h21v18Z',P)+path('m27 44 13-11 14 11Z',S),path('M13 37h6v9h-6m5-9h6v9h-6m28-7h6v10h-6M35 61V49h11v12',R)+path('M8 53h22m22-6h20','none',A)),
 'macau-taipa-houses': scene(rect(8,34,64,25,G)+path('m4 35 12-12h48l12 12Z',R)+path('M28 35V24l12-10 12 10v11Z',G),path('M14 41h7v11h-7m11-11h7v11h-7m20-11h7v11h-7m11-11h7v11h-7M36 59V41h9v18',P)+path('M10 60h61M35 28h10','none',P)),
} satisfies LandmarkPack
