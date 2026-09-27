// Движок: ведёт настоящее приложение TramFlow в iframe кадр за кадром.
// Каждый кадр: позиция курсора → события указателя → действия сценария → виртуальное время += 1/60 с → ждём React и данные.
// Кадры идут строго по порядку (concurrency 1); при прыжке назад iframe перезагружается и сценарий проигрывается заново —
// поэтому любой кадр однозначно определяется своим номером.
import { actions, APP_H, APP_W, camera, cursor, type Action, type Target } from './script'
import { step } from './spring'

type Rect = { x: number; y: number; w: number; h: number }
export type Snapshot = { cx: number; cy: number; zoom: number; mx: number; my: number; pressed: number }

const sec = (b: number) => b * 0.5
// MessageChannel вместо setTimeout: таймеры фоновой вкладки headless Chrome троттлятся
const tick = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })

export class Engine {
  iframe: HTMLIFrameElement | null = null
  fps = 60 // 240 при рендере с подкадрами для motion blur
  private frameOf(b: number) { return Math.round(b * 0.5 * this.fps) }
  base = ''
  loads = 0
  last = -1
  private cache = new Map<string, { x: number; y: number } | Rect>()
  private down: Element | null = null
  private over: Element | null = null
  private pos = { x: -100, y: -100 }
  private lastPress = -1e9
  private scrolls: { el: Element; from: number; to: number; t0: number; dur: number }[] = []

  get win(): any { return this.iframe?.contentWindow }
  get doc(): Document { return this.win.document }

  async reload() {
    const f = this.iframe!
    this.loads++
    await new Promise<void>((res) => { f.onload = () => res(); f.src = `${this.base}&load=${this.loads}` })
    await this.win.__vtReady
    await this.doc.fonts.ready
    this.last = -1
    this.cache.clear()
    this.down = this.over = null
    this.scrolls = []
    this.lastPress = -1e9
  }

  async goto(f: number): Promise<Snapshot> {
    if (!this.win?.__vt || f < this.last || this.last < 0 && this.loads === 0) await this.reload()
    const t0 = performance.now(), n = f - this.last
    for (let g = this.last + 1; g <= f; g++) await this.step(g)
    if (n > 0 && f % 60 === 0) console.error(`[promo] кадр ${f}: ${((performance.now() - t0) / n).toFixed(1)} мс/шаг`)
    return this.snapshot(f)
  }

  // --- поиск целей ---
  private find(p: Extract<Target, { sel: string }>): Element | null {
    let root: ParentNode = this.doc
    if (p.inSel) {
      // группа по своему заголовку (первый <b>/<h2>), иначе по вхождению текста
      const boxes = [...this.doc.querySelectorAll(p.inSel)]
      const head = (e: Element) => e.querySelector('b, h2, h3')?.textContent?.trim()
      const box = boxes.find((e) => !p.inText || head(e) === p.inText) ?? boxes.find((e) => !p.inText || e.textContent?.includes(p.inText))
      if (!box) return null
      root = box
    }
    const all = [...root.querySelectorAll(p.sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (!p.text || e.textContent?.trim() === p.text || e.textContent?.includes(p.text))
    })
    const exact = p.text ? all.filter((e) => e.textContent?.trim() === p.text) : []
    const list = exact.length ? exact : all
    return list[p.nth ?? 0] ?? null
  }
  private rectOf(t: Target): Rect | null {
    if ('rect' in t) return { x: t.rect[0], y: t.rect[1], w: t.rect[2], h: t.rect[3] }
    if ('x' in t) return { x: t.x, y: t.y, w: 0, h: 0 }
    const el = this.find(t)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const pad = t.pad ?? 0
    return { x: r.x - pad, y: r.y - pad, w: r.width + pad * 2, h: r.height + pad * 2 }
  }
  /** Точка цели: пока курсор едет, следим за элементом вживую (раскладка может сдвинуться); после прибытия — замораживаем. */
  private point(key: string, t: Target, fallback: { x: number; y: number }, live: boolean) {
    if (live || !this.cache.has(key)) {
      const r = this.rectOf(t)
      if (r) {
        const p = t as { ax?: number; ay?: number; dx?: number; dy?: number }
        this.cache.set(key, { x: r.x + r.w * (p.ax ?? 0.5) + (p.dx ?? 0), y: r.y + r.h * (p.ay ?? 0.5) + (p.dy ?? 0) })
      }
    }
    return (this.cache.get(key) as { x: number; y: number } | undefined) ?? fallback
  }

  /** Курсор: сумма пружин между целями, путь чуть выгнут дугой, как у руки. */
  private cursorAt(t: number) {
    let prev = this.point('c0', cursor[0].to, { x: 1380, y: 980 }, false)
    let x = prev.x, y = prev.y
    for (let i = 1; i < cursor.length; i++) {
      const k = cursor[i]
      const lead = k.lead ?? 1
      const t0 = sec(k.b - lead)
      if (t < t0) break
      const p = this.point('c' + i, k.to, prev, t < sec(k.b + 0.5))
      const s = step(t - t0, sec(lead) * 0.7, 0.9) // успокаивается к прибытию: недолёт < 3 px даже на 1000 px пути
      const dx = p.x - prev.x, dy = p.y - prev.y
      const arc = Math.sin(Math.PI * Math.min(1, s)) * 0.08
      x += dx * s - dy * arc
      y += dy * s + dx * arc
      prev = p
    }
    return { x, y }
  }

  /** Камера: центр и масштаб — суммы пружин; «full» — всё окно. */
  private cameraAt(t: number) {
    // «full» и прямоугольники — постоянные; цели-селекторы отслеживаются, пока камера к ним едет
    const full = { cx: APP_W / 2, cy: APP_H / 2, zoom: 1 }
    const val = (i: number) => {
      const k = camera[i]
      if (k.to === 'full') return full
      if (!this.cache.has('k' + i) || t < sec(k.b + (k.dur ?? 2))) {
        const r = this.rectOf(k.to)
        if (r) this.cache.set('k' + i, r)
      }
      const r = this.cache.get('k' + i) as Rect | undefined
      if (!r) return null
      const zoom = Math.max(1, Math.min(2.2, APP_W / r.w, APP_H / r.h))
      // не показываем край окна при наезде: центр не ближе половины кадра к границе
      const hw = APP_W / 2 / zoom, hh = APP_H / 2 / zoom
      const cx = Math.min(APP_W - hw, Math.max(hw, r.x + r.w / 2))
      const cy = Math.min(APP_H - hh, Math.max(hh, r.y + r.h / 2))
      return { cx, cy, zoom }
    }
    let prev = val(0) ?? full
    let { cx, cy } = prev
    let lz = Math.log(prev.zoom)
    for (let i = 1; i < camera.length; i++) {
      const k = camera[i]
      const t0 = sec(k.b)
      if (t < t0) break
      const v = val(i) ?? prev
      const s = step(t - t0, sec(k.dur ?? 2), 0.92)
      cx += (v.cx - prev.cx) * s
      cy += (v.cy - prev.cy) * s
      lz += (Math.log(v.zoom) - Math.log(prev.zoom)) * s
      prev = v
    }
    return { cx, cy, zoom: Math.exp(lz) }
  }

  // --- события указателя ---
  private fire(el: Element, type: string, p: { x: number; y: number }, buttons: number) {
    const W = this.win
    const init = { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, button: 0, buttons, view: W }
    const ev = type.startsWith('pointer')
      ? new W.PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0 })
      : new W.MouseEvent(type, init)
    el.dispatchEvent(ev)
  }
  private at(p: { x: number; y: number }) { return this.doc.elementFromPoint(p.x, p.y) ?? this.doc.body }

  private move(p: { x: number; y: number }) {
    if (Math.abs(p.x - this.pos.x) < 0.05 && Math.abs(p.y - this.pos.y) < 0.05) return
    this.pos = p
    const buttons = this.down ? 1 : 0
    const el = this.at(p)
    if (el !== this.over) {
      if (this.over) { this.fire(this.over, 'pointerout', p, buttons); this.fire(this.over, 'mouseout', p, buttons) }
      this.fire(el, 'pointerover', p, buttons); this.fire(el, 'mouseover', p, buttons)
      this.over = el
    }
    const target = this.down ?? el
    this.fire(target, 'pointermove', p, buttons)
    this.fire(target, 'mousemove', p, buttons)
  }

  private act(a: Action, g: number) {
    const p = this.pos
    const t = g / this.fps
    if (a.a === 'click' || a.a === 'down') {
      const el = this.at(p)
      this.fire(el, 'pointerdown', p, 1); this.fire(el, 'mousedown', p, 1)
      const f = (el as HTMLElement).closest?.('input,textarea,button,a,[tabindex]') as HTMLElement | null
      f?.focus?.()
      this.lastPress = t
      if (a.a === 'down') { this.down = el; return }
      this.fire(el, 'pointerup', p, 0); this.fire(el, 'mouseup', p, 0); this.fire(el, 'click', p, 0)
    } else if (a.a === 'up') {
      const el = this.down ?? this.at(p)
      this.fire(el, 'pointerup', p, 0); this.fire(el, 'mouseup', p, 0)
      this.down = null
    } else if (a.a === 'key') {
      const W = this.win
      const el = this.doc.activeElement ?? this.doc.body
      if ((el as HTMLElement).blur && el !== this.doc.body) (el as HTMLElement).blur()
      this.doc.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: a.key, bubbles: true, cancelable: true }))
      this.doc.body.dispatchEvent(new W.KeyboardEvent('keyup', { key: a.key, bubbles: true, cancelable: true }))
    } else if (a.a === 'scroll') {
      const el = this.find(a.to as Extract<Target, { sel: string }>)
      if (!el) return
      let box: Element | null = el.parentElement
      while (box && !(box.scrollHeight > box.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement
      if (!box) return
      const to = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12
      this.scrolls.push({ el: box, from: box.scrollTop, to: Math.min(to, box.scrollHeight - box.clientHeight), t0: t, dur: sec(a.dur) })
    }
  }

  private typeAt(a: Extract<Action, { a: 'type' }>, g: number) {
    for (let i = 0; i < a.text.length; i++) {
      if (this.frameOf(a.b + i * a.per) !== g) continue
      const el = this.doc.activeElement as HTMLInputElement
      if (!el || el.tagName !== 'INPUT') return
      const setter = Object.getOwnPropertyDescriptor(this.win.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, a.text.slice(0, i + 1))
      el.dispatchEvent(new this.win.Event('input', { bubbles: true }))
    }
  }

  private async step(g: number) {
    const t = g / this.fps
    this.move(this.cursorAt(t))
    for (const a of actions) {
      if (a.a === 'type') this.typeAt(a, g)
      else if (this.frameOf(a.b) === g) this.act(a, g)
    }
    for (const s of this.scrolls) if (t < s.t0 + s.dur * 2) s.el.scrollTop = s.from + (s.to - s.from) * step(t - s.t0, s.dur, 0.95)
    this.win.__vt.advance(t * 1000)
    for (let i = 0; i < 200; i++) {
      await tick()
      if (i >= 2 && this.win.__vt.pending === 0) break
    }
    this.win.__vt.settle()
    await tick()
    this.win.__vt.sync()
    this.last = g
  }

  private snapshot(f: number): Snapshot {
    const t = f / this.fps
    const cam = this.cameraAt(t)
    const c = this.cursorAt(t)
    const since = t - this.lastPress
    const pressed = since >= 0 && since < 0.5 ? Math.sin(Math.min(1, since / 0.18) * Math.PI) * (since < 0.18 ? 1 : 0) : 0
    return { ...cam, mx: c.x, my: c.y, pressed }
  }
}
