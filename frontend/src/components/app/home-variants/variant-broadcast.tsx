import { useState } from "react"
import {
  ClipboardPaste,
  FileVideo,
  Film,
  Play,
  Radio,
  Terminal,
  Tv,
  Video,
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

type DeckSlot = "twitch" | "youtube" | "local" | "curl"

export function VariantBroadcast() {
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

  const [activeSlot, setActiveSlot] = useState<DeckSlot>("twitch")
  const [curlOpen, setCurlOpen] = useState(false)

  const recentProjects = listProjectWorkspaces()

  return (
    <div
      data-slot="variant-broadcast"
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-950 font-mono text-neutral-200 select-none px-4 py-6 sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Üst Yayın Monitörü ve Durum Çubuğu (Broadcast Header) */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Tv className="size-4 text-rose-500 animate-pulse" />
            <span className="text-xs font-bold tracking-wider text-neutral-100 uppercase">
              MASTER BROADCAST DESK
            </span>
            <span className="rounded bg-rose-950/80 border border-rose-800 px-2 py-0.5 text-[9px] font-bold text-rose-400 uppercase">
              LIVE REMUX ONLINE
            </span>
          </div>

          <div className="flex items-center gap-4 text-[10px] text-neutral-400">
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500">VU METER:</span>
              <span className="font-mono text-emerald-400">||||||||||.. -6dB</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500">ENGINE:</span>
              <span className="text-neutral-200 font-bold">FFMPEG 7</span>
            </div>
          </div>
        </div>

        {/* 6 Büyük Donanım Tuşu (Macro Stream Deck Buttons) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* Tuş 1: Twitch / Kick */}
          <button
            type="button"
            onClick={() => setActiveSlot("twitch")}
            className={cn(
              "group flex flex-col justify-between rounded-2xl border p-4 text-left transition-all",
              activeSlot === "twitch"
                ? "border-rose-500 bg-rose-950/30 ring-1 ring-rose-500/40 shadow-lg"
                : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700 hover:bg-neutral-900",
            )}
          >
            <div className="flex items-center justify-between">
              <Radio className="size-5 text-rose-500" />
              <span className="size-2 rounded-full bg-rose-500 animate-ping" />
            </div>
            <div className="mt-4">
              <span className="block text-xs font-bold text-neutral-100 uppercase">
                TWITCH / KICK LIVE
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                Real-time HLS capture
              </span>
            </div>
          </button>

          {/* Tuş 2: YouTube / VOD */}
          <button
            type="button"
            onClick={() => setActiveSlot("youtube")}
            className={cn(
              "group flex flex-col justify-between rounded-2xl border p-4 text-left transition-all",
              activeSlot === "youtube"
                ? "border-red-500 bg-red-950/30 ring-1 ring-red-500/40 shadow-lg"
                : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700 hover:bg-neutral-900",
            )}
          >
            <div className="flex items-center justify-between">
              <Video className="size-5 text-red-500" />
              <span className="text-[10px] text-neutral-500">yt-dlp</span>
            </div>
            <div className="mt-4">
              <span className="block text-xs font-bold text-neutral-100 uppercase">
                YOUTUBE / SHORTS
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                Up to 4K 60fps
              </span>
            </div>
          </button>

          {/* Tuş 3: Yerel Dosya */}
          <button
            type="button"
            onClick={() => {
              setActiveSlot("local")
              void pickFile()
            }}
            className={cn(
              "group flex flex-col justify-between rounded-2xl border p-4 text-left transition-all",
              activeSlot === "local"
                ? "border-amber-500 bg-amber-950/30 ring-1 ring-amber-500/40 shadow-lg"
                : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700 hover:bg-neutral-900",
            )}
          >
            <div className="flex items-center justify-between">
              <FileVideo className="size-5 text-amber-500" />
              <span className="text-[10px] text-neutral-500">Direct</span>
            </div>
            <div className="mt-4">
              <span className="block text-xs font-bold text-neutral-100 uppercase">
                LOCAL DISK FILE
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                MP4 / MKV / MOV
              </span>
            </div>
          </button>

          {/* Tuş 4: Panodan Yapıştır */}
          <button
            type="button"
            onClick={() => void paste()}
            className="group flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 text-left transition-all hover:border-neutral-700 hover:bg-neutral-900"
          >
            <div className="flex items-center justify-between">
              <ClipboardPaste className="size-5 text-emerald-400" />
              <span className="text-[10px] text-neutral-500">Auto</span>
            </div>
            <div className="mt-4">
              <span className="block text-xs font-bold text-neutral-100 uppercase">
                PASTE CLIPBOARD
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                Click to load url
              </span>
            </div>
          </button>

          {/* Tuş 5: Örnek Klip */}
          <button
            type="button"
            onClick={() => void load(DEMO_URL)}
            className="group flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 text-left transition-all hover:border-neutral-700 hover:bg-neutral-900"
          >
            <div className="flex items-center justify-between">
              <Play className="size-5 text-sky-400 fill-current" />
              <span className="text-[10px] text-neutral-500">Test</span>
            </div>
            <div className="mt-4">
              <span className="block text-xs font-bold text-neutral-100 uppercase">
                SAMPLE REEL
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                Instant test video
              </span>
            </div>
          </button>

          {/* Tuş 6: cURL Başlıkları */}
          <button
            type="button"
            onClick={() => setCurlOpen(true)}
            className="group flex flex-col justify-between rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 text-left transition-all hover:border-neutral-700 hover:bg-neutral-900"
          >
            <div className="flex items-center justify-between">
              <Terminal className="size-5 text-purple-400" />
              <span className="text-[10px] text-neutral-500">HTTP</span>
            </div>
            <div className="mt-4">
              <span className="block text-xs font-bold text-neutral-100 uppercase">
                CUSTOM CURL
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                Cookies & Headers
              </span>
            </div>
          </button>
        </div>

        {/* Seçili Tuş Giriş Konsolu (Active Slot Terminal) */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/90 p-4 shadow-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void load()
            }}
            className="flex items-center gap-2"
          >
            <span className="text-xs text-rose-500 font-bold shrink-0">INGEST &gt;</span>
            <Input
              ref={inputRef}
              type="search"
              placeholder={
                activeSlot === "twitch"
                  ? "Enter Twitch/Kick URL or .m3u8 stream..."
                  : "Enter video link or paste from clipboard..."
              }
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="h-9 border-neutral-700 bg-neutral-950 text-xs font-mono text-neutral-100"
              disabled={resolving}
            />
            <Button
              type="submit"
              size="sm"
              className="h-9 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-4"
              disabled={!inputUrl.trim() || resolving}
            >
              EXECUTE
            </Button>
          </form>

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

        {/* Kayıtlı Yayınlar Listesi (Recent Broadcast Sessions) */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-neutral-400 font-bold uppercase">
            <span className="flex items-center gap-2">
              <Film className="size-3.5 text-rose-500" />
              SAVED BROADCAST ARCHIVE ({recentProjects.length})
            </span>
          </div>

          {recentProjects.length === 0 ? (
            <div className="py-6 text-center text-xs text-neutral-600">
              No previous recordings found. Select a deck button above to begin.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recentProjects.slice(0, 6).map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => window.location.assign(projectUrl(proj.id))}
                  role="button"
                  tabIndex={0}
                  className="group flex items-center justify-between rounded-xl border border-neutral-800/80 bg-neutral-950 p-3 transition-colors hover:border-neutral-700 hover:bg-neutral-900 cursor-pointer"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="block truncate text-xs font-semibold text-neutral-200 group-hover:text-white">
                      {proj.title || proj.source?.title || "Untitled Recording"}
                    </span>
                    <span className="block text-[10px] text-neutral-500">
                      {new Date(proj.updated_date).toLocaleDateString()} · {proj.source?.platform || "LIVE"}
                    </span>
                  </div>

                  <span className="text-[11px] font-bold text-rose-400 group-hover:underline">
                    LOAD &gt;
                  </span>
                </div>
              ))}
            </div>
          )}
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
