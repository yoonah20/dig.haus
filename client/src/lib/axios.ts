import axios from 'axios'
import { bumpEdgeGen, edgeGen } from './edgeGen'

axios.defaults.baseURL = import.meta.env.VITE_API_URL || ''

// Edge-cache freshness (see lib/edgeGen.ts): API GETs carry a `v=<gen>`
// param so Cloudflare's cache key changes after a mutation, and every
// successful non-GET bumps the generation. Skipped while gen is 0 so a
// session that never mutates keeps the pristine, shared anon cache keys.
// Cover images don't pass through axios (plain <img> tags), so their
// long-lived immutable cache entries are unaffected by bumps.
axios.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase()
  if (method === 'get' && edgeGen() > 0 && config.url?.startsWith('/api/')) {
    config.params = { ...(config.params || {}), v: edgeGen() }
  }
  return config
})

axios.interceptors.response.use((res) => {
  const method = (res.config.method || 'get').toLowerCase()
  if (method !== 'get') bumpEdgeGen()
  return res
})

export default axios
