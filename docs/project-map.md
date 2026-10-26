# Project map

> `python scripts/project-map.py` ile üretilir; elle düzenlemeyin.
> Amacı: dosya adı bilinmeyen bir konuyu tek aramada bulmak.

## Nasıl kullanılır

1. Konuyu bu dosyada ara (ör. `dalga`, `waveform`, `export`).
2. Açıklaması uyan dosyayı doğrudan aç; tüm repoyu tarama.
3. Dosya adları dalga formu yerine görev adına göre konur (`waveform-layer`, `export-advanced-settings`).

## Backend (`backend/`)

### Giriş noktası ve yapılandırma

| Dosya       | Açıklama / semboller |
|-------------|------------------------|
| `app.py`    | ClipStream Studio — modüler backend giriş noktası. |
| `config.py` | Uygulama genel yapılandırması ve sabitler. |

### HTTP uçları (`backend/api/`)

| Dosya             | Açıklama / semboller |
|-------------------|------------------------|
| `__init__.py`     | — |
| `capabilities.py` | Dışa aktarma yetenekleri: GPU, H.265 ve kare hızı desteği. |
| `frames.py`       | Önizleme karesi uç noktası: videoyu ilerletmeden tek kare döner. |
| `jobs.py`         | Dışa aktarma işleri: oluşturma, durum sorgulama, iptal. |
| `library.py`      | Galeri uç noktaları: listeleme, silme, gezginde gösterme ve thumbnail. |
| `local.py`        | Yerel dosya uç noktaları: kopyasız seçim, yükleme ve oynatma. |
| `media.py`        | Medya uç noktaları: kaynak çözümleme, analiz ve CORS proxy'si. |
| `storyboard.py`   | Zaman çizelgesi storyboard uç noktaları. |
| `waveform.py`     | Dalga formu uç noktası: kaynağın ses tepe değerlerini (önbellekli) döner. |

### Çekirdek yardımcılar (`backend/core/`)

| Dosya         | Açıklama / semboller |
|---------------|------------------------|
| `__init__.py` | — |
| `i18n.py`     | İstek diline göre İngilizce/Türkçe kullanıcı mesajları. |
| `jobs.py`     | Arka planda çalışan dışa aktarma işlerinin merkezî yönetimi. |
| `timecode.py` | Zaman dönüşüm yardımcıları. |

### Servisler (`backend/services/`) — asıl iş mantığı

| Dosya                   | Açıklama / semboller |
|-------------------------|------------------------|
| `__init__.py`           | — |
| `codecs.py`             | FFmpeg CPU codec yeteneklerini (H.265/libx265) algılar. |
| `exporter.py`           | FFmpeg dışa aktarma işçisi: komutu kurar, çalıştırır ve ilerlemeyi raporlar. |
| `file_dialog.py`        | — |
| `frames.py`             | Hover önizlemesi için tek kare (JPEG) üretimi. |
| `gpu.py`                | GPU H.264 kodlayıcı yeteneği tespiti ve seçimi. |
| `header_store.py`       | Proxy için başlık belirteci (token) kaydı. |
| `hls.py`                | HLS master (çoklu varyantlı) playlist'lerden tek varyant seçimi. |
| `library.py`            | exports/ klasöründeki dosyaların listelenmesi, silinmesi ve gezginde açılması. |
| `local_media.py`        | Yerel dosya kaynakları: yükleme, kopyasız seçim ve yol eşleme. |
| `prober.py`             | ffprobe ile uzak medya analizi. |
| `proxy.py`              | CORS proxy'si: uzak yayınları tarayıcıya aktarır ve HLS playlist'lerini yeniden yazar. |
| `request_headers.py`    | Kullanıcı tanımlı HTTP başlıkları (curl yapıştırma). |
| `resolver.py`           | yt-dlp ile YouTube / X (Twitter) / Instagram bağlantılarını oynatılabilir akışa çözer. |
| `segment_downloader.py` | HLS medya playlist'ini paralel indirip yerel bir dosyada birleştirir. |
| `storyboard.py`         | Zaman çizelgesi storyboard'u: kaynak başına kademeli JPEG döşemeleri + JSON. |
| `subtitles.py`          | HLS WebVTT altyazılarını tek bir oynatılabilir WebVTT metnine dönüştürür. |
| `thumbnails.py`         | Galeri ve iş kartları için küçük, önbellekli thumbnail üretimi. |
| `waveform.py`           | Ses dalga formu (waveform) çıkarımı ve önbelleği. |

### Testler (`backend/tests/`)

| Dosya                        | Açıklama / semboller |
|------------------------------|------------------------|
| `test_exporter.py`           | Dışa aktarma komutu ve GPU kodlayıcı seçimi için birim testleri. |
| `test_hls_detection.py`      | Uzantısız HLS playlist'lerinin tespiti ve doğrudan kaynak çözümlemesi. |
| `test_library.py`            | Galeri metadata uç noktası: güvenli çözümleme, ffprobe ve önbellek. |
| `test_proxy.py`              | CORS proxy'sinin uzantısız/`.txt` HLS playlist'lerini ve sıkıştırılmış yanıtları aktarımı. |
| `test_resolver.py`           | TikTok URL/platform seçimi ve canlı akış tercihleri. |
| `test_segment_downloader.py` | Paralel HLS segment indiricisi: sıralı birleştirme ve geçici dosya temizliği. |
| `test_storyboard.py`         | Storyboard planı, önbellek anahtarı, komut ve temizlik testleri. |
| `test_subtitles.py`          | HLS WebVTT altyazılarının tek bir oynatılabilir metne dönüştürülmesi. |
| `test_waveform_parallel.py`  | Paralel waveform çıkarımı: kova hizalama ve tepe birleştirme testleri. |
| `test_waveform_stream.py`    | Kademeli waveform akışı: NDJSON olayları, önbellek ve sessiz kaynak. |

## Frontend (`frontend/src/`)

### Giriş dosyaları

| Dosya           | Açıklama / semboller |
|-----------------|------------------------|
| `App.tsx`       | App |
| `main.tsx`      | — |
| `vite-env.d.ts` | — |

### Uygulama bileşenleri (`components/app/`)

| Dosya                           | Açıklama / semboller |
|---------------------------------|------------------------|
| `crop-menu.tsx`                 | CropMenu |
| `crop-overlay.tsx`              | CropOverlay |
| `delete-file-dialog.tsx`        | DeleteFileDialog, DeleteFilesDialog |
| `export-action-bar.tsx`         | ExportActionBar |
| `export-advanced-settings.tsx`  | ExportAdvancedSettings |
| `export-controls.tsx`           | InfoHint, FieldLabel |
| `export-output-settings.tsx`    | ExportOutputSettings |
| `export-panel-constants.ts`     | FORMAT_LABELS, FORMAT_NOTE_KEYS, PROFILE_LABEL_KEYS, QUALITY_DESCRIPTION_KEYS, CODEC_LABEL_KEYS, CODEC_DESCRIPTION_KEYS, FRAME_RATE_SOURCE, FRAME_RATE_30 |
| `export-panel.tsx`              | ExportPanel |
| `export-summary.tsx`            | ExportSummary |
| `export-thumbnail.tsx`          | ExportThumbnail |
| `file-drop-zone.tsx`            | FileDropZone |
| `file-icon.tsx`                 | FileIcon |
| `gallery-preview-dialog.tsx`    | GalleryPreviewDialog |
| `gallery.tsx`                   | Gallery |
| `incoming-project-screen.tsx`   | IncomingProjectScreen |
| `job-preview-dialog.tsx`        | JobPreviewDialog |
| `job-progress.tsx`              | JobProgress |
| `jobs-dock.tsx`                 | JobsDock |
| `log-drawer.tsx`                | LogDrawer |
| `project-banner.tsx`            | ProjectBanner |
| `project-history.tsx`           | ProjectHistory |
| `project-loading-screen.tsx`    | ProjectLoadingScreen |
| `project-recovery-screen.tsx`   | ProjectRecoveryScreen |
| `project-workspace-context.tsx` | ProjectWorkspaceProvider, useProjectWorkspaceController |
| `settings-panel.tsx`            | SettingsPanel |
| `side-panel.tsx`                | SidePanel |
| `stage-controls.tsx`            | StageControls |
| `stream-status-badge.tsx`       | StreamStatusBadge |
| `timeline-toolbar.tsx`          | TimelineToolbar |
| `timeline.tsx`                  | Timeline |
| `trim-bar.tsx`                  | TrimBar |
| `url-source-bar.tsx`            | UrlSourceBar |
| `video-stage.tsx`               | VideoStage |
| `waveform-layer.tsx`            | WaveformLayer |

### UI temelleri (`components/ui/`)

| Dosya               | Açıklama / semboller |
|---------------------|------------------------|
| `alert-dialog.tsx`  | — |
| `badge.tsx`         | — |
| `button.tsx`        | — |
| `card.tsx`          | — |
| `checkbox.tsx`      | — |
| `dialog.tsx`        | — |
| `dropdown-menu.tsx` | — |
| `input.tsx`         | — |
| `label.tsx`         | — |
| `progress.tsx`      | — |
| `scroll-area.tsx`   | — |
| `select.tsx`        | — |
| `separator.tsx`     | — |
| `skeleton.tsx`      | — |
| `slider.tsx`        | — |
| `sonner.tsx`        | — |
| `switch.tsx`        | — |
| `tabs.tsx`          | — |
| `toggle-group.tsx`  | — |
| `toggle.tsx`        | — |
| `tooltip.tsx`       | — |

### Hook'lar (`hooks/`)

| Dosya                       | Açıklama / semboller |
|-----------------------------|------------------------|
| `use-export-job.ts`         | jobKeys, useStartExport, useJob, useJobs, useCancelJob |
| `use-export-title.ts`       | useExportTitle |
| `use-fullscreen.ts`         | getStageElement, toggleStageFullscreen, useFullscreen |
| `use-gpu-capability.ts`     | capabilityKeys, useGpuCapability |
| `use-hls-source.ts`         | useHlsSource |
| `use-incoming-project.ts`   | useIncomingProject |
| `use-keyboard-shortcuts.ts` | useKeyboardShortcuts |
| `use-library.ts`            | libraryKeys, useLibrary, useLibraryFileMeta, useDeleteLibraryFile, useDeleteLibraryFiles, useRevealInExplorer |
| `use-project-route.ts`      | useProjectRoute |
| `use-project-workspace.ts`  | useProjectWorkspace |
| `use-storyboard.ts`         | useStoryboard |
| `use-subtitles.ts`          | useSubtitleVtt |
| `use-waveform.ts`           | useWaveform |

### Yardımcılar (`lib/`)

| Dosya                   | Açıklama / semboller |
|-------------------------|------------------------|
| `api.ts`                | ApiError, api |
| `app-version.ts`        | APP_VERSION |
| `curl.ts`               | parseCurl |
| `format.ts`             | clamp, formatMegabytes, formatFrameRate, formatBytes, stripExtension, formatTime, formatClock, compactDuration |
| `keyboard-shortcuts.ts` | KEYBOARD_SHORTCUTS |
| `media.ts`              | isHlsUrl, proxiedUrl, withScheme, extractPastedUrl |
| `project-handoff.ts`    | projectKey, writeProjectHandoff, readProjectHandoff, removeProjectHandoff |
| `project-route.ts`      | projectParamFromUrl, isProjectId, readProjectIdFromUrl, projectHash, ensureProjectHash, setProjectInUrl, clearProjectFromUrl, projectUrl |
| `project-workspace.ts`  | PROJECT_SCHEMA_VERSION, PROJECT_STORAGE_PREFIX, createProjectId, projectStorageKey, readProjectWorkspace, writeProjectWorkspace, removeProjectWorkspace, listProjectWorkspaces |
| `types.ts`              | — |
| `utils.ts`              | — |

### Zustand store'ları (`stores/`)

| Dosya                   | Açıklama / semboller |
|-------------------------|------------------------|
| `edit-store.ts`         | MIN_TRIM_SECONDS, useEditStore |
| `export-store.ts`       | useExportStore |
| `local-import-store.ts` | useLocalImportStore |
| `log-store.ts`          | useLogStore, log |
| `player-store.ts`       | MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE, VOLUME_STEP, SEEK_BACK_SECONDS, SEEK_FORWARD_SECONDS, STEP_MODES, FALLBACK_FPS, getVideoElement |
| `preferences-store.ts`  | usePreferencesStore |
| `project-ui-store.ts`   | useProjectUiStore |
| `source-store.ts`       | useSourceStore |
| `theme-store.ts`        | useThemeStore |
| `timeline-store.ts`     | TIMELINE_ZOOM_LEVELS, MIN_TIMELINE_ZOOM, MAX_TIMELINE_ZOOM, useTimelineStore |

### Çeviriler (`i18n/`)

| Dosya      | Açıklama / semboller |
|------------|------------------------|
| `en.ts`    | en |
| `index.ts` | LOCALE_OPTIONS, useLocaleStore, translate, getLocale, useI18n |
| `tr.ts`    | tr |
