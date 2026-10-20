/** Yeni proje sekmesi dosyayı beklerken gösterilen tam ekran durum. */
import { AlertCircle, Clapperboard, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface IncomingProjectScreenProps {
  fileName: string | null
  error: string | null
}

function closeTab() {
  window.close()
  // Tarayıcı sekmeyi kapatmaya izin vermezse boş stüdyoya dön.
  window.location.replace("/")
}

export function IncomingProjectScreen({ fileName, error }: IncomingProjectScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 text-center shadow-2xl">
        {error ? (
          <>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold">Yeni proje hazırlanamadı</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
              {fileName && (
                <p className="truncate text-xs text-muted-foreground/80" title={fileName}>
                  {fileName}
                </p>
              )}
            </div>
            <Button className="w-full" onClick={closeTab}>
              Kapat
            </Button>
          </>
        ) : (
          <>
            <div className="relative mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Clapperboard className="size-6" />
              <Loader2 className="absolute -right-1 -bottom-1 size-5 animate-spin rounded-full bg-card" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold">Yeni proje hazırlanıyor</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {fileName ? (
                  <>
                    <span className="font-medium text-foreground">{fileName}</span> yeni sekmeye
                    aktarılıyor. Hazır olduğunda bu sekme kendiliğinden açılacak.
                  </>
                ) : (
                  "Dosya yeni sekmeye aktarılıyor. Hazır olduğunda bu sekme kendiliğinden açılacak."
                )}
              </p>
            </div>
            <div className="mx-auto h-1 w-44 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Mevcut projen diğer sekmede açık kalıyor. Aktarımı iptal etmek için oradaki
              bildirimi kullanabilirsin.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
