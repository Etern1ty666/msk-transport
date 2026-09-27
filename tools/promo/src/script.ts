// Сценарий ролика на бит-сетке: 120 BPM, 18 тактов по 4 доли, 1 доля = 0.5 с = 30 кадров при 60 fps.
// Время везде в долях (b). Курсор приходит к цели на своей доле, клик — ровно на доле.

export const BEAT = 0.5
export const BEATS = 72
export const APP_W = 1600
export const APP_H = 900

type Pick = { sel: string; text?: string; inSel?: string; inText?: string; nth?: number; ax?: number; ay?: number; dx?: number; dy?: number; pad?: number }
export type Target = Pick | { x: number; y: number } | { rect: [number, number, number, number] }
export type CursorKey = { b: number; to: Target; lead?: number }
export type Action =
  | { b: number; a: 'click'; sound?: 'click' | 'tick' | null }
  | { b: number; a: 'down' }
  | { b: number; a: 'up' }
  | { b: number; a: 'type'; text: string; per: number }
  | { b: number; a: 'key'; key: string }
  | { b: number; a: 'scroll'; to: Target; dur: number }
export type CamKey = { b: number; to: Target | 'full'; dur?: number }

const ruler = (ax: number, dx = 0): Target => ({ sel: '.ruler', ax, ay: 0.62, dx })
const menuItem = (t: string): Target => ({ sel: '.menupop button', text: t, ax: 0.3 })

export const cursor: CursorKey[] = [
  { b: 0, to: { x: 1380, y: 980 } },
  { b: 3.75, to: { sel: 'button', text: 'Открыть карту', ax: 0.56, ay: 0.58 }, lead: 1.5 },
  { b: 7.75, to: ruler(0.66), lead: 2 },
  { b: 12, to: ruler(0.66, -262), lead: 3.6 },
  { b: 13.75, to: { sel: '.ev.crit .ev-h', ax: 0.35 }, lead: 1.2 },
  { b: 15.75, to: { sel: '.routebar button', text: '17' }, lead: 1.3 },
  { b: 18.5, to: { sel: '.ops-side .recharts-wrapper', ax: 0.28, ay: 0.55 }, lead: 1.4 },
  { b: 20.5, to: { sel: '.ops-side .recharts-wrapper', ax: 0.9, ay: 0.55 }, lead: 1.8 },
  { b: 21.75, to: { sel: 'input[aria-label="Поиск станции"]', ax: 0.25 }, lead: 1 },
  { b: 25.75, to: { sel: '.ops-side .toprow', ax: 0.3 }, lead: 1.3 },
  { b: 29.75, to: { sel: '.seg-b.speed' }, lead: 1.4 },
  { b: 31.9, to: { sel: '.seg-b.play' }, lead: 0.3 },
  { b: 35.75, to: { sel: '.ev.free .ev-h', ax: 0.35 }, lead: 1.2 },
  { b: 38, to: { sel: '.ops-side .recharts-wrapper', ax: 0.62, ay: 0.55 }, lead: 1.6 },
  { b: 39.75, to: { sel: '.tl-menu' }, lead: 1.2 },
  { b: 40.75, to: menuItem('Сводка'), lead: 0.7 },
  { b: 42.75, to: { sel: '#sm-overview .recharts-wrapper', ax: 0.5, ay: 0.5 }, lead: 1.4 },
  { b: 46.5, to: { sel: '#sm-overview .recharts-wrapper', ax: 0.93, ay: 0.45 }, lead: 3.2 },
  { b: 50.75, to: { sel: 'a.btn.primary', text: 'submission.csv' }, lead: 1.4 },
  { b: 51.75, to: { sel: '.pb-back' }, lead: 0.7 },
  { b: 52.75, to: { sel: '.tl-menu' }, lead: 0.7 },
  { b: 53.75, to: menuItem('Настройки'), lead: 0.7 },
  { b: 55.75, to: { sel: '.ch-opts button', text: 'Сильно', inSel: '.choice', inText: 'Погода' }, lead: 1.2 },
  { b: 56.75, to: { sel: '.ch-opts button', text: 'Выше', inSel: '.choice', inText: 'Праздники' }, lead: 0.8 },
  { b: 57.75, to: { sel: 'button.btn.primary', text: 'Сохранить' }, lead: 0.55 },
  { b: 61.75, to: { sel: '.sd-close' }, lead: 1.4 },
  { b: 62.75, to: { sel: '.tl-menu' }, lead: 0.8 },
  { b: 63.75, to: menuItem('О проекте'), lead: 0.7 },
  { b: 67.5, to: { x: 1250, y: 760 }, lead: 2.5 },
]

export const actions: Action[] = [
  { b: 4, a: 'click' },
  { b: 8, a: 'down' },
  { b: 12, a: 'up' },
  { b: 14, a: 'click' },
  { b: 16, a: 'click' },
  { b: 22, a: 'click' },
  { b: 22.5, a: 'type', text: 'ВДНХ', per: 0.5 },
  { b: 26, a: 'click' },
  { b: 28, a: 'key', key: 'Escape' },
  { b: 29, a: 'key', key: 'Escape' },
  { b: 30, a: 'click', sound: 'tick' },
  { b: 30.5, a: 'click', sound: 'tick' },
  { b: 31, a: 'click', sound: 'tick' },
  { b: 31.5, a: 'click', sound: 'tick' },
  { b: 32, a: 'click' },
  { b: 34, a: 'click' },
  { b: 36, a: 'click' },
  { b: 40, a: 'click' },
  { b: 41, a: 'click' },
  { b: 47, a: 'scroll', to: { sel: '#sm-forecast' }, dur: 3 },
  { b: 51, a: 'click' },
  { b: 52, a: 'click' },
  { b: 53, a: 'click' },
  { b: 54, a: 'click' },
  { b: 56, a: 'click', sound: 'tick' },
  { b: 57, a: 'click', sound: 'tick' },
  { b: 58, a: 'click' },
  { b: 62, a: 'click' },
  { b: 63, a: 'click' },
  { b: 64, a: 'click' },
  { b: 65, a: 'scroll', to: { sel: '#ab-model' }, dur: 1.6 },
  { b: 67, a: 'scroll', to: { sel: '#ab-service' }, dur: 1.6 },
]

export const camera: CamKey[] = [
  { b: 0, to: { rect: [560, 170, 480, 560] } },
  { b: 4.25, to: 'full', dur: 3 },
  { b: 8.5, to: { rect: [180, 0, 1240, 698] }, dur: 3 },
  { b: 12.5, to: { rect: [400, 0, 800, 450] }, dur: 2 },
  { b: 16.25, to: { rect: [0, 0, 1080, 608] }, dur: 2 },
  { b: 21.25, to: { rect: [0, 190, 1000, 562] }, dur: 2 },
  { b: 26.25, to: { rect: [0, 0, 1000, 562] }, dur: 2 },
  { b: 29, to: { rect: [240, 0, 1100, 619] }, dur: 2 },
  { b: 32.25, to: 'full', dur: 2.5 },
  { b: 35.25, to: { rect: [400, 0, 800, 450] }, dur: 2 },
  { b: 36.5, to: { rect: [0, 0, 1080, 608] }, dur: 2 },
  { b: 39.5, to: 'full', dur: 2 },
  { b: 42, to: { sel: '#sm-overview .recharts-wrapper', pad: 70 }, dur: 2.5 },
  { b: 47, to: 'full', dur: 2.5 },
  { b: 50, to: { sel: 'a.btn.primary', text: 'submission.csv', pad: 300 }, dur: 2 },
  { b: 51.75, to: 'full', dur: 2 },
  { b: 54.25, to: { rect: [0, 0, 1000, 562] }, dur: 2 },
  { b: 58.25, to: 'full', dur: 2.5 },
  { b: 62.25, to: { rect: [400, 0, 800, 450] }, dur: 1.5 },
  { b: 63.25, to: 'full', dur: 2 },
]

/** Подписи к функциям: пилюля внизу, текст сменяется с коротким блюром. */
export const captions: { b: number; text: string | null }[] = [
  { b: 0, text: null },
  { b: 1.5, text: 'Точность 0,887 — у бейзлайна организаторов 0,48' },
  { b: 4.5, text: '10 маршрутов на схеме Москвы, наполненность каждого вагона' },
  { b: 8, text: 'Тянете ленту времени — прогноз на любой час' },
  { b: 13, text: 'Перегрузки видны сразу' },
  { b: 16, text: 'Карточка ветки: посадки по часам и сколько вагонов добавить' },
  { b: 22, text: 'Поиск станции и поток пассажиров на остановке' },
  { b: 30, text: 'Симуляция суток ×8' },
  { b: 35.5, text: 'Где вагоны лишние — и куда их отдать' },
  { b: 41, text: 'Сводка: 12,4 млн посадок на ноябрь–декабрь' },
  { b: 49.5, text: 'Выгрузка: submission.csv, CSV и XLSX' },
  { b: 51, text: 'submission.csv · 14 640 строк — скачано' },
  { b: 54, text: 'Настройки прогноза — применяются для всех сразу' },
  { b: 62, text: 'Прогноз скорректирован — видно на карте' },
  { b: 64.5, text: 'Модель: профиль × тренд × календарь × погода' },
  { b: 67, text: 'REST API, три WebSocket и Swagger' },
  { b: 68.5, text: 'mos-trans.legacy-team.tech' },
  { b: 70, text: null },
]

/** Окно приложения: 0 — пилюля TramFlow, 1 — окно. Последний кадр совпадает с первым. */
export const morph: { b: number; v: number; dur: number; zeta?: number }[] = [
  { b: 0, v: 0, dur: 1 },
  { b: 1, v: 1, dur: 1.4 },
  { b: 69.25, v: 0, dur: 1.5, zeta: 1 }, // без перелёта: к последнему кадру пилюля точно как в первом
]

export const cursorVisible: { b: number; v: number }[] = [
  { b: 0, v: 0 },
  { b: 2, v: 1 },
  { b: 68, v: 0 },
]
