import ForecastPage from './ForecastPage'
import Overview from './Overview'
import { Section, SectionNav, useScrollToHash } from './Sections'

/** «Сводка»: ключевые показатели прогноза и где не хватает вагонов, затем прогноз в разрезах, таблица и выгрузка. */
export default function SummaryPage() {
  useScrollToHash({ overview: 'sm-overview', forecast: 'sm-forecast' })
  return (
    <>
      <SectionNav items={[{ id: 'sm-overview', title: 'Показатели' }, { id: 'sm-forecast', title: 'Прогноз и выгрузка' }]} />
      <Section id="sm-overview" title="Показатели"
        lead="Прогноз посадок на ноябрь–декабрь в сравнении с фактом, разбивка по маршрутам и часам и часы, где вагонов не хватает до норматива. Всё — с действующими корректировками из «Настроек».">
        <Overview />
      </Section>
      <Section id="sm-forecast" title="Прогноз и выгрузка"
        lead="Прогноз на день, месяц или год — по маршруту, остановке и интервалу часов, с разложением по компонентам. Таблицу можно выгрузить в CSV или XLSX; файл для платформы хакатона — чистый выход модели.">
        <ForecastPage />
      </Section>
    </>
  )
}
