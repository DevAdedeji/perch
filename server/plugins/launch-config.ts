import { assertProductionConfig } from '../../config/launch'

/** Refuse traffic when a deployed server has unsafe or incomplete core configuration. */
export default defineNitroPlugin(() => {
  if (import.meta.prerender || process.env.NODE_ENV !== 'production') return
  assertProductionConfig(process.env)
})
