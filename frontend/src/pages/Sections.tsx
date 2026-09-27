import { useEffect, useState, type ReactNode } from 'react'

/** Разделы длинной страницы: закреплённые «пилюли» сверху — прокрутка к разделу. */
export function SectionNav({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '')
  useEffect(() => {
    const page = document.querySelector<HTMLElement>('.page')
    const nav = document.querySelector<HTMLElement>('.psec-nav')
    if (!page || !nav) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const edge = nav.getBoundingClientRect().bottom + 24
        let current = items[0]?.id ?? ''
        for (const item of items) {
          const section = document.getElementById(item.id)
          if (section && section.getBoundingClientRect().top <= edge) current = item.id
        }
        setActive(current)
      })
    }
    update()
    page.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { cancelAnimationFrame(frame); page.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [items])
  const go = (id: string) => {
    const page = document.querySelector<HTMLElement>('.page')
    const section = document.getElementById(id)
    const nav = document.querySelector<HTMLElement>('.psec-nav')
    const bar = document.querySelector<HTMLElement>('.page-bar')
    if (!page || !section) return
    const offset = (bar?.offsetHeight ?? 0) + (nav?.offsetHeight ?? 0) + 16
    page.scrollTo({ top: page.scrollTop + section.getBoundingClientRect().top - page.getBoundingClientRect().top - offset, behavior: 'smooth' })
    setActive(id)
  }
  return (
    <nav className="psec-nav" aria-label="Разделы страницы">
      {items.map((it) => (
        <button key={it.id} className={active === it.id ? 'on' : ''} aria-current={active === it.id ? 'location' : undefined} onClick={() => go(it.id)}>{it.title}</button>
      ))}
    </nav>
  )
}

/** Раздел страницы: заголовок, пара предложений — что здесь и зачем, дальше содержимое. */
export function Section({ id, title, lead, children, separated = true }: { id: string; title: string; lead: ReactNode; children: ReactNode; separated?: boolean }) {
  return (
    <section id={id} className={`psec${separated ? '' : ' psec-joined'}`}>
      <div className="psec-head"><h2>{title}</h2><p>{lead}</p></div>
      <div className="psec-body">{children}</div>
    </section>
  )
}

/** Открыли по старому адресу (#model, #forecast …) — прокручиваем к разделу, куда вошла та страница. */
export function useScrollToHash(map: Record<string, string>) {
  useEffect(() => {
    const go = () => {
      const id = map[window.location.hash.slice(1)]
      if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 60)
    }
    go()
    window.addEventListener('hashchange', go) // страница уже открыта, сменился только адрес раздела
    return () => window.removeEventListener('hashchange', go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
