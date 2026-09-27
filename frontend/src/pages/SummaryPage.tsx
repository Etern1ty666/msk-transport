import ForecastPage from './ForecastPage'
import Overview from './Overview'
import { Section, useScrollToHash } from './Sections'

/** «Сводка»: ключевые показатели прогноза и где не хватает вагонов, затем прогноз в разрезах, таблица и выгрузка. */
export default function SummaryPage() {
  useScrollToHash({ forecast: 'sm-forecast', overview: 'sm-overview' })
  return (
    <>
      <Section id="sm-forecast" title="Прогноз и выгрузка"
        lead="Прогноз на день, месяц или год — по маршруту, остановке и интервалу часов, с разложением по компонентам. Таблицу можно выгрузить в CSV или XLSX; файл для платформы хакатона — чистый выход модели.">
        <ForecastPage />
      </Section>
      <Section id="sm-overview" title="Показатели"
        separated={false}
        lead="Прогноз посадок на ноябрь–декабрь в сравнении с фактом, разбивка по маршрутам и часам и часы, где вагонов не хватает до норматива. Всё — с действующими корректировками из «Настроек».">
        <Overview />
      </Section>
    </>
  )
}
