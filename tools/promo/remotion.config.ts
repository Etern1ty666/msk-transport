import { Config } from '@remotion/cli/config'

// Приложение в iframe живёт на виртуальных часах и проигрывается по порядку: один поток, кадры строго подряд.
Config.setConcurrency(1)
Config.setChromiumOpenGlRenderer('angle')
Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(95)
Config.setCodec('h264')
Config.setCrf(14)
Config.setDelayRenderTimeoutInMilliseconds(600000)
