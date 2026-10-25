/** Galeri sekmesi: exports/ klasöründeki klipleri listeler, oynatır, indirir, siler. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react"

import {
  DownloadIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { cn } from "cn"

import { DeleteFileDialog, DeleteFilesDialog } from "@/components/app/delete-file-dialog"
import { ExportThumbnail } from "@/components/app/export-thumbnail"
import { GalleryPreviewDialog } from "@/components/app/gallery-preview-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDeleteLibraryFile,
  useDeleteLibraryFiles,
  useLibrary,
  useRevealInExplorer,
} from "@/hooks/use-library"
import { useI18n } from "@/i18n"
import { formatBytes, formatMegabytes } from "@/lib/format"
import type { ExportFile } from "@/lib/types"
import { usePlayerStore } from "@/stores/player-store"

const EMPTY_FILES: ExportFile[] = []

export function Gallery() {
  const { t } = useI18n()
  const { data, isLoading, isFetching, refetch } = useLibrary()
  const deleteFile = useDeleteLibraryFile()
  const deleteFiles = useDeleteLibraryFiles()
  const reveal = useRevealInExplorer()
  const [previewName, setPreviewName] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmFiles, setConfirmFiles] = useState<ExportFile[]>([])
  const refreshButtonRef = useRef<HTMLButtonElement>(null)
  const selectButtonRef = useRef<HTMLButtonElement>(null)
  const bulkDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const previewTriggerRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selectedRef = useRef<Set<string>>(new Set())
  const anchorNameRef = useRef<string | null>(null)
  const rangeBaseRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)

  const hasLibraryData = data !== undefined
  const files = data?.files ?? EMPTY_FILES
  const isRefreshing = refreshing || isFetching
  const pending = deleteFiles.isPending
  const selectedFiles = files.filter((file) => selected.has(file.name))
  const selectedCount = selectedFiles.length
  const selectedSizeMb = selectedFiles.reduce(
    (total, file) => total + file.size_mb,
    0,
  )
  const selectedSize = formatBytes(selectedSizeMb * 1024 * 1024)
  const allSelected = files.length > 0 && selectedCount === files.length
  const someSelected = selectedCount > 0 && !allSelected

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const commitSelection = useCallback((next: Set<string>) => {
    selectedRef.current = next
    setSelected(next)
  }, [])

  const exitSelectionMode = useCallback(
    (focus: "select" | "refresh" = "select") => {
      setSelectionMode(false)
      setConfirmOpen(false)
      setConfirmFiles([])
      commitSelection(new Set())
      anchorNameRef.current = null
      rangeBaseRef.current = new Set()

      window.requestAnimationFrame(() => {
        if (focus === "refresh") {
          refreshButtonRef.current?.focus({ preventScroll: true })
          return
        }
        const target = selectButtonRef.current ?? refreshButtonRef.current
        target?.focus({ preventScroll: true })
      })
    },
    [commitSelection],
  )

  // Seçim dosya adıyla tutulur: yenileme/silme sonrası nesne referansı
  // eskise bile sıra güncel listeden yeniden hesaplanır.
  const previewIndex = previewName
    ? files.findIndex((file) => file.name === previewName)
    : -1
  const previewFile = previewIndex >= 0 ? files[previewIndex] : null
  const previousName = previewIndex > 0 ? files[previewIndex - 1].name : null
  const nextName =
    previewIndex >= 0 && previewIndex < files.length - 1
      ? files[previewIndex + 1].name
      : null

  // Liste her yenilendiğinde seçimi güncel adlarla buda. Yeni dosyalar
  // kendiliğinden seçili olmaz; kaybolan adlar seçimden çıkar.
  useEffect(() => {
    // Yenileme sırasında veri kısa süreliğine boş görünebilir; seçimi koru.
    if (!hasLibraryData) return
    const names = new Set(files.map((file) => file.name))
    setSelected((previous) => {
      if (previous.size === 0) return previous
      let changed = false
      const next = new Set<string>()
      for (const name of previous) {
        if (names.has(name)) next.add(name)
        else changed = true
      }
      if (!changed) return previous
      selectedRef.current = next
      return next
    })

    if (rangeBaseRef.current.size > 0) {
      let baseChanged = false
      const nextBase = new Set<string>()
      for (const name of rangeBaseRef.current) {
        if (names.has(name)) nextBase.add(name)
        else baseChanged = true
      }
      if (baseChanged) rangeBaseRef.current = nextBase
    }

    if (anchorNameRef.current && !names.has(anchorNameRef.current)) {
      anchorNameRef.current = null
      rangeBaseRef.current = new Set()
    }
  }, [files, hasLibraryData])

  // Kütüphane boşaldığında seçim modu kendiliğinden kapanır. Yükleme
  // sırasında verinin geçici olarak boş görünmesi seçim modunu kapatmaz.
  useEffect(() => {
    if (!hasLibraryData || files.length > 0 || !selectionMode || pending) return
    exitSelectionMode("refresh")
  }, [hasLibraryData, files.length, selectionMode, pending, exitSelectionMode])

  // Seçim moduna girince ilk satırın onay kutusuna odaklan.
  useEffect(() => {
    if (!selectionMode) return
    const frame = window.requestAnimationFrame(() => {
      const firstCheckbox =
        listRef.current?.querySelector<HTMLButtonElement>(
          '[data-slot="checkbox"]',
        )
      firstCheckbox?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectionMode])

  const handleRefresh = async () => {
    setRefreshing(true)
    const started = performance.now()
    try {
      await refetch()
    } finally {
      // Kısa süren yenilemelerde animasyon anında kaybolmasın.
      const remaining = 500 - (performance.now() - started)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
      setRefreshing(false)
    }
  }

  // Galeri önizlemesi açılırken ana oynatıcıyı durdur: iki sesin üst üste
  // çalmasını engeller. Kullanıcı modalı kapattığında oynatmayı kendisi sürdürür.
  const openPreview = (file: ExportFile, trigger: HTMLElement) => {
    if (selectionMode) return
    usePlayerStore.getState().pause()
    previewTriggerRef.current = trigger
    setPreviewName(file.name)
  }

  /** Modal kapanınca açan satıra/düğmeye, o artık yoksa yenile düğmesine dön. */
  const restorePreviewFocus = () => {
    const trigger = previewTriggerRef.current
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true })
      return
    }
    refreshButtonRef.current?.focus({ preventScroll: true })
  }

  const closePreview = () => {
    setPreviewName(null)
    // Radix içerik hemen söküldüğünde odak body'ye düşebiliyor; bir kare
    // sonra odağı açan öğeye geri ver.
    window.requestAnimationFrame(() => restorePreviewFocus())
  }

  const enterSelectionMode = () => {
    if (selectionMode || pending) return
    if (previewName) closePreview()
    commitSelection(new Set())
    anchorNameRef.current = null
    rangeBaseRef.current = new Set()
    setSelectionMode(true)
  }

  const selectAll = () => {
    if (pending) return
    const next = new Set(files.map((file) => file.name))
    commitSelection(next)
    anchorNameRef.current = null
    rangeBaseRef.current = next
  }

  const clearSelection = () => {
    if (pending) return
    const next = new Set<string>()
    commitSelection(next)
    anchorNameRef.current = null
    rangeBaseRef.current = next
  }

  const toggleSelection = (name: string, event: MouseEvent) => {
    if (!selectionMode || pending || event.detail > 1) return

    const anchor = anchorNameRef.current
    if (event.shiftKey && anchor && anchor !== name) {
      const anchorIndex = files.findIndex((file) => file.name === anchor)
      const targetIndex = files.findIndex((file) => file.name === name)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        const next = new Set(rangeBaseRef.current)
        for (let index = start; index <= end; index += 1) {
          next.add(files[index].name)
        }
        commitSelection(next)
        return
      }
    }

    const next = new Set(selectedRef.current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    commitSelection(next)
    anchorNameRef.current = name
    rangeBaseRef.current = next
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selectionMode || confirmOpen || pending) return

    const target = event.target as HTMLElement | null
    if (
      target?.closest(
        "input, textarea, select, [contenteditable='true'], [role='dialog']",
      )
    ) {
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault()
      selectAll()
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      exitSelectionMode("select")
    }
  }

  const requestDeleteSelected = () => {
    if (pending || selectedFiles.length === 0) return
    setConfirmFiles(selectedFiles)
    setConfirmOpen(true)
  }

  const handleConfirmOpenChange = (open: boolean) => {
    if (open) {
      setConfirmOpen(true)
      return
    }
    if (pending) return
    setConfirmOpen(false)
    setConfirmFiles([])
    window.requestAnimationFrame(() => {
      bulkDeleteButtonRef.current?.focus({ preventScroll: true })
    })
  }

  const confirmDeleteSelected = () => {
    if (pending) return
    const names = confirmFiles.map((file) => file.name)
    if (names.length === 0) {
      setConfirmOpen(false)
      return
    }

    deleteFiles.mutate(names, {
      onSuccess: (result) => {
        if (!mountedRef.current) return

        if (result.failed.length === 0) {
          exitSelectionMode("select")
          return
        }

        setConfirmOpen(false)
        setConfirmFiles([])
        const failedNames = new Set(
          result.failed.map((failure) => failure.name),
        )
        commitSelection(failedNames)
        anchorNameRef.current = result.failed[0]?.name ?? null
        rangeBaseRef.current = new Set(failedNames)
        window.requestAnimationFrame(() => {
          bulkDeleteButtonRef.current?.focus({ preventScroll: true })
        })
      },
      onError: () => {
        if (!mountedRef.current) return
        setConfirmOpen(false)
        setConfirmFiles([])
        window.requestAnimationFrame(() => {
          bulkDeleteButtonRef.current?.focus({ preventScroll: true })
        })
      },
    })
  }

  return (
    <div className="space-y-3" onKeyDown={handleKeyDown}>
      {selectionMode ? (
        <div
          role="toolbar"
          aria-label={t("gallery.selectionToolbar")}
          className="sticky top-0 z-10 flex h-8 items-center gap-1.5 bg-background/95 backdrop-blur-sm"
        >
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={() => {
              if (allSelected) clearSelection()
              else selectAll()
            }}
            disabled={pending}
            aria-label={t("gallery.selectAll")}
            title={t("gallery.selectAll")}
            className="shrink-0"
          />

          <span
            aria-live="polite"
            aria-atomic="true"
            className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          >
            {t("gallery.selectedSummary", {
              count: selectedCount,
              size: selectedSize,
            })}
          </span>

          {selectedCount > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 shrink-0 px-1.5 text-[11px] font-normal text-muted-foreground"
              onClick={clearSelection}
              disabled={pending}
            >
              {t("gallery.clearSelection")}
            </Button>
          )}

          <Button
            ref={refreshButtonRef}
            variant="ghost"
            size="icon-xs"
            className="shrink-0 cursor-pointer"
            onClick={() => void handleRefresh()}
            title={t("gallery.refresh")}
            aria-label={t("gallery.refresh")}
            aria-busy={isRefreshing}
            disabled={isRefreshing || pending}
          >
            <RefreshCwIcon className={isRefreshing ? "animate-spin" : undefined} />
          </Button>

          <Button
            ref={bulkDeleteButtonRef}
            variant="destructive"
            size="xs"
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
            onClick={requestDeleteSelected}
            disabled={selectedCount === 0 || pending}
            aria-busy={pending}
            title={t("gallery.deleteSelected")}
            aria-label={t("gallery.deleteSelected")}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <Trash2Icon />
            )}
            <span className="hidden sm:inline">{t("gallery.deleteSelected")}</span>
          </Button>

          <Button
            variant="ghost"
            size="xs"
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px] font-normal"
            onClick={() => exitSelectionMode("select")}
            disabled={pending}
            title={t("gallery.exitSelection")}
            aria-label={t("gallery.exitSelection")}
          >
            <XIcon />
            <span className="hidden sm:inline">{t("gallery.exitSelection")}</span>
          </Button>
        </div>
      ) : (
        <div className="flex h-8 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {t("gallery.count", { count: files.length })}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            {files.length > 0 && (
              <Button
                ref={selectButtonRef}
                variant="ghost"
                size="xs"
                className="h-6 cursor-pointer gap-1 px-1.5 text-[11px] font-normal text-muted-foreground"
                onClick={enterSelectionMode}
                title={t("gallery.select")}
                aria-label={t("gallery.select")}
              >
                <ListChecksIcon />
                <span className="hidden sm:inline">{t("gallery.select")}</span>
              </Button>
            )}
            <Button
              ref={refreshButtonRef}
              variant="ghost"
              size="icon-xs"
              className="cursor-pointer"
              onClick={() => void handleRefresh()}
              title={t("gallery.refresh")}
              aria-label={t("gallery.refresh")}
              aria-busy={isRefreshing}
              disabled={isRefreshing}
            >
              <RefreshCwIcon
                className={isRefreshing ? "animate-spin" : undefined}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="cursor-pointer"
              onClick={() => reveal.mutate(undefined)}
              title={t("gallery.openFolder")}
              aria-label={t("gallery.openFolder")}
            >
              <FolderOpenIcon />
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-13 w-full" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("gallery.empty")}
        </p>
      ) : (
        <ScrollArea className="h-[360px]">
          <ul ref={listRef} aria-label={t("gallery.files")} className="space-y-1.5 pr-2">
            {files.map((file) => (
              <GalleryItem
                key={file.name}
                file={file}
                selectionMode={selectionMode}
                selected={selected.has(file.name)}
                disabled={pending}
                onPreview={(trigger) => openPreview(file, trigger)}
                onToggle={(event) => toggleSelection(file.name, event)}
                onDelete={() => deleteFile.mutate(file.name)}
                onReveal={() => reveal.mutate(file.name)}
                deleting={deleteFile.isPending && deleteFile.variables === file.name}
              />
            ))}
          </ul>
        </ScrollArea>
      )}

      <GalleryPreviewDialog
        file={previewFile}
        files={files}
        position={previewIndex + 1}
        total={files.length}
        previousName={previousName}
        nextName={nextName}
        onNavigate={setPreviewName}
        onClose={closePreview}
        onDeleteSuccess={(name) => {
          if (name) setPreviewName(name)
          else closePreview()
        }}
        onReveal={(name) => reveal.mutate(name)}
        onRestoreFocus={restorePreviewFocus}
      />

      <DeleteFilesDialog
        open={confirmOpen}
        files={confirmFiles}
        pending={pending}
        onOpenChange={handleConfirmOpenChange}
        onConfirm={confirmDeleteSelected}
      />
    </div>
  )
}

interface GalleryItemProps {
  file: ExportFile
  selectionMode: boolean
  selected: boolean
  disabled: boolean
  onPreview: (trigger: HTMLElement) => void
  onToggle: (event: MouseEvent) => void
  onDelete: () => void
  onReveal: () => void
  deleting: boolean
}

function GalleryItem({
  file,
  selectionMode,
  selected,
  disabled,
  onPreview,
  onToggle,
  onDelete,
  onReveal,
  deleting,
}: GalleryItemProps) {
  const { t } = useI18n()
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    if (selectionMode) setDeleteOpen(false)
  }, [selectionMode])

  /** Satıra çift tıklama, düğmelere dokunmadan klibi önizlemede açar. */
  const handleDoubleClick = (event: MouseEvent<HTMLLIElement>) => {
    if (selectionMode) return
    if ((event.target as HTMLElement).closest("button, a")) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    onPreview(event.currentTarget)
  }

  const handleRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if (!selectionMode) return
    onToggle(event)
  }

  const handleCheckboxClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle(event)
  }

  return (
    <li
      tabIndex={-1}
      className={cn(
        "group flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 ring-1 ring-transparent transition-all duration-150 outline-none hover:bg-muted/70 hover:shadow-sm hover:ring-border/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/80",
        selectionMode && "cursor-pointer select-none",
        selectionMode &&
          selected &&
          "bg-primary/10 ring-primary/30 hover:bg-primary/15 hover:ring-primary/40",
        disabled && "opacity-60",
      )}
      onClick={handleRowClick}
      onDoubleClick={handleDoubleClick}
    >
      {selectionMode && (
        <Checkbox
          checked={selected}
          disabled={disabled}
          onClick={handleCheckboxClick}
          aria-label={file.name}
          title={file.name}
          className="shrink-0"
        />
      )}

      <ExportThumbnail
        name={file.name}
        version={file.modified}
        className="h-9 w-16 shrink-0 rounded-md ring-1 ring-border/40"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px]">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatMegabytes(file.size_mb)} · {file.modified_str}
        </p>
      </div>

      {!selectionMode && (
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer"
            onClick={(event) => onPreview(event.currentTarget)}
            title={t("gallery.preview")}
          >
            <PlayIcon />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="cursor-pointer"
                title={t("gallery.actions")}
                aria-label={t("gallery.actions")}
              >
                <EllipsisVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem asChild>
                <a href={file.url} download>
                  <DownloadIcon />
                  {t("gallery.download")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onReveal}>
                <FolderOpenIcon />
                {t("gallery.reveal")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={deleting}
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
                {t("gallery.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <DeleteFileDialog
        open={deleteOpen}
        fileName={file.name}
        pending={deleting}
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
      />
    </li>
  )
}
