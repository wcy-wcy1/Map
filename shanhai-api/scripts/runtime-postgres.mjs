/** Local developer helper. Never installs a Windows service or deletes a cluster. */
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile, access, unlink, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'
import { homedir } from 'node:os'

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)))
const local = path.join(root, '.local'), configFile = path.join(local, 'runtime.json')
// Native Windows PostgreSQL cannot initialize UTF8 with this workspace's CJK
// binary/data paths. Keep one deterministic, project-specific ASCII cache.
const cache = path.join(homedir(), '.cache', 'shanhai-postgres', createHash('sha256').update(root).digest('hex').slice(0, 16))
const cluster = path.join(cache, 'data'), native = path.join(cache, 'native-17.10')
const port = 55439
const command = process.argv[2]
if (!['start', 'status', 'stop'].includes(command)) throw new Error('Usage: node scripts/runtime-postgres.mjs start|status|stop')
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This pinned development helper is Windows x64 only; use your own PostgreSQL on other platforms.')
const requireRuntime = createRequire(new URL('../qa/runtime/package.json', import.meta.url))
const sourceBinaries = await import(pathToFileURL(requireRuntime.resolve('@embedded-postgres/windows-x64')).href)
const binaries = { pg_ctl: path.join(native, 'bin', 'pg_ctl.exe'), initdb: path.join(native, 'bin', 'initdb.exe') }
const { Client } = requireRuntime('pg')
const exists = async file => { try { await access(file); return true } catch { return false } }
const inside = actual => actual.toLowerCase().startsWith((root + path.sep).toLowerCase())
if (command === 'start') await mkdir(local, { recursive: true })
if (!await exists(local)) { console.log(JSON.stringify({ running: false, initialized: false })); process.exit(0) }
if (!inside(await realpath(local))) throw new Error('Refusing runtime directory outside this project')
if (/[^\x20-\x7e]/.test(cache)) throw new Error('PostgreSQL Windows helper requires an ASCII user cache path')
if (command === 'start') await mkdir(cache, { recursive: true })
if (!await exists(cache)) { console.log(JSON.stringify({ running: false, initialized: false })); process.exit(0) }
if ((await realpath(cache)).toLowerCase() !== cache.toLowerCase()) throw new Error('Refusing redirected runtime cache')
if (await exists(cluster) && !(await realpath(cluster)).toLowerCase().startsWith((cache + path.sep).toLowerCase())) throw new Error('Refusing external cluster')
if (!await exists(native) && command === 'start') await cp(path.resolve(sourceBinaries.pg_ctl, '../..'), native, { recursive: true, errorOnExist: true, force: false })
if (!await exists(binaries.pg_ctl)) { console.log(JSON.stringify({ running: false, initialized: false })); process.exit(0) }

async function run(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: cache, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk))
    child.on('error', reject)
    // pg_ctl exits after readiness, but Windows postgres can retain inherited
    // pipe handles. Await the verified child exit, not descendant pipe closure.
    child.on('exit', code => {
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy()
      resolve({ code, output: Buffer.concat(chunks).toString('utf8') })
    })
    child.stdin.end(input)
  })
}
const control = args => run(binaries.pg_ctl, ['-D', cluster, ...args])
const status = await control(['status'])
if (command === 'status') { console.log(JSON.stringify({ running: status.code === 0, initialized: await exists(path.join(cluster, 'PG_VERSION')), port, details: status.output.trim() })); process.exit(0) }
if (command === 'stop') {
  if (status.code !== 0) { console.log(JSON.stringify({ stopped: false, reason: 'Cluster is not running; nothing changed' })); process.exit(0) }
  const result = await control(['stop', '-m', 'fast', '-w', '-t', '30'])
  if (result.code !== 0) throw new Error(result.output)
  console.log(JSON.stringify({ stopped: true, dataPreserved: true, cluster })); process.exit(0)
}

let config
if (await exists(configFile)) {
  config = JSON.parse(await readFile(configFile, 'utf8'))
  const oldCluster = path.join(local, 'postgres')
  if (config.cluster === oldCluster && !await exists(oldCluster) && !await exists(cluster)) {
    config.cluster = cluster
    await writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600 })
  }
}
else {
  if (await exists(cluster)) throw new Error('Existing cluster without this helper configuration; refusing to guess credentials')
  const adminPassword = randomBytes(32).toString('base64url'), appPassword = randomBytes(32).toString('base64url')
  config = {
    format: 1, port, cluster, adminPassword, appPassword,
    developmentDatabaseUrl: `postgresql://shanhai_app:${appPassword}@127.0.0.1:${port}/shanhai_api_dev`,
    testDatabaseUrl: `postgresql://shanhai_app:${appPassword}@127.0.0.1:${port}/shanhai_api_test`,
    testAuthSecret: randomBytes(32).toString('base64url'),
    signingSecret: randomBytes(48).toString('base64url'),
  }
  await writeFile(configFile, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 })
}
if (config.format !== 1 || config.port !== port || config.cluster !== cluster || !/^[A-Za-z0-9_-]{43}$/.test(config.adminPassword) || !/^[A-Za-z0-9_-]{43}$/.test(config.appPassword)) throw new Error('Runtime configuration mismatch; refusing to modify cluster')
if (status.code !== 0) {
  const occupied = await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }); socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(true) })
  })
  if (occupied) throw new Error(`Port ${port} is already occupied; no process was stopped`)
  if (!await exists(path.join(cluster, 'PG_VERSION'))) {
    const passwordFile = path.join(cache, `init-${randomBytes(12).toString('hex')}.secret`)
    await writeFile(passwordFile, config.adminPassword + '\n', { flag: 'wx', mode: 0o600 })
    try {
      const initialized = await run(binaries.initdb, ['-D', cluster, '-U', 'shanhai_runtime_admin', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile=' + passwordFile])
      if (initialized.code !== 0) throw new Error(initialized.output)
    } finally { await unlink(passwordFile) }
  }
  const started = await control(['start', '-l', path.join(cache, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=30`, '-w', '-t', '30'])
  if (started.code !== 0) throw new Error(started.output)
}
const client = new Client({ host: '127.0.0.1', port, user: 'shanhai_runtime_admin', password: config.adminPassword, database: 'postgres' })
await client.connect()
try {
  const role = await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='shanhai_app'")
  if (!role.rowCount) await client.query(`CREATE ROLE shanhai_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${config.appPassword}'`)
  else if (role.rows[0].rolsuper || role.rows[0].rolcreatedb || role.rows[0].rolcreaterole) throw new Error('Application role unexpectedly has administrative privileges')
  for (const dbName of ['shanhai_api_dev', 'shanhai_api_test']) {
    const database = await client.query('SELECT datname FROM pg_database WHERE datname=$1', [dbName])
    if (!database.rowCount) await client.query(`CREATE DATABASE ${dbName} OWNER shanhai_app`)
  }
  const version = (await client.query('SELECT version() AS version')).rows[0].version
  console.log(JSON.stringify({ running: true, host: '127.0.0.1', port, version, applicationRole: 'non-superuser', configuration: configFile, databases: ['shanhai_api_dev', 'shanhai_api_test'], dataPreserved: true }))
} finally { await client.end() }
