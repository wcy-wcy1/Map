import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { hash } from './crypto.js'
export async function migrate(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(1942026097)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(id text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const sql = await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'), checksum = hash(sql)
    const prior = (await client.query("SELECT sha256 FROM schema_migrations WHERE id='001_initial'")).rows[0]
    if (prior && prior.sha256 !== checksum) throw new Error('An applied migration was modified')
    if (!prior) { await client.query(sql); await client.query("INSERT INTO schema_migrations(id,sha256) VALUES('001_initial',$1)", [checksum]) }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { await client.end() }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.SHANHAI_DATABASE_URL) throw new Error('SHANHAI_DATABASE_URL is required')
  await migrate(process.env.SHANHAI_DATABASE_URL)
  console.log('Applied checked migrations to the explicitly configured PostgreSQL database.')
}
