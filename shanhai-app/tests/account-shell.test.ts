import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { toRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteBundle, RemoteSession, RemoteState } from '../src/remote'
import type { TravelServices } from '../src/services/travel-services'

const remote = vi.hoisted(() => ({ createRemoteServices: vi.fn(), getSession: vi.fn(), logout: vi.fn(), testLogin: vi.fn(), appMounted: vi.fn(), appRefresh: vi.fn() }))
vi.mock('../src/remote', () => remote)
vi.mock('../src/App.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'App', props: ['services', 'mode'], emits: ['interaction'], setup(props, { expose, slots }) {
    remote.appMounted(props.mode, props.services)
    expose({ refresh: remote.appRefresh })
    return () => h('div', { class: 'test-account-map' }, slots.account?.())
  } }) }
})
import RemoteApp from '../src/RemoteApp.vue'

const sessionA: RemoteSession = { account: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'active' }, csrfToken: 'a'.repeat(40), expiresAt: '2026-09-08T00:00:00Z' }
const sessionB: RemoteSession = { ...sessionA, account: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active' }, csrfToken: 'b'.repeat(40) }
const simulatedSecret = 'synthetic-local-secret-'.repeat(2)
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
function bundle(session = sessionA) {
  let state: RemoteState = { accountId: session.account.id, status: 'ready', pending: 0, message: '合成账号状态' }
  const listeners = new Set<(state: RemoteState) => void>()
  const value: RemoteBundle = {
    services: { syntheticOwner: session.account.id } as unknown as TravelServices,
    get state() { return state }, capabilities: { backup: false, restore: false, undo: false },
    refresh: vi.fn().mockResolvedValue(undefined), retryPending: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(listener => { listeners.add(listener); listener(state); return () => { listeners.delete(listener) } }),
  }
  return { value, publish(patch: Partial<RemoteState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(state) } }
}
const channels: SimulatedChannel[] = []
class SimulatedChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
  constructor(readonly name: string) { channels.push(this) }
  receive() { this.onmessage?.({ data: { type: 'identity-changed' } }) }
}
const capabilityFetch = vi.fn(), wrappers: VueWrapper[] = []
async function start() { const wrapper = mount(RemoteApp, { attachTo: document.body }); wrappers.push(wrapper); await flushPromises(); return wrapper }
function button(wrapper: VueWrapper, text: string) { const found = wrapper.findAll('button').find(node => node.text() === text); expect(found, `button ${text}`).toBeDefined(); return found! }
async function signIn(wrapper: VueWrapper) { await wrapper.get('#yn-test-secret').setValue(simulatedSecret); await wrapper.get('form').trigger('submit'); await flushPromises() }
beforeEach(() => {
  Object.values(remote).forEach(mock => mock.mockReset())
  remote.getSession.mockResolvedValue(null); remote.logout.mockResolvedValue(undefined); remote.appRefresh.mockResolvedValue(true)
  remote.testLogin.mockResolvedValue(sessionA); remote.createRemoteServices.mockResolvedValue(bundle().value)
  capabilityFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ apiVersion: '1', testIdentityOnly: true }) })
  vi.stubGlobal('fetch', capabilityFetch)
  vi.stubGlobal('location', { hostname: '127.0.0.1', pathname: '/connected' })
  vi.stubGlobal('BroadcastChannel', SimulatedChannel)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount()); channels.length = 0
  document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('account shell with simulated auth, bundle and map boundaries (not browser/HTTP)', () => {
  it('does not mount any anonymous map before a supported session is available', async () => {
    const wrapper = await start()
    expect(capabilityFetch).toHaveBeenCalledWith('/api/v1/capabilities', expect.objectContaining({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' }))
    expect(remote.getSession).toHaveBeenCalledOnce()
    expect(remote.appMounted).not.toHaveBeenCalled(); expect(remote.createRemoteServices).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('旧本机记录不会自动导入')
    expect(wrapper.get('input[type="password"]').element).toBeDefined()
  })
  it('refuses a capability response that does not explicitly enable local test identities', async () => {
    capabilityFetch.mockResolvedValue({ ok: true, json: async () => ({ apiVersion: '1', testIdentityOnly: false }) })
    const wrapper = await start()
    expect(remote.getSession).not.toHaveBeenCalled(); expect(remote.appMounted).not.toHaveBeenCalled()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('账号服务暂时无法连接')
  })
  it('clears the entered secret immediately and mounts only the confirmed account services', async () => {
    const auth = deferred<RemoteSession>(), h = bundle()
    remote.testLogin.mockReturnValue(auth.promise); remote.createRemoteServices.mockResolvedValue(h.value)
    const wrapper = await start(); await signIn(wrapper)
    expect(remote.testLogin).toHaveBeenCalledExactlyOnceWith('alice', simulatedSecret)
    expect(wrapper.get<HTMLInputElement>('#yn-test-secret').element.value).toBe('')
    expect(remote.appMounted).not.toHaveBeenCalled()
    auth.resolve(sessionA); await flushPromises()
    expect(remote.createRemoteServices).toHaveBeenCalledExactlyOnceWith(sessionA)
    const map = wrapper.findComponent({ name: 'App' })
    expect(map.props('mode')).toBe('account'); expect(toRaw(map.props('services'))).toBe(h.value.services)
    expect(remote.appMounted).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain(simulatedSecret)
  })
  it('hides unauthorized account content, disposes the bundle and clears credentials', async () => {
    const h = bundle(); remote.getSession.mockResolvedValue(sessionA); remote.createRemoteServices.mockResolvedValue(h.value)
    const wrapper = await start()
    expect(wrapper.find('.test-account-map').exists()).toBe(true)
    h.publish({ status: 'unauthorized' }); await flushPromises()
    expect(wrapper.find('.test-account-map').exists()).toBe(false)
    expect(h.value.dispose).toHaveBeenCalledOnce()
    expect(wrapper.get<HTMLInputElement>('#yn-test-secret').element.value).toBe('')
    expect(wrapper.text()).toContain('已隐藏旧账号资料')
  })
  it('disables sync and logout during map interaction, then runs explicit sync afterward', async () => {
    const h = bundle(); remote.getSession.mockResolvedValue(sessionA); remote.createRemoteServices.mockResolvedValue(h.value)
    const wrapper = await start(); await button(wrapper, '账号').trigger('click')
    wrapper.findComponent({ name: 'App' }).vm.$emit('interaction', true); await flushPromises()
    expect(button(wrapper, '重新同步').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '退出账号').attributes('disabled')).toBeDefined()
    await button(wrapper, '退出账号').trigger('click'); await button(wrapper, '重新同步').trigger('click')
    expect(remote.logout).not.toHaveBeenCalled(); expect(h.value.refresh).not.toHaveBeenCalled()
    wrapper.findComponent({ name: 'App' }).vm.$emit('interaction', false); await flushPromises()
    await button(wrapper, '重新同步').trigger('click'); await flushPromises()
    expect(h.value.refresh).toHaveBeenCalledOnce(); expect(remote.appRefresh).toHaveBeenCalledOnce()
  })
  it('does not mount a delayed old bundle after an identity-change broadcast', async () => {
    const pending = deferred<RemoteBundle>(), old = bundle()
    remote.getSession.mockResolvedValue(sessionA); remote.createRemoteServices.mockReturnValue(pending.promise)
    const wrapper = await start(); expect(remote.createRemoteServices).toHaveBeenCalledOnce()
    channels[0]!.receive(); await flushPromises()
    pending.resolve(old.value); await flushPromises()
    expect(remote.appMounted).not.toHaveBeenCalled(); expect(old.value.dispose).toHaveBeenCalledOnce()
    expect(wrapper.find('.test-account-map').exists()).toBe(false)
  })
  it.each(['startup', 'login'])('discards a delayed %s auth response after an identity-change broadcast', async stage => {
    const pending = deferred<RemoteSession>()
    if (stage === 'startup') remote.getSession.mockReturnValue(pending.promise)
    else remote.testLogin.mockReturnValue(pending.promise)
    const wrapper = await start()
    if (stage === 'login') await signIn(wrapper)
    channels[0]!.receive(); await flushPromises()
    pending.resolve(sessionA); await flushPromises()
    expect(remote.createRemoteServices).not.toHaveBeenCalled(); expect(remote.appMounted).not.toHaveBeenCalled()
    expect(wrapper.find('.test-account-map').exists()).toBe(false)
  })
  it('rechecks a focused page and hides an account when the cookie session changes', async () => {
    const h = bundle(); remote.getSession.mockResolvedValueOnce(sessionA).mockResolvedValue(sessionB); remote.createRemoteServices.mockResolvedValue(h.value)
    const wrapper = await start()
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(remote.getSession).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.test-account-map').exists()).toBe(false)
    expect(h.value.dispose).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('其他页面已退出或切换登录')
  })
  it('handles startup failure with local-mode navigation and does not expose the raw error', async () => {
    capabilityFetch.mockRejectedValue(new Error('sensitive internal failure detail'))
    const wrapper = await start()
    expect(wrapper.text()).toContain('账号服务暂时无法连接')
    expect(wrapper.text()).not.toContain('sensitive internal failure detail')
    expect(wrapper.find('a[href="/app"]').exists()).toBe(true)
    expect(button(wrapper, '重新连接当前会话').attributes('disabled')).toBeUndefined()
    expect(remote.appMounted).not.toHaveBeenCalled()
  })
  it('disposes a late-created bundle after the shell is unmounted', async () => {
    const pending = deferred<RemoteBundle>(), old = bundle()
    remote.getSession.mockResolvedValue(sessionA); remote.createRemoteServices.mockReturnValue(pending.promise)
    const wrapper = await start()
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    pending.resolve(old.value); await flushPromises()
    expect(remote.appMounted).not.toHaveBeenCalled(); expect(old.value.dispose).toHaveBeenCalledOnce()
    expect(channels[0]!.close).toHaveBeenCalledOnce()
  })
})
