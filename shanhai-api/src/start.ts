import { createApp } from './app.js'
import { configFromEnv } from './config.js'

const config = configFromEnv()
const app = await createApp(config)
await app.listen(config.port, '127.0.0.1')
console.log(`Shanhai local test API: ${config.origin} (test identities only; not a public server)`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)) })
