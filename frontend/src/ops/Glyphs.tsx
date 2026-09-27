import type { ComponentType, ReactNode } from 'react'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** Иконка + число; пояснение — во всплывающей подсказке, а не текстом на экране. */
export function Stat({ icon: I, v, tip, color, big, on, onClick }: {
  icon: Icon; v: ReactNode; tip: string; color?: string; big?: boolean
  on?: boolean; onClick?: () => void // плитка-кнопка: по нажатию раскрывает подробности
}) {
  const body = <><I size={big ? 16 : 14} strokeWidth={2} /><b style={color ? { color } : undefined}>{v}</b></>
  return onClick
    ? <button className={`stat ${big ? 'big' : ''} tap ${on ? 'on' : ''}`} title={tip} aria-label={tip} aria-expanded={on} onClick={onClick}>{body}</button>
    : <span className={`stat ${big ? 'big' : ''}`} title={tip} aria-label={tip}>{body}</span>
}

const p2 = (h: number) => String(h).padStart(2, '0')
/** Окно часов коротко: {from: 8, to: 8} → «08–09». */
export const hspan = (w: { from: number; to: number }) => `${p2(w.from)}–${p2(w.to + 1)}`
