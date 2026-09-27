// Запись настоящих сообщений WebSocket прода: метрики сервиса и снимок конвейера — ролик проигрывает их как есть.
import fs from 'fs'
const rec = (path, ms) => new Promise((res) => {
  const out = []; const t0 = Date.now()
  const ws = new WebSocket('wss://mos-trans.legacy-team.tech' + path)
  ws.onmessage = (e) => out.push({ dt: Date.now() - t0, data: e.data })
  setTimeout(() => { ws.close(); res(out) }, ms)
})
const [system, pipeline] = await Promise.all([rec('/ws/system', 40000), rec('/ws/pipeline', 5000)])
fs.writeFileSync('public/fixtures/ws.json', JSON.stringify({ '/ws/system': system, '/ws/pipeline': pipeline }))
console.log('system', system.length, 'pipeline', pipeline.length, system[0]?.data.slice(0, 160))
