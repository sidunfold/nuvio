# Nuvio

Provider JavaScript untuk Nuvio, menggunakan `https://pencurimoviesubmalay26.site/`.

**Status: beta 0.1.1.** Pasang sebagai repositori **Plugins**, bukan add-on Stremio. Kod berjalan pada peranti pengguna; tiada backend berbayar diperlukan.

Versi 0.1.1 membetulkan pautan episod `s1-ep1` (contohnya Lanterns) sambil mengekalkan sokongan `s1-e1`. Pilihan pelayan `mixdr` turut diberi keutamaan sebagai MixDrop.

## Fungsi dan had

- Carian filem mengikut tajuk/tahun TMDB, dan siri mengikut musim/episod. Tajuk dipadankan secara ketat supaya filem lain tidak dipilih.
- Menyokong MixDrop dan video MP4/HLS/MKV terus yang terdapat dalam HTML pelayan. Header Referer dan parameter URL dikekalkan.
- Pilihan iklan `fake` diabaikan. Tiada skrip laman dilaksanakan, API key dibundel atau video disimpan dalam repo.
- Abyss, RPM, SeekPlay, P2PStream, UpnShare, Byse dan Netu yang memerlukan API khusus/penyulitan **belum disokong**. Tajuk yang hanya menggunakan pelayan tersebut boleh mengembalikan kosong.
- Label MalaySub datang daripada laman. Provider tidak menghasilkan atau menjamin sarikata. Resolusi dilabel `Unknown` kerana belum disahkan.
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
