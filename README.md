# 🌊 Deep Sea Pulse: Coalition Wars

**Deep Sea Pulse**, 42 Network öğrencileri için özel olarak tasarlanmış, 4 oyunculu, web tabanlı, 2D Hex-Strategy (Altıgen Strateji) oyunudur.

Bu proje, 3 günlük bir **Game Jam** kapsamında geliştirilmiştir. Öğrenciler kendi 42 Intra hesaplarıyla giriş yapar ve parçası oldukları Coalition (İttifak) renkleriyle denizlerdeki adaları fethetmeye çalışırlar.

---

## 🎮 Oyunun Kuralları & "Pulse" Mekaniği

Oyun gerçek zamanlı değil, **"Pulse" (Nabız)** adı verilen 20 saniyelik döngülerle oynanır.
- **Planlama Evresi (20sn):** Her oyuncu bu süre zarfında hamlelerini (gemi üretme, hareket, köy kurma) planlar.
- **Pulse Evresi (0sn):** Süre dolduğunda herkesin hamlesi sunucuya gönderilir ve **aynı anda** işlenir.

### Zafere Giden Yol
Oyun en fazla **30 Pulse** (yaklaşık 10 dakika) sürer. Süre sonunda en çok kaynağa sahip olan veya haritadaki adaların %60'ını ele geçiren oyuncu kazanır.

### Birimler ve Yapılar
- 🪵 **Köy (Village):** Adalara kurulur, her Pulse'da 1 kaynak üretir. (Maliyet: 5 Odun, 3 Taş)
- 🏰 **Şehir (City):** Köyler şehre dönüştürülür, her Pulse'da 3 kaynak üretir ve saldırılara daha dayanıklıdır. (Maliyet: 10 Taş, 5 Demir)
- 🚢 **Ticaret Gemisi (Merchant):** Adaları başkentinize bağlar. Kaynak üretebilmek için köylerinizin başkente bağlı olması şarttır.
- ⛵ **Savaş Gemisi (Navy):** Haritada hareket eder. Düşman ticaret gemilerini yok edebilir (2 Navy gerekir) veya köylerini yağmalayabilir (5 Navy gerekir).

---

## 🚀 Kurulum (Local Development)

Proje `Node.js v20+` ve `SQLite` kullanmaktadır.

### 1. Gereksinimleri Yükleyin
```bash
npm install
```

### 2. Çevre Değişkenlerini (Env) Ayarlayın
`.env` dosyasını kendi 42 Intra uygulamanıza göre düzenleyin:
```env
PORT=3000
SESSION_SECRET=gizli_bir_sifre_belirleyin
FORTYTWO_CLIENT_ID=uid_buraya
FORTYTWO_CLIENT_SECRET=secret_buraya
FORTYTWO_CALLBACK_URL=http://localhost:3000/auth/42/callback
DB_PATH=./server/database/deep_sea_pulse.sqlite
```

*(Not: 42 API Uygulamanızın ayarlarından `Redirect URI` kısmını `http://localhost:3000/auth/42/callback` olarak ayarlamayı unutmayın!)*

### 3. Sunucuyu Başlatın
```bash
# Geliştirme modu (otomatik yeniden başlatma ile)
npm run dev

# veya production modu
npm start
```

Tarayıcınızdan `http://localhost:3000` adresine giderek oyuna giriş yapabilirsiniz.

---

## 🛠 Teknoloji Yığını (Tech Stack)

- **Backend:** Node.js, Express.js
- **Real-time İletişim:** Socket.IO
- **Veritabanı:** SQLite (better-sqlite3) - *Game Jam hızı için sıfır-ayar DB!*
- **Auth:** 42 Intra OAuth 2.0 (Custom fetch implementation)
- **Frontend:** Vanilla JavaScript, HTML5 Canvas Rendering, Vanilla CSS (Glassmorphism & Deep Sea Theme)

---

## 🏆 Puanlama (Global ELO)

Her maç bittiğinde oyuncuların ELO puanları güncellenir:
- **1. Olan:** +50 Puan
- **2. Olan:** +20 Puan
- **3. Olan:** -10 Puan
- **4. Olan:** -20 Puan

Tüm oyuncular Global Leaderboard (Lobi) ekranında listelenir.

---
*Game Jam 2025 için sevgi ve bol kahveyle yapıldı! ☕*
