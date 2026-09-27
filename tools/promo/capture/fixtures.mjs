// Снимок ответов API прода для детерминированного рендера: всё, что приложение запрашивает по сценарию ролика.
import { chromium } from 'playwright'
import fs from 'fs'
import crypto from 'crypto'
const OUT = 'public/fixtures'
fs.mkdirSync(OUT, { recursive: true })
const index = {}
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } })
const page = await ctx.newPage()
page.on('response', async (res) => {
  const u = new URL(res.url())
  if (!u.pathname.startsWith('/api/') || res.request().method() !== 'GET') return
  try {
    const body = await res.body()
    const key = u.pathname + u.search
    const f = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json'
    fs.writeFileSync(`${OUT}/${f}`, body); index[key] = f
  } catch {}
})
await page.clock.install({ time: new Date('2026-09-29T06:00:00+03:00') })
await page.goto('https://mos-trans.legacy-team.tech/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Открыть карту' }).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: '17', exact: true }).click()
await page.waitForTimeout(2000)
for (const hash of ['summary', 'settings', 'about']) {
  await page.evaluate((h) => { location.hash = h }, hash); await page.waitForTimeout(3000)
  await page.mouse.wheel(0, 2500); await page.waitForTimeout(1500)
}
await page.waitForLoadState('networkidle')
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1))
console.log(Object.keys(index).join('\n'))
await b.close()
