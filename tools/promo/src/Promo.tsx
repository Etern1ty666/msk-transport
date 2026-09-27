import { loadFont } from '@remotion/google-fonts/Geist'
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AbsoluteFill, Audio, continueRender, delayRender, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Engine, type Snapshot } from './engine'
import { actions, APP_H, APP_W, BEATS, captions, cursorVisible, morph } from './script'
import { clamp, lerp, step, track } from './spring'

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '600'], subsets: ['latin', 'cyrillic'] })

const T = {
  canvas: '#ECE9E4',
  ink: '#111110',
  paper: '#FFFFFF',
  accent: '#22D3EE',
  shade: 'rgba(28, 24, 18, 0.16)',
}

const W = 1920, H = 1080
const FX = W / 2, FY = 516 // центр кадра для камеры (снизу место под подпись)
const sec = (b: number) => b * 0.5

const engine = new Engine()
const APP_SRC = staticFile('app/index.html') + '?t0=' + encodeURIComponent('2026-09-29T06:00:00+03:00')

/** Нажатие курсора: палец идёт вниз за 60 мс до доли, отпускание — пружиной; на драге удерживается. */
function pressAt(t: number) {
  const bump = (ta: number) => (t < ta - 0.06 || t > ta + 0.4 ? 0 : t < ta ? (t - ta + 0.06) / 0.06 : 1 - step(t - ta, 0.3, 1))
  let p = 0
  let downAt: number | null = null
  for (const a of actions) {
    const ta = sec(a.b)
    if (a.a === 'click') p = Math.max(p, bump(ta))
    else if (a.a === 'down' && t >= ta - 0.06) downAt = ta
    else if (a.a === 'up' && downAt != null) {
      if (t >= ta) { downAt = null; if (t < ta + 0.4) p = Math.max(p, 1 - step(t - ta, 0.3, 1)) }
    }
  }
  if (downAt != null) p = Math.max(p, clamp((t - downAt + 0.06) / 0.06))
  return p
}

function Cursor({ x, y, press, opacity }: { x: number; y: number; press: number; opacity: number }) {
  const s = 1 - 0.14 * press
  return (
    <svg width={36} height={36} viewBox="0 0 24 24" style={{ position: 'absolute', left: x - 5, top: y - 3, opacity, transform: `scale(${s})`, transformOrigin: '5px 3px' }}>
      <path d="M5 3 L5 19.2 L9.2 15.3 L11.9 21.2 L14.6 20 L12 14.2 L17.8 14.2 Z" fill={T.ink} stroke={T.paper} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}

/** Подпись: одна пилюля, края едут на разных пружинах, текст уходит и приходит со своим блюром. */
function Caption({ t }: { t: number }) {
  let cur = 0
  for (let i = 0; i < captions.length; i++) if (sec(captions[i].b) <= t) cur = i
  const c = captions[cur]
  const since = t - sec(c.b)
  const measure = (s: string | null) => (s ? s.length * 13.2 + 64 : 0)
  const widths = captions.map((k) => ({ t: sec(k.b), v: measure(k.text) }))
  const left = track(widths.map((k, i) => ({ ...k, dur: 0.5, t: k.t + (i > 0 && widths[i - 1].v > k.v ? 0.05 : 0) })), t)
  const right = track(widths.map((k, i) => ({ ...k, dur: 0.62, t: k.t + (i > 0 && widths[i - 1].v <= k.v ? 0.05 : 0) })), t)
  const w = (left + right) / 2
  const h = 50
  const vis = clamp((w - 12) / 60)
  const prev = cur > 0 ? captions[cur - 1] : null
  const exitK = clamp(since / 0.14)
  const enterK = step(since - 0.1, 0.35, 1)
  return (
    <div style={{ position: 'absolute', left: FX - Math.max(0, w) / 2, top: 1004, width: Math.max(0, w), height: h, borderRadius: h / 2, background: T.ink, opacity: vis, overflow: 'hidden' }}>
      {prev?.text && exitK < 1 && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', whiteSpace: 'nowrap', color: T.paper, fontSize: 22, fontWeight: 500, letterSpacing: -0.1, opacity: 1 - exitK, filter: `blur(${exitK * 6}px)` }}>{prev.text}</div>
      )}
      {c.text && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', whiteSpace: 'nowrap', color: T.paper, fontSize: 22, fontWeight: 500, letterSpacing: -0.1, opacity: enterK, filter: `blur(${(1 - enterK) * 6}px)`, transform: `translateY(${(1 - enterK) * 6}px)` }}>{c.text}</div>
      )}
    </div>
  )
}

export function Promo(_: { sub: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const frameOf = (b: number) => Math.round(b * 0.5 * fps)
  const ref = useRef<HTMLIFrameElement>(null)
  const [snap, setSnap] = useState<Snapshot>({ cx: APP_W / 2, cy: APP_H / 2, zoom: 1, mx: -100, my: -100, pressed: 0 })

  useLayoutEffect(() => {
    const h = delayRender(`кадр ${frame}`, { timeoutInMilliseconds: 600000 })
    engine.iframe = ref.current
    engine.fps = fps
    engine.base = APP_SRC
    engine.goto(frame).then((s) => { flushSync(() => setSnap(s)); continueRender(h) }).catch((e) => { console.error(e); continueRender(h) })
  }, [frame, fps])

  // окно: пилюля TramFlow ↔ окно приложения
  const m = track(morph.map((k) => ({ t: sec(k.b), v: k.v, dur: sec(k.dur), zeta: k.zeta ?? 0.9 })), t)
  const S = snap.zoom
  const winX = FX - snap.cx * S, winY = FY - snap.cy * S
  const pill = { x: FX - 230, y: 540 - 52, w: 460, h: 104, r: 52 }
  const box = {
    x: lerp(pill.x, winX, m), y: lerp(pill.y, winY, m),
    w: lerp(pill.w, APP_W * S, m), h: lerp(pill.h, APP_H * S, m),
    r: lerp(pill.r, 18 * S, clamp(m * 1.15)),
  }
  const appIn = step(t - 0.62, 0.45, 1) * (1 - step(t - sec(69.95), 0.22, 1))
  const labelIn = 1 - step(t - 0.45, 0.2, 1) + step(t - sec(70.15), 0.35, 1)
  const cv = track(cursorVisible.map((k) => ({ t: sec(k.b), v: k.v, dur: 0.35 })), t)

  const clicks = actions.flatMap((a) => a.a === 'click' ? [{ f: frameOf(a.b), s: a.sound ?? 'click' }] : a.a === 'down' ? [{ f: frameOf(a.b), s: 'click' }] : a.a === 'type' ? [...a.text].map((_, i) => ({ f: frameOf(a.b + i * a.per), s: 'key' })) : [])
  const peak: Record<string, number> = { click: 0.002, tick: 0.102, key: 0.109, pop: 0.07 }

  return (
    <AbsoluteFill style={{ background: T.canvas, fontFamily }}>
      <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: box.r, overflow: 'hidden', background: T.ink, boxShadow: `0 ${24 * m + 8}px ${70 * m + 24}px ${T.shade}` }}>
        <iframe ref={ref} title="TramFlow" style={{ position: 'absolute', left: winX - box.x, top: winY - box.y, width: APP_W, height: APP_H, border: 0, transform: `scale(${S})`, transformOrigin: '0 0', opacity: appIn, filter: appIn < 1 ? `blur(${(1 - appIn) * 10}px)` : undefined }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, color: T.paper, opacity: clamp(labelIn), filter: `blur(${(1 - clamp(labelIn)) * 8}px)` }}>
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="4" width="14" height="13" rx="3" /><path d="M5 11h14M9 20l-1.5 1.5M15 20l1.5 1.5M8 17v3M16 17v3M10 2h4M12 2v2" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: -0.6 }}>TramFlow</span>
            <span style={{ fontSize: 17, fontWeight: 400, opacity: 0.62 }}>прогноз загрузки трамваев Москвы</span>
          </div>
        </div>
      </div>

      <Caption t={t} />
      <Cursor x={winX + snap.mx * S} y={winY + snap.my * S} press={pressAt(t)} opacity={cv} />

      <Audio src={staticFile('music.m4a')} />
      {clicks.map((c, i) => (
        <Sequence key={i} from={Math.max(0, c.f - Math.round(peak[c.s] * fps))} durationInFrames={Math.round(0.7 * fps)}>
          <Audio src={staticFile(`sfx/${c.s}.wav`)} volume={c.s === 'key' ? 0.35 : 0.5} />
        </Sequence>
      ))}
      {[51, 58].map((b) => (
        <Sequence key={'p' + b} from={frameOf(b) + Math.round(0.1 * fps) - Math.round(peak.pop * fps)} durationInFrames={fps}>
          <Audio src={staticFile('sfx/pop.wav')} volume={0.4} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

export const DURATION = BEATS * 30 // кадров при 60 fps
