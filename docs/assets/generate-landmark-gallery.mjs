/**
 * Rebuild the desktop and mobile README galleries from the app's drawings.
 * Run from any directory: node docs/assets/generate-landmark-gallery.mjs
 * Requires only the TypeScript dependency already installed in shanhai-app.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const assetDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(assetDirectory, '../..');
const appDirectory = resolve(rootDirectory, 'shanhai-app');
const sourceDirectory = resolve(appDirectory, 'src/map/landmarks');
const requireApp = createRequire(resolve(appDirectory, 'package.json'));
const ts = requireApp('typescript');
const moduleCache = new Map();

// These modules contain only trusted, locally authored SVG string builders.
// Keep evaluation confined to that source folder; do not load dependencies.
function loadDrawingModule(filename) {
  const absolute = resolve(filename);
  const localPath = relative(sourceDirectory, absolute);
  assert(localPath && !localPath.startsWith(`..${sep}`) && localPath !== '..');
  assert.equal(extname(absolute), '.ts');
  if (moduleCache.has(absolute)) return moduleCache.get(absolute).exports;
  const compiled = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolute,
    reportDiagnostics: true,
  });
  assert(!compiled.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error));
  const module = { exports: {} };
  moduleCache.set(absolute, module);
  new Script(`(function(require, module, exports) {\n${compiled.outputText}\n})`, {
    filename: absolute,
  }).runInNewContext({})((specifier) => {
    assert(specifier.startsWith('./'), `Unexpected module import: ${specifier}`);
    return loadDrawingModule(resolve(dirname(absolute), `${specifier}.ts`));
  }, module, module.exports);
  return module.exports;
}

const { wrapLandmark } = loadDrawingModule(resolve(sourceDirectory, 'shared.ts'));
const catalogue = JSON.parse(readFileSync(resolve(appDirectory, 'public/data/national-places.json'), 'utf8'));
const places = new Map(catalogue.map(place => [place.id, place]));
const groups = [
  { title: '北京', module: 'beijing', ids: ['beijing-forbidden-city', 'beijing-white-pagoda'] },
  { title: '上海', module: 'shanghai', ids: ['shanghai-yu-garden', 'shanghai-slaughterhouse'] },
  { title: '福建', module: 'fujian', ids: ['fujian-gulangyu', 'fujian-qida'] },
];
const expectedNames = ['故宫', '白塔寺街区', '豫园', '1933老场坊', '鼓浪屿', '奇达村'];
const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);
const actualNames = [];

const artwork = groups.map((group, groupIndex) => {
  const pack = loadDrawingModule(resolve(sourceDirectory, `${group.module}.ts`)).default;
  const groupCenter = 300 + groupIndex * 500;
  const drawings = group.ids.map((id, index) => {
    const place = places.get(id);
    assert(place, `Missing catalogue entry: ${id}`);
    assert(pack[id], `Missing authored artwork: ${id}`);
    assert.equal(place.discoveryTier, index === 0 ? 'classic' : 'local');
    actualNames.push(place.name);
    const center = groupCenter + (index === 0 ? -112 : 112);
    const label = index === 0 ? '经典地标' : '地方发现';
    // Preserve the complete application illustration, including its map anchor.
    const svg = wrapLandmark(pack[id]).replace('<svg ', `<svg x="${center - 104}" y="240" width="208" height="187.2" `);
    return `<g aria-label="${escapeXml(`${group.title}，${label}，${place.name}`)}">
      <text class="category ${index === 0 ? 'classic' : 'local'}" x="${center}" y="210">${label}</text>
      ${svg}
      <text class="place" x="${center}" y="488">${escapeXml(place.name)}</text>
    </g>`;
  }).join('\n');
  return `<g>
    <text class="region" x="${groupCenter}" y="146">${group.title}</text>
    ${drawings}
  </g>`;
}).join('\n');

assert.deepEqual(actualNames, expectedNames);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600" role="img" aria-labelledby="gallery-title gallery-description">
  <title id="gallery-title">山海集：产品地标插画</title>
  <desc id="gallery-description">来自山海集应用的六处原创地标插画，按经典地标与地方发现配对。北京：故宫与白塔寺街区；上海：豫园与1933老场坊；福建：鼓浪屿与奇达村。</desc>
  <style>
    text { text-anchor: middle; fill: #183B3C; }
    .region { font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, serif; font-size: 40px; font-weight: 400; letter-spacing: 5px; }
    .caption, .category, .place { font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; font-weight: 400; }
    .caption { font-size: 20px; letter-spacing: 2px; text-anchor: start; fill: #647E7B; }
    .category { font-size: 20px; letter-spacing: 1.5px; }
    .classic { fill: #183B3C; }
    .local { fill: #647E7B; }
    .place { font-size: 26px; }
  </style>
  <rect width="1600" height="600" fill="#EEF2EE"/>
  <text class="caption" x="76" y="58">产品地标插画</text>
  ${artwork}
</svg>
`;

assert(!/<script\b|(?:href|src)\s*=|@import|url\s*\(/i.test(svg), 'Gallery must be self-contained and script-free');
const output = resolve(assetDirectory, 'shanhai-landmark-gallery.svg');
writeFileSync(output, svg, 'utf8');
process.stdout.write(`Generated ${relative(rootDirectory, output)} from six verified catalogue entries.\n`);

// At a 320px display width, categories remain 11px, place names 13px,
// and each illustration is 96px wide. Keep city pairs together vertically.
const mobileArtwork = groups.map((group, groupIndex) => {
  const pack = loadDrawingModule(resolve(sourceDirectory, `${group.module}.ts`)).default;
  const offset = groupIndex * 400;
  const drawings = group.ids.map((id, index) => {
    const place = places.get(id);
    const center = index === 0 ? 170 : 470;
    const label = index === 0 ? '经典地标' : '地方发现';
    const drawing = wrapLandmark(pack[id]).replace('<svg ', `<svg x="${center - 96}" y="${224 + offset}" width="192" height="172.8" `);
    return `<g aria-label="${escapeXml(`${group.title}，${label}，${place.name}`)}">
      <text class="category ${index === 0 ? 'classic' : 'local'}" x="${center}" y="${195 + offset}">${label}</text>
      ${drawing}
      <text class="place" x="${center}" y="${446 + offset}">${escapeXml(place.name)}</text>
    </g>`;
  }).join('\n');
  return `<g>
    <text class="region" x="320" y="${132 + offset}">${group.title}</text>
    ${drawings}
  </g>`;
}).join('\n');

const mobileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1320" viewBox="0 0 640 1320" role="img" aria-labelledby="gallery-mobile-title gallery-mobile-description">
  <title id="gallery-mobile-title">山海集：产品地标插画</title>
  <desc id="gallery-mobile-description">来自山海集应用的六处原创地标插画，按经典地标与地方发现配对。北京：故宫与白塔寺街区；上海：豫园与1933老场坊；福建：鼓浪屿与奇达村。</desc>
  <style>
    text { text-anchor: middle; fill: #183B3C; }
    .region { font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, serif; font-size: 40px; font-weight: 400; letter-spacing: 5px; }
    .caption, .category, .place { font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; font-weight: 400; }
    .caption { font-size: 24px; letter-spacing: 2px; text-anchor: start; fill: #647E7B; }
    .category { font-size: 22px; letter-spacing: 1.5px; }
    .classic { fill: #183B3C; }
    .local { fill: #647E7B; }
    .place { font-size: 26px; }
  </style>
  <rect width="640" height="1320" fill="#EEF2EE"/>
  <text class="caption" x="40" y="52">产品地标插画</text>
  ${mobileArtwork}
</svg>
`;

assert(!/<script\b|(?:href|src)\s*=|@import|url\s*\(/i.test(mobileSvg), 'Mobile gallery must be self-contained and script-free');
const mobileOutput = resolve(assetDirectory, 'shanhai-landmark-gallery-mobile.svg');
writeFileSync(mobileOutput, mobileSvg, 'utf8');
process.stdout.write(`Generated ${relative(rootDirectory, mobileOutput)} for narrow README layouts.\n`);
