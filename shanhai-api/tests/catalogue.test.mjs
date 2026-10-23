import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Catalogue, CATALOGUE_VERSION, verifyCatalogueAsset } from '../dist/catalogue.js'
import { catalogueManifest } from '../dist/catalogue-manifest.js'
import { hash } from '../dist/crypto.js'
test('controlled catalogue owns nationwide identities and bounds legacy references', async () => {
  const catalogue = new Catalogue(); await catalogue.load()
  assert.equal(catalogue.places.size, catalogueManifest.counts.publicPlaces)
  assert.equal(catalogue.regions.size, 49)
  assert.equal(catalogue.regions.get('cn-11'), 'cn-11')
  assert.equal(catalogue.places.get('beijing-forbidden-city').mapId, 'cn-11')
  assert.equal(catalogue.places.get('yulong').mapId, 'yunnan')
  assert.ok(catalogue.supportsReference('beijing-forbidden-city', CATALOGUE_VERSION))
  assert.ok(catalogue.supportsReference('yulong', 'yunnan43-3ecd736f'))
  assert.ok(catalogue.supportsReference('beijing-forbidden-city', 'national75-ea98de83'))
  assert.ok(catalogue.supportsReference('taiwan-taipei-101', 'national175-64c75248'))
  assert.equal(catalogue.supportsReference('unknown', 'national175-64c75248'), false)
  assert.equal(catalogue.supportsReference('taiwan-taipei-101', 'national75-ea98de83'), false)
  assert.equal(catalogue.supportsReference('beijing-forbidden-city', 'yunnan43-3ecd736f'), false)
  assert.equal(catalogue.supportsReference('yulong', 'unknown'), false)
  assert.equal(catalogue.supportsReference('unknown', CATALOGUE_VERSION), false)
  assert.equal(catalogue.supportsReference('yulong', '__proto__'), false)
})
test('hash validation tolerates checkout line endings but rejects content tampering', () => {
  const value = { id: 'controlled', coordinates: [116.4, 39.9] }, pin = hash(JSON.stringify(value))
  assert.deepEqual(verifyCatalogueAsset('fixture', Buffer.from(JSON.stringify(value, null, 2).replaceAll('\n', '\r\n')), pin), value)
  assert.throws(() => verifyCatalogueAsset('fixture', Buffer.from(JSON.stringify({ ...value, id: 'tampered' })), pin), /Controlled catalogue data changed/)
})
