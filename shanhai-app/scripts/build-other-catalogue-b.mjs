import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = new URL('../', import.meta.url), evidenceDir = 'reference/catalogue/expansion/'
export async function buildOtherCatalogueB() {
const read = async path => JSON.parse((await readFile(new URL(path, root), 'utf8')).replace(/^\uFEFF/, ''))
const candidates = await read(evidenceDir + 'other-candidates.json'), resolved = await read(evidenceDir + 'other-resolved.json')
const ids = new Set(['cn-43','cn-44','cn-46','cn-50','cn-61','cn-64','cn-63','cn-15','cn-54','cn-71','cn-81','cn-82'])
const provinces = (await read('src/data/province-boundaries.json')).features
const entities = new Map()
for (const file of (await readdir(new URL(evidenceDir, root))).filter(f => /^other-wikidata-\d+\.json$/.test(f) || f === 'b-wikidata-extra.json')) {
  for (const entity of Object.values((await read(evidenceDir + file)).entities)) entities.set(entity.id, { entity, file })
}
const overrides = { 'guangdong-guangji': 'Q826705', 'macau-mandarin-house': 'Q6757684', 'neimenggu-xiangshawan': 'Q42310009' }
const special = {}
for (const [id, file, type, objectId] of [['hainan-boao','b-osm-yudai.json','way',1460883593], ['ningxia-sand-lake','b-osm-sand-lake.json','relation',16906759], ['neimenggu-asihatu','b-osm-asihatu-way.json','way',961619853], ['chongqing-gongtan','b-osm-gongtan.json','node',2886574248]]) {
  const elements = (await read(evidenceDir + file)).elements, object = elements.find(e => e.type === type && e.id === objectId)
  let coordinates, method
  if (type === 'node') { coordinates = [object.lon, object.lat]; method = 'original OSM settlement node (current Gongtan, not submerged old site)' }
  else if (type === 'relation') {
    const result = (await read(evidenceDir + 'b-nominatim.json')).flatMap(x => x.results).find(x => x.osm_type === type && x.osm_id === objectId)
    coordinates = [Number(result.lon), Number(result.lat)]; method = 'Nominatim display point of the named lake; not an entrance'
  } else {
    const byId = new Map(elements.filter(e => e.type === 'node').map(e => [e.id,e]))
    const ring = object.nodes.map(id => byId.get(id)), y = (Math.min(...ring.map(n => n.lat)) + Math.max(...ring.map(n => n.lat))) / 2
    const crossings = []
    for (let i=1; i<ring.length; i++) { const a=ring[i-1],b=ring[i]; if ((a.lat>y)!==(b.lat>y)) crossings.push(a.lon+(b.lon-a.lon)*(y-a.lat)/(b.lat-a.lat)) }
    crossings.sort((a,b)=>a-b)
    const intervals = []; for(let i=1;i<crossings.length;i+=2) intervals.push([crossings[i-1],crossings[i]])
    intervals.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0])); if(!intervals.length) throw new Error('No surface point')
    coordinates = [(intervals[0][0]+intervals[0][1])/2,y]; method = 'midpoint of longest interior horizontal interval at bbox mid-latitude'
  }
  const url = `https://www.openstreetmap.org/${type}/${objectId}`
  special[id] = { coordinates, source: url, coordinateSource: { type: type === 'node' ? 'osm-node' : 'osm-surface-point', url, rawUrl: `https://api.openstreetmap.org/api/0.6/${type}/${objectId}${type === 'node' ? '' : '/full'}.json`, objectVersion: object.version, timestamp: object.timestamp, method, evidenceFile: evidenceDir + file, evidenceKey: `${type}/${objectId}`, license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' } }
}
const rows = candidates.filter(p => ids.has(p.mapId)).map(p => {
  let coordinate = special[p.id]
  if (!coordinate) {
    const qid = overrides[p.id] ?? resolved[p.id]?.page.pageprops?.wikibase_item
    const selected = entities.get(qid)
    if (!selected) throw new Error(`Missing entity: ${p.id}`)
    const { entity, file } = selected
    if (entity.claims.P31?.some(c => c.mainsnak.datavalue?.value.id === 'Q4167410')) throw new Error(`Disambiguation entity: ${p.id}`)
    const statements = (entity.claims.P625 ?? []).filter(c => c.rank !== 'deprecated' && c.mainsnak.datavalue?.value.globe === 'http://www.wikidata.org/entity/Q2')
    const statement = statements.find(c => c.rank === 'preferred') ?? statements[0]
    if (!statement) throw new Error(`Missing coordinate: ${p.id}`)
    const point = statement.mainsnak.datavalue.value, url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json?revision=${entity.lastrevid}`
    coordinate = { coordinates: [point.longitude, point.latitude], source: `https://www.wikidata.org/wiki/${qid}`, coordinateSource: { type:'wikidata-coordinate', url, rawUrl:url, entityId:qid, revision:entity.lastrevid, statementId:statement.id, precision:point.precision, referenceCount:statement.references?.length ?? 0, evidenceFile:evidenceDir+file, evidenceKey:qid, license:'CC0-1.0' } }
  }
  const province = provinces.find(r => r.properties.provinceId === p.mapId).properties
  const name = p.id === 'xizang-guge' ? '古格王城遗址' : p.name
  const notes = { 'chongqing-gongtan':'以现龚滩镇村落节点代表重建古镇街区，不指沉没的旧址', 'ningxia-sand-lake':'以沙湖湖面显示点代表沙湖，不指门票入口', 'hainan-boao':'以玉带滩原始沙滩面的内部代表点定位', 'neimenggu-asihatu':'以具名阿斯哈图石林园区原始面的内部点定位，不使用整个克什克腾旗中心', 'qinghai-kumbum':'采用Wikidata寺院坐标；未采用与OSM位置不符的中文Wikipedia坐标', 'taiwan-lukang':'采用Wikidata鹿港寺院坐标；拒用中文Wikipedia偏南约一纬度的错误坐标', 'guangdong-kaiping':'开平碉楼与村落遗产地的社区代表点，不代表所有碉楼或某座单体' }
  return { id:p.id, name, aliases:[p.title].filter(s=>s!==name), mapId:p.mapId, regionId:p.mapId, regionName:province.name, city:province.shortName, category:p.iconKey, iconKey:p.iconKey, ...coordinate, coordinateSystem:'WGS84', anchorNote:`${notes[p.id] ?? '采用具名地点的开放社区代表点'}；仅作回忆地图定位，不是导航入口，不代表到访。`, text:p.scene+'。', highlights:[p.scene], priority:p.priority, discoveryTier:p.discoveryTier }
})
if (rows.length !== 48) throw new Error('Unexpected B coverage')
for (const row of rows) {
  row.coordinateSource.evidenceSha256 = createHash('sha256').update(await readFile(new URL(row.coordinateSource.evidenceFile, root))).digest('hex')
  if (row.id === 'ningxia-sand-lake') {
    row.coordinateSource.displayPointEvidenceFile = evidenceDir + 'b-nominatim.json'
    row.coordinateSource.displayPointEvidenceSha256 = createHash('sha256').update(await readFile(new URL(row.coordinateSource.displayPointEvidenceFile, root))).digest('hex')
  }
}
return rows
}
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) {
  const text = JSON.stringify(await buildOtherCatalogueB(), null, 2) + '\n', path = new URL('src/data/other-province-places-b.json', root)
  if (process.argv.includes('--check')) { if (await readFile(path, 'utf8') !== text) throw new Error('Stale additional catalogue B') }
  else await writeFile(path, text)
  console.log('Built 48 reviewed additional places (B)')
}
