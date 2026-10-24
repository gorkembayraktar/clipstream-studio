/** Tamamlanan dışa aktarma işini galerinin oynatma modalında açar. */
import { useEffect, useState } from "react"

import { GalleryPreviewDialog } from "@/components/app/gallery-preview-dialog"
import { useLibrary, useRevealInExplorer } from "@/hooks/use-library"
import type { ExportFile, ExportJob } from "@/lib/types"

interface JobPreviewDialogProps {
  job: ExportJob | null
  onClose: () => void
  onRestoreFocus: () => void
}

/** İş dosyası henüz galeri listesine düşmediyse modalın açılabilmesi için yedek kayıt. */
function fallbackFile(job: ExportJob): ExportFile | null {
  const name = job.output_filename
  if (!name) return null

  const modified = (job.created_at ?? Date.now() / 1000) + (job.elapsed_sec ?? 0)
  return {
    name,
    size_mb: job.size_mb ?? 0,
    modified,
    modified_str: new Date(modified * 1000).toLocaleString(),
    url: `/exports/${encodeURIComponent(name)}`,
  }
}

export function JobPreviewDialog({ job, onClose, onRestoreFocus }: JobPreviewDialogProps) {
  if (!job) return null
  return (
    <JobGalleryPreview
      job={job}
      onClose={onClose}
      onRestoreFocus={onRestoreFocus}
    />
  )
}

function JobGalleryPreview({
  job,
  onClose,
  onRestoreFocus,
}: {
  job: ExportJob
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const { data } = useLibrary()
  const reveal = useRevealInExplorer()
  const [activeName, setActiveName] = useState(job.output_filename ?? "")

  const fallback = fallbackFile(job)
  let files = data?.files ?? []

  // Galeri listesi yenilenene kadar iş çıktısını listenin başında göster.
  if (fallback && !files.some((file) => file.name === fallback.name)) {
    if (activeName === fallback.name) files = [fallback, ...files]
  }

  const index = files.findIndex((file) => file.name === activeName)
  const file = index >= 0 ? files[index] : null
  const total = files.length
  const previousName = index > 0 ? files[index - 1].name : null
  const nextName = index >= 0 && index < total - 1 ? files[index + 1].name : null

  // Açık dosya silinip listeden düştüyse modalı kapat.
  useEffect(() => {
    if (data && total > 0 && !file) onClose()
  }, [data, file, onClose, total])

  if (!file) return null

  return (
    <GalleryPreviewDialog
      file={file}
      files={files}
      position={index + 1}
      total={total}
      previousName={previousName}
      nextName={nextName}
      onNavigate={setActiveName}
      onClose={onClose}
      onDeleteSuccess={(name) => {
        if (name) setActiveName(name)
        else onClose()
      }}
      onReveal={(name) => reveal.mutate(name)}
      onRestoreFocus={onRestoreFocus}
    />
  )
}
