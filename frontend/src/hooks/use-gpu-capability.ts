/** GPU render yeteneği: backend'in gerçek FFmpeg probe sonucunu sorgular. */
import { useQuery } from "@tanstack/react-query"

import { useI18n } from "@/i18n"
import { api } from "@/lib/api"

export const capabilityKeys = {
  gpu: ["export", "gpu-capability"] as const,
}

export function useGpuCapability() {
  const { locale } = useI18n()
  return useQuery({
    // `reason` backend tarafından seçili dilde döndüğü için dil anahtara dahildir.
    queryKey: [...capabilityKeys.gpu, locale],
    queryFn: api.getExportCapabilities,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
