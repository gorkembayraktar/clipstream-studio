# Agent conventions

- The app version is `0.1.x` (currently `0.1.144`).
- For every development change, increment the last number by one.
- Keep these in sync:
  - `frontend/package.json`
  - `frontend/package-lock.json` (both root version entries)
  - the version badge in `README.md`

## Start here (fast lookup)

`docs/project-map.md` lists every backend module (with its first docstring line) and
every frontend file (with its exported symbols). Search that file before scanning the
repo: it turns "where is this?" into one grep.

- Regenerate after renaming/adding/removing source files: `python scripts/project-map.py`
- Check freshness (non-zero exit when stale): `python scripts/project-map.py --check`

## Routing table

| Task | Primary files |
| --- | --- |
| Export (FFmpeg, jobs, formats) | `backend/services/exporter.py`, `backend/api/jobs.py`, `backend/core/jobs.py`, `frontend/src/components/app/export-*.tsx` |
| Timeline (trim, cut, zoom, waveform layer) | `frontend/src/components/app/timeline.tsx`, `trim-bar.tsx`, `waveform-layer.tsx`, `frontend/src/stores/timeline-store.ts` |
| Player (HLS, proxy, fullscreen) | `frontend/src/components/app/video-stage.tsx`, `hooks/use-hls-source.ts`, `hooks/use-fullscreen.ts`, `backend/services/proxy.py` |
| Source/ingest (URL, curl, local files) | `frontend/src/components/app/url-source-bar.tsx`, `file-drop-zone.tsx`, `backend/services/resolver.py`, `local_media.py`, `request_headers.py` |
| Gallery / library | `frontend/src/components/app/gallery*.tsx`, `frontend/src/hooks/use-library.ts`, `backend/services/library.py` |
| Waveform | `backend/services/waveform.py`, `backend/api/waveform.py`, `frontend/src/hooks/use-waveform.ts` |
| Storyboard / hover preview | `backend/services/storyboard.py`, `backend/api/storyboard.py`, `frontend/src/hooks/use-storyboard.ts` |
| Subtitles | `backend/services/subtitles.py`, `frontend/src/hooks/use-subtitles.ts` |
| Settings / theme / i18n | `frontend/src/components/app/settings-panel.tsx`, `stores/theme-store.ts`, `stores/preferences-store.ts`, `frontend/src/i18n/{en,tr}.ts` |
| API contract and types | `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts` |

## Search habits

- Search with a stable noun from the UI label or the wire format, not with prose:
  `waveform`, `partial`, `skipped`, `format`, `crf`.
- Backend user-facing messages go through `backend/core/i18n.py`; frontend strings go
  through `frontend/src/i18n`. A new string needs both `en.ts` and `tr.ts` keys.
- Tests live in `backend/tests/`; add a case there when touching a service's contract.
