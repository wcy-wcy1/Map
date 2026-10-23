// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, copyFile, readFile, rm, lstat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error The standalone release tool has no declaration file.
import { CATALOGUE_REFERENCE_FILES } from '../scripts/release-utils.mjs'

describe('offline catalogue reproducibility', () => {
  it('rebuilds every generated file from versioned inputs without the ignored QA archive', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'shanhai-catalogue-rebuild-'))
    const app = path.join(fixture, 'shanhai-app')
    try {
      const files = [
        ...CATALOGUE_REFERENCE_FILES,
        ...['build-national-catalogue.mjs', 'build-other-catalogue-a.mjs', 'build-other-catalogue-b.mjs', 'build-catalogue-manifest.mjs'].map(name => 'scripts/' + name),
        ...['province-boundaries.json', 'yunnan-boundary.json', 'places.json', 'catalogue-releases.json'].map(name => 'src/data/' + name),
      ]
      for (const name of files) {
        await mkdir(path.dirname(path.join(app, name)), { recursive: true })
        await copyFile(fileURLToPath(new URL('../' + name, import.meta.url)), path.join(app, name))
      }
      await mkdir(path.join(app, 'public/data'), { recursive: true })
      await mkdir(path.join(fixture, 'shanhai-api/src'), { recursive: true })
      for (const script of ['build-national-catalogue.mjs', 'build-catalogue-manifest.mjs']) {
        for (const args of [[], ['--check']]) {
          const result = spawnSync(process.execPath, ['scripts/' + script, ...args], { cwd: app, encoding: 'utf8' })
          expect(result.stderr).toBe('')
          expect(result.status).toBe(0)
        }
      }
      for (const name of ['src/data/other-province-places-a.json', 'src/data/other-province-places-b.json', 'src/data/national-places.json', 'public/data/national-places.json', 'src/data/catalogue-manifest.json', '../shanhai-api/src/catalogue-manifest.ts']) {
        expect(await readFile(path.join(app, name), 'utf8')).toBe(await readFile(new URL('../' + name, import.meta.url), 'utf8'))
      }
      await expect(lstat(path.join(app, 'qa'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      const relative = path.relative(path.resolve(tmpdir()), fixture)
      if (relative.includes(path.sep) || !relative.startsWith('shanhai-catalogue-rebuild-') || (await lstat(fixture)).isSymbolicLink()) throw new Error('Unsafe test cleanup')
      await rm(fixture, { recursive: true })
    }
  })
})
