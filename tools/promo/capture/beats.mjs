// Один кадр на каждую долю (или диапазон долей) — проверка сетки, читаемости и тесноты до полного рендера.
import { bundle } from '@remotion/bundler'
import { renderFrames, selectComposition } from '@remotion/renderer'
import { fileURLToPath } from 'url'
import fs from 'fs'
const p = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const [from = 0, to = 71, nth = 30] = process.argv.slice(2).map(Number)
const out = p('../out/beats/')
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
const serveUrl = await bundle({ entryPoint: p('../src/index.ts'), publicDir: p('../public') })
const composition = await selectComposition({ serveUrl, id: 'Promo' })
const t0 = Date.now()
await renderFrames({
  serveUrl, composition, outputDir: out, imageFormat: 'jpeg', jpegQuality: 88, concurrency: 1,
  frameRange: [from * 30, Math.min(composition.durationInFrames - 1, to * 30)], everyNthFrame: nth,
  chromiumOptions: { gl: 'angle' }, timeoutInMilliseconds: 600000,
  onBrowserLog: (l) => { if (l.type === 'error') console.log('LOG', l.text.slice(0, 300)) },
  onFrameUpdate: (n) => { if (n % 8 === 0) process.stdout.write(`${n} `) },
})
console.log('\ndone in', ((Date.now() - t0) / 1000).toFixed(0), 's')
