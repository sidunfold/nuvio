# Nuvio

Provider JavaScript untuk Nuvio, menggunakan `https://pencurimoviesubmalay26.site/`.

**Status: beta 0.3.0.** Pasang sebagai repositori **Plugins**, bukan add-on Stremio. MixDrop berjalan pada peranti pengguna. Abyss memerlukan bridge aktif pada VPS/komputer.

Versi 0.3.0 menambah **Server pilihan → Abyss** dengan pilihan resolusi daripada metadata Abyss. Sokongan ini memerlukan pemasangan [Abyss bridge](bridge/README.md); kod sahaja dalam repo belum mengaktifkan hosting pada VPS. MixDrop terus berfungsi tanpa bridge.

Versi 0.2.0 menambah **Resolusi pilihan** dalam tetapan provider: Semua, 2160p, 1080p, 720p atau 480p. Lalai ialah Semua. Kad sumber memaparkan label resolusi yang dikenal pasti; pilih sumber tersebut untuk main balik. Pilihan ini tidak menghasilkan salinan video baharu. Jika server hanya menyediakan 1080p, 720p tidak boleh dipilih untuk tajuk itu. Penapis khusus mengabaikan sumber dengan label tidak diketahui dan tidak jatuh balik ke resolusi lain.

Versi 0.1.2 memulangkan MixDrop sebaik sahaja sumber ditemui, tanpa menunggu pelayan lain yang lambat. Fallback hanya dicuba jika sumber pilihan tidak berjaya. Ini mengurangkan risiko tamat masa pada episod dengan banyak server.

Versi 0.1.1 membetulkan pautan episod `s1-ep1` (contohnya Lanterns) sambil mengekalkan sokongan `s1-e1`. Pilihan pelayan `mixdr` turut diberi keutamaan sebagai MixDrop.

## Fungsi dan had

- Carian filem mengikut tajuk/tahun TMDB, dan siri mengikut musim/episod. Tajuk dipadankan secara ketat supaya filem lain tidak dipilih.
- Menyokong MixDrop dan video MP4/HLS/MKV terus yang terdapat dalam HTML pelayan. Header Referer dan parameter URL dikekalkan.
- Pilihan iklan `fake` diabaikan. Tiada skrip laman dilaksanakan, API key dibundel atau video disimpan dalam repo.
- Abyss disokong secara eksperimen melalui bridge HTTPS yang dikonfigurasi dalam tetapan provider. RPM, SeekPlay, P2PStream, UpnShare, Byse dan Netu **belum disokong**. Tajuk yang hanya menggunakan pelayan tersebut boleh mengembalikan kosong.
- Label MalaySub datang daripada laman. Provider tidak menghasilkan atau menjamin sarikata. Resolusi dibaca daripada label sumber/nama fail, bukan pemeriksaan piksel video. Label `Unknown` dikekalkan jika tiada label resolusi yang boleh dikenal pasti; provider tidak meneka daripada tajuk filem atau teks iklan.
- Ujian Node mengesahkan logik provider. Pemasangan dan main balik dalam Nuvio sebenar masih perlu diuji pada peranti pengguna.

## Pasang dalam Nuvio

Repo ini public. Gunakan URL manifest berikut untuk pemasangan tanpa log masuk GitHub.

```text
https://raw.githubusercontent.com/sidunfold/nuvio/refs/heads/main/manifest.json
```

1. Buka **Settings → Content & Discovery → Plugins → Add Repository** (nama menu bergantung pada versi).
2. Masukkan URL manifest, pasang/refresh dan hidupkan **PencuriMovie MalaySub**.
3. Provider menggunakan `TMDB_API_KEY` daripada runtime Nuvio jika tersedia. Jika log menyebut key tiada, masukkan **TMDB API key v3** sendiri dalam tetapan provider. Jangan commit key.
4. Buka tajuk yang menawarkan pelayan MixDrop dan periksa senarai sumbernya.

Jika domain sumber berubah, kemas kini **Alamat laman sumber** dalam tetapan provider. Gunakan HTTPS tanpa laluan.

## Pembangunan

Perlukan Node.js 18+. Tiada dependency perlu dipasang.

```sh
npm test
npm run smoke
npm start
```

`smoke` melakukan carian langsung dan membaca hanya bahagian awal respons video untuk pengesahan; ia tidak memuat turun filem penuh. URL video boleh luput dan diekstrak semula setiap kali provider digunakan.

Untuk tajuk lain: `npm run smoke -- "Badut Gendong" "2026"`.

Untuk siri: `npm run smoke -- "Lanterns" "2026" tv 1 1` (musim 1, episod 1).

Untuk Plugin Tester pada peranti dalam Wi-Fi yang sama, gunakan `http://IP-KOMPUTER:3000/manifest.json`. `localhost` pada telefon merujuk telefon sendiri. Pelayan pembangunan hanya menyediakan manifest dan kod provider.

## Fail

- `manifest.json`: registry Nuvio.
- `providers/pencurimovie.js`: kod siap guna menggunakan Promise chains; tiada build step.
- `test/provider.test.js`: ujian padanan, episod, pengekstrakan dan runtime.
- `scripts/smoke.js`: semakan langsung.
- `scripts/serve.js`: pelayan tempatan.

Rujukan: [panduan provider](https://github.com/yoruix/nuvio-providers/blob/main/DOCUMENTATION.md), [runtime NuvioTV](https://github.com/NuvioMedia/NuvioTV/blob/dev/app/src/full/java/com/nuvio/tv/core/plugin/PluginRuntime.kt).
