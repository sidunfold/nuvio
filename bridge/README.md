# Abyss bridge (Windows / VPS)

**Status: eksperimen; belum dipasang pada VPS pengguna.** Provider 0.3.0 memerlukan bridge aktif untuk Abyss. MixDrop masih boleh digunakan tanpa bridge.

Abyss menggunakan metadata AES-CTR dan fail bersegmen. Bridge menukarkan permintaan `Range` pemain kepada segmen CDN yang betul, termasuk permintaan merentasi sempadan segmen. Tiada filem penuh disimpan pada cakera. Video dihantar melalui VPS, jadi trafik/bandwidth VPS digunakan sepanjang main balik.

## Windows: cara ujian paling mudah

Untuk Windows 10 / Server 2016 ke atas, gunakan bridge Node.js. Skrip ZIP tidak memerlukan cmdlet `Expand-Archive`. Untuk **Windows Server 2012 R2**, gunakan bridge .NET Framework di bawah; Node.js tidak diperlukan.

### Windows Server 2012 R2: bridge .NET Framework

Bridge alternatif menggunakan C# 5 dan API .NET Framework 4.5+, tanpa NuGet, Node.js, IIS atau perubahan URL ACL. Server 2012 R2 biasanya menyertakan .NET Framework 4.5.1. Ia mendengar pada loopback sahaja dan tidak membuka firewall atau mengubah port RDP.

Muat turun ZIP repo baharu dan extract, kemudian buka CMD dalam folder `nuvio-main`:

```powershell
powershell -NoProfile -File .\bridge\start-legacy.ps1 -LocalOnly
```

Skrip mengkompilasi kod dengan compiler .NET Framework yang tersedia pada Windows, memulakan bridge tersembunyi, menyemak health tempatan dan cuba membaca senarai resolusi Abyss. Jika berjaya, mesej `PASS: bridge .NET berjalan dalam VPS` dipaparkan. **Ini belum menyediakan akses dari telefon/TV.** Alamat `127.0.0.1` tidak boleh digunakan pada peranti lain.

Hentikan sesi tempatan sebelum menukar konfigurasi:

```powershell
powershell -NoProfile -File .\bridge\start-legacy.ps1 -Stop
```

Untuk akses awam, pilihan kekal ialah reverse proxy HTTPS daripada penyedia hosting yang menghantar trafik ke `127.0.0.1:3147`. Selepas URL itu benar-benar dikonfigurasi:

```powershell
powershell -NoProfile -File .\bridge\start-legacy.ps1 -PublicBase https://DOMAIN-BRIDGE-ANDA
```

Jika tiada reverse proxy, terdapat cubaan sementara:

```powershell
powershell -NoProfile -File .\bridge\start-legacy.ps1 -QuickTunnel
```

Mod ini menggunakan cloudflared **2023.8.2**, release rasmi berasaskan Go 1.20, dengan SHA256 yang dipinkan daripada release rasmi. Ia release lama di luar tetingkap sokongan Cloudflare. Ujian pembangunan mendapat sambungan ke Cloudflare tetapi URL awam gagal resolusi DNS dari rangkaian pembangun, jadi **akses HTTPS mod ini belum disahkan**. Skrip hanya memaparkan URL/token jika `/health` awam berjaya dicapai, dan menghentikan proses jika semakan gagal. Jangan anggap cubaan ini sebagai pemasangan kekal.

Bridge .NET telah dikompilasi dengan compiler C# 5/.NET Framework dan diuji pada Windows pembangun: metadata, token, HTTP Range, HEAD serta bacaan permulaan/sempadan/hujung bagi 480p, 720p dan 1080p. Ia **belum diuji pada VPS Server 2012 R2 pengguna**. Tiada pemasangan jauh dilakukan melalui RDP dalam chat ini.

Fail dan log disimpan di `%LOCALAPPDATA%\NuvioAbyssLegacy`. Token sesi disimpan dengan penyulitan pengguna Windows. Proses belum didaftarkan sebagai Windows Service/startup task; selepas reboot, jalankan semula. Gunakan penyedia hosting untuk semak HTTPS/port awam dan elakkan menukar port RDP.

Anda boleh tanyakan kepada hosting: "Boleh sediakan reverse proxy HTTPS untuk domain bridge yang forward ke 127.0.0.1:3147 pada VPS saya? Jika tidak, apakah port awam tambahan yang tersedia?"

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

Rujukan legacy: [.NET Framework pada Server 2012 R2](https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements), [release cloudflared 2023.8.2 dan checksum](https://github.com/cloudflare/cloudflared/releases/tag/2023.8.2), [had sokongan release Cloudflare](https://developers.cloudflare.com/tunnel/downloads/).
