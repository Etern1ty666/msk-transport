// Виртуальное время для сборки TramFlow внутри Remotion.
// Подключается раньше бандла приложения. Всё, что в приложении зависит от времени (таймеры, rAF, Date,
// performance.now, CSS-переходы), движется только когда Remotion вызывает __vt.advance(ms) — ровно на кадр.
// API отвечает из снимка прода (fixtures/), настройки живут в памяти страницы: прод не трогаем.
;(function () {
  const W = window
  const q = new URLSearchParams(location.search)
  const EPOCH = Date.parse(q.get('t0') || '2026-09-29T06:00:00+03:00')
  let vt = 0

  try { localStorage.clear() } catch { /* без хранилища */ }
  for (const kv of (q.get('ls') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); try { localStorage.setItem(k, v) } catch { /* ignore */ } }

  const RealDate = Date
  class VDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(EPOCH + vt); else super(...a) }
    static now() { return EPOCH + vt }
  }
  W.Date = VDate
  performance.now = () => vt

  let seq = 1
  const timers = new Map()
  const rafs = new Map()
  W.setTimeout = (fn, ms = 0, ...args) => { const id = seq++; timers.set(id, { at: vt + Math.max(0, +ms || 0), fn, args, every: 0 }); return id }
  W.setInterval = (fn, ms = 0, ...args) => { const id = seq++; const e = Math.max(1, +ms || 0); timers.set(id, { at: vt + e, fn, args, every: e }); return id }
  W.clearTimeout = W.clearInterval = (id) => { timers.delete(id) }
  W.requestAnimationFrame = (fn) => { const id = seq++; rafs.set(id, fn); return id }
  W.cancelAnimationFrame = (id) => { rafs.delete(id) }

  // CSS-анимации и переходы: ставим на паузу и сами выставляем currentTime по виртуальным часам
  const born = new WeakMap()
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      if (!born.has(a)) { born.set(a, vt); try { a.pause() } catch { /* ignore */ } }
      try { a.currentTime = vt - born.get(a) } catch { /* ignore */ }
    }
  }

  function runTimers(to) {
    for (let guard = 0; guard < 10000; guard++) {
      let next = null
      for (const [id, t] of timers) if (t.at <= to && (!next || t.at < next[1].at)) next = [id, t]
      if (!next) break
      const [id, t] = next
      vt = Math.max(vt, t.at)
      if (t.every) t.at += t.every; else timers.delete(id)
      try { typeof t.fn === 'function' ? t.fn(...t.args) : undefined } catch (e) { console.error(e) }
    }
    vt = Math.max(vt, to)
  }

  function runRaf() {
    const cbs = [...rafs.values()]
    rafs.clear()
    for (const cb of cbs) { try { cb(vt) } catch (e) { console.error(e) } }
  }

  W.__vt = {
    get now() { return vt },
    get pending() { return pending },
    advance(to) { runTimers(to); runRaf(); syncAnimations() },
    settle() { runRaf(); syncAnimations() },
    sync: syncAnimations,
  }

  // --- API из снимка ---
  const realFetch = W.fetch.bind(W)
  let index = null
  const ready = realFetch('../fixtures/index.json').then((r) => r.json()).then((j) => { index = j })
  let settings = null
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const file = (f) => realFetch('../fixtures/' + f).then((r) => r.text()).then((t) => new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } }))
  function lookup(u) {
    const key = u.pathname + u.search
    if (index[key]) return index[key]
    const same = Object.keys(index).filter((k) => k.startsWith(u.pathname + '?') || k === u.pathname)
    const date = u.searchParams.get('date')
    const byDate = same.find((k) => date && new URL(k, 'http://x').searchParams.get('date') === date)
    const k = byDate || same[0]
    return k ? index[k] : null
  }
  let pending = 0
  W.fetch = (input, init = {}) => { pending++; return apiFetch(input, init).finally(() => { pending-- }) }
  const apiFetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.origin)
    if (!u.pathname.startsWith('/api/')) return realFetch(input, init)
    await ready
    const method = (init.method || 'GET').toUpperCase()
    if (u.pathname === '/api/settings') {
      if (!settings) settings = await (await file(index['/api/settings'])).json()
      if (method === 'PUT') settings = { ...settings, ...JSON.parse(init.body || '{}') }
      return json(settings)
    }
    if (u.pathname === '/api/settings/reset') { settings = await (await file(index['/api/settings'])).json(); return json(settings) }
    const f = lookup(u)
    return f ? file(f) : json({ error: 'нет в снимке' }, 404)
  }

  // WebSocket: проигрываем настоящие сообщения прода (записаны capture/ws.mjs) по виртуальным часам.
  // Для метрик сразу отдаём накопленные 30 секунд, чтобы график не начинался с пустого места.
  let wsRec = {}
  const wsReady = realFetch('../fixtures/ws.json').then((r) => r.json()).then((j) => { wsRec = j }).catch(() => {})
  W.WebSocket = class {
    constructor(url) {
      this.readyState = 0
      const path = new URL(url).pathname
      wsReady.then(() => W.setTimeout(() => {
        this.readyState = 1
        this.onopen && this.onopen({})
        const list = wsRec[path] || []
        const backlog = path === '/ws/system' ? 30 : 0
        list.forEach((m, i) => W.setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: m.data }) }, i < backlog ? 0 : (m.dt - (list[backlog]?.dt ?? 0))))
      }, 16))
    }
    send() {}
    close() { this.readyState = 3 }
    addEventListener() {}
    removeEventListener() {}
  }
  W.WebSocket.OPEN = 1

  // ссылки на выгрузку не уводят страницу
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (a) e.preventDefault() }, true)
  // синтетический указатель: захват может падать без «живого» pointerId
  const cap = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = function (id) { try { cap.call(this, id) } catch { /* ignore */ } }
  const rel = Element.prototype.releasePointerCapture
  Element.prototype.releasePointerCapture = function (id) { try { rel.call(this, id) } catch { /* ignore */ } }
  W.__vtReady = Promise.all([ready, wsReady])
})()
