import { ArrowLeftRight, Clock, Download, Keyboard, LayoutDashboard, MousePointerClick, SlidersHorizontal, TrainFront, Users } from 'lucide-react'
import { Card, useApp } from '../components'
import ModelPage from './ModelPage'
import PipelinePage from './PipelinePage'
import ServicePage from './ServicePage'
import { Section, SectionNav, useScrollToHash } from './Sections'

const num = (v: number, d = 3) => v.toFixed(d).replace('.', ',')

/** «О проекте»: как пользоваться сервисом, как считается прогноз, откуда данные и как устроен сервис — одной страницей. */
export default function AboutPage() {
  const { meta, go } = useApp()
  const wape = meta?.backtest_mean?.['Полная модель'] ?? 0
  useScrollToHash({ use: 'ab-use', model: 'ab-model', pipeline: 'ab-pipeline', service: 'ab-service' })
  return (
    <>
      <SectionNav items={[
        { id: 'ab-use', title: 'Как пользоваться' }, { id: 'ab-model', title: 'Как считается прогноз' },
        { id: 'ab-pipeline', title: 'Данные и обработка' }, { id: 'ab-service', title: 'Сервис и API' },
      ]} />

      <Section id="ab-use" title="Как пользоваться"
        lead="ПОТОК (СПП, система прогнозирования пассажиропотока) прогнозирует посадки в трамваи Москвы по часам на 10 маршрутах и подсказывает диспетчеру, где не хватит вагонов и откуда их взять.">
        <div className="grid g-side">
          <Card title="Карта и карточки">
            <ol className="about-steps">
              <li><Clock size={18} /><span><b>Лента времени</b> сверху — любой час и день; «Live» — сейчас. Под ней — события сети: перегрузка, скоро перегрузка, загрузка выше 80%, можно снять вагоны (или «Всё спокойно»); нажмите — появятся номера веток.</span></li>
              <li><TrainFront size={18} /><span><b>Цвет ветки</b> — загрузка к нормативу: зелёный — свободно, жёлтый и оранжевый — на грани, <b className="c-crit">красный</b> — перегрузка. На нижней панели маршрутов перегруженные ветки мигают красным маячком с «+N%».</span></li>
              <li><MousePointerClick size={18} /><span><b>Карточка ветки</b> — нажмите на ветку. Плитки «пассажиры · оплаты · вагоны» раскрываются подробностями; ниже — нужны ли вагоны: схема, откуда их взять (или куда снять лишние), несколько вариантов; список станций с поиском.</span></li>
              <li><Users size={18} /><span><b>Карточка остановки</b> — пассажиры в этот час, оплаты с начала суток, час пик на остановке и пересадки рядом (метро, МЦК, МЦД, другие трамваи).</span></li>
              <li><Keyboard size={18} /><span><b>Стрелки ← →</b> листают то, по чему кликнули последним: ленту времени, остановки или маршруты на нижней панели; ↑ ↓ — ветки или остановки в карточке; пробел — пуск/пауза; Esc — назад.</span></li>
              <li><ArrowLeftRight size={18} /><span>Кнопка с картой справа — переключить подложку: схема маршрутов или городская карта.</span></li>
            </ol>
          </Card>
          <Card title="Точность и разделы">
            <div className="intro-score">
              <div className="is-row"><span>Точность модели (WAPE-score)</span><b>{wape ? num(wape) : '—'}</b></div>
              <div className="is-bar"><i style={{ width: `${wape * 100}%` }} /><em style={{ left: '48%' }} title="baseline организаторов" /></div>
              <div className="is-foot"><span>baseline организаторов — 0,48</span><span>1,0 — идеально</span></div>
            </div>
            <div className="about-links">
              <button className="btn" onClick={() => go('summary')}><LayoutDashboard size={15} />Сводка — показатели, таблица, выгрузка</button>
              <button className="btn" onClick={() => go('settings')}><SlidersHorizontal size={15} />Настройки — коэффициенты и пороги</button>
              <a className="btn" href="/api/submission"><Download size={15} />submission.csv</a>
            </div>
          </Card>
        </div>
      </Section>

      <Section id="ab-model" title="Как считается прогноз"
        lead="Профиль посадок «маршрут × час» по последним неделям, умноженный на поправки: календарь и праздники, погода, тренд маршрута и сезон. Ниже — формула, бэктест на октябре, вклад каждого источника и сравнение с ML-моделями.">
        <ModelPage />
      </Section>

      <Section id="ab-pipeline" title="Данные и обработка"
        lead="Сырые валидации (≈47 млн строк) агрегируются DuckDB по часам, к ним добавляются погода и календарь, затем строится модель, прогноз и файл для платформы. Конвейер можно перезапустить и следить за ним в реальном времени.">
        <PipelinePage />
      </Section>

      <Section id="ab-service" title="Сервис и API"
        lead="FastAPI отдаёт прогноз за миллисекунды — с корректировками из «Настроек». Здесь метрики в реальном времени, нагрузочный тест и все точки входа API со ссылкой на Swagger.">
        <ServicePage />
      </Section>
    </>
  )
}
