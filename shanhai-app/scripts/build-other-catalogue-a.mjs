// Node-only offline builder, equivalent to the original research Python helper.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = new URL('../', import.meta.url), evidenceDir = 'reference/catalogue/expansion/'
const read = async path => JSON.parse((await readFile(new URL(path, root), 'utf8')).replace(/^\uFEFF/, ''))

export async function buildOtherCatalogueA() {
  const candidates = await read(evidenceDir + 'other-candidates.json'), resolved = await read(evidenceDir + 'other-resolved.json')
  const scopes = ['cn-12','cn-13','cn-14','cn-21','cn-22','cn-23','cn-31','cn-32','cn-34','cn-36','cn-37','cn-41','cn-42']
  const cities = [Array(4).fill('天津'),['秦皇岛','承德','石家庄','张家口'],['晋中','大同','忻州','朔州'],['沈阳','大连','朝阳','本溪'],['延边','长春','通化','延边'],['哈尔滨','黑河','牡丹江','齐齐哈尔'],Array(4).fill('上海'),['苏州','南京','无锡','扬州'],Array(4).fill('黄山'),['九江','南昌','景德镇','九江'],['泰安','济宁','潍坊','烟台'],['洛阳','郑州','洛阳','南阳'],['武汉','十堰','襄阳','武汉']]
  const fixes = {
    'jiangxi-lushan': { title:'汉阳峰', name:'庐山·汉阳峰', scene:'庐山主峰的山林与峰峦' },
    'shanxi-foguang-temple': { title:'佛光寺 (五台)', name:'佛光寺（五台）' },
    'heilongjiang-wudalianchi': { title:'五大连池火山群', name:'五大连池火山群' },
    'henan-songyang': { id:'henan-guanlin', title:'关林', name:'关林', scene:'古树与红色庙宇屋檐', iconKey:'temple' },
    'hubei-tusi-city': { id:'hubei-guqin-terrace', title:'古琴臺', name:'古琴台', scene:'湖畔亭廊与琴台', iconKey:'garden' },
  }
  const extra = new Map()
  for (const file of ['other-wikipedia-a-fixes.json', 'other-wikipedia-a-anchor-check.json']) {
    for (const page of (await read(evidenceDir + file)).query.pages) extra.set(page.title, { page, file })
  }
  const entities = new Map()
  for (const file of (await readdir(new URL(evidenceDir, root))).filter(f => /^other-wikidata-\d+\.json$/.test(f) || ['other-wikidata-a-fixes.json','other-wikidata-a-anchor.json'].includes(f))) {
    for (const entity of Object.values((await read(evidenceDir + file)).entities)) entities.set(entity.id, { entity, file })
  }
  const provinces = (await read('src/data/province-boundaries.json')).features, result = []
  for (const original of candidates.filter(p => scopes.includes(p.mapId))) {
    const p = { ...original, ...fixes[original.id] }
    if (p.id === 'jiangxi-yaoli') p.name = '瑶里古镇'
    const { page, file: pageFile } = fixes[original.id] ? extra.get(p.title) : resolved[p.id]
    if ('disambiguation' in (page.pageprops ?? {})) throw new Error(`Disambiguation page: ${p.id}`)
    const qid = page.pageprops?.wikibase_item, { entity, file: entityFile } = entities.get(qid) ?? {}
    const claims = (entity?.claims.P625 ?? []).filter(c => c.rank !== 'deprecated' && c.mainsnak.snaktype === 'value' && c.mainsnak.datavalue.value.globe === 'http://www.wikidata.org/entity/Q2')
    const claim = claims.find(c => c.rank === 'preferred') ?? claims[0]
    let coordinates, source, evidenceFile
    if (claim) {
      const value = claim.mainsnak.datavalue.value
      coordinates = [value.longitude, value.latitude]; evidenceFile = evidenceDir + entityFile
      source = { type:'wikidata-coordinate', url:`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json?revision=${entity.lastrevid}`, entityId:qid, revision:entity.lastrevid, modified:entity.modified, statementId:claim.id, globe:value.globe, precision:value.precision ?? null, referenceCount:claim.references?.length ?? 0, license:'CC0-1.0', licenseUrl:'https://www.wikidata.org/wiki/Wikidata:Licensing', evidenceKey:`entities.${qid}.claims.P625` }
    } else {
      const value = page.coordinates?.find(c => c.primary && c.globe === 'earth')
      if (!value) throw new Error(`Missing coordinate: ${p.id}`)
      coordinates = [value.lon, value.lat]; evidenceFile = evidenceDir + pageFile
      const revision = page.revisions[0]
      source = { type:'wikipedia-coordinate', url:`https://zh.wikipedia.org/w/index.php?oldid=${revision.revid}`, pageId:page.pageid, revision:revision.revid, modified:revision.timestamp, globe:'earth', license:'CC-BY-SA-4.0', licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/', evidenceKey:`query.pages[pageid=${page.pageid}].coordinates` }
    }
    source.evidenceFile = evidenceFile
    source.evidenceSha256 = createHash('sha256').update(await readFile(new URL(evidenceFile, root))).digest('hex')
    const province = provinces.find(f => f.properties.provinceId === p.mapId).properties
    result.push({ id:p.id, name:p.name, aliases:[...new Set([p.title,p.regionName])], mapId:p.mapId, regionId:p.mapId, regionName:province.name, city:cities[scopes.indexOf(p.mapId)][result.filter(r => r.mapId === p.mapId).length], category:p.iconKey, iconKey:p.iconKey, coordinates, coordinateSystem:'WGS84', coordinateSource:source, anchorNote:`${p.name}公开条目代表点；景区和建筑群使用整体代表位置，仅作回忆定位，不是导航入口或到访证明。`, source:`https://zh.wikipedia.org/w/index.php?oldid=${page.revisions[0].revid}`, text:p.scene+'。', highlights:[p.scene], priority:p.priority, discoveryTier:p.discoveryTier })
  }
  const notes = {
    'jiangxi-lushan':'以庐山最高峰汉阳峰为明确代表点，采用汉阳峰条目坐标；不混用庐山遗产范围和山体条目的宽泛登记点。仅作回忆定位，不是景区入口。',
    'jiangxi-yaoli':'瑶里古镇代表点；Wikidata瑶里镇坐标与OSM瑶里古镇旅游节点5175990732相邻，区别于行政镇域中心。不是导航入口。',
    'shandong-taishan':'泰山整体代表点；采用与UNESCO遗产437登记位置一致的Wikidata条目坐标，不声称玉皇顶或景区入口。',
    'shanxi-pingyao':'平遥古城整体代表点；采用古城Wikidata实体坐标，不使用同名平遥古城高铁站的位置。不是城门入口。',
    'liaoning-laohutan':'老虎滩海洋公园条目代表点；临海坐标位于本应用粗化省区轮廓之外，保留来源真实坐标，不据示意轮廓判定归属。不是导航入口。',
    'jilin-fangchuan':'防川村条目代表点；边境狭长地形在粗化省区轮廓中失真，保留来源真实坐标，不据示意轮廓判定归属。不是导航入口。',
  }
  for (const p of result) {
    if (notes[p.id]) p.anchorNote = notes[p.id]
    const unesco = { 'jiangxi-lushan':778, 'shandong-taishan':437, 'shanxi-pingyao':812 }[p.id]
    if (unesco) p.source = `https://whc.unesco.org/en/list/${unesco}/`
  }
  if (result.length !== 52) throw new Error('Unexpected A coverage')
  return result
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) {
  const text = JSON.stringify(await buildOtherCatalogueA(), null, 2) + '\n', path = new URL('src/data/other-province-places-a.json', root)
  if (process.argv.includes('--check')) { if (await readFile(path, 'utf8') !== text) throw new Error('Stale additional catalogue A') }
  else await writeFile(path, text)
  console.log('Built 52 reviewed additional places (A)')
}
