import { Clock, Download, MousePointerClick, TriangleAlert, X } from 'lucide-react'
import { useApp } from '../components'

const num = (v: number, d = 3) => v.toFixed(d).replace('.', ',')

/** Приветствие: что прогнозируем, насколько точно и как читать карту — коротко, по центру экрана. */
export default function Intro({ onClose }: { onClose: () => void }) {
  const { meta } = useApp()
  const wape = meta?.backtest_mean?.['Полная модель'] ?? 0
  return (
    <>
      <div className="intro-back" onClick={onClose} />
      <div className="intro" role="dialog" aria-label="О проекте">
        <button className="iconbtn intro-x" onClick={onClose} title="Закрыть"><X size={16} /></button>
        <h2>Прогноз загрузки трамваев Москвы</h2>
        <div className="note">Посадки по часам · 10 маршрутов · ноябрь–декабрь 2025</div>

        <div className="intro-score">
          <div className="is-row"><span>Точность модели (WAPE-score)</span><b>{wape ? num(wape) : '—'}</b></div>
          <div className="is-bar"><i style={{ width: `${wape * 100}%` }} /><em style={{ left: '48%' }} title="baseline организаторов" /></div>
          <div className="is-foot"><span>baseline организаторов — 0,48</span><span>1,0 — идеально</span></div>
        </div>

        <ol className="intro-steps">
          <li><Clock size={18} /><span>Тяните <b>ленту времени</b> — карта покажет загрузку в любой час</span></li>
          <li><TriangleAlert size={18} /><span><b className="c-crit">Красная</b> обводка ветки — перегрузка, <b className="c-high">оранжевая</b> — на грани нормы</span></li>
          <li><i className="fill-swatch" /><span>Свечение вокруг вагона — его <b>наполненность</b>: <b className="c-ok">зелёный</b> — свободно, тёмно-зелёный — 30–60%, с 65% оранжевеет, <b className="c-crit">красный</b> — 100% и больше</span></li>
          <li><MousePointerClick size={18} /><span>Нажмите на ветку — сколько <b>вагонов добавить</b> и когда</span></li>
        </ol>

        <div className="intro-actions">
          <button className="ia primary" onClick={onClose}>Открыть карту</button>
          <a className="ia" href="/api/submission"><Download size={15} /> submission.csv</a>
        </div>
      </div>
    </>
  )
}
