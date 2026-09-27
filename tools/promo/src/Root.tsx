import { Composition } from 'remotion'
import { DURATION, Promo } from './Promo'

// sub — подкадров на кадр 60 fps: 4 для финального рендера с motion blur (ffmpeg tmix), 1 для предпросмотра
export function Root() {
  return (
    <Composition id="Promo" component={Promo} fps={60} width={1920} height={1080} durationInFrames={DURATION} defaultProps={{ sub: 1 }}
      calculateMetadata={({ props }) => ({ fps: 60 * props.sub, durationInFrames: DURATION * props.sub })} />
  )
}
