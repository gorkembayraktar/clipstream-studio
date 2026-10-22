<p align="center">
  <img src="docs/clipstream-studio-logo.svg" alt="ClipStream Studio" width="760">
</p>

<p align="center">
  Bilgisayarında çalışan video ve canlı yayın klipleyici.<br />
  Bağlantıyı yapıştır, istediğin bölümü kes, kırp ve dışa aktar.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-8b5cf6?style=flat-square" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Localhost-127.0.0.1-8b5cf6?style=flat-square" alt="Localhost">
  <img src="https://img.shields.io/badge/FFmpeg-required-15803d?style=flat-square&logo=ffmpeg&logoColor=white" alt="FFmpeg">
  <img src="https://img.shields.io/badge/yt--dlp-optional-111827?style=flat-square" alt="yt-dlp optional">
</p>

<p align="center">
  <a href="docs/demo.mp4">
    <img src="docs/demo.gif" alt="ClipStream Studio demo: Mux HLS akışını yükleme, aralık seçme, dışa aktarma ve galeride oynatma" width="860">
  </a>
</p>

<p align="center">
  <sub>Demo kaynağı: Mux HLS test akışı · <a href="docs/demo.mp4">MP4 olarak izle</a></sub>
</p>

---

## Desteklenen Kaynaklar

<table>
  <tr>
    <td align="center" width="64"><img src="docs/logos/youtube.svg" width="30" alt="YouTube logosu"></td>
    <td><strong>YouTube</strong><br><sub>Video ve kısa video bağlantıları; <code>yt-dlp</code> ile çözülür.</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/logos/x.svg" width="30" alt="X logosu"></td>
    <td><strong>X (Twitter)</strong><br><sub>Gönderi video bağlantıları; <code>yt-dlp</code> ile çözülür.</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/logos/instagram.svg" width="30" alt="Instagram logosu"></td>
    <td><strong>Instagram</strong><br><sub>Herkese açık gönderi ve reel bağlantıları; <code>yt-dlp</code> ile çözülür.</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/logos/hls.svg" width="30" alt="HLS Stream logosu"></td>
    <td><strong>m3u8 / HLS Stream</strong><br><sub>Master ve media playlist'ler; <code>.m3u8</code>, <code>.txt</code> ve uzantısız HLS adresleri. Mux, Cloudflare Stream, Bunny Stream gibi sağlayıcılar dahil.</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/logos/ffmpeg.svg" width="30" alt="FFmpeg logosu"></td>
    <td><strong>Doğrudan MP4 / WebM</strong><br><sub>HTTP(S) üzerinden erişilen video dosyaları.</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/logos/local-file.svg" width="30" alt="Yerel dosya logosu"></td>
    <td><strong>Yerel dosyalar</strong><br><sub>Gözat veya sürükle-bırak; MP4, WebM ve FFmpeg'in okuyabildiği diğer biçimler.</sub></td>
  </tr>
</table>

> YouTube, X ve Instagram için `yt-dlp` gerekir. HLS ve doğrudan dosya kaynakları `yt-dlp` olmadan çalışır.
>
> <sub>Marka logoları Simple Icons (CC0) üzerinden alınmıştır; HLS ve yerel dosya simgeleri bu proje için çizilmiştir.</sub>

## Özellikler

- **Kaynaklar:** YouTube, X, Instagram, HLS (`.m3u8` / `.txt` / uzantısız), doğrudan MP4/WebM ve yerel dosyalar.
- **Çoklu ses:** HLS master playlist'lerindeki alternatif ses rendition'ları önizlemede seçilebilir; seçim dışa aktarmaya da uygulanır.
- **Altyazı:** HLS WebVTT altyazıları önizlemede açılıp kapatılabilir ve dil seçilebilir. Altyazılar şimdilik yalnızca önizlemede gösterilir, çıktıya yakılmaz.
- **HLS hata tanılama:** 403, 404, 429, CORS/ağ, eksik segment ve desteklenmeyen codec hataları eyleme dönük mesajlarla bildirilir.
- **Kesme:** Zaman çizelgesinden giriş/çıkış; noktalar birbirini geçerse otomatik yer değiştirir.
- **Kırpma:** Video üzerinde sürükle-boyutlandır; 16:9, 9:16, 1:1, 4:5 ve serbest oranlar.
- **Dışa aktarma:** MP4 (hızlı/hassas), GIF ve MP3; canlı ilerleme, tahmini kalan süre ve iptal.
- **GPU render:** Uyumlu NVIDIA/Intel/AMD H.264 kodlayıcılarında isteğe bağlı GPU dışa aktarma; GPU yoksa veya hata verirse CPU'ya otomatik dönüş.
- **Galeri:** Klipleri modalda oynat, indir, klasörde göster veya sil.
- **Yerel dosyalar:** Gözat veya sürükle-bırak. Açık proje varken bırakılan video yeni sekmede açılır.
- **Korumalı bağlantılar:** `curl` komutunu yapıştırarak referer/cookie başlıkları ekle.
- **Dil:** İngilizce ve Türkçe arayüz; İngilizce varsayılan, Türkçe tarayıcılarda otomatik seçilir. Alt bilgideki dil seçiciyle sayfa yenilenmeden değiştirilir; API hata mesajları da seçilen dilde döner.
- **Kısayollar:** `Boşluk`, `I`/`O`, `←`/`→`, `M`, `F`, `P`.

## Hızlı Başlangıç

**Gereksinimler**

- Windows 10/11
- Python 3.10+
- FFmpeg (`ffmpeg` ve `ffprobe` PATH'te olmalı)
- Node.js 20+ — yalnızca arayüz ilk kez derlenecekse
- yt-dlp — YouTube, X ve Instagram için opsiyonel

**Çalıştırma**

```bat
pip install -r requirements.txt
baslat.bat
```

`baslat.bat` sunucuyu başlatır ve tarayıcıda `http://127.0.0.1:8765` adresini açar. Arayüz derlemesi yoksa gerekli npm paketlerini kurup derler.

YouTube, X ve Instagram kaynakları için `yt-dlp` gerekir: `pip install -U yt-dlp`.

Kapatmak için `durdur.bat` dosyasını çalıştır.

## Kullanım

1. **Kaynak:** Bağlantıyı yapıştır veya videoyu pencereye sürükle.
2. **Kes:** Zaman çizelgesinde giriş/çıkış noktalarını ayarla.
3. **Kırp (isteğe bağlı):** Kırpma anahtarını açıp videoda alan seç.
4. **Dışa Aktar:** Formatı ve kesim modunu seç; uyumlu MP4 dışa aktarmalarında **GPU ile render** anahtarını açabilirsin.
5. **Galeri:** Oluşan klibi ▶ düğmesiyle modalda izle.

Klipler `exports/` klasörüne kaydedilir. Sürükle-bırak ile eklenen geçici dosyalar `cache/uploads/` altında tutulur ve 7 gün sonra temizlenir.

Adres çubuğu `#project/?v=<sürüm>` biçimindedir; `v` değeri `frontend/package.json` sürümünden gelir ve uygulama açılışında güncellenir.

### GPU ile render

- Yalnızca **MP4** ve **hassas kesim** veya **kırpma** dışa aktarmalarında kullanılabilir; hızlı kopyalama yeniden kodlama yapmadığı için GPU'yu kullanamaz.
- FFmpeg derlemesinde `h264_nvenc` (NVIDIA), `h264_qsv` (Intel) veya `h264_amf` (AMD) bulunmalı; sürücü ve donanım çalışır olmalı.
- Uygulama kısa bir test kodlamasıyla gerçek yeteneği doğrular. Kodlayıcı yoksa anahtar kapalıdır ve nedeni panelde gösterilir.
- GPU sürücü/oturum hatası verirse iş otomatik olarak CPU ile yeniden denenir; sonuç kartında bilgi görünür.
- GPU çıktısı CPU ile birebir aynı değildir; kalite ve dosya boyutu farklı olabilir.

## Sorun Giderme

- **FFmpeg bulunamadı:** `ffmpeg` ve `ffprobe` PATH'te olmalı. Kurulumdan sonra terminali yeniden aç.
- **YouTube/X/Instagram açılmıyor:** `pip install -U yt-dlp` ile güncelle.
- **8765 portu kullanımda:** Çalışan sunucuyu `durdur.bat` ile kapat.
- **HLS oynamıyor:** 403, 404, 429, CORS/ağ, eksik segment ve codec hataları arayüzde nedeniyle birlikte gösterilir. 403 için **Gelişmiş bağlantı** ile `curl`/başlıkları ekle; CORS için kaynak panelindeki CORS proxy'yi aç. `.txt` ve uzantısız HLS adresleri de desteklenir; sunucu `.txt` içeriğinde `#EXTM3U` döndürüyorsa playlist olarak işlenir.
- **Altyazı görünmüyor:** HLS master playlist'inde `TYPE=SUBTITLES` rendition'ı olmalı. Altyazı kaynağı ayrı bir HTTP isteği gerektirdiğinden 403/CORS durumunda kaynak başlıklarını veya proxy'yi kullan.
- **Korumalı medya:** Kaynak panelindeki **Gelişmiş bağlantı** ile `curl` komutunu referer/cookie başlıklarıyla birlikte yapıştır.

## Geliştirme

```bat
scripts\dev.bat
```

Backend `http://127.0.0.1:8765`, arayüz `http://127.0.0.1:5173` adresinde çalışır. Üretim sunucusu açıksa önce `durdur.bat` ile kapat.

Arayüzü elle derlemek için:

```bat
cd frontend
npm run build
```

Backend komut ve GPU seçim testleri:

```bat
python -m unittest discover -s backend/tests -v
```

---

<p align="center">
  <sub>Yerel çalışır. Kliplerin bilgisayarından ayrılmaz.</sub>
</p>
