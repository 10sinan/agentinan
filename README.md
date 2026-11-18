# Agentinan

**Linux** için küçük bir Claude Code panosu. Çalışan her Claude Code oturumunu bir yörünge haritasında gösterir.
Bir oturum onay ya da cevap beklediğinde, ya da işini bitirdiğinde masaüstü bildirimi gönderir.
[Orbiterm](https://github.com/atalaykarahan/orbiterm) fikrinden esinlenildi, ama kod sıfırdan yazıldı.

Arayüz dört sekmeden oluşur: **Harita**, **Oturumlar**, **Terminal** ve **Ayarlar**. 3D harita hep arka planda durur; diğer sekmeler onun üstünde cam görünümlü paneller olarak açılır.

- **Yörünge haritası:** Ortadaki güneş sizsiniz, her oturum bir gezegen.
  - Turuncu: çalışıyor (arkasında kuyruk izi bırakır).
  - Kırmızı ve nabız gibi atan: sizi bekliyor.
  - Mavi: boşta.
  - Etrafında dönen aylar: çalışan alt ajanlar.
  - Gezegenden uçuşan yazılar: o anda yapılan araç çağrıları.
- **Oturum listesi:** Son isteğiniz, son araç çağrıları, token, tahmini maliyet, bağlam doluluğu ve alt ajanlar.
  Bir karta tıklarsanız Claude'un son cevabı açılır. Oradan klasörü açabilir ya da `claude --resume` komutunu kopyalayabilirsiniz.
- **Bugünün toplamı:** Kapanmış oturumlar da dahil, model bazında token ve maliyet.
- **Komut verme:** Üst çubuktaki **Yeni oturum** ile bir klasörde Claude başlatırsınız. **Terminal** sekmesinde o oturumun terminali ve bir komut kutusu açılır; haritada bu oturumlar `›_` işaretiyle görünür. Oradan Claude'a yazabilir, onay sorularını **✓ Onayla** ya da **✕ Reddet / Durdur** ile cevaplayabilirsiniz.
  Bu oturumlar Claude Code'un arka plan oturumlarıdır (`claude --bg`). Agentinan kapansa da çalışmaya devam ederler ve tekrar açınca yeniden bağlanılır.
  Daha önce hiç onaylanmamış bir klasör seçerseniz Claude'un "bu klasöre güveniyor musun" sorusu terminalde çıkar. Böyle bir oturum Agentinan kapanınca kapanır.
  VS Code'da ya da başka bir terminalde açılan oturumlar sadece izlenir; onlara dışarıdan komut gönderilemez.
- **Bildirimler:** "Seni beklediğinde bildir" ve "Bitirdiğinde bildir" ayarları **Ayarlar** sekmesinde. "Bitti" bildirimi, pencere öndeyken gönderilmez.

## Gereksinimler

- **Linux** (Fedora 44 üzerinde, GNOME ve Wayland ile denendi; diğer dağıtımlarda da çalışması beklenir)
- Node.js 20 veya üstü
- [Claude Code](https://code.claude.com) kurulu ve hesabınızla giriş yapılmış olmalı (Pro, Max ya da API anahtarı)

## Çalıştırma

```sh
npm install
npm start
./install-desktop.sh   # isteğe bağlı: uygulamalar menüsüne ekler
```

`node scripts/check.js` Electron açmadan tek bir anlık görüntü yazdırır. Veri okumayı test etmek için kullanılır.

## Nasıl çalışır

Uygulama yalnızca `~/.claude` altındaki dosyaları okur (`CLAUDE_CONFIG_DIR` ayarlıysa oradakileri).
Hiçbir şeye yazmaz, ağa da bağlanmaz.

- `sessions/<pid>.json`: Çalışan her Claude Code süreci için bir dosya. Klasörü ve durumu (`busy` / `idle` / `waiting`) tutar.
  Süreç gerçekten çalışıyor mu diye `/proc/<pid>/stat` dosyasındaki başlangıç zamanıyla karşılaştırılır.
- `projects/<klasör>/<oturum>.jsonl`: Oturumun kaydı (transcript). Yalnızca yeni eklenen satırlar okunur.
- `projects/<klasör>/<oturum>/subagents/`: Alt ajanların kayıtları ve `.meta.json` dosyaları.

Maliyet, API liste fiyatlarıyla hesaplanan bir tahmindir ([src/pricing.js](src/pricing.js)).
Pro ya da Max aboneliğinde bu tutarı ödemezsiniz.

## Dosyalar

| Dosya | Görevi |
| --- | --- |
| [src/collector.js](src/collector.js) | `~/.claude` dosyalarını okur ve anlık görüntüyü hazırlar |
| [src/pricing.js](src/pricing.js) | Model fiyatları ve maliyet hesabı |
| [src/terminals.js](src/terminals.js) | Agentinan'dan başlatılan oturumları açar, bağlanır, komut gönderir |
| [renderer/console.js](renderer/console.js) | Terminal paneli, komut kutusu ve "Yeni oturum" penceresi |
| [src/main.js](src/main.js) | Electron penceresi, 1,5 saniyede bir okuma, bildirimler, ayarlar |
| [renderer/app.js](renderer/app.js) | Sekmeler, oturum kartları, harita bilgi kartı ve ayarlar |
| [renderer/orbit3d.js](renderer/orbit3d.js) | 3D yörünge haritası (three.js) |

## Lisans

[MIT](LICENSE)
