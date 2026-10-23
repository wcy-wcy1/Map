/** Exact public map inputs; the existing meeting portrait folder is not a map input. */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PUBLIC_FILES, safeFileNames, readSafeFile } from './serve.mjs'
export const MAP_PUBLIC_SOURCES = Object.freeze(PUBLIC_FILES.filter(name => !['index.html', '.vite/manifest.json'].includes(name)).map(name => 'public/' + name))

export async function mapPublicNames(root) {
  // Metadata only for excluded portraits; never traverse or copy that directory.
  for (const entry of await readdir(join(root, 'public'), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden: public/${entry.name}`)
    if (['data', 'licenses', 'characters'].includes(entry.name) && entry.isDirectory()) continue
    if (entry.name === 'favicon.svg' && entry.isFile()) continue
    throw new Error(`Unlisted map public input: public/${entry.name}`)
  }
  const names = ['public/favicon.svg', ...await safeFileNames(root, 'public/data', () => false), ...await safeFileNames(root, 'public/licenses', () => false)]
  for (const name of names) if (!MAP_PUBLIC_SOURCES.includes(name)) throw new Error(`Unlisted map public input: ${name}`)
  for (const name of MAP_PUBLIC_SOURCES) if (!names.includes(name)) throw new Error(`Missing map public input: ${name}`)
  // Also validates every parent directory and the fixed favicon against links.
  for (const name of names) await readSafeFile(root, name)
  return names.sort()
}
