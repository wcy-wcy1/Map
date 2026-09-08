<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import App from './App.vue'
import { createRemoteServices, getSession, logout, testLogin } from './remote'
import './styles/account.css'

type Bundle = Awaited<ReturnType<typeof createRemoteServices>>
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>
const bundle = shallowRef<Bundle | null>(null), session = shallowRef<Session | null>(null)
const state = shallowRef<Bundle['state'] | null>(null), mapApp = ref<InstanceType<typeof App> | null>(null)
const subject = ref<'alice' | 'bob'>('alice'), secret = ref(''), message = ref('正在检查本机账号服务…')
const working = ref(false), checking = ref(true), supported = ref(false), error = ref(false), interacting = ref(false)
const accountDetails = ref(false), generation = ref(0)
const locked = computed(() => working.value || interacting.value || state.value?.status === 'syncing')
const statusText = computed(() => state.value?.message || '账号资料已读取。')
let disposed = false, unsubscribe: (() => void) | undefined, channel: BroadcastChannel | undefined
let identityCheck: Promise<void> | null = null
const friendly = (cause: unknown, fallback: string) => (cause as { friendlyMessage?: string })?.friendlyMessage || fallback

function clearIdentity(reason: string) {
  generation.value++
  const previous = bundle.value
  unsubscribe?.(); unsubscribe = undefined
  bundle.value = null; state.value = null; session.value = null; secret.value = ''; interacting.value = false
  message.value = reason; error.value = true; accountDetails.value = false
  if (previous) void previous.dispose()
}
async function attach(next: Session) {
  const epoch = ++generation.value
  const previous = bundle.value
  unsubscribe?.(); unsubscribe = undefined; bundle.value = null; state.value = null
  if (previous) await previous.dispose()
  session.value = next
  const connected = await createRemoteServices(next)
  if (disposed || epoch !== generation.value) { await connected.dispose(); return }
  bundle.value = connected; interacting.value = false
  unsubscribe = connected.subscribe(value => {
    if (disposed || epoch !== generation.value) return
    state.value = { ...value }
    if (value.status === 'unauthorized') clearIdentity('登录已失效或账号已改变，已隐藏旧账号资料。重新登录后可继续已存草稿和待处理记录。')
  })
  if (disposed || epoch !== generation.value || bundle.value !== connected) return
  message.value = ''; error.value = false
}
async function start() {
  if (working.value || disposed) return
  const epoch = ++generation.value
  working.value = true; checking.value = true; error.value = false
  try {
    if (location.hostname !== '127.0.0.1' || location.pathname !== '/connected') throw new Error('Unsupported entry')
    const response = await fetch('/api/v1/capabilities', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
    const capability = await response.json()
    if (disposed || epoch !== generation.value) return
    if (!response.ok || capability?.apiVersion !== '1' || capability?.testIdentityOnly !== true) throw new Error('Unsupported capabilities')
    supported.value = true
    const current = await getSession()
    if (disposed || epoch !== generation.value) return
    if (current) await attach(current)
    else message.value = '仅用于这台电脑的联调。请选择测试账号，输入本机测试密钥。'
  } catch (cause) {
    if (!disposed) { message.value = friendly(cause, '账号服务暂时无法连接。请确认本机服务已启动，再重新连接；本机模式仍可使用。'); error.value = true }
  } finally { working.value = false; checking.value = false }
}
async function signIn() {
  if (!supported.value || working.value || disposed) return
  const epoch = ++generation.value
  working.value = true; error.value = false; message.value = '正在连接账号资料…'
  const input = secret.value; secret.value = ''
  try {
    const current = await testLogin(subject.value, input)
    if (disposed || epoch !== generation.value) return
    channel?.postMessage({ type: 'identity-changed' })
    if (!disposed) await attach(current)
  } catch (cause) { if (!disposed) { message.value = friendly(cause, '登录未完成，请检查本机测试密钥后重试。'); error.value = true } }
  finally { working.value = false }
}
async function signOut() {
  if (locked.value || !session.value) return
  working.value = true
  try {
    await logout(session.value)
    clearIdentity('已退出。已保存的账号回忆未删除，本浏览器中的草稿和待处理记录仍按账号保留。')
    error.value = false
    channel?.postMessage({ type: 'identity-changed' })
  } catch (cause) {
    // A failed revocation is not a successful logout. Still hide the old
    // identity so no stale private view survives a switched browser cookie.
    clearIdentity(friendly(cause, '退出尚未得到服务端确认，已隐藏本页资料。请重新连接后核对会话。'))
  } finally { working.value = false }
}
async function synchronize(retry = false) {
  const current = bundle.value, epoch = generation.value
  if (!current || locked.value) return
  working.value = true; message.value = ''; error.value = false
  try {
    if (retry) await current.retryPending()
    else await current.refresh()
    if (!disposed && epoch === generation.value) await mapApp.value?.refresh()
  } catch (cause) {
    if (!disposed && epoch === generation.value) { message.value = friendly(cause, '这次同步没有完成，已存草稿和待处理记录仍保留。'); error.value = true }
  } finally { working.value = false }
}
function checkIdentity(): Promise<void> {
  if (identityCheck) return identityCheck
  const current = session.value, epoch = generation.value
  if (disposed || !current || working.value || document.hidden) return Promise.resolve()
  identityCheck = (async () => {
    try {
      const actual = await getSession()
      if (disposed || epoch !== generation.value) return
      if (!actual || actual.account.id !== current.account.id || actual.csrfToken !== current.csrfToken) {
        clearIdentity('其他页面已退出或切换登录，已隐藏旧账号资料。请重新连接；已存草稿仍按账号保留。')
      }
    } catch (cause) {
      // An offline connection is not proof of revocation, but a malformed or
      // mismatched private identity response must not leave the old tree alive.
      if (!disposed && epoch === generation.value && (cause as { code?: string })?.code === 'unauthorized') clearIdentity('账号响应无法核对，已隐藏旧账号资料。请重新连接后继续。')
    }
    finally { identityCheck = null }
  })()
  return identityCheck
}
const visible = () => { if (!document.hidden) void checkIdentity() }
onMounted(() => {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('shanhai-session-change-v1')
    channel.onmessage = event => {
      if (event.data?.type !== 'identity-changed' || disposed) return
      // Invalidate even during attach/write: deferring this behind `working`
      // could mount an old account after the shared browser cookie changed.
      clearIdentity('其他页面已改变登录，已隐藏旧账号资料。请重新连接后继续已存草稿。')
    }
  }
  window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
  void start()
})
onBeforeUnmount(() => {
  disposed = true; generation.value++; unsubscribe?.(); channel?.close()
  window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible)
  if (bundle.value) void bundle.value.dispose()
})
</script>

<template>
  <App v-if="bundle" ref="mapApp" :key="generation" :services="bundle.services" mode="account" @interaction="interacting = $event">
    <template #account>
      <section class="yn-account-bar" aria-label="账号与同步">
        <div class="yn-account-summary"><strong>账号回忆 <small>本机联调</small></strong><span role="status">{{ statusText }}<template v-if="state?.pending"> 待处理 {{ state.pending }} 条。</template></span></div>
        <div class="yn-account-actions">
          <button v-if="state?.pending" type="button" :disabled="locked" @click="synchronize(true)">重试待保存</button>
          <button type="button" :disabled="locked" @click="synchronize()">重新同步</button>
          <button type="button" :aria-expanded="accountDetails" aria-controls="yn-account-details" @click="accountDetails = !accountDetails">账号</button>
        </div>
        <p v-if="message && error" class="yn-account-error" role="alert">{{ message }}</p>
        <div v-if="accountDetails" id="yn-account-details" class="yn-account-details">
          <p>当前账号标识：{{ session?.account.id.slice(0, 8) }}。这是本机测试身份，尚未接入正式登录或云存储。只有你点击保存的内容会传到本机服务，旧记录不会自动上传。</p>
          <p v-if="interacting">请先保存或关闭当前编辑、照片或对话框，再同步或退出账号。</p>
          <p v-if="state?.pending">还有待处理操作。退出会保留这些操作，只有重新登录此账号后才能继续；不能视为全部保存成功。</p>
          <button type="button" :disabled="locked" @click="signOut">退出账号</button>
          <a v-if="!locked" href="/app">打开本机模式</a>
        </div>
      </section>
    </template>
  </App>
  <main v-else id="shanhai-lijiang" class="yn-account-entry" aria-label="山海集账号连接">
    <header class="yn-header"><a class="yn-brand" href="/app"><span>山海集</span><small>把走过的地方，留在地图上。</small></a><a href="/app">使用本机模式</a></header>
    <section class="yn-account-login" aria-labelledby="yn-account-title">
      <h1 id="yn-account-title">连接你的回忆</h1>
      <p>在同一个账号里保存、找回旅行照片和手记。</p>
      <p class="yn-account-disclosure">目前仅连接这台电脑的测试服务，不是云服务。旧本机记录不会自动导入，请使用测试素材。</p>
      <p role="status" :class="{ 'yn-account-error': error }">{{ message }}</p>
      <form v-if="supported && !checking" class="yn-account-form" @submit.prevent="signIn">
        <label for="yn-test-account">测试账号</label>
        <select id="yn-test-account" v-model="subject" :disabled="working"><option value="alice">账号 A</option><option value="bob">账号 B</option></select>
        <label for="yn-test-secret">本机测试密钥</label>
        <input id="yn-test-secret" v-model="secret" type="password" autocomplete="off" required minlength="32" :disabled="working" aria-describedby="yn-secret-help" />
        <small id="yn-secret-help">由本机开发环境提供。不要输入你在其他网站使用的密码。</small>
        <button type="submit" :disabled="working || secret.length < 32">{{ working ? '正在连接…' : '连接账号回忆' }}</button>
      </form>
      <button v-if="!checking" type="button" :disabled="working" @click="start">重新连接当前会话</button>
      <p class="yn-account-local-note">只想在当前浏览器记录？<a href="/app">打开本机地图</a>，不需要登录。</p>
    </section>
  </main>
</template>
