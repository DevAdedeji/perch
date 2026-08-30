import { PERCH_PRODUCTION_ORIGIN, isPerchProductionOrigin } from '@perch/shared'

export function useSiteUrl() {
  const configured = useRuntimeConfig().public.siteUrl
  const requestOrigin = useRequestURL().origin

  const url = computed(() => {
    try {
      return new URL(configured || requestOrigin).origin
    } catch {
      return PERCH_PRODUCTION_ORIGIN
    }
  })
  const indexable = computed(() => isPerchProductionOrigin(url.value))

  return { url, indexable }
}
