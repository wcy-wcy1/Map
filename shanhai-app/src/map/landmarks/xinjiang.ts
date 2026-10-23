import { A, B, G, I, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'xinjiang-tianchi': {
    silhouette: `<path d="m4 42 16-23 12 13L47 8l29 35Z" fill="${B}"/><path d="m47 8-11 18 10-4 5 7 7-7Zm-27 11-8 12 7-2 5 5 4-6" fill="${P}"/><path d="M8 45c13-9 47-12 64 0l-6 12c-17 7-40 7-55-1Z" fill="${W}"/>`,
    detail: `<path d="M18 48h18m7 7h16m-26 3h10" stroke="${P}" stroke-width="2.3"/><path d="m7 48 5-17 5 17Zm54 1 5-18 6 18Z" fill="${S}"/><path d="M12 48v8m54-7v8m-19-49 0 14"/><path d="M25 54c4 2 8 2 12 0" stroke="${B}"/>`,
  },
  'xinjiang-kanas': {
    silhouette: `<path d="M5 30c18-17 38-18 70 0v30H5Z" fill="${G}"/><path d="M24 22c25-2 38 7 26 14-7 5-27 6-22 11 5 4 29-1 41 13H43C26 52 8 56 9 46c0-11 35-11 37-16 2-4-12-6-22-8Z" fill="${W}"/>`,
    detail: `<path d="M28 24c19 1 26 5 17 9-9 5-26 5-27 13m13 5c13 1 22 2 27 7" stroke="${P}" stroke-width="2.2"/><path d="m6 34 5-15 5 15Zm51 5 5-16 6 16Zm-10 9 4-12 4 12Z" fill="${S}"/><path d="M11 34v8m51-3v7m-11 2v6M36 15l8-8 10 9" stroke="${B}"/>`,
  },
  'xinjiang-jiaohe': {
    silhouette: `<path d="m5 52 11-18 48-2 11 20-9 10H14Z" fill="${A}"/><path d="M14 50V28h11v8h7V20h15v13h9V24h11v27Z" fill="${A}"/><path d="M22 52V41h16v11m8 0V39h16v13" fill="${P}"/><path d="m5 52 10 3 50-1 10-2"/>`,
    detail: `<path d="M38 20v-7h8v7M20 30l-2 18m19-23v11m6-9v10m18-10v9M14 57l3 5m46-4-2 4" stroke="${P}"/><path d="M27 52v-6h5v6m19-1v-7h5v7" fill="${I}"/><path d="M39 41h5v18m-21-2h11m14 1h10" stroke="${S}"/>`,
  },
  'xinjiang-jiangbulake': {
    silhouette: `<path d="m5 34 17-18 13 11L48 9l27 27Z" fill="${B}"/><path d="m48 9-10 14 9-3 5 6 6-5Z" fill="${P}"/><path d="M5 37c24-6 44-6 70 1v22H5Z" fill="${A}"/><path d="M5 47c21-6 44 3 70-4M5 57c22-5 47 3 70-3" stroke="${G}" stroke-width="6"/>`,
    detail: `<path d="M25 35c1 10 13 16 17 25" stroke="${P}" stroke-width="2.5"/><path d="M13 45v-8m-3 2 3 3 3-3m39 14v-8m-3 2 3 3 3-3m10-3v-8m-3 2 3 3 3-3"/><path d="m55 34 4-12 4 12Zm9 1 4-10 4 10Z" fill="${S}"/><path d="M59 34v5m9-4v5"/>`,
  },
} satisfies LandmarkPack
