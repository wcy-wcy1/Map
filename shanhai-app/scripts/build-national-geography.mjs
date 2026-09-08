import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const check = process.argv.includes('--check')
const refresh = process.argv.includes('--refresh')
if (process.argv.slice(2).some(arg => !['--check', '--refresh'].includes(arg)) || (check && refresh)) {
  throw new Error('Usage: node scripts/build-national-geography.mjs [--check | --refresh]')
}
const evidence = 'qa/national-map-20260907/data'
const commit = '9469f09592ced973a3448cf66b6100b741b64c0d'
const sourceBase = `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${commit}/releaseData/gbOpen/CHN/ADM1/`
const sourceFile = 'geoBoundaries-CHN-ADM1.geojson'
const metadataFile = 'geoBoundaries-CHN-ADM1-metaData.json'
const sourceHash = '3a00467a0db9b4136facb5f2f3d0edbfd96adb15651cfdf63991da9281030e85'
const metadataHash = 'b14151296df758f83bc66706929db37eb2114a439b6f0a1e5c9608732d840136'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// This is the single authority for source-name -> app-name/code mapping.
// Coordinates are never translated, simplified, enlarged, or hand drawn.
const divisions = [
  ['11', '北京市', '北京', 'Beijing Municipality'],
  ['12', '天津市', '天津', 'Tianjin Municipality'],
  ['13', '河北省', '河北', 'Hebei Province'],
  ['14', '山西省', '山西', 'Shanxi Province'],
  ['15', '内蒙古自治区', '内蒙古', 'Inner Mongolia Autonomous Region'],
  ['21', '辽宁省', '辽宁', 'Liaoning Province'],
  ['22', '吉林省', '吉林', 'Jilin Province'],
  ['23', '黑龙江省', '黑龙江', 'Heilongjiang Province'],
  ['31', '上海市', '上海', 'Shanghai Municipality'],
  ['32', '江苏省', '江苏', 'Jiangsu Province'],
  ['33', '浙江省', '浙江', 'Zhejiang Province'],
  ['34', '安徽省', '安徽', 'Anhui Province'],
  ['35', '福建省', '福建', 'Fujian Province'],
  ['36', '江西省', '江西', 'Jiangxi Province'],
  ['37', '山东省', '山东', 'Shandong Province'],
  ['41', '河南省', '河南', 'Henan Province'],
  ['42', '湖北省', '湖北', 'Hubei Province'],
  ['43', '湖南省', '湖南', 'Hunan Province'],
  ['44', '广东省', '广东', 'Guangzhou Province'],
  ['45', '广西壮族自治区', '广西', 'Guangxi Zhuang Autonomous Region'],
  ['46', '海南省', '海南', 'Hainan Province'],
  ['50', '重庆市', '重庆', 'Chongqing Municipality'],
  ['51', '四川省', '四川', 'Sichuan Province'],
  ['52', '贵州省', '贵州', 'Guizhou Province'],
  ['53', '云南省', '云南', 'Yunnan Province'],
  ['54', '西藏自治区', '西藏', 'Tibet Autonomous Region'],
  ['61', '陕西省', '陕西', 'Shaanxi Province'],
  ['62', '甘肃省', '甘肃', 'Gansu Province'],
  ['63', '青海省', '青海', 'Qinghai Province'],
  ['64', '宁夏回族自治区', '宁夏', 'Ningxia Ningxia Hui Autonomous Region'],
  ['65', '新疆维吾尔自治区', '新疆', 'Xinjiang Uyghur Autonomous Region'],
  ['71', '台湾省', '台湾', 'Taiwan Province'],
  ['81', '香港特别行政区', '香港', 'Hong Kong Special Administrative Region'],
  ['82', '澳门特别行政区', '澳门', 'Macau Special Administrative Region'],
]

async function pinnedInput(filename, expectedHash) {
  const local = resolve(root, evidence, filename)
  let bytes
  if (!refresh) {
    try { bytes = await readFile(local) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!bytes) {
    if (check) throw new Error(`Offline source missing: ${local}`)
    const response = await fetch(sourceBase + filename)
    if (!response.ok) throw new Error(`Source download failed: ${response.status} ${filename}`)
    bytes = Buffer.from(await response.arrayBuffer())
    if (sha256(bytes) !== expectedHash) throw new Error(`Downloaded source hash mismatch: ${filename}`)
    await mkdir(resolve(root, evidence), { recursive: true })
    await writeFile(local, bytes)
  }
  if (sha256(bytes) !== expectedHash) throw new Error(`Pinned source hash mismatch: ${filename}`)
  return JSON.parse(bytes.toString('utf8'))
}

function validateGeometry(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
  if (!polygons.length) throw new Error('Source must contain Polygon/MultiPolygon geometries')
  for (const polygon of polygons) {
    if (!polygon.length) throw new Error('Empty source polygon')
    for (const ring of polygon) {
      if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw new Error('Unclosed source ring')
      for (const point of ring) {
        if (point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Invalid source coordinate')
      }
    }
  }
}

const [source, metadata, previous] = await Promise.all([
  pinnedInput(sourceFile, sourceHash),
  pinnedInput(metadataFile, metadataHash),
  readFile(resolve(root, 'src/data/geography.json'), 'utf8').then(JSON.parse),
])
if (source.type !== 'FeatureCollection' || source.features.length !== 34 || metadata.admUnitCount !== '34' || metadata.boundaryLicense !== 'Public Domain' || metadata.boundaryYear !== '2019') {
  throw new Error('Unexpected fixed source metadata')
}
const bySourceName = new Map(source.features.map(feature => [feature.properties.shapeName, feature]))
if (bySourceName.size !== divisions.length) throw new Error('Duplicate or missing source division names')
const features = divisions.map(([prefix, name, shortName, sourceName]) => {
  const feature = bySourceName.get(sourceName)
  if (!feature) throw new Error(`Missing source division: ${sourceName}`)
  validateGeometry(feature.geometry)
  const id = prefix === '53' ? 'yunnan' : `cn-${prefix}`
  return {
    type: 'Feature', id,
    properties: {
      kind: 'province', id, provinceId: id, divisionCode: `${prefix}0000`, name, shortName,
      sourceName, sourceShapeId: feature.properties.shapeID, sourceUrl: sourceBase + sourceFile,
      sourceLicense: metadata.boundaryLicense, sourceYear: metadata.boundaryYear,
    },
    geometry: feature.geometry,
  }
})
const national = {
  type: 'FeatureCollection',
  attribution: {
    name: 'geoBoundaries gbOpen CHN ADM1',
    source: metadata.boundarySource,
    license: metadata.boundaryLicense,
    yearRepresented: metadata.boundaryYear,
    sourceDataUpdateDate: metadata.sourceDataUpdateDate,
    buildDate: metadata.buildDate,
    metadataUrl: sourceBase + metadataFile,
    sourceUrl: sourceBase + sourceFile,
    commit, sha256: sourceHash,
    limitations: '第三方 2019 年省级粗略边界，仅用于本地旅行足迹示意；并非官方标准地图，未经地图审核，不可作为行政界线、测绘或导航依据。海岸、小岛及港澳轮廓精度有限，点位可能被误判；未补画或移动源坐标。',
    nameCorrections: {
      'Guangzhou Province': '广东省（源名错误；保留原始几何，应用名称映射为广东省）',
      'Ningxia Ningxia Hui Autonomous Region': '宁夏回族自治区（源名重复；保留原始几何）',
    },
    upstreamLicenseSource: metadata.licenseSource,
    upstreamLicenseCaveat: '上游许可字段为 Public Domain；其 Wikimedia 链接缺少具体文件名且协议格式有误，不能据此声称已逐一核验原始 Wikimedia 文件。',
  },
  features,
}
const yunnanFeatures = previous.features.filter(feature => feature.properties.kind === 'province')
if (yunnanFeatures.length !== 1 || yunnanFeatures[0].properties.divisionCode !== '530000') throw new Error('Unexpected legacy Yunnan province boundary')
yunnanFeatures.forEach(feature => validateGeometry(feature.geometry))
const yunnan = { type: 'FeatureCollection', features: yunnanFeatures }
const output = new Map([
  ['src/data/province-boundaries.json', national],
  ['public/data/china-provinces.geojson', national],
  ['src/data/yunnan-boundary.json', yunnan],
])
for (const [filename, data] of output) {
  const content = JSON.stringify(data) + '\n'
  const destination = resolve(root, filename)
  if (check) {
    if (await readFile(destination, 'utf8') !== content) throw new Error(`Generated geography is stale: ${filename}`)
  } else {
    await mkdir(resolve(destination, '..'), { recursive: true })
    await writeFile(destination, content)
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${filename}: ${Buffer.byteLength(content)} bytes; SHA256 ${sha256(content)}`)
}
console.log(`Verified ${features.length} provinces; fixed source ${sourceHash}; Yunnan geometry preserved from the existing source.`)
