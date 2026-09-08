import { createApp } from 'vue'
import 'leaflet/dist/leaflet.css'
import './styles/journal.css'
import './styles/migration.css'
import App from './App.vue'

// Account integration is an explicit, same-origin loopback entry. Opening the
// ordinary local trial never probes an API or uploads the anonymous library.
if (location.hostname === '127.0.0.1' && location.pathname === '/connected') {
  void import('./RemoteApp.vue').then(module => createApp(module.default).mount('#app')).catch(() => {
    const host = document.getElementById('app')
    if (host) host.textContent = '账号页面暂时无法加载。请刷新重试，或打开 /app 使用本机模式。原有记录没有更改。'
  })
} else createApp(App).mount('#app')
