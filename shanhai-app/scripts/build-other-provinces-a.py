from pathlib import Path
import json,hashlib,urllib.parse
root=Path(__file__).resolve().parents[1]
evidence=root/'reference/catalogue/expansion'
cs=json.loads((evidence/'other-candidates.json').read_text(encoding='utf-8'))
resolved=json.loads((evidence/'other-resolved.json').read_text(encoding='utf-8'))
scopes=['cn-12','cn-13','cn-14','cn-21','cn-22','cn-23','cn-31','cn-32','cn-34','cn-36','cn-37','cn-41','cn-42']
cities=[['天津']*4,['秦皇岛','承德','石家庄','张家口'],['晋中','大同','忻州','朔州'],['沈阳','大连','朝阳','本溪'],['延边','长春','通化','延边'],['哈尔滨','黑河','牡丹江','齐齐哈尔'],['上海']*4,['苏州','南京','无锡','扬州'],['黄山']*4,['九江','南昌','景德镇','九江'],['泰安','济宁','潍坊','烟台'],['洛阳','郑州','洛阳','南阳'],['武汉','十堰','襄阳','武汉']]
fixes={
 'jiangxi-lushan':{'title':'汉阳峰','name':'庐山·汉阳峰','scene':'庐山主峰的山林与峰峦'},
 'shanxi-foguang-temple':{'title':'佛光寺 (五台)','name':'佛光寺（五台）'},
 'heilongjiang-wudalianchi':{'title':'五大连池火山群','name':'五大连池火山群'},
 'henan-songyang':{'id':'henan-guanlin','title':'关林','name':'关林','scene':'古树与红色庙宇屋檐','iconKey':'temple'},
 'hubei-tusi-city':{'id':'hubei-guqin-terrace','title':'古琴臺','name':'古琴台','scene':'湖畔亭廊与琴台','iconKey':'garden'},
}
extra=json.loads((evidence/'other-wikipedia-a-fixes.json').read_text(encoding='utf-8-sig'))['query']['pages'] + json.loads((evidence/'other-wikipedia-a-anchor-check.json').read_text(encoding='utf-8-sig'))['query']['pages']
entities={};files={}
for f in list(evidence.glob('other-wikidata-??.json'))+[evidence/'other-wikidata-a-fixes.json',evidence/'other-wikidata-a-anchor.json']:
 for q,e in json.loads(f.read_text(encoding='utf-8-sig')).get('entities',{}).items():entities[q]=e;files[q]=f
boundary=json.loads((root/'src/data/province-boundaries.json').read_text(encoding='utf-8'))
provinceNames={f['properties']['provinceId']:f['properties']['name'] for f in boundary['features']}
result=[]
for c0 in cs:
 if c0['mapId'] not in scopes:continue
 c={**c0,**fixes.get(c0['id'],{})}
 if c['id']=='jiangxi-yaoli': c['name']='瑶里古镇'
 if c0['id'] in fixes:
  page=next(p for p in extra if p['title']==c['title']);wpfile=evidence/'other-wikipedia-a-fixes.json'
 else:
  r=resolved[c['id']];page=r['page'];wpfile=evidence/r['file']
 assert 'disambiguation' not in page.get('pageprops',{}), c['id']
 q=page.get('pageprops',{}).get('wikibase_item');e=entities.get(q,{})
 claims=[a for a in e.get('claims',{}).get('P625',[]) if a.get('rank')!='deprecated' and a.get('mainsnak',{}).get('snaktype')=='value' and a['mainsnak']['datavalue']['value'].get('globe')=='http://www.wikidata.org/entity/Q2']
 claims.sort(key=lambda a: a['rank']!='preferred')
 if claims:
  a=claims[0];v=a['mainsnak']['datavalue']['value'];coords=[v['longitude'],v['latitude']];file=files[q]
  source={'type':'wikidata-coordinate','url':f'https://www.wikidata.org/wiki/Special:EntityData/{q}.json?revision={e["lastrevid"]}','entityId':q,'revision':e['lastrevid'],'modified':e['modified'],'statementId':a['id'],'globe':v['globe'],'precision':v.get('precision'),'referenceCount':len(a.get('references',[])),'license':'CC0-1.0','licenseUrl':'https://www.wikidata.org/wiki/Wikidata:Licensing','evidenceKey':f'entities.{q}.claims.P625'}
 else:
  v=next(v for v in page.get('coordinates',[]) if v.get('primary') and v.get('globe')=='earth');coords=[v['lon'],v['lat']];file=wpfile
  rev=page['revisions'][0];source={'type':'wikipedia-coordinate','url':f'https://zh.wikipedia.org/w/index.php?oldid={rev["revid"]}','pageId':page['pageid'],'revision':rev['revid'],'modified':rev['timestamp'],'globe':'earth','license':'CC-BY-SA-4.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/','evidenceKey':f'query.pages[pageid={page["pageid"]}].coordinates'}
 source.update({'evidenceFile':file.relative_to(root).as_posix(),'evidenceSha256':hashlib.sha256(file.read_bytes()).hexdigest()})
 pi=scopes.index(c['mapId']);localIndex=sum(x['mapId']==c['mapId'] for x in result)
 result.append({'id':c['id'],'name':c['name'],'aliases':list(dict.fromkeys([c['title'],c['regionName']])),'mapId':c['mapId'],'regionId':c['mapId'],'regionName':provinceNames[c['mapId']],'city':cities[pi][localIndex],'category':c['iconKey'],'iconKey':c['iconKey'],'coordinates':coords,'coordinateSystem':'WGS84','coordinateSource':source,'anchorNote':f'{c["name"]}公开条目代表点；景区和建筑群使用整体代表位置，仅作回忆定位，不是导航入口或到访证明。','source':f'https://zh.wikipedia.org/w/index.php?oldid={page["revisions"][0]["revid"]}','text':c['scene']+'。','highlights':[c['scene']],'priority':c['priority'],'discoveryTier':c['discoveryTier']})
notes={
 'jiangxi-lushan':'以庐山最高峰汉阳峰为明确代表点，采用汉阳峰条目坐标；不混用庐山遗产范围和山体条目的宽泛登记点。仅作回忆定位，不是景区入口。',
 'jiangxi-yaoli':'瑶里古镇代表点；Wikidata瑶里镇坐标与OSM瑶里古镇旅游节点5175990732相邻，区别于行政镇域中心。不是导航入口。',
 'shandong-taishan':'泰山整体代表点；采用与UNESCO遗产437登记位置一致的Wikidata条目坐标，不声称玉皇顶或景区入口。',
 'shanxi-pingyao':'平遥古城整体代表点；采用古城Wikidata实体坐标，不使用同名平遥古城高铁站的位置。不是城门入口。',
 'liaoning-laohutan':'老虎滩海洋公园条目代表点；临海坐标位于本应用粗化省区轮廓之外，保留来源真实坐标，不据示意轮廓判定归属。不是导航入口。',
 'jilin-fangchuan':'防川村条目代表点；边境狭长地形在粗化省区轮廓中失真，保留来源真实坐标，不据示意轮廓判定归属。不是导航入口。',
}
for p in result:
 if p['id'] in notes: p['anchorNote']=notes[p['id']]
 if p['id']=='jiangxi-lushan':p['source']='https://whc.unesco.org/en/list/778/'
 if p['id']=='shandong-taishan':p['source']='https://whc.unesco.org/en/list/437/'
 if p['id']=='shanxi-pingyao':p['source']='https://whc.unesco.org/en/list/812/'
assert len(result)==52
(root/'src/data/other-province-places-a.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('52 source-backed places built')
