# Abyss bridge (Windows / VPS)

**Status: eksperimen; belum dipasang pada VPS pengguna.** Provider 0.3.0 memerlukan bridge aktif untuk Abyss. MixDrop masih boleh digunakan tanpa bridge.

Abyss menggunakan metadata AES-CTR dan fail bersegmen. Bridge menukarkan permintaan `Range` pemain kepada segmen CDN yang betul, termasuk permintaan merentasi sempadan segmen. Tiada filem penuh disimpan pada cakera. Video dihantar melalui VPS, jadi trafik/bandwidth VPS digunakan sepanjang main balik.

## Windows: cara ujian paling mudah

Perlukan Windows 10 / Windows Server 2016 atau lebih baharu untuk Node.js rasmi. Skrip extract ZIP melalui .NET, jadi tidak memerlukan cmdlet `Expand-Archive`. Windows Server 2012/R2 dan versi lebih lama tidak boleh menjalankan runtime Node.js yang diperlukan; menaik taraf PowerShell sahaja tidak menyelesaikan had Windows tersebut.

1. Masuk ke VPS menggunakan Remote Desktop seperti biasa.
2. Muat turun dan extract [ZIP repo](https://github.com/sidunfold/nuvio/archive/refs/heads/main.zip). Jangan jalankan terus dalam ZIP.
3. Buka PowerShell dalam folder `nuvio-main` dan jalankan:

```powershell
powershell -NoProfile -File .\bridge\start-windows.ps1 -QuickTunnel
```

Skrip menggunakan Node.js yang sedia ada, atau memuat turun versi portable Node.js 22 dari nodejs.org. Untuk Quick Tunnel, skrip memuat turun cloudflared dari release rasmi Cloudflare. Kedua-dua muat turun disemak SHA256. Skrip memulakan proses tersembunyi; ia tidak membuka firewall atau mengubah port Remote Desktop.

Skrip memaparkan **Abyss bridge URL** dan **Abyss bridge token**. Jangan hantar token ke chat atau commit ke GitHub. Token sesi disimpan di `%LOCALAPPDATA%\NuvioAbyssBridge\session.json` dalam bentuk penyulitan pengguna Windows.

Dalam tetapan **PencuriMovie MalaySub** pada Nuvio:

- `Server pilihan`: **Abyss (perlukan bridge)**.
- `Abyss bridge URL`: URL HTTPS yang dicetak skrip, tanpa `/resolve`.
- `Abyss bridge token`: token yang dicetak skrip.
- `Resolusi pilihan`: **Semua**, atau resolusi yang anda mahu.

Cuba filem dahulu. Resolusi Abyss datang daripada senarai sumber server; tidak semua tajuk mempunyai semua resolusi.

Quick Tunnel hanya untuk ujian. URL berubah apabila proses tunnel dimulakan semula, dan tidak dijamin untuk penggunaan kekal. Proses berhenti selepas VPS reboot; skrip ini belum memasang startup task/service. Jangan gunakan port RDP sebagai URL bridge.

## Pemasangan kekal

Sediakan domain HTTPS/reverse proxy yang menghantar trafik ke `127.0.0.1:3147` pada VPS. Gunakan URL itu dengan:

```powershell
powershell -NoProfile -File .\bridge\start-windows.ps1 -PublicBase https://DOMAIN-BRIDGE-ANDA
```

Perintah ini memulakan bridge sahaja; ia **tidak** menyediakan DNS, sijil TLS, reverse proxy atau Windows Service. Konfigurasi hosting sebenar perlu diselesaikan sebelum URL itu boleh digunakan dari telefon/TV.

Alternatif jika Node.js telah dipasang dan anda mengurus proses sendiri:

```powershell
$env:ABYSS_PUBLIC_BASE = 'https://DOMAIN-BRIDGE-ANDA'
$env:ABYSS_BRIDGE_TOKEN = 'TOKEN-RAWAK-SEKURANG-KURANGNYA-24-AKSARA'
node .\bridge\server.js
```

Bridge mendengar pada loopback secara lalai. Route resolve memerlukan token jika ditetapkan; URL main balik ditandatangani dan luput selepas enam jam. Restart bridge membatalkan URL main balik lama. Endpoint `/health` tidak mendedahkan token.

## Ujian pembangun

```sh
npm test
npm run abyss:smoke
```

Semakan langsung hanya membaca 1 KiB pada permulaan, sempadan segmen dan hujung setiap resolusi, bukan muat turun penuh atau ujian menonton dalam Nuvio. Server Abyss boleh lambat/tidak tersedia. Main balik sebenar di Nuvio dan akses melalui VPS masih perlu disahkan selepas pemasangan.

Rujukan protokol: [implementasi Abyss/Hydrax](https://github.com/naravid19/N_m3u8DL_RE_GUI/tree/main/N_m3u8DL_RE_GUI.Core/Abyss). Rujukan hosting: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [Node.js 22 Windows](https://nodejs.org/download/release/latest-jod/).
