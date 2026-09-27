# Промо-ролик TramFlow (Remotion)

36 секунд, 120 BPM, 18 тактов. В кадре настоящий интерфейс TramFlow, а не запись экрана: собранный фронт
работает в `<iframe>` внутри композиции Remotion на виртуальных часах. Клики, драги и набор текста — это
настоящие события в DOM приложения, привязанные к долям. Камеру, морф окна, курсор и подписи рисует Remotion.

Как устроено:

- `app-shim/vt.js` подключается раньше бандла. Он подменяет `setTimeout`/`setInterval`, `requestAnimationFrame`,
  `Date` и `performance.now`, ставит CSS-анимации на паузу и сам выставляет им `currentTime`. Время двигается
  только по `__vt.advance(ms)`. API отвечает из снимка прода (`public/fixtures`), WebSocket проигрывает записанные
  сообщения, настройки хранятся в памяти страницы, так что прод рендер не трогает.
- `src/engine.ts` шагает кадры строго по порядку: курсор (сумма пружин), события указателя, действия сценария,
  `advance`, ожидание React и данных. При прыжке назад iframe перезагружается и сценарий проигрывается заново,
  поэтому кадр однозначно определяется своим номером.
- `src/script.ts` — сценарий на бит-сетке: цели курсора (селекторы), клики, камера, подписи.
- Музыка: «Hazy After Hours», Alejandro Magaña, [Mixkit](https://mixkit.co/free-stock-music/) (Mixkit Free License).
  Замер показал 121 BPM, трек растянут до 120 (`atempo`), старт взят с сильной доли на 16.015 с.
  Звуки интерфейса тоже с Mixkit, выставлены по измеренному пику.

```bash
npm install
npm run fixtures      # снимок API и WebSocket прода (уже лежит в public/fixtures)
npm run build-app     # сборка ../../frontend в public/app + vt.js
npm run beats         # по кадру на долю в out/beats — проверка сетки перед полным рендером
npm run render        # 240 fps: 4 подкадра на кадр
npm run finish        # tmix → 60 fps с motion blur, GIF → ../../docs/promo.gif
```
