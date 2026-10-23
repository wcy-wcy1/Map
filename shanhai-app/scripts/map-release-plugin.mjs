import { mapPublicNames } from './map-public.mjs'
import { readSafeFile, safeRoot, safeFileNames } from './serve.mjs'
import { lstat, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'

export async function prepareMapOutput(projectRoot, configuredOutDir = 'dist') {
  const root = await safeRoot(projectRoot), output = resolve(root, configuredOutDir)
  if (output !== resolve(root, 'dist') || dirname(output) !== root || basename(output) !== 'dist') throw new Error('Map output must be exactly projectRoot/dist')
  try { await lstat(output) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  await safeRoot(output)
  await safeFileNames(root, 'dist') // Refuse links/junctions anywhere before recursive removal.
  await rm(output, { recursive: true })
}

export function mapReleasePlugin() {
  let root, outDir
  return {
    name: 'verified-map-release', apply: 'build',
    async configResolved(config) { root = await safeRoot(config.root); outDir = config.build.outDir },
    async buildStart() { await prepareMapOutput(root, outDir) },
    transformIndexHtml: { order: 'pre', handler(html) {
      const entry = 'src="/src/dev.ts"'
      if (html.split(entry).length !== 2) throw new Error('Expected exactly one development entry to replace with the map entry')
      return html.replace(entry, 'src="/src/main.ts"')
    } },
    async generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') {
        for (const id of Object.keys(chunk.modules)) if (/\/src\/(?:dev\.ts|MeetingApp\.vue|styles\/meeting(?:-polish)?\.css)(?:\?|$)/.test(id.replaceAll('\\', '/'))) throw new Error(`Meeting code entered the map release: ${id}`)
      }
      for (const name of await mapPublicNames(root)) this.emitFile({ type:'asset', fileName:name.slice('public/'.length), source:await readSafeFile(root, name) })
    },
  }
}
