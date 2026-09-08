/* Original journal-map symbols. Category imagery, not architectural surveys.
 * svg(key, { variant: place.id }) returns trusted, prebuilt SVG only.
 * Place the viewBox coordinate (40, 68) on the projected geographic point.
 * The caller supplies the accessible place name on its button; SVG is decorative.
 */

const P = '#FBF8EF', I = '#163D3A', G = '#CCDCC8', W = '#A9CED3';
const R = '#A23E34', A = '#D2AE65', S = '#849F98', B = '#7199AA';
const ground = `<ellipse cx="40" cy="62" rx="27" ry="3" fill="${G}" stroke="none"/>`;
const anchor = `<path d="M40 63v3" stroke="${I}" stroke-width="1.5"/><circle cx="40" cy="68" r="2" fill="${I}" stroke="${P}" stroke-width="1"/>`;
const wrap = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 72" aria-hidden="true" focusable="false" data-anchor-x="40" data-anchor-y="68"><g fill="none" stroke="${I}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ground}${body}${anchor}</g></svg>`;

const drawings: Readonly<Record<string, string>> = {
  'snow-mountain': `
    <path d="M5 59 24 25l10 11L45 10l29 49Z" fill="${W}"/>
    <path d="m24 25 9 11-4 9-5-5-6 6Zm21-15 12 22-8-3-5 8-5-7-6 5Z" fill="${P}"/>
    <path d="m45 10 4 19-5 8 15 22h15Zm-21 15 0 15 5 5-5 14H5Z" fill="${B}" stroke="none"/>
    <path d="m45 10 12 22-8-3-5 8-5-7-6 5M18 46l6-6 5 5M12 59h55"/>
    <path d="m59 51 4-9 4 9Zm-46 7 3-7 3 7Z" fill="${G}"/>
  `,
  'old-town': `
    <path d="M9 39h26v21H9Zm28-11h27v32H37Z" fill="${P}"/>
    <path d="m5 40 8-8h17l8 8Zm27-11 9-12h19l10 12Z" fill="${S}"/>
    <path d="M32 31h38M41 17h19M13 43v14m8-14v14m8-14v14M43 35h7v8h-7Zm12 0h6v8h-6Z"/>
    <path d="M45 60V49h13v11" fill="${R}"/>
    <path d="m6 60 30-1 9 4 27-2M8 29l7-6h10l7 6Z" fill="${W}"/>
    <path d="M68 39v19m-3-16h6"/>
    <ellipse cx="68" cy="46" rx="3" ry="4" fill="${R}"/>
  `,
  pagoda: `
    <path d="M13 59 15 35h11l2 24Zm19 0 4-39h9l4 39Zm21 0 2-24h11l2 24Z" fill="${P}"/>
    <path d="M12 36h17m-16 7h15m-15 7h15m-14 7h13M33 22h15m-15 7h15m-16 7h17m-18 7h19m-20 7h21m-22 7h23M52 36h17m-16 7h15m-15 7h15m-14 7h13" stroke="${A}" stroke-width="2.6"/>
    <path d="m17 34 4-7 4 7m13-15 3-10 3 10m13 15 4-7 4 7M40 13v-5M21 30v-5m40 5v-5M39 59v-7h4v7"/>
    <path d="M10 61h61"/>
  `,
  'stone-forest': `
    <path d="m8 60 5-25 6-8 5 33Zm12 0 5-39 8-9 7 48Zm16 0 5-29 8-13 6 42Zm17 0 3-31 7-9 8 40Z" fill="${S}"/>
    <path d="m25 21 8-9-2 29-5 19m15-29 8-13-3 33m10-22 7-9-1 22M13 35l6-8-1 22" stroke="${P}" stroke-width="2"/>
    <path d="m5 61 7-5 9 4 9-4 12 5 10-4 10 4 11-2" stroke="${I}"/>
    <path d="m10 58 3-7 3 7m48 2 3-7 3 7" fill="${G}"/>
  `,
  terraces: `
    <path d="M6 51c10-2 13-11 18-17 8-12 14-18 23-16 9 2 12 13 17 19 5 7 10 10 11 19-17 9-47 12-69 0Z" fill="${G}"/>
    <path d="M13 45c10 6 28 7 47 0l8-2M8 52c16 8 40 9 65-1M21 34c11 6 23 6 38 0M17 40c11 7 25 8 46 0M29 25c5 6 14 7 24 2" stroke="${P}" stroke-width="4.4"/>
    <path d="M13 45c10 6 28 7 47 0l8-2M8 52c16 8 40 9 65-1M21 34c11 6 23 6 38 0M17 40c11 7 25 8 46 0M29 25c5 6 14 7 24 2" stroke="${B}" stroke-width="1.4"/>
    <path d="m35 18 6-6 7 6v5H35Z" fill="${P}"/><path d="m33 18 8-7 9 7" stroke="${R}" stroke-width="2.5"/>
  `,
  lake: `
    <path d="m5 37 13-17 13 16 15-23 21 22 8 7" fill="${G}"/>
    <path d="M8 43c12-9 25-4 33-6 14-5 23-2 31 5l-5 14c-18 8-38 8-57-1Z" fill="${W}"/>
    <path d="M9 43c10-6 21-4 27-5M18 55h18m7-8h17m-23 10h17" stroke="${P}" stroke-width="2.3"/>
    <path d="M47 41V28l-9 13Z" fill="${P}"/><path d="M36 43h17l-4 4h-9Z" fill="${R}"/>
    <path d="M11 58v-8m0 3-5-6m5 2 5-7m49 16 5-7"/>
  `,
  temple: `
    <path d="M13 42h54v18H13Zm10-13h34v15H23Z" fill="${P}"/>
    <path d="m8 43 11-12 5 4h33l5-4 11 12Zm11-14 12-11 9-7 9 7 12 11Z" fill="${A}"/>
    <path d="M40 11V6m-3 5h6M16 45h48M25 49v11m30-11v11"/>
    <path d="M34 60V48h12v12" fill="${R}"/><path d="M27 33h7v7h-7m12-7h7v7h-7m12-7h5v7h-5"/>
    <path d="M9 62h63" stroke="${A}" stroke-width="3"/>
  `,
  rainforest: `
    <path d="M16 59V33m23 27V23m22 35V35" stroke-width="3"/>
    <path d="M17 38C0 42 3 22 15 24c-5-14 15-19 17-8C34 1 55 7 51 20c13-4 19 12 9 17-10 5-17-2-19-9-1 13-12 15-18 6" fill="${G}"/>
    <path d="M59 42c-13 4-15-12-4-14-2-11 16-12 16-1 11 6 4 19-10 14" fill="${S}"/>
    <path d="M39 26c-4 0-8-4-9-9m9 13 8-12m-31 24 8-12m35 15 6-10"/>
    <path d="M6 59c6-10 11-10 17 0 5-10 12-10 18 0 10-13 19-12 29 0" fill="${G}"/>
    <path d="M35 62c12-6 13-12 9-19" stroke="${W}" stroke-width="4"/>
  `,
  waterfall: `
    <path d="M8 55V27l12-6 9 4 13-11 16 7 11 2v32Z" fill="${S}"/>
    <path d="m13 26 9 8-5 17m40-27 8 10-4 18M26 22l8 4" stroke="${G}"/>
    <path d="M28 24c7 4 14 4 23 0l-3 28 10 6H20l12-7Z" fill="${W}"/>
    <path d="M36 29 34 49m8-19-1 22m6-23-3 25" stroke="${P}" stroke-width="2.5"/>
    <ellipse cx="40" cy="58" rx="31" ry="5" fill="${W}"/>
    <path d="M27 57h25m-32 3h13m13 0h17" stroke="${P}"/>
    <path d="m9 26 4-10 5 10m41-3 5-11 5 13" fill="${G}"/>
  `,
  volcano: `
    <path d="M6 59c13-8 13-27 25-31h20c9 4 13 24 24 31Z" fill="${S}"/>
    <path d="M30 29c5-5 18-5 22 0-5 8-18 8-22 0Z" fill="${A}"/>
    <path d="M33 30c5-3 13-3 16 0" stroke="${R}" stroke-width="3"/>
    <path d="m28 38-8 14m33-15 7 13m-24-9-5 16m12-18 8 19" stroke="${G}"/>
    <path d="M40 23c-6-8 8-9 4-18m6 18c9-7 3-12 8-15" stroke="${S}" stroke-width="3"/>
    <path d="m9 60 4-8 4 8m47 0 4-9 4 9" fill="${G}"/>
  `,
  village: `
    <path d="m5 42 14-16 18 17 19-25 20 25" fill="${G}"/>
    <path d="M13 40h24v19H13Zm34-4h20v23H47Z" fill="${P}"/>
    <path d="m8 41 16-13 18 13Zm34-4 14-13 16 13Z" fill="${A}"/>
    <path d="M14 48h22M17 52v8m14-8v8m19-16h14m-13 1v15m10-15v15"/>
    <path d="M22 50v-7h7v7m30-6v-6h-6v6" fill="${R}"/>
    <path d="M34 63c6-5 7-13 15-15" stroke="${W}" stroke-width="3"/>
    <path d="M8 57V43m0 5-4-4m4 1 5-5"/>
  `,
  canyon: `
    <path d="M5 18 21 11l10 20-4 13 10 18H5Zm70 0-16-7-12 19 5 15-9 17h32Z" fill="${S}"/>
    <path d="m10 21 8-4 9 14-11 10 9 16m46-36-9-4-10 14 12 10-10 17" stroke="${G}" stroke-width="3"/>
    <path d="M37 29c16 8-11 15 3 23 5 3 8 6 5 10H32c8-7-11-10-3-19 7-7 14-8 8-14Z" fill="${W}"/>
    <path d="M40 39c-9 7-7 9 0 15" stroke="${P}"/>
    <path d="m6 18 5-8 4 6m47 0 5-9 6 13" fill="${G}"/>
  `,
  tea: `
    <path d="M5 54c8-23 20-14 27-28 8-12 21-9 31 9 6 7 11 13 12 23-19 9-50 8-70 0Z" fill="${G}"/>
    <path d="M15 40c11 9 28 13 51 3M9 49c14 9 40 13 63 2M26 30c8 9 17 10 34 5" stroke="${P}" stroke-width="4"/>
    <path d="M15 40c11 9 28 13 51 3M9 49c14 9 40 13 63 2M26 30c8 9 17 10 34 5" stroke="${S}" stroke-width="1.4"/>
    <path d="M41 30V13m0 9C27 25 28 11 28 11c10-2 15 5 13 11Zm0-5c-1-11 13-11 13-11s0 13-13 11Z" fill="${S}"/>
  `,
  cave: `
    <path d="M7 60 10 32l12-15 23-6 19 15 10 34Z" fill="${S}"/>
    <path d="M22 60V41c0-25 37-25 37 0v19Z" fill="${I}"/>
    <path d="m25 32 5 15 4-20 7 12 4-13 7 21 5-14" fill="${A}" stroke="${A}"/>
    <path d="m29 59 5-12 5 12m7 0 4-15 5 15" fill="${G}" stroke="${G}"/>
    <path d="M17 61c12-4 25-5 41 0" stroke="${W}" stroke-width="3"/>
    <path d="m14 31 8-6m32-4 7 10" stroke="${G}"/>
  `,
  flower: `
    <path d="M40 61V34m-17 25V43m36 16V41" stroke-width="2.5"/>
    <path d="M39 54c-13 0-16-10-16-10s16-2 16 10Zm2-9c12 0 17-10 17-10s-15-3-17 10Z" fill="${G}"/>
    <path d="M34 20c-3-13 15-13 12 0 13-4 18 12 5 15 4 12-12 19-16 7-10 8-20-5-10-12-11-9 1-20 9-10Z" fill="${R}"/>
    <circle cx="39" cy="29" r="6" fill="${A}"/>
    <path d="M18 37c-10-9 6-16 7-6 10-5 14 9 4 10-1 10-15 7-11-4Zm39-2c-9-6 4-17 8-7 11-1 9 13 1 12-3 8-15 3-9-5Z" fill="${A}"/>
    <path d="M15 62c16-7 35-7 50 0" stroke="${S}"/>
  `,
  wetland: `
    <path d="M7 47c11-11 28-2 36-8 10-8 27-3 31 7l-6 12c-17 7-41 7-59 0Z" fill="${W}"/>
    <path d="M16 42V21m-5 26V30m12 16V28m38 15V28m7 18V20"/>
    <path d="M16 22v-9m-5 18v-8m12 6v-7m38 7v-8m7 0v-8" stroke="${A}" stroke-width="4"/>
    <path d="m16 32-6-8m13 15 7-8m31 5-6-8m12 5 6-8" stroke="${S}"/>
    <path d="M28 47c3 5 13 5 16 0l-5-4c-2-5 1-9 6-9l4 2-5 1c-3 2-2 5 1 7l3 4" fill="${P}"/>
    <path d="M21 55h16m6 3h15M32 18c3-4 5-4 8 0 3-4 5-4 8 0" stroke="${P}"/>
  `,
  museum: `
    <path d="M11 31h58v29H11Z" fill="${P}"/>
    <path d="m6 31 34-19 34 19Zm3 29h62v4H9Z" fill="${A}"/>
    <path d="M17 36h7v21h-7Zm19 0h8v21h-8Zm20 0h7v21h-7Z" fill="${G}"/>
    <path d="M14 36h13m6 0h14m6 0h13M16 57h9m9 0h12m9 0h9"/>
    <circle cx="40" cy="24" r="3" fill="${R}"/>
  `,
  bridge: `
    <path d="M5 55c9-5 18 4 28 0 11-5 21 4 41 0v7H5Z" fill="${W}" stroke="none"/>
    <path d="M7 53V39c19-24 47-24 66 0v14H60c-7-24-34-24-40 0Z" fill="${P}"/>
    <path d="M9 37c19-21 43-21 62 0M12 36v9m9-17v10m9-15v10m10-12v10m10-8v10m10-5v10m9-2v9"/>
    <path d="M5 43h10m50 0h10" stroke="${A}" stroke-width="3"/>
    <path d="M10 59h15m10-2h13m9 2h11" stroke="${P}"/>
  `,
  garden: `
    <path d="M8 54c17-12 43-12 64 0l-5 7H14Z" fill="${G}"/>
    <path d="M29 52V29h28v23" fill="${P}"/>
    <path d="m22 30 11-11 10-6 10 6 11 11Z" fill="${S}"/>
    <path d="M35 31v21m15-21v21M27 53h32"/>
    <path d="M14 52V31m0 8-6-8m6 3 7-8"/>
    <path d="M7 31c-8-8 4-15 7-10 2-9 16-4 12 4 9 6-6 17-11 8-5 6-9 5-8-2Z" fill="${G}"/>
    <path d="M25 61c4-7 29-7 36 0" stroke="${W}" stroke-width="4"/>
    <path d="m61 52 4-10 8 10Z" fill="${S}"/>
  `,
  'hot-spring': `
    <path d="M7 47c6-13 60-13 67 0v9c-10 10-55 11-67 0Z" fill="${S}"/>
    <ellipse cx="40" cy="47" rx="33" ry="10" fill="${P}"/>
    <ellipse cx="40" cy="47" rx="26" ry="6" fill="${W}" stroke="none"/>
    <path d="M26 34c-10-11 10-12 0-25m14 24c-9-10 10-13 0-26m15 27c-9-10 9-13 0-24" stroke="${B}" stroke-width="2.5"/>
    <path d="M27 47h20m-32 9 3 3m45-3-4 4" stroke="${P}" stroke-width="2"/>
    <path d="m4 42 7-7 8 4m43 0 7-5 7 8" fill="${G}"/>
  `
};

// Shape variants are authored below, never generated from supplied strings.
const variations: Readonly<Record<string, string>> = {
  'forest-mountain': `
    <path d="M5 59 16 39l11-8 12-17 14 17 10 7 12 21Z" fill="${G}"/>
    <path d="m39 14 5 23 9 8 10 14H28l7-19Z" fill="${S}" stroke="none"/>
    <path d="m39 14 5 23 9 8m-37-6 11-8 8 9M8 60h64"/>
    <path d="m10 53 5-12 5 12Zm44 3 5-14 6 14Zm11-6 4-11 5 11Z" fill="${S}"/>
    <path d="M15 53v7m44-4v5m10-11v9"/>
    <path d="M25 60c0-7 16-10 12-17" stroke="${P}" stroke-width="2"/>
  `,
  'rock-art': `
    <path d="M9 60 8 31l11-15 29-6 17 15 7 35Z" fill="${A}"/>
    <path d="m19 16 3 17-7 11m33-34-4 12 14 10 7-7m-1 29 8 6" stroke="${S}"/>
    <path d="M24 31h24m-30 24 9-2m31-34 5 7" stroke="${P}"/>
    <circle cx="31" cy="36" r="2" fill="${R}" stroke="${R}"/>
    <circle cx="48" cy="34" r="2" fill="${R}" stroke="${R}"/>
    <path d="M31 39v10m-7-8 7 4 8-5m-8 9-6 8m6-8 5 8M48 37v11m-6-8 6 3 7-6m-7 11-5 8m5-8 7 7" stroke="${R}" stroke-width="2.3"/>
    <path d="M10 61h61"/>
  `,
  meili: `
    <path d="m5 60 14-24 10 8L41 6l15 36 8-16 12 34Z" fill="${W}"/>
    <path d="m41 6 11 29-8-5-4 9-6-6-7 10Zm23 20 6 14-6-3-5 5" fill="${P}"/>
    <path d="m41 6 3 24-4 9 16 21h20L64 26l-8 16Z" fill="${B}" stroke="none"/>
    <path d="m41 6 11 29-8-5-4 9-6-6-7 10m37-17 6 14-6-3-5 5M12 61h58"/>
    <path d="m12 56 4-10 4 10m39 3 4-9 4 9" fill="${G}"/>
  `,
  'golden-pagoda': `
    <path d="M18 58 21 46h38l4 12Zm8-12 4-17h20l5 17Zm6-17 8-16 8 16Z" fill="${A}"/>
    <path d="M40 13V5m-4 9h8M28 32h25M24 40h32M16 58h49M13 63h56"/>
    <path d="M35 58V46c0-6 10-6 10 0v12" fill="${R}"/>
    <path d="M8 57V42h8v15m49 0V42h7v15M7 42l5-10 5 10m47 0 5-10 4 10" fill="${A}"/>
    <path d="M32 26h16m-6-14v-3" stroke="${P}"/>
  `,
  'golden-monastery': `
    <path d="M8 39h21v21H8Zm18-13h27v34H26Zm24 10h23v24H50Z" fill="${P}"/>
    <path d="M8 45h21m-3-10h27m-3 9h23" stroke="${R}" stroke-width="4"/>
    <path d="m4 39 6-8h14l8 8Zm18-13 8-10h6l4-7 5 7h5l8 10Zm25 10 6-8h14l10 8Z" fill="${A}"/>
    <path d="M40 9V5m-27 44h4v6h-4m7-6h4v6h-4m14-20h4v5h-4m8-5h4v5h-4m13 17h4v6h-4m4-14h4v5h-4"/>
    <path d="M35 60V46h11v14" fill="${R}"/><path d="M6 62h68"/>
  `,
  'earth-forest': `
    <path d="m6 60 3-22 7-13 5 18 5-28 8-7 7 31 6-11 7-12 6 30 7-11 8 25Z" fill="${A}"/>
    <path d="m16 25 1 30m9-40 4 43m4-50 2 33m18-25-4 39m10-9 4 14" stroke="${P}" stroke-width="2"/>
    <path d="m9 45 8-3m6-11 13-2m9 16 10-5M6 60h69"/>
  `,
  yuanyang: `
    <path d="M5 52c8-2 11-12 19-16 8-4 13-17 25-16 12 2 15 21 25 27l1 11c-15 8-50 11-70 0Z" fill="${W}"/>
    <path d="M8 51c10 6 37 11 65-1M17 42c18 10 33 7 50-3M25 35c12 7 25 6 34-6M35 27c8 3 16 2 20-3" stroke="${G}" stroke-width="5"/>
    <path d="M8 51c10 6 37 11 65-1M17 42c18 10 33 7 50-3M25 35c12 7 25 6 34-6M35 27c8 3 16 2 20-3" stroke="${P}" stroke-width="1.5"/>
    <path d="M39 19v-6h8v6m-11-6 7-7 7 7Z" fill="${A}"/><path d="m58 56 3-8 3 8" fill="${G}"/>
  `,
  'old-town-water': `
    <path d="M7 61c14-13 42-17 66-6v8H7Z" fill="${W}" stroke="none"/>
    <path d="M8 38h25v19H8Zm33-11h25v24H41Z" fill="${P}"/>
    <path d="m4 39 8-10h17l8 10Zm32-11 14-14h9l15 14Z" fill="${S}"/>
    <path d="M12 45h5v9h-5m8-9h5v9h-5m24-22h5v6h-5m8-6h5v6h-5"/>
    <path d="M47 51V42h12v9" fill="${R}"/>
    <path d="M23 63v-8c8-8 18-8 26-1v5h-6c-3-7-10-6-14 4Z" fill="${P}"/>
    <path d="M9 61h8m35-1h12" stroke="${P}"/>
  `
};

const variantNames: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'snow-mountain': { meili: 'meili', 'meili-snow-mountain': 'meili', 'meili-mountain': 'meili' },
  pagoda: { 'golden-pagoda': 'golden-pagoda', 'menghuan-golden-pagoda': 'golden-pagoda', 'menghuan-pagoda': 'golden-pagoda' },
  temple: { 'golden-monastery': 'golden-monastery', 'songzanlin-monastery': 'golden-monastery', songzanlin: 'golden-monastery' },
  'stone-forest': { 'earth-forest': 'earth-forest', 'yuanmou-earth-forest': 'earth-forest', 'yuanmou-tulin': 'earth-forest' },
  terraces: { yuanyang: 'yuanyang', 'yuanyang-terraces': 'yuanyang', 'honghe-hani-terraces': 'yuanyang' },
  'old-town': { 'old-town-water': 'old-town-water', 'lijiang-old-town': 'old-town-water', shuhe: 'old-town-water' },
  garden: { 'forest-mountain': 'forest-mountain', 'western-hills': 'forest-mountain' },
  cave: { 'rock-art': 'rock-art', 'cangyuan-rock-art': 'rock-art' }
};
export const landmarkKeys = Object.freeze(Object.keys(drawings));
const icons = Object.freeze(Object.fromEntries(Object.entries(drawings).map(([key, body]) => [key, wrap(body)])));
const variants = Object.freeze(Object.fromEntries(Object.entries(variations).map(([key, body]) => [key, wrap(body)])));
const fallback = wrap(`<path d="M19 59V39l21-22 21 22v20Z" fill="${P}"/><path d="m13 41 27-29 27 29" fill="${G}"/><path d="M34 59V44h12v15" fill="${R}"/><circle cx="40" cy="32" r="4" fill="${A}"/>`);
const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Returns only authored SVG; unknown keys/options never become markup. */
export function svg(key: unknown, options?: unknown): string {
  if (typeof key !== 'string' || !own(icons, key)) return fallback;
  const base = icons[key] ?? fallback;
  let variant: unknown;
  // Ignore accessor properties; never execute/coerce supplied values.
  try {
    if (options && typeof options === 'object') variant = Object.getOwnPropertyDescriptor(options, 'variant')?.value;
  } catch { return base; }
  const mapping = own(variantNames, key) ? variantNames[key] : undefined;
  if (typeof variant === 'string' && mapping && own(mapping, variant)) {
    const name = mapping[variant];
    return name ? variants[name] ?? base : base;
  }
  return base;
}

export function landmarkDataUrl(key: unknown, options?: unknown): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(key, options));
}
