import { useEffect, useRef } from 'react'

export type Precip = { kind: 'rain' | 'snow'; k: number } | null // k — сила 0…1

/** Косметика: дождь или снег поверх схемы по погоде выбранного часа. Холст не ловит мышь; на скрытой вкладке
 *  и при «уменьшить движение» в системе не анимируется. */
export default function WeatherFx({ fx }: { fx: Precip }) {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = cv.current
    if (!c || !fx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = c.getContext('2d')!
    let W = 0, H = 0, raf = 0, last = performance.now()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => { W = c.clientWidth; H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
    resize()
    const snow = fx.kind === 'snow'
    const n = Math.round((snow ? 120 : 140) + (snow ? 200 : 260) * fx.k)
    const P = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      z: 0.4 + Math.random() * 0.6, // «глубина»: ближние крупнее и быстрее
      ph: Math.random() * Math.PI * 2,
    }))
    const wind = snow ? 18 : 90 // px/с вбок
    const draw = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      ctx.clearRect(0, 0, W, H)
      if (snow) {
        for (const p of P) {
          p.y += (22 + 38 * p.z) * dt
          p.x += (wind * p.z + Math.sin(t / 900 + p.ph) * 14) * dt
          if (p.y > H + 6) { p.y = -6; p.x = Math.random() * W }
          if (p.x > W + 6) p.x = -6
          const r = 1.8 + 2.8 * p.z
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${0.8 + 0.2 * p.z})`; ctx.fill()
          ctx.lineWidth = 0.9; ctx.strokeStyle = `rgba(90,112,145,${0.4 + 0.25 * p.z})`; ctx.stroke()
        }
      } else {
        ctx.lineCap = 'round'
        for (const p of P) {
          const v = 520 + 480 * p.z
          p.y += v * dt; p.x += wind * dt
          if (p.y > H + 20) { p.y = -20; p.x = Math.random() * (W + 100) - 100 }
          const len = 9 + 12 * p.z
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (wind / v) * len, p.y - len)
          ctx.lineWidth = 0.8 + 0.7 * p.z; ctx.strokeStyle = `rgba(70,110,170,${0.18 + 0.22 * p.z})`; ctx.stroke()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(draw) } }
    raf = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', vis)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis); ctx.clearRect(0, 0, W, H) }
  }, [fx?.kind, fx && Math.round(fx.k * 4)]) // eslint-disable-line react-hooks/exhaustive-deps
  return fx ? <canvas ref={cv} className="wxfx" aria-hidden="true" /> : null
}
