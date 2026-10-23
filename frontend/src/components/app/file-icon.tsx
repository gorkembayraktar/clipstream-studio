/** Galeri listesi ve önizleme modalında ortak dosya türü simgesi. */
import { FilmIcon, ImageIcon, MusicIcon } from "lucide-react"

export function FileIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const extension = name.split(".").pop()?.toLowerCase()
  if (extension === "mp3") return <MusicIcon className={className} />
  if (extension === "gif") return <ImageIcon className={className} />
  return <FilmIcon className={className} />
}
