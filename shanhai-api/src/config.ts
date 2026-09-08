import path from 'node:path'
export interface ApiConfig {
  databaseUrl: string; storageRoot: string; origin: string; port: number
  testAuthEnabled: boolean; testAuthSecret: string
}
export function validateConfig(config: ApiConfig): ApiConfig {
  const origin = new URL(config.origin), database = new URL(config.databaseUrl)
  if (origin.origin !== config.origin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.port !== String(config.port)) throw new Error('Local API origin must be exactly http://127.0.0.1:<port>')
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid local port')
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost'].includes(database.hostname)) throw new Error('Only an explicitly configured local PostgreSQL database is supported')
  if (!path.isAbsolute(config.storageRoot) || path.parse(config.storageRoot).root === path.resolve(config.storageRoot)) throw new Error('An explicit private storage subdirectory is required')
  if (!config.testAuthEnabled || !config.testAuthSecret || config.testAuthSecret.length < 32 || process.env.NODE_ENV === 'production') throw new Error('This implementation requires explicit local-only test auth and a secret of at least 32 characters; production use is disabled')
  return { ...config, storageRoot: path.resolve(config.storageRoot) }
}
export function configFromEnv(env = process.env): ApiConfig {
  return validateConfig({ databaseUrl: env.SHANHAI_DATABASE_URL || '', storageRoot: env.SHANHAI_STORAGE_ROOT || '',
    origin: env.SHANHAI_ORIGIN || '', port: Number(env.SHANHAI_PORT),
    testAuthEnabled: env.SHANHAI_TEST_AUTH === '1', testAuthSecret: env.SHANHAI_TEST_AUTH_SECRET || '' })
}
