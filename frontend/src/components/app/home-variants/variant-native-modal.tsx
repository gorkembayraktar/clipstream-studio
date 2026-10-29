import { useState } from "react"
import {
  ClipboardPaste,
  Clock,
  FileVideo,
  Globe,
  Loader2,
  Play,
  Terminal,
  Upload,
} from "lucide-react"

import { SourceCurlDialog } from "@/components/app/source-panels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectUrl } from "@/lib/project-route"
import { listProjectWorkspaces } from "@/lib/project-workspace"
import { useSourceResolve, DEMO_URL } from "@/hooks/use-source-resolve"
import { useLocalImportStore } from "@/stores/local-import-store"
import { cn } from "cn"

import { ResolveStatusView } from "./shared"

type ModalTab = "url" | "file" | "recents"

export function VariantNativeModal() {
  const pickFile = useLocalImportStore((s) => s.pickFile)

  const {
    inputUrl,
    setInputUrl,
    inputRef,
    resolving,
    progress,
    stage,
    detail,
    load,
    cancel,
    paste,
  } = useSourceResolve()

  const [activeTab, setActiveTab] = useState<ModalTab>("url")
  const [curlOpen, setCurlOpen] = useState(false)

  const recentProjects = listProjectWorkspaces()

  return (
    <div
      data-slot="variant-native-modal"
      className="flex h-full min-h-0 flex-1 items-center justify-center bg-neutral-900/40 p-4"
    >
      {/* Yerel Masaüstü Karşılama Penceresi (Native Window Frame) */}
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700/80 bg-card shadow-2xl backdrop-blur-xl">
        {/* Pencere Başlık Çubuğu (Window Titlebar) */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 bg-muted/40 px-4">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red-500/80" />
            <span className="size-2.5 rounded-full bg-amber-500/80" />
            <span className="size-2.5 rounded-full bg-emerald-500/80" />
          </div>

          <span className="text-xs font-semibold text-foreground">
            ClipStream Studio — Welcome
          </span>

          <span className="text-[10px] font-mono text-muted-foreground">0.2.13</span>
        </div>

        {/* Sekmeli Mod Seçici (Segmented Control) */}
        <div className="border-b border-border/60 bg-muted/20 p-2">
          <div className="flex items-center rounded-lg bg-muted/60 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("url")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-all",
                activeTab === "url"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Globe className="size-3.5" />
              <span>Web Stream</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("file")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-all",
                activeTab === "file"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileVideo className="size-3.5" />
              <span>Local Video</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("recents")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-all",
                activeTab === "recents"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Clock className="size-3.5" />
              <span>Recent ({recentProjects.length})</span>
            </button>
          </div>
        </div>

        {/* Gövde İçeriği */}
        <div className="p-6">
          {/* SEKME 1: Web URL */}
          {activeTab === "url" && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                Enter a YouTube, Twitch, TikTok, Kick, or HLS stream URL to begin:
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void load()
                }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    autoFocus
                    type="search"
                    className="h-10 text-xs sm:text-sm font-medium"
                    placeholder="https://... video or stream link"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    disabled={resolving}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 text-xs shrink-0"
                    onClick={() => void paste()}
                    disabled={resolving}
                  >
                    <ClipboardPaste className="size-3.5 mr-1" />
                    Paste
                  </Button>
                </div>

                <Button
                  type="submit"
                  className="w-full h-10 text-xs font-semibold"
                  disabled={!inputUrl.trim() || resolving}
                >
                  {resolving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      <span>Resolving Stream...</span>
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5 fill-current mr-1.5" />
                      <span>Open in Studio</span>
                    </>
                  )}
                </Button>
              </form>
            </div>
          )}

          {/* SEKME 2: Yerel Dosya */}
          {activeTab === "file" && (
            <div
              onClick={() => void pickFile()}
              role="button"
              tabIndex={0}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 p-8 text-center transition-all hover:border-primary hover:bg-primary/5"
            >
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
                <Upload className="size-6" />
              </div>
              <span className="text-xs font-semibold text-foreground">
                Click to browse local video
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5">
                MP4, MKV, MOV, WebM, AVI (Lossless remux)
              </span>
              <Button type="button" size="sm" variant="secondary" className="mt-4 text-xs">
                Select File
              </Button>
            </div>
          )}

          {/* SEKME 3: Son Oturumlar */}
          {activeTab === "recents" && (
            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {recentProjects.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No saved workspaces found.
                </div>
              ) : (
                recentProjects.slice(0, 6).map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => window.location.assign(projectUrl(proj.id))}
                    role="button"
                    tabIndex={0}
                    className="flex items-center justify-between rounded-lg border border-border/60 p-2.5 text-xs transition-colors hover:bg-accent cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="block truncate font-medium text-foreground">
                        {proj.title || proj.source?.title || "Untitled Project"}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {new Date(proj.updated_date).toLocaleDateString()}
                      </span>
                    </div>

                    <Button type="button" size="sm" className="h-6 text-[10px] px-2.5">
                      Open
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* İlerleme Paneli */}
          <div className="mt-3">
            <ResolveStatusView
              resolving={resolving}
              progress={progress}
              stage={stage}
              detail={detail}
              onCancel={cancel}
              hasInputUrl={Boolean(inputUrl)}
            />
          </div>
        </div>

        {/* Pencere Alt Bilgi Çubuğu (Dialog Footer) */}
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-border/60 bg-muted/30 px-4 text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={() => void load(DEMO_URL)}
            className="hover:text-foreground text-primary"
            disabled={resolving}
          >
            Load Sample Video
          </button>

          <button
            type="button"
            onClick={() => setCurlOpen(true)}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Terminal className="size-3" />
            <span>cURL Ingest</span>
          </button>
        </div>
      </div>

      <SourceCurlDialog
        open={curlOpen}
        onOpenChange={setCurlOpen}
        disabled={resolving}
        onSubmit={(url, headers) => {
          setInputUrl(url)
          void load(url, headers)
        }}
      />
    </div>
  )
}
