/** Produces an independent local trial from an exact, current passing build. */
import { mkdir, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { MANIFEST_FORMAT, assertSafeName, readSafeFile, safeRoot, loadRelease, sha256 } from './serve.mjs'
import { assertSnapshotEqual, sourceSnapshot, distributionSnapshot, validateVerification } from './release-utils.mjs'

export { sourceSnapshot, distributionSnapshot, validateVerification }

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

/** ZIP32 with UTF-8 filenames, CRC32 and a central directory; no external tool. */
export function createZip(entries, date = new Date()) {
  assert.ok(entries.length < 65535, 'ZIP32 entry limit')
  const bodies = [], central = [], seen = new Set()
  let offset = 0
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()))
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  for (const entry of entries) {
    assertSafeName(entry.name)
    assert.ok(!seen.has(entry.name), 'Duplicate ZIP entry')
    seen.add(entry.name)
    const name = Buffer.from(entry.name, 'utf8'), compressed = deflateRawSync(entry.bytes, { level: 9 }), crc = crc32(entry.bytes)
    assert.ok(name.length < 65536 && compressed.length < 0xffffffff && entry.bytes.length < 0xffffffff, 'ZIP32 size limit')
    assert.deepEqual(inflateRawSync(compressed), entry.bytes, 'ZIP compression round-trip')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.bytes.length, 22); local.writeUInt16LE(name.length, 26)
    bodies.push(local, name, compressed)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt16LE(8, 10)
    header.writeUInt16LE(dosTime, 12); header.writeUInt16LE(dosDate, 14); header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(entry.bytes.length, 24); header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38); header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += local.length + name.length + compressed.length
    assert.ok(offset < 0xffffffff, 'ZIP32 offset limit')
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...bodies, centralBytes, end])
}

const README = `# 山海集 Vue 本地试用包

这是云南旅行记录 Vue 版本的独立本地试用构建。无需安装 npm 依赖；需要已安装并处于维护期的 Node.js 22.22.2+ 或 24.15.0+。

1. 完整解压 ZIP，进入含 serve.mjs 和 manifest.json 的目录。
2. 在终端运行：node serve.mjs
3. 浏览器打开：http://127.0.0.1:5176/app
4. 结束时在终端按 Ctrl+C。

更换端口的唯一参数是数字，例如 node serve.mjs 5177。地址固定为 127.0.0.1，仅本机可访问；不提供局域网、公网部署或写入接口。端口被占用时会报错，不会悄悄换端口。

请保持同一浏览器、地址和端口。浏览器记录以来源隔离；更换端口、localhost/127.0.0.1 或浏览器，会打开另一份本地存储。需要迁移时，请先在原应用导出个人备份，再在目标来源手动导入。不要清理浏览器站点数据来排错。直接双击 index.html 不受支持。

此包只包含审核构建清单中的网页资源、公开地图来源与许可，以及服务脚本和本说明。个人记录、照片、浏览器数据库和备份文件不属于打包输入。文件白名单和 SHA-256 比对是完整性检查，不能证明任意源代码文本绝无敏感内容。报告证明的自动化检查范围与手机体验、实际系统分享、用户试用不同；本包不声称已完成公开上线验收。

服务启动时核验完整目录、清单文件长度及 SHA-256，把获准网页资源缓存进内存。额外文件、符号链接和修改过的字节会导致启动失败。修改文件后应重新构建、验证并打包；不要手改 manifest.json。运行后对磁盘的修改不会被网页服务读取。

manifest.json 记录构建验证报告的摘要哈希和包内文件哈希；外部同名 .release.json 回执记录 ZIP 与清单哈希。README.md、serve.mjs 和发布清单不作为网页路由提供。网页只接受 GET/HEAD，没有 QA、上传、任意文件读取或数据写入接口。

公开数据来源见 data/SOURCES.md；Leaflet 许可见 licenses/Leaflet.txt。可选择 34 个省区并添加个人地点，公共目录目前仍为云南 43 个代表性地点；省区轮廓较粗略，不是全国完整景点目录、导航地图或实时排名。
`

export async function packageRelease({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), now = new Date() } = {}) {
  const verification = await validateVerification(root, { now })
  root = verification.root
  const entries = []
  for (const artifact of verification.artifacts) {
    const bytes = await readSafeFile(root, artifact.path)
    assert.equal(bytes.length, artifact.bytes, `Artifact length changed: ${artifact.path}`)
    assert.equal(sha256(bytes), artifact.sha256, `Artifact hash changed: ${artifact.path}`)
    entries.push({ name: artifact.path.slice('dist/'.length), bytes })
  }
  const serverBytes = await readSafeFile(root, 'scripts/serve.mjs')
  assert.equal(sha256(serverBytes), verification.sources.find(source => source.path === 'scripts/serve.mjs')?.sha256, 'Server changed after verification')
  entries.push({ name: 'serve.mjs', bytes: serverBytes }, { name: 'README.md', bytes: Buffer.from(README) })
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const createdAt = new Date(now).toISOString()
  const manifest = {
    format: MANIFEST_FORMAT, version: 1, createdAt,
    purpose: 'Independent Vue local trial; loopback only',
    verification: { checkedAt: verification.report.checkedAt, reportSha256: verification.reportSha256, sourceSnapshotSha256: sha256(Buffer.from(JSON.stringify(verification.sources))), checks: verification.report.checks.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })) },
    publicFiles: verification.artifacts.map(artifact => artifact.path.slice('dist/'.length)).sort(),
    files: entries.map(({ name, bytes }) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })),
    generatedFiles: ['manifest.json'],
    checks: { exactDistributionAllowlist: true, viteDependencyClosure: true, sourceAndArtifactHashesMatchPassingReport: true, noSymlinkInputs: true, serverLoopbackOnly: true },
    limits: 'File allowlisting and byte hashes check package scope and integrity; they are not proof that arbitrary source text contains no sensitive content, nor certification of phone testing, real sharing or public deployment. Browser records, personal backups and photos are not packaging inputs.',
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  entries.push({ name: 'manifest.json', bytes: manifestBytes })
  // Capture bytes first, then confirm no source/report/build changed while reading.
  const confirmed = await validateVerification(root, { now })
  assert.equal(confirmed.reportSha256, verification.reportSha256, 'Verification report changed during packaging')
  assertSnapshotEqual(confirmed.sources, verification.sources, 'Packaging sources')
  assertSnapshotEqual(confirmed.artifacts, verification.artifacts, 'Packaging artifacts', true)

  const releaseRoot = path.join(root, 'release')
  try { await lstat(releaseRoot) } catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(releaseRoot) }
  await safeRoot(releaseRoot)
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const bundleName = `shanhai-vue-local-trial-${stamp}-${randomUUID().slice(0, 8)}`
  const bundleRoot = path.join(releaseRoot, bundleName)
  await mkdir(bundleRoot) // Unique, exclusive directory: no previous output is removed.
  await safeRoot(bundleRoot)
  for (const entry of entries) {
    const target = path.join(bundleRoot, ...entry.name.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await safeRoot(path.dirname(target))
    await writeFile(target, entry.bytes, { flag: 'wx' })
  }
  await loadRelease(bundleRoot)
  const archive = createZip(entries.map(entry => ({ ...entry, name: `${bundleName}/${entry.name}` })), new Date(now))
  const archivePath = path.join(releaseRoot, `${bundleName}.zip`)
  await safeRoot(releaseRoot)
  await writeFile(archivePath, archive, { flag: 'wx' })
  const receipt = {
    format: 'shanhai-vue-local-trial-receipt', version: 1, createdAt,
    directory: `release/${bundleName}`, archive: `release/${bundleName}.zip`,
    archiveBytes: archive.length, archiveSha256: sha256(archive), manifestSha256: sha256(manifestBytes),
    verificationReportSha256: verification.reportSha256, fileCount: entries.length,
    unlistedFilesIncluded: 0,
    scope: 'Local Vue trial. Exact file allowlist and matching verification hashes; no public deployment, browser data export, phone certification or live sharing claim.',
  }
  const receiptPath = path.join(releaseRoot, `${bundleName}.release.json`)
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return { receipt, manifest, bundleRoot, archivePath, receiptPath }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/package.mjs (no arguments)')
    const { receipt } = await packageRelease()
    console.log(JSON.stringify(receipt, null, 2))
  } catch (error) { console.error(`Cannot package local trial: ${error.message}`); process.exitCode = 1 }
}
