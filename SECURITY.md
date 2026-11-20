# Güvenlik

## Açık bildirme

Bir güvenlik açığı bulduysan lütfen herkese açık issue açma. GitHub'da özel bildirim kullan:
<https://github.com/10sinan/agentinan/security/advisories/new>

Bu sayfa açılmıyorsa, ayrıntı yazmadan "güvenlik bildirimi için iletişim" başlıklı bir issue aç; ben özel bir kanaldan dönerim.

Bildirimde şunlar işime yarar: etkilenen sürüm, adımlar, beklenen ve gerçekleşen sonuç. Tek kişilik bir proje; yanıt vermeye çalışırım ama süre sözü veremem.

Desteklenen sürüm: yalnızca en son sürüm.

## Güven modeli

Agentinan, kendi kullanıcının makinesinde yerel çalışır. Ağ üzerinden dinlemez, kendi sunucusu yoktur ve veri göndermez.

Okuduğu ve yazdığı şeyler:

- `~/.claude/sessions/*.json` ve `~/.claude/projects/**.jsonl`: Claude Code'un yazdığı dosyalar. Agentinan bunları **güvenilmeyen girdi** sayar: pid ve oturum kimlikleri doğrulanır, ekrana basılan her değer kaçışlanır.
- `~/.config/agentinan/`: kendi ayarları (`settings.json`) ve kapanışta kaydedilen oturum/terminal listesi.
- Kullanıcının isteğiyle: `claude` süreçleri ve kabuklar başlatır, git komutları çalıştırır, sohbet dosyasını yeniden adlandırır ya da siler.

## Alınan önlemler

- Electron'un güncel kararlı sürümü; `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- Pencere hiçbir adrese gitmez ve yeni pencere açamaz (`will-navigate`, `will-redirect`, `setWindowOpenHandler`).
- Ana işleme gelen her IPC çağrısı (`ipcMain.handle` ve `ipcMain.on`) tek bir yerde sarılır ve yalnızca yerel `renderer/index.html` sayfasının üst çerçevesinden kabul edilir (`src/ipc-guard.js`).
- `settings:set` yalnızca izin verilen anahtarları ve geçerli tür/aralıktaki değerleri kabul eder (`src/settings-schema.js`).
- `open-folder` yalnızca gerçek bir klasörü açar.
- Sohbet silme ve yeniden adlandırma: yol sembolik bağlar çözüldükten sonra `projects/` altında kalmalı ve `.jsonl` ile bitmelidir.
- Arayüzdeki HTML şablonlarında dışarıdan gelen her değer `esc()` ile kaçışlanır.
- Hata ayıklama kancaları (`AGENTINAN_SHOT`, `AGENTINAN_EVAL`) paketlenmiş uygulamada çalışmaz.

## Kapsam dışı / bilinen sınırlar

- Agentinan'ın içindeki terminaller ve `claude` oturumları kullanıcının kendi yetkisiyle çalışır; bunlar bir sandbox değildir.
- Aynı kullanıcı hesabında çalışan başka bir yerel süreç zaten aynı dosyalara erişebilir; Agentinan buna karşı koruma sağlamaz.
- RPM paketi `chrome-sandbox` dosyasını setuid olarak kurar (Electron'un Chromium sandbox'ı için gerekir).

## Sürüm doğrulama

`npm run dist` ya da `sh scripts/build-rpm.sh` çıktıların yanına `dist/SHA256SUMS` yazar. İndirdiğin dosyayı doğrulamak için:

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

Not: bu dosya paketle aynı yerden dağıtıldığı için yalnızca bozulmayı yakalar; imza değildir.
