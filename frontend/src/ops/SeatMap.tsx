import { useMemo } from 'react'
import { fillRGB } from './scheme/SchemeView'

// Условная схема вагона сверху: 2 ряда сидений вдоль бортов и 2 ряда стоячих мест в проходе, 4 двери.
const COLS = 16, ROWS = 4, CELL = 14, GAP = 3, PAD_X = 22, PAD_Y = 9
const W = PAD_X * 2 + COLS * CELL + (COLS - 1) * GAP, H = PAD_Y * 2 + ROWS * CELL + (ROWS - 1) * GAP
const DOORS = [2.5, 6.5, 10.5, 14.5] // между какими колонками двери (по верхнему борту)
const isSeat = (row: number) => row === 0 || row === ROWS - 1

/** Детерминированный «случайный» порядок: пассажиры рассаживаются вразброс, но при росте загрузки квадратики только добавляются. */
function order(seed: number) {
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => ({ r: Math.floor(i / COLS), c: i % COLS }))
  let s = seed * 9301 + 49297
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  const key = cells.map((x) => ({ x, k: (isSeat(x.r) ? 0 : 1) + rnd() * 0.999 })) // сначала сиденья, потом проход
  return key.sort((a, b) => a.k - b.k).map((q) => q.x)
}

/** Заполненность вагона квадратиками: доля закрашенных = загрузка (посадки на вагон ÷ норматив маршрута). */
export default function SeatMap({ ratio, seed = 1, off }: { ratio: number; seed?: number; off?: boolean }) {
  const seq = useMemo(() => order(seed), [seed])
  const n = off ? 0 : Math.round(Math.min(1, Math.max(0, ratio)) * seq.length)
  const filled = new Set(seq.slice(0, n).map((x) => x.r * COLS + x.c))
  const [cr, cg, cb] = fillRGB(Math.min(1, ratio))
  const color = `rgb(${cr},${cg},${cb})`
  const over = !off && ratio > 1
  // сверх вместимости: столько «не поместившихся» квадратиков в ряд под вагоном (не больше одного ряда)
  const extra = over ? Math.min(COLS, Math.round((ratio - 1) * seq.length)) : 0
  const OY = H + 5, SH = extra ? CELL + 6 : 0
  const seats = seq.filter((x) => isSeat(x.r)).length
  const busySeats = seq.slice(0, n).filter((x) => isSeat(x.r)).length
  const tip = off ? 'В этот час вагонов на линии нет'
    : `Заполненность ≈${Math.round(ratio * 100)}%: занято ${busySeats} из ${seats} сидячих, ${n - busySeats} из ${seq.length - seats} стоячих`
      + `${over ? `; ещё ≈${Math.round((ratio - 1) * seq.length)} не помещаются` : ''}. Схема условная: 1 квадрат ≈ 1/${seq.length} вместимости`

  return (
    <svg className={`seatmap ${over ? 'over' : ''}`} viewBox={`0 0 ${W} ${H + SH}`} role="img" aria-label={tip}>
      <title>{tip}</title>
      {/* корпус: кабины с обеих сторон, двери — разрывы борта */}
      <rect className="body" x="1" y="1" width={W - 2} height={H - 2} rx={H / 2.6} />
      {DOORS.map((d) => {
        const x = PAD_X + d * (CELL + GAP) - GAP / 2
        return <rect key={d} className="door" x={x - 9} y="0" width="18" height="3.2" rx="1.2" />
      })}
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const r = Math.floor(i / COLS), c = i % COLS
        const on = filled.has(i)
        return (
          <rect key={i} className={`cell ${isSeat(r) ? 'seat' : 'stand'} ${on ? 'on' : ''}`}
            x={PAD_X + c * (CELL + GAP)} y={PAD_Y + r * (CELL + GAP)} width={CELL} height={CELL} rx={isSeat(r) ? 3 : 5}
            style={on ? { fill: color, transitionDelay: `${(seq.findIndex((q) => q.r === r && q.c === c) % 12) * 12}ms` } : undefined} />
        )
      })}
      {Array.from({ length: extra }, (_, i) => (
        <rect key={`x${i}`} className="cell out" x={PAD_X + i * (CELL + GAP)} y={OY} width={CELL} height={CELL} rx={5}
          style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </svg>
  )
}
