/** Pencere geneline bırakılan video dosyasını kaynak olarak içe aktarır.
 *
 * Tarayıcı, dosya pencerenin üzerine bırakıldığında varsayılan olarak dosyayı
 * açar (sekme dosyaya gider). Bu katman `dragover`/`drop` olaylarını yakalayıp
 * varsayılanı engeller ve dosyayı yükleme akışına verir.
 */
import { useEffect, useRef, useState } from "react"

import { UploadCloud } from "lucide-react"
import { toast } from "sonner"

import { useLocalImportStore } from "@/stores/local-import-store"
import { useStudioStore } from "@/stores/studio-store"

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes("Files")
}

export function FileDropZone() {
  const importFile = useLocalImportStore((s) => s.importFile)
  const importFileInNewTab = useLocalImportStore((s) => s.importFileInNewTab)
  const busy = useLocalImportStore((s) => s.busy)
  const progress = useLocalImportStore((s) => s.progress)
  const processing = useLocalImportStore((s) => s.processing)
  const fileName = useLocalImportStore((s) => s.fileName)
  const target = useLocalImportStore((s) => s.target)
  const hasSource = useStudioStore((s) => Boolean(s.streamUrl))
  const [active, setActive] = useState(false)
  /** dragenter/dragleave alt öğelerde de tetiklenir: sayaçla dengelenir. */
  const depthRef = useRef(0)

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depthRef.current += 1
      setActive(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setActive(false)
    }

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depthRef.current = 0
      setActive(false)

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return
      if (files.length > 1) {
        toast.info("Birden fazla dosya bırakıldı", {
          description: "İlk video kullanılıyor; diğerlerini tek tek ekleyin.",
        })
      }

      // Açık bir proje varsa üzerine yazma: dosya yeni bir sekmede proje olur.
      const sourceOpen = Boolean(useStudioStore.getState().streamUrl)
      void (sourceOpen ? importFileInNewTab(files[0]) : importFile(files[0]))
    }

    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)

    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
    }
  }, [importFile, importFileInNewTab])

  if (!active) return null

  const percent = Math.round((progress ?? 0) * 100)

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/60 bg-card/90 px-8 py-10 text-center shadow-2xl">
        <UploadCloud className="size-10 text-primary" />
        {busy ? (
          <>
            <p className="text-base font-semibold">
              {processing
                ? target === "new-tab"
                  ? "Yeni proje hazırlanıyor…"
                  : "Tarayıcıya hazırlanıyor…"
                : `${target === "new-tab" ? "Yeni projeye aktarılıyor" : "Yükleniyor"} %${percent}`}
            </p>
            <p className="max-w-full truncate text-xs text-muted-foreground">{fileName}</p>
            {target === "new-tab" && (
              <p className="text-[11px] text-muted-foreground/70">Mevcut projen korunuyor.</p>
            )}
          </>
        ) : (
          <>
            <p className="text-base font-semibold">Videoyu buraya bırak</p>
            <p className="text-xs text-muted-foreground">
              MP4, WebM, MOV, MKV, AVI… · geçici kopya oluşturulur; tarayıcının
              çalamadığı biçimler otomatik hazırlanır
            </p>
            <p className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground">
              {hasSource
                ? "Yeni sekmede proje açar · mevcut projen korunur"
                : "Mevcut projede açılır"}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
