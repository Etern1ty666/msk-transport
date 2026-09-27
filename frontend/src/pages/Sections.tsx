import { useEffect, type ReactNode } from 'react'

/** Разделы длинной страницы: закреплённые «пилюли» сверху — прокрутка к разделу. */
export function SectionNav({ items }: { items: { id: string; title: string }[] }) {
  return (
    <nav className="psec-nav">
      {items.map((it) => (
        <button key={it.id} onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{it.title}</button>
      ))}
    </nav>
  )
}

/** Раздел страницы: заголовок, пара предложений — что здесь и зачем, дальше содержимое. */
export function Section({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="psec">
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
