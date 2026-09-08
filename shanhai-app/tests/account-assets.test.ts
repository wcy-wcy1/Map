// @vitest-environment node
import { describe, expect, it } from 'vitest'
// Runtime packaging module is covered as JavaScript to use the real allowlist.
// @ts-expect-error No declarations are shipped for the standalone server.
import { ASSET_PATTERN, PUBLIC_FILES, validatePublicNames } from '../scripts/serve.mjs'

describe('explicit account entry asset family', () => {
  const base = [...PUBLIC_FILES, 'assets/index-abcdefgh.js', 'assets/index-abcdefgh.css']
  it('permits only the named hashed account chunks, without broadening to arbitrary assets', () => {
    expect(validatePublicNames([...base, 'assets/RemoteApp-12345678.js', 'assets/RemoteApp-12345678.css'])).toHaveLength(base.length + 2)
    for (const name of ['assets/account-secrets-12345678.js', 'assets/RemoteApp.js', 'assets/RemoteApp-12345678.js.map', '.local/runtime.json', 'src/RemoteApp.vue']) {
      expect(ASSET_PATTERN.test(name)).toBe(false)
      expect(() => validatePublicNames([...base, name])).toThrow()
    }
  })
  it('rejects stale duplicates of the account chunk', () => {
    expect(() => validatePublicNames([...base, 'assets/RemoteApp-12345678.js', 'assets/RemoteApp-87654321.js'])).toThrow('Duplicate asset family')
  })
})
