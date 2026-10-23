import { A, B, G, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'guangxi-li-river': {
    silhouette: `<path d="M4 49 9 31l7-13 7 3 7 28 7-24 8-15 7 7 5 32 6-19 6-4 7 23Z" fill="${G}"/><path d="M5 49c22-5 44 5 70 0v12H5Z" fill="${W}"/><path d="M24 55h28" stroke="${R}" stroke-width="3"/><path d="M39 54V41m0 1-7 9m7-6 8 8"/><circle cx="39" cy="39" r="2.5" fill="${A}"/>`,
    detail: `<path d="m16 24-3 16m32-22-4 24m27-10-2 11" stroke="${S}" stroke-width="2.5"/><path d="M10 56h10m35 0h13M26 60h13" stroke="${P}"/><path d="m28 52 2 7m16-7 2 7m0-11 9 11"/><path d="M12 49v-4m30 4v-5m27 5v-4" stroke="${B}"/>`,
  },
  'guangxi-longji': {
    silhouette: `<path d="M5 55c4-16 17-20 22-30 6-12 18-12 25-2 7 12 15 14 23 32v5H5Z" fill="${A}"/><path d="M8 49c20 15 45 11 63-2M14 39c17 13 35 13 51-1M23 29c10 9 22 10 34 0M32 20c5 5 13 5 17 1" stroke="${G}" stroke-width="5"/>`,
    detail: `<path d="M8 49c20 15 45 11 63-2M14 39c17 13 35 13 51-1M23 29c10 9 22 10 34 0M32 20c5 5 13 5 17 1" stroke="${S}" stroke-width="1.3"/><path d="M33 15V9h11v6m-14-6 9-6 8 6Z" fill="${P}"/><path d="m49 49 11-2m-39 7 12 3" stroke="${P}"/>`,
  },
  'guangxi-huangyao': {
    silhouette: `<path d="M5 52h70v10H5Z" fill="${W}"/><path d="M49 33h22v21H49Z" fill="${P}"/><path d="m43 34 16-13 16 13Z" fill="${S}"/><path d="M15 55v-7c10-15 27-15 38 0v7h-7c-5-13-20-13-25 0Z" fill="${A}"/><path d="M22 46V27m0 8-12-9m12 6 9-12" stroke-width="3"/><path d="M7 28C-1 17 8 9 17 14c2-10 17-10 19 0 12-2 17 12 8 17-7 6-17 0-22-4-6 9-16 9-15 1Z" fill="${G}"/>`,
    detail: `<path d="m12 26 2 12m17-12v10M35 41v6m-9-4 4 6m13-6-4 6M54 39h6v8h-6m8-8h5v8h-5"/><path d="M24 59h15m20 0h10" stroke="${P}"/><path d="M64 55v-8h5v8" fill="${R}"/>`,
  },
  'guangxi-chengyang': {
    silhouette: `<path d="M5 54h70v8H5Z" fill="${W}"/><path d="M8 40h64v12H8Z" fill="${A}"/><path d="M17 51v10h6V51m19 0v10h6V51m17 0v10h6V51" fill="${P}"/><path d="m4 41 8-8h56l8 8Z" fill="${S}"/><path d="M15 33V22h13v11m17 0V17h15v16" fill="${P}"/><path d="m11 24 10-10 12 10Zm30-6 11-12 12 12Zm0 8h23m-23 7h23" fill="${S}"/>`,
    detail: `<path d="M12 44v6m7-6v6m7-6v6m7-6v6m7-6v6m7-6v6m7-6v6m7-6v6m7-6v6M20 26v6m31-12v4m5-4v4m-5 7v4m5-4v4"/><path d="M7 53h66" stroke="${R}" stroke-width="2.2"/><path d="M28 59h10m15 0h8" stroke="${P}"/>`,
  },
} satisfies LandmarkPack
