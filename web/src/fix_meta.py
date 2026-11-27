import pathlib

# ---------------------------------------------------------------------------
# app/layout.tsx  - root metadata + html lang
# ---------------------------------------------------------------------------
p = pathlib.Path("src/app/layout.tsx")
s = p.read_text(encoding="utf-8")
s = s.replace('"title": "HotClip — Tempel URL, Dapat Shorts Viral"',
              '"title": "HotClip — Turn long videos into viral shorts"')
s = s.replace('"Studio AI tanpa login: tempel tautan YouTube atau unggah video, dapat klip vertikal siap posting dengan face-tracking, subtitle karaoke, dan skor viralitas."',
              '"Studio AI without login: paste a YouTube link or upload a video, get vertical clips ready for posting, with face-tracking, karaoke subtitles and virality scoring."')
s = s.replace('"Studio AI tanpa login: klip vertikal siap posting dengan face-tracking, subtitle karaoke, dan skor viralitas."',
              '"Studio AI without login: vertical clips ready for posting, with face-tracking, karaoke subtitles and virality scoring."')
s = s.replace('"id_ID"', '"en_US"')
p.write_text(s, encoding="utf-8")
print("layout.tsx fixed")


# ---------------------------------------------------------------------------
# app/page.tsx  - landing hero + features copy
# ---------------------------------------------------------------------------
p = pathlib.Path("src/app/page.tsx")
s = p.read_text(encoding="utf-8")
s = s.replace('"GPU Vast.ai instan"',
              '"Instant Vast.ai GPU"')
s = s.replace('"Provisioning otomatis di GPU cloud Vast.ai — pipeline mulai render dalam hitungan detik."',
              '"Automatic provisioning on Vast.ai GPU cloud—render starts in seconds."')
s = s.replace('"Model hook-score memilih momen terbaik secara presisi, bukan tebakan manual."',
              '"Hook-score model picks the best moments precisely, not manual guesswork."')
s = s.replace('"Tanpa akun"',
              '"No account needed"')
s = s.replace('"Cukup tempel URL dan atur opsi — tidak ada API key, tidak ada login."',
              '"Paste a URL, set options—no API key, no login required."')
p.write_text(s, encoding="utf-8")
print("app/page.tsx fixed")


# ---------------------------------------------------------------------------
# auth sign-in page
# ---------------------------------------------------------------------------
p = pathlib.Path("src/app/(auth)/sign-in/[[...sign-in]]/page.tsx")
s = p.read_text(encoding="utf-8")
s = s.replace('"Masuk ke HotClip Studio untuk mengelola klip, kredit, dan ekspor."',
              '"Sign in to manage your clips, credits and exports."')
s = s.replace('"/sign-in" ketika sesi belum ada.', '"/sign-in" before a session exists.')
s = s.replace('Widget digaya "obsidian cyber": background #06080d, border',
              "Widget styled in the obsidian cyber theme (background #06080d, border")
s = s.replace('rgba(255,255,255,0.08), teks #e6edf6, accent cyan.',
              "rgba(255,255,255,0.08), text #e6edf6, cyan accent.")
s = s.replace('site key ia hanya menampilkan placeholder sehingga build tetap aman.',
              "With no site key set it only shows a placeholder so the build stays safe.")
s = s.replace("Belum punya akun?", "Don't have an account?")
p.write_text(s, encoding="utf-8")
print("sign-in page fixed")


# ---------------------------------------------------------------------------
# auth sign-up page
# ---------------------------------------------------------------------------
p = pathlib.Path("src/app/(auth)/sign-up/[[...sign-up]]/page.tsx")
s = p.read_text(encoding="utf-8")
s = s.replace('"Buat akun HotClip Studio: nama, email, dan kata sandi."',
              '"Create a HotClip Studio account: name, email and password."')
s = s.replace("Buat akun HotClip Studio", "Create a HotClip Studio account")
s = s.replace("Sudah punya akun?", "Already have an account?")
p.write_text(s, encoding="utf-8")
print("sign-up page fixed")
