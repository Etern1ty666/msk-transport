// Пружины в замкнутой форме: переходная характеристика осциллятора второго порядка.
// Значение с несколькими сменами цели — сумма пружин, по одной на смену, поэтому остаётся чистой функцией времени.

/** Доля пути 0→1 через t секунд после старта; к dur секундам пружина успокаивается (ζ<1 даёт едва заметный перелёт). */
export function step(t: number, dur: number, zeta = 0.86): number {
  if (t <= 0) return 0
  if (zeta >= 1) {
    const w = 5.8 / dur // критическое затухание: без перелёта
    const v = 1 - Math.exp(-w * t) * (1 + w * t)
    return v > 0.9999 ? 1 : v
  }
  const w = 4.2 / (zeta * dur)
  const wd = w * Math.sqrt(1 - zeta * zeta)
  const v = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t))
  return Math.abs(1 - v) < 1e-4 && t > dur ? 1 : v
}

export type Key<T> = { t: number; v: T; dur?: number; zeta?: number }

/** Сумма пружин для числа: keys отсортированы по t (секунды старта перехода). */
export function track(keys: Key<number>[], t: number, dur = 0.5): number {
  let v = keys[0].v
  for (let i = 1; i < keys.length; i++) v += (keys[i].v - keys[i - 1].v) * step(t - keys[i].t, keys[i].dur ?? dur, keys[i].zeta)
  return v
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
