/** GPU render yeteneği: backend'in gerçek FFmpeg probe sonucunu sorgular. */
import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

export const capabilityKeys = {
  gpu: ["export", "gpu-capability"] as const,
}

export function useGpuCapability() {
  return useQuery({
    queryKey: capabilityKeys.gpu,
    queryFn: api.getExportCapabilities,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
