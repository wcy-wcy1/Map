import type { Component } from 'vue'

// Optional local development module; a clean map checkout does not require it.
// The verified map build explicitly uses main.ts.
const meeting = import.meta.glob<{ default: Component }>('./MeetingApp.vue')['./MeetingApp.vue']
if (location.pathname === '/meeting' && meeting) {
  void Promise.all([import('vue'), meeting()]).then(([{ createApp }, module]) => createApp(module.default).mount('#app'))
} else void import('./main')
