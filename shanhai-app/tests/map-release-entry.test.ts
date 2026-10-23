// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error The build plugin is standalone JavaScript.
import { mapReleasePlugin, prepareMapOutput } from '../scripts/map-release-plugin.mjs'

describe('explicit map release entry', () => {
  it('keeps the meeting route in development and replaces only the HTML entry for production', () => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const plugin = mapReleasePlugin()
    expect(source).toContain('src="/src/dev.ts"')
    const production = plugin.transformIndexHtml.handler(source)
    expect(production).toContain('src="/src/main.ts"')
    expect(production).not.toContain('/src/dev.ts')
    expect(production).not.toContain('data:image')
    expect(readFileSync(new URL('../src/dev.ts', import.meta.url), 'utf8')).toContain("location.pathname === '/meeting'")
    expect(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')).not.toContain('MeetingApp')
    expect(() => plugin.transformIndexHtml.handler(source + source)).toThrow(/exactly one/)
  })
  it('refuses meeting modules that accidentally become reachable from the map entry', async () => {
    const plugin = mapReleasePlugin()
    await expect(plugin.generateBundle({}, { leaked:{ type:'chunk', modules:{ 'D:/project/src/MeetingApp.vue':{} } } })).rejects.toThrow(/Meeting code entered/)
  })
  it('cleans only the exact generated output and rejects alternate paths and links', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shanhai-map-build-'))
    try {
      await mkdir(path.join(root, 'public/characters'), { recursive:true })
      await writeFile(path.join(root, 'public/characters/portrait.png'), 'original')
      await mkdir(path.join(root, 'dist/assets'), { recursive:true })
      await writeFile(path.join(root, 'dist/assets/old.js'), 'stale output')
      for (const target of ['.', '..', 'public', 'dist/../public', '../outside']) await expect(prepareMapOutput(root, target)).rejects.toThrow(/exactly projectRoot\/dist/)
      await prepareMapOutput(root)
      await expect(lstat(path.join(root, 'dist'))).rejects.toMatchObject({ code:'ENOENT' })
      expect(await readFile(path.join(root, 'public/characters/portrait.png'), 'utf8')).toBe('original')
      await symlink(path.join(root, 'public'), path.join(root, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(prepareMapOutput(root)).rejects.toThrow(/regular directory|link/i)
      await unlink(path.join(root, 'dist'))
      await mkdir(path.join(root, 'dist'))
      await symlink(path.join(root, 'public'), path.join(root, 'dist/linked'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(prepareMapOutput(root)).rejects.toThrow(/links are forbidden/i)
      await unlink(path.join(root, 'dist/linked'))
    } finally {
      const relative = path.relative(path.resolve(tmpdir()), root)
      if (relative.includes(path.sep) || !relative.startsWith('shanhai-map-build-') || (await lstat(root)).isSymbolicLink()) throw new Error('Unsafe fixture cleanup')
      await rm(root, { recursive:true })
    }
  })
})
