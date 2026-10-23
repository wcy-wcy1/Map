import { A, B, G, I, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'guizhou-huangguoshu': {
    silhouette: `<path d="M6 56V28l12-11 23 7 18-9 15 13v28Z" fill="${S}"/><path d="M19 26c12 4 27 4 42-1l-3 27 12 7H11l10-8Z" fill="${W}"/><path d="M27 30v21m9-20v23m10-24v24m9-24-2 21" stroke="${P}" stroke-width="3"/><ellipse cx="40" cy="58" rx="33" ry="5" fill="${W}"/>`,
    detail: `<path d="M13 27v-9m-4 5 4-9 5 9m44 2 5-13 5 13" fill="${G}"/><path d="M23 58h14m9 2h17M19 54l4-3m34 3 4-3" stroke="${P}"/><path d="M7 46c4-8 7-8 12-7m43-1c6-4 10 0 12 4" stroke="${G}"/><path d="M7 53h7m52-1h7"/>`,
  },
  'guizhou-xiaoqikong': {
    silhouette: `<path d="M5 40c6-15 16-16 25-9 9-17 27-18 45 7v16H5Z" fill="${G}"/><path d="M5 50h70v12H5Z" fill="${W}"/><path d="M7 47c20-5 46-5 66 0v9H7Z" fill="${A}"/><path d="M11 56v-5a3 3 0 0 1 6 0v5Zm9 0v-6a3 3 0 0 1 6 0v6Zm9 0v-7a3 3 0 0 1 6 0v7Zm9 0v-7a3 3 0 0 1 6 0v7Zm9 0v-7a3 3 0 0 1 6 0v7Zm9 0v-6a3 3 0 0 1 6 0v6Zm9 0v-5a3 3 0 0 1 6 0v5Z" fill="${W}"/>`,
    detail: `<path d="M6 44c21-5 47-5 68 0M10 42v4m10-6v4m10-5v4m10-5v4m10-3v4m10-2v4m10-2v4"/><path d="M15 60h16m17-1h14" stroke="${P}"/><path d="M18 35V21m0 7-6-5m6 3 7-7m36 18V23m0 7 6-5" stroke="${S}" stroke-width="2.5"/>`,
  },
  'guizhou-tangan': {
    silhouette: `<path d="M5 55c13-4 19-24 36-21 14 2 23 15 34 19v9H5Z" fill="${G}"/><path d="M9 53c21 9 43 9 62-2m-54-9c15 8 30 9 44 0" stroke="${P}" stroke-width="3"/><path d="M31 26h20v33H31Z" fill="${A}"/><path d="m28 27 13-17 13 17Zm-2 7h30m-32 7h34m-36 8h38" fill="${S}"/><path d="M7 42h16v15H7Zm52-1h14v15H59Z" fill="${P}"/><path d="m4 43 11-9 11 9Zm52-1 13-9 9 9Z" fill="${S}"/>`,
    detail: `<path d="M41 10V5m-5 23v4m10-4v4m-10 4v4m10-4v4m-10 4v4m10-4v4M12 47h5v8h-5m50-10h5v8h-5"/><path d="M37 59V51h8v8" fill="${R}"/><path d="M28 61h26" stroke="${A}" stroke-width="2.5"/>`,
  },
  'guizhou-zhenyuan': {
    silhouette: `<path d="m4 35 12-20 13 15 14-16 13 12 14-5 6 15" fill="${G}"/><path d="M5 38c15-4 47-1 46 9-1 7-24 5-24 10 0 3 25 4 48 0v6H5Z" fill="${W}"/><path d="M7 33h19v12H7Zm28-8h21v14H35Zm25 15h15v13H60Z" fill="${P}"/><path d="m4 34 13-10 13 10Zm27-8 14-11 15 11Zm25 15 11-10 11 10Z" fill="${S}"/>`,
    detail: `<path d="M12 38h4v6h-4m5-6h4v6h-4m18-9h5v8h-5m8-8h5v8h-5m13 7h5v8h-5" fill="${R}"/><path d="M38 51v-6c8-8 18-8 25 0v6h-5c-3-7-10-7-15 0Z" fill="${A}"/><path d="M10 50h13m20 9h18" stroke="${P}"/>`,
  },
} satisfies LandmarkPack
