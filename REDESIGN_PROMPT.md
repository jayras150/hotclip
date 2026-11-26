Lakukan perombakan total (full redesign & full-stack synchronization) pada proyek `hookclip.pro` (`hotclip`) di folder `C:/Users/WINDOWS 11 PRO/Documents/hotclip` menjadi aplikasi publik bergaya **Full Obsidian Cyber-Studio Dark Mode** yang penuh animasi interaktif 60fps, bebas hambatan autentikasi/API key di tampilan depan, dan sinkron penuh antara database Supabase yang baru di-reset, backend worker GPU Vast.ai, dan frontend web.

WAJIB aktifkan dan terapkan seluruh skills berikut sesuai perannya masing-masing sepanjang pengerjaan:
- **UI/UX, Brand & Design System:** `ui-ux-pro-max`, `design-system`, `design`, `ui-styling`, `brand`, `banner-design`, `slides`
- **Component & Frontend Architecture:** `shadcn`, `migrate-radix-to-base`
- **Database & Schema:** `supabase`, `supabase-postgres-best-practices`
- **GPU Worker & Provisioning:** `vastai`, `vastai-sdk`

Jalankan eksekusi secara menyeluruh dan berurutan dalam 5 fase berikut tanpa memotong kode atau meninggalkan placeholder:

### FASE 1: Sinkronisasi Skema Database Supabase (`supabase`, `supabase-postgres-best-practices`)
1. Audit struktur query/model database di codebase (`src/server/*` & `web/*`), lalu buat dan terapkan migrasi SQL lengkap yang bersih, terindeks optimal (`uuid`, `timestamptz`, `jsonb`), foreign key dengan `ON DELETE CASCADE`, serta RLS policy yang aman untuk akses publik berbasis `client_session_id`.
2. Pastikan tabel inti (`jobs`, `clips`, `gpu_instances` / `worker_logs`, dll.) mendukung mode publik tanpa mewajibkan login/API key manual dari pengguna akhir.

### FASE 2: Audit Pipeline GPU Vast.ai & Public API Endpoints (`vastai`, `vastai-sdk`)
1. Pastikan integrasi provisioning, health-check, dan auto-destroy instance GPU di Vast.ai berjalan mulus untuk job publik tanpa memblokir pengguna publik dengan form API key.
2. Pastikan seluruh endpoint `/api/*` dan streaming `/logs/*` berjalan tanpa membutuhkan header API key manual di UI publik, sementara rute admin terisolasi di `/admin` dan tidak tampil di antarmuka publik.

### FASE 3: Brand Identity, Design System & Migrasi Komponen (`brand`, `design-system`, `design`, `ui-styling`, `ui-ux-pro-max`, `shadcn`, `migrate-radix-to-base`)
1. Terapkan **Full Obsidian Cyber-Studio Dark Mode** di seluruh aplikasi (0% light mode): base `#06080D`, glass surface `#0C1018` (`backdrop-blur-xl`), border `1px solid rgba(255,255,255,0.08)`, glow aktif `rgba(0, 240, 255, 0.35)`, aksen Electric Cyan (`#00F0FF`) & Cyber Blue (`#3B82F6`), font `JetBrains Mono` untuk telemetri/durasi/log, serta perbarui logo SVG, favicon, dan OG banner (`banner-design`).
2. Rapikan komponen UI (`Dialog`, `Tabs`, `Select`, `Slider`, `Switch`, `Tooltip`, `Progress`, `Toast`) ke pola `@base-ui-components/react` + `shadcn` terbaru dengan animasi transisi mulus.

### FASE 4: Redesign Halaman Utama Publik & Full Interactive Animations (`ui-ux-pro-max`, `ui-styling`, `slides`, `banner-design`)
1. Hapus total form/modal "Butuh API key dulu", input API key publik, badge status "Belum terhubung", serta link "Admin Dashboard" dari halaman publik. Tombol **"Buat Shorts Sekarang"** langsung aktif sejak halaman terbuka.
2. Tambahkan ambient cyber-grid perspektif & radial glow orbs 60fps, hero sinematik + showcase interaktif (`slides`) transformasi `16:9` ke `9:16`.
3. Buat dual input studio (tab animasi **URL YouTube** dengan auto-preview thumbnail/judul + **Unggah Video Lokal** drag-and-drop), selektor **Jumlah Klip**, **Rasio Aspek** (`9:16`, `4:5`, `1:1`, `16:9`), dan toggle modul AI (*Face-Tracking*, *Karaoke ASS*, *Hook Score*).
4. Buat visualizer 5 tahap pipeline beranimasi + cyber-terminal log langsung (`/logs/...`), serta galeri kartu hasil klip `9:16` dengan hover tilt/glow, tombol download MP4, copy caption, dan modal preview studio `9:16` dengan animasi karaoke.

### FASE 5: Verifikasi, Build Produksi & Deploy ke VPS (`209.94.60.207`)
1. Jalankan unit test, `typecheck`, `lint`, dan `build` produksi (0 error).
2. Sinkronkan perubahan ke `/opt/hotclip` di VPS `209.94.60.207`, rebuild container `api` dan `web` (`docker compose -f docker-compose.vps.yml --profile certbot up -d --build`), dan verifikasi `https://hookclip.pro` serta `https://hookclip.pro/api/health` merespons `200 OK`.
