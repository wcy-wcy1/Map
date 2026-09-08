/** Visible, explicitly triggered controls for isolated native IndexedDB QA. */
const dbName = 'shanhai-lijiang-local-v1'
const allowed = location.hostname === '127.0.0.1' && ['5175', '5177'].includes(location.port)
const status = document.querySelector('#status'), output = document.querySelector('#result')
const controls = [...document.querySelectorAll('button')]
const encoder = new TextEncoder()
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
const request = item => new Promise((resolve, reject) => { item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error) })
const completed = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error ?? new Error('事务中止')); transaction.onerror = () => {}
})
async function exists() {
  if (typeof indexedDB.databases !== 'function') throw new Error('当前浏览器不支持安全枚举，未访问数据库。')
  return (await indexedDB.databases()).some(db => db.name === dbName)
}
async function run(action) {
  if (!allowed) { status.textContent = '非隔离测试来源，全部操作禁用。'; return }
  controls.forEach(button => { button.disabled = true })
  try { await action() }
  catch (error) { status.textContent = '检查未完成：' + error.message }
  finally { controls.forEach(button => { button.disabled = false }) }
}
async function inspect() {
  if (!await exists()) { output.textContent = JSON.stringify({ exists: false }, null, 2); status.textContent = '此来源尚无山海集数据库，没有创建空库。'; return }
  const db = await request(indexedDB.open(dbName))
  try {
    const stores = [...db.objectStoreNames], transaction = db.transaction(stores, 'readonly')
    const done = completed(transaction)
    const entries = await Promise.all(stores.map(async name => [name, await request(transaction.objectStore(name).getAll())]))
    await done
    const rows = Object.fromEntries(entries)
    const signatures = Object.fromEntries(await Promise.all(['visits', 'covers', 'drafts'].map(async name => [name, await sha(encoder.encode(JSON.stringify(rows[name] ?? [])))])))
    const visits = await Promise.all((rows.visits ?? []).map(async row => ({ id: row.id, placeId: row.placeId, date: row.date, note: row.note, coverId: row.coverId,
      customPlace: row.customPlace, fields: Object.keys(row).sort(), photos: await Promise.all(row.photos.map(async photo => ({ id: photo.id, name: photo.name, encodedLength: photo.url.length, sha256: await sha(encoder.encode(photo.url)) }))) })))
    const draft = rows.drafts?.find(row => row.slot === 'active')?.draft
    output.textContent = JSON.stringify({ exists: true, version: db.version, stores, signatures, visits, covers: rows.covers ?? [],
      derivedIndex: rows.visitIndex ? { count: rows.visitIndex.length, revision: rows.libraryMeta?.find(row => row.id === 'library')?.revision,
        bytes: encoder.encode(JSON.stringify(rows.visitIndex)).length,
        visitFields: rows.visitIndex.map(row => ({ id: row.id, fields: Object.keys(row).sort(), photoFields: row.photos.map(photo => Object.keys(photo).sort()) })) } : null,
      draft: draft ? { id: draft.id, visitId: draft.visitId, placeId: draft.placeId, date: draft.date, note: draft.note, version: draft.version,
        customPlace: draft.customPlace, photoCount: draft.photos?.length ?? 0 } : null }, null, 2)
    status.textContent = `只读检查完成：schema ${db.version}，${visits.length} 条记录。`
  } finally { db.close() }
}
async function seed() {
  if (await exists()) throw new Error('此来源已有数据库；没有清除、降级或覆盖任何内容。')
  const response = await fetch('/fixture.jpg')
  if (!response.ok) throw new Error('测试图片不可用')
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  const photo = { id: 'legacy-v1-photo', name: '合成升级测试.jpg', url: 'data:image/jpeg;base64,' + btoa(binary) }
  const open = indexedDB.open(dbName, 1)
  let created = false
  open.onupgradeneeded = event => {
    if (event.oldVersion !== 0) { open.transaction.abort(); return }
    created = true
    const db = open.result
    db.createObjectStore('visits', { keyPath: 'id' }).add({ id: 'legacy-v1-qa-memory', placeId: 'yulong', createdAt: 1735689600000,
      date: '2025-01-01', note: 'schema 1 合成旧记录，升级后照片与手记应保留。', photos: [photo], coverId: photo.id })
    db.createObjectStore('covers', { keyPath: 'placeId' }).add({ placeId: 'yulong', visitId: 'legacy-v1-qa-memory', photoId: photo.id })
  }
  open.onblocked = () => { status.textContent = '建库被其他页面阻塞，没有请求清除数据。' }
  const db = await request(open)
  db.close()
  if (!created) throw new Error('另一个页面已建立数据库，没有写入测试记录。')
  await inspect()
  status.textContent = '已建立 schema 1 合成库。可先检查，再点击 Vue 构建验证升级。'
}
document.querySelector('#inspect').addEventListener('click', () => run(inspect))
document.querySelector('#seed').addEventListener('click', () => run(seed))
if (!allowed) { controls.forEach(button => { button.disabled = true }); status.textContent = '非隔离测试来源，全部操作禁用。' }
