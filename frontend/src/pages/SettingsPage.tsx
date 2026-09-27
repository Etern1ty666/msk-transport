import { Check, CircleHelp, RotateCcw, Save, SlidersHorizontal, Undo2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Coef, Settings } from '../api'
import { useApp } from '../components'
import { TramSide } from '../ops/Fleet'
import { Stat } from '../ops/Glyphs'

const pct = (v: number) => `${Math.round(v * 100)}%`
const same = (a: Settings | null, b: Settings | null) => !!a && !!b && JSON.stringify([a.coef, a.norm_scale, a.soft, a.free, a.free_target]) === JSON.stringify([b.coef, b.norm_scale, b.soft, b.free, b.free_target])
type Opt = { v: number; t: string; tip?: string } // t — коротко на кнопке, tip — полностью в подсказке

// сила эффекта: 1 — как в модели
const STRENGTH: Opt[] = [{ v: 2, t: 'Сильно', tip: 'Сильно — эффект ×2' }, { v: 1.5, t: 'Выше', tip: 'Выше среднего — эффект ×1,5' }, { v: 1, t: 'Средне', tip: 'Средне — как в модели' },
  { v: 0.5, t: 'Слабо', tip: 'Частично — эффект ×0,5' }, { v: 0, t: 'Нет', tip: 'Не влияет — эффект выключен' }]
// уровень пассажиропотока: множитель на весь прогноз
// все варианты — одной шкалой «Сильно · Выше · Средне · Слабо · Нет»; «Средне» — как в модели, числа уходят на сервер
const LEVEL = (d: number): Opt[] => [
  { v: 1 + 2 * d, t: 'Сильно', tip: `Сильно больше пассажиров (+${Math.round(2 * d * 100)}%)` }, { v: 1 + d, t: 'Выше', tip: `Больше пассажиров (+${Math.round(d * 100)}%)` },
  { v: 1, t: 'Средне', tip: 'Как в модели' },
  { v: 1 - d, t: 'Слабо', tip: `Меньше пассажиров (−${Math.round(d * 100)}%)` }, { v: 1 - 2 * d, t: 'Нет', tip: `Сильно меньше пассажиров (−${Math.round(2 * d * 100)}%)` }]
const IMPACT: { key: keyof Coef; title: string; desc: string; opts: Opt[] }[] = [
  // погода и праздники понятны без пояснения — у них нет «?»
  { key: 'weather', title: 'Погода', desc: '', opts: STRENGTH },
  { key: 'holiday', title: 'Праздники', desc: '', opts: STRENGTH },
  { key: 'trend', title: 'Тренд маршрутов', desc: 'Рост или спад на маршруте за последнее время', opts: STRENGTH },
  { key: 'season', title: 'Сезон', desc: 'Изменение количества пассажиров в зависимости от времени года', opts: LEVEL(0.05) },
  { key: 'event', title: 'События', desc: 'События из внешних источников: перекрытия дорог, ремонт путей, концерты, матчи и другие скопления людей', opts: LEVEL(0.15) },
]
// вкладка «Вагоны»: когда и сколько — словами, пороги загрузки уходят на сервер.
// Наборы подобраны так, что любые сочетания согласованы: снимать ниже (≤55%) < снимать до (≥60%), снимать до (≤75%) ≤ добавлять от (≥75%)
const SOFT: Opt[] = [{ v: 0.75, t: 'Заранее', tip: 'Как только загрузка выше 75%' }, { v: 0.8, t: 'Обычно', tip: 'Когда загрузка выше 80% — как в модели' }, { v: 0.9, t: 'Позже', tip: 'Только когда загрузка выше 90%' }]
const FREE: Opt[] = [{ v: 0.55, t: 'Чаще', tip: 'Уже при загрузке ниже 55%' }, { v: 0.5, t: 'Обычно', tip: 'При загрузке ниже 50% — как в модели' }, { v: 0.4, t: 'Реже', tip: 'Только при загрузке ниже 40%' }]
const FREE_TARGET: Opt[] = [{ v: 0.75, t: 'Больше', tip: 'Снимать, пока загрузка не станет 75%' }, { v: 0.7, t: 'Обычно', tip: 'Снимать, пока загрузка не станет 70% — как в модели' }, { v: 0.6, t: 'Меньше', tip: 'Снимать, пока загрузка не станет 60%' }]
// вкладка «Вместимость»: сколько пассажиров в час считаем нормой для вагона
const NORM: Opt[] = [{ v: 1.2, t: 'Много', tip: 'На 20% больше, чем в модели' }, { v: 1.1, t: 'Больше', tip: 'На 10% больше, чем в модели' }, { v: 1, t: 'Норма', tip: 'Как в модели' },
  { v: 0.9, t: 'Меньше', tip: 'На 10% меньше, чем в модели' }, { v: 0.8, t: 'Мало', tip: 'На 20% меньше, чем в модели' }]
const label = (opts: Opt[], v: number) => opts.find((o) => Math.abs(o.v - v) < 1e-6)?.t ?? `×${v.toFixed(2)}`

/** Строка настройки: название (пояснение — в подсказке и по «?»), варианты одной строкой; вариант модели отмечен точкой,
 *  своё значение (сохранённое через API) — отдельной кнопкой. */
function Choice({ title, desc, value, def, opts, onChange }: { title: string; desc: string; value: number; def: number; opts: Opt[]; onChange: (v: number) => void }) {
  const [help, setHelp] = useState(false)
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const custom = !opts.some((o) => eq(o.v, value))
  return (
    <div className={`choice ${eq(value, def) ? '' : 'changed'}`}>
      <div className="ch-name">
        <b>{title}</b>
        {/* своя подсказка: появляется сразу при наведении, по нажатию закрепляется (для телефона) */}
        {desc && <span className={`ch-help ${help ? 'on' : ''}`} onMouseLeave={() => setHelp(false)}>
          <button onClick={() => setHelp(!help)} aria-label={`Пояснение: ${desc}`} aria-expanded={help}><CircleHelp size={14} /></button>
          <span className="ch-tip" role="tooltip">{desc}</span>
        </span>}
      </div>
      <div className="ch-opts" role="radiogroup" aria-label={title} style={{ ['--n' as string]: opts.length + (custom ? 1 : 0) }}>
        {opts.map((o) => (
          <button key={o.v} role="radio" aria-checked={eq(o.v, value)} className={`${eq(o.v, value) ? 'on' : ''} ${eq(o.v, def) ? 'def' : ''}`}
            onClick={() => onChange(o.v)} title={o.tip ?? (eq(o.v, def) ? 'Как в модели' : o.t)}>{o.t}</button>
        ))}
        {custom && <button className="on" disabled title="Своё значение">×{value.toFixed(2)}</button>}
      </div>
    </div>
  )
}

/** «Настройки» — в стиле карточки станции: три плитки (влияние на прогноз · вагоны · норматив), нажатая раскрывает варианты.
 *  Сохраняется на сервере — карта, сводка, XLSX и API у всех пользователей считаются с этими значениями;
 *  submission для хакатона остаётся чистым выходом модели. */
export default function SettingsPage() {
  const { settings, saveSettings, resetSettings, meta } = useApp()
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [tile, setTile] = useState<'coef' | 'veh' | 'norm'>('coef')
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({})
  useEffect(() => { if (settings && (!draft || state.ok)) setDraft(settings) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft || !settings) return <div className="note">Загрузка настроек с сервера…</div>

  const def = settings.defaults ?? settings
  const dirty = !same(draft, settings)
  const atModel = same(settings, { ...settings, ...def } as Settings)
  const bad = draft.free >= draft.soft ? '«Снимать ниже» должно быть меньше «добавлять от»'
    : draft.free_target > draft.soft ? '«После снятия не выше» не может быть больше «добавлять от»'
    : draft.free_target <= draft.free ? '«После снятия не выше» должно быть больше «снимать ниже»' : null
  const set = (patch: Partial<Settings>) => { setDraft({ ...draft, ...patch }); setState({}) }
  const run = async (f: () => Promise<void>, ok: string) => {
    setState({ busy: true })
    try { await f(); setState({ ok }) } catch (e) { setState({ err: e instanceof Error ? e.message : String(e) }) }
  }
  const routeOf = (r: string) => meta?.routes.find((x) => String(x.route) === r)
  const nCoef = IMPACT.filter((c) => draft.coef[c.key] !== def.coef[c.key]).length
  const nVeh = (['soft', 'free', 'free_target'] as const).filter((k) => draft[k] !== def[k]).length
  const msg = state.err ?? bad ?? (dirty ? 'Есть несохранённые изменения' : state.ok ?? '')

  return (
    <div className="setcard">
      <div className="facts-box" data-tab={{ coef: 0, veh: 1, norm: 2 }[tile]}>
        <div className="facts glyph-facts">
          <Stat big icon={SlidersHorizontal} v={`${nCoef} из 5`} on={tile === 'coef'} onClick={() => setTile('coef')}
            tip={nCoef ? `Изменено факторов влияния на прогноз: ${nCoef} из 5` : 'Влияние на прогноз — как в модели'} />
          <Stat big icon={TramSide} v={`${nVeh} из 3`} on={tile === 'veh'} onClick={() => setTile('veh')}
            tip={`Когда подсказывать добавить или снять вагоны: добавлять при загрузке выше ${pct(draft.soft)}, снимать ниже ${pct(draft.free)}, снимать до ${pct(draft.free_target)}`} />
          <Stat big icon={Users} v={label(NORM, draft.norm_scale)} on={tile === 'norm'} onClick={() => setTile('norm')}
            tip="Сколько пассажиров вмещает вагон — от этого считается загрузка" />
        </div>

        {tile === 'coef' && (
          <div className="tdet">
            <div className="td-h"><b>Влияние на прогноз</b></div>
            {IMPACT.map((c) => (
              <Choice key={c.key} title={c.title} desc={c.desc} value={draft.coef[c.key]} def={def.coef[c.key]} opts={c.opts}
                onChange={(v) => set({ coef: { ...draft.coef, [c.key]: v } })} />
            ))}
          </div>
        )}
        {tile === 'veh' && (
          <div className="tdet">
            <div className="td-h"><b>Подсказки по вагонам</b></div>
            <Choice title="Когда предлагать добавить вагоны?" desc="Ветка загружена — подсказываем, откуда взять свободные вагоны. «Заранее» — подсказка появится раньше, при меньшей загрузке"
              value={draft.soft} def={def.soft} opts={SOFT} onChange={(v) => set({ soft: v })} />
            <Choice title="Когда предлагать снять вагоны?" desc="Ветка полупустая — подсказываем, что лишние вагоны можно отдать другим веткам или в парк. «Чаще» — подсказка появится при большей загрузке"
              value={draft.free} def={def.free} opts={FREE} onChange={(v) => set({ free: v })} />
            <Choice title="Сколько вагонов снимать?" desc="«Больше» — снимаем больше вагонов, оставшиеся едут полнее; «Меньше» — снимаем осторожнее. На линии всегда остаётся не меньше половины вагонов"
              value={draft.free_target} def={def.free_target} opts={FREE_TARGET} onChange={(v) => set({ free_target: v })} />
          </div>
        )}
        {tile === 'norm' && (
          <div className="tdet">
            <div className="td-h"><b>Вместимость вагона</b></div>
            <Choice title="Сколько пассажиров вмещает вагон?" desc="Норма посадок в час на один вагон. «Больше» — вагон считается просторнее: загрузка ниже и вагонов нужно меньше. Ниже — норма по каждой ветке" value={draft.norm_scale} def={def.norm_scale} opts={NORM} onChange={(v) => set({ norm_scale: v })} />
            <div className="norm-cap">Норма посадок в час на один вагон</div>
            <div className="sd-list norm-list">
              {Object.entries(settings.norm_base ?? {}).filter(([r, v]) => v > 0 && routeOf(r)?.active !== false).map(([r, v]) => {
                const m = routeOf(r)
                return (
                  <div key={r} className="toprow static" title={m?.name}>
                    <span className="rnum" style={{ background: m?.color ?? '#64748b' }}>{r}</span>
                    <span>{m?.name.replace(/^Трамвай \d+: /, '').replace(/\s*=>\s*/, ' — ') ?? `№${r}`}</span>
                    <span className="num">{draft.norm_scale !== 1 && <s>{Math.round(v)}</s>}<b>{Math.round(v * draft.norm_scale)}</b></span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* действия — внизу панели, всегда под рукой */}
      <div className="set-foot-bar">
        <span className={`set-state ${state.err || bad ? 'err' : dirty ? 'dirty' : ''}`}>{msg}</span>
        <div className="set-btns">
          {dirty && <button className="iconbtn" onClick={() => { setDraft(settings); setState({}) }} title="Отменить изменения"><Undo2 size={16} /></button>}
          {!atModel && <button className="iconbtn" disabled={state.busy} onClick={() => run(resetSettings, 'Возвращены настройки модели')} title="Вернуть значения модели для всех"><RotateCcw size={16} /></button>}
          <button className="btn primary" disabled={!dirty || !!bad || state.busy} onClick={() => run(() => saveSettings(draft), 'Сохранено для всех')}>
            {state.ok && !dirty ? <Check size={15} /> : <Save size={15} />}Сохранить</button>
        </div>
      </div>
    </div>
  )
}
