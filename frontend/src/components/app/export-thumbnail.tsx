/** Galeri ve iş kartlarında kullanılan küçük, tembel yüklenen önizleme. */
import { useEffect, useState } from "react"

import { FileIcon } from "@/components/app/file-icon"
import { api } from "@/lib/api"
import { cn } from "cn"

interface ExportThumbnailProps {
  name: string
  /** Dosya sürümü: tarayıcı önbelleğini dosya değişince tazelemek için. */
  version?: string | number
  className?: string
  iconClassName?: string
}

export function ExportThumbnail({
  name,
  version,
  className,
  iconClassName,
}: ExportThumbnailProps) {
  const source = api.libraryThumbnailUrl(name, version)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [source])

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid place-items-center overflow-hidden bg-muted text-muted-foreground",
        className,
      )}
    >
      <FileIcon
        name={name}
        className={cn("size-4", iconClassName, loaded && !failed && "opacity-0")}
      />
      {!failed && (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-150",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </span>
  )
}
