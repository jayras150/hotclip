import pathlib

BILLING = pathlib.Path("src/app/billing/page.tsx")
s = BILLING.read_text(encoding="utf-8")
s = s.replace(">{currency} kredit tersedia", ">{currency} credits available")
s = s.replace(">{currency} total", ">{currency} total")
s = s.replace("Sisa kredit {formatCredits(credits)} &lt; {LOW_BALANCE_THRESHOLD} kredit.",
              "Remaining credits {formatCredits(credits)} &lt; {LOW_BALANCE_THRESHOLD} credits.")
s = s.replace("Transaksi", "Transactions")
s = s.replace("Saldo rendah", "Low balance")
s = s.replace(">Kredit aktif", ">Credits active")
s = s.replace(">Saldo lokal", ">Local balance")
s = s.replace("Saldo Kredit", "Credits")
s = s.replace("Belum ada transaksi. Top-up untuk menambah kredit.",
              "No transactions yet. Top up to add credits.")
s = s.replace("+{formatCredits(tx.credits_added)} kredit",
              "+{formatCredits(tx.credits_added)} credits")
s = s.replace("1 kredit = {exchangeRate.toLocaleString()} {currency}",
              "1 credit = {exchangeRate.toLocaleString()} {currency}")
BILLING.write_text(s, encoding="utf-8")
print("billing fixed")


TOPUP = pathlib.Path("src/components/TopupDialog.tsx")
t = TOPUP.read_text(encoding="utf-8")
t = t.replace("Pilih gateway pembayaran.", "Choose a payment gateway.")
t = t.replace("Jumlah minimal 1", "Minimum amount 1")
t = t.replace("Jumlah tidak valid", "Invalid amount")
t = t.replace("Mata uang tidak valid", "Invalid currency")
t = t.replace("Pembayaran tidak valid", "Invalid payment")
t = t.replace("Top-up pending · ", "Top-up pending · ")
t = t.replace("Top-up berhasil dibuat", "Top-up created")
t = t.replace("Masukkan jumlah top-up", "Enter top-up amount")
t = t.replace("Top Up", "Top Up")
t = t.replace("Batal", "Cancel")
t = t.replace("Metode pembayaran", "Payment method")
t = t.replace("Jumlah (Rp / $)", "Amount (Rp / $)")
t = t.replace("Mata uang", "Currency")
# credit-related Indonesian leftovers
t = t.replace("kbisa", "kbisa")
t = t.replace("saldo kredit", "credit balance")
t = t.replace("sisa kredit", "remaining credits")
t = t.replace("kredit", "credits")
TOPUP.write_text(t, encoding="utf-8")
print("topup fixed")


AUTH = pathlib.Path("src/app/(auth)")
for f in AUTH.glob("*/page.tsx"):
    r = f.read_text(encoding="utf-8")
    r = r.replace("Masuk ke HotClip Studio untuk mengelola klip, kredit, dan ekspor.",
                  "Enter HotClip Studio to manage clips, credits and exports.")
    r = r.replace("Belum punya akun?", "Don't have an account?")
    r = r.replace("Buat akun HotClip Studio: nama, email, dan kata sandi.",
                  "Create a HotClip Studio account: name, email and password.")
    r = r.replace("Sudah punya akun?", "Already have an account?")
    r = r.replace("Buat akun", "Create account")
    r = r.replace("HotClip Studio", "HotClip Studio")
    f.write_text(r, encoding="utf-8")
    print("auth page fixed", f.name)


ADMIN = pathlib.Path("src/app/admin")
for f in ADMIN.glob("**/page.tsx"):
    r = f.read_text(encoding="utf-8")
    r = r.replace("Belum ada aktivitas tercatat.", "No activity recorded yet.")
    r = r.replace("Aksi gagal dijalankan", "Action failed to run")
    r = r.replace("Belum ada user terdaftar.", "No users registered yet.")
    r = r.replace("User tidak akan bisa login atau membuat job baru sampai di-unban.",
                  "User will be unable to log in or create jobs until unbanned.")
    r = r.replace("Saldo credits user akan direset menjadi 0.",
                  "User credit balance will be reset to 0.")
    r = r.replace("Matikan penyedia penyimpanan ini?", "Deactivate this storage provider?")
    r = r.replace("Aktifkan penyedia penyimpanan ini?", "Enable this storage provider?")
    r = r.replace("Gagal mengeksekusi aksi instance", "Failed to execute instance action")
    r = r.replace("Eksekusi aksi \"{label}\" pada instance ini?",
                  "Run action \"{label}\" on this instance?")
    r = r.replace("Deaktifkan penyedia ini", "Deactivate this provider")
    r = r.replace("Aktifkan penyedia ini", "Enable this provider")
    r = r.replace("Autentikasi lingkungan pada mulai pertama; pandu ke layanan yang diperlukan.",
                  "Environment authentication on first run; guide you to the services required.")
    f.write_text(r, encoding="utf-8")
    print("admin fixed", f.relative_to(ADMIN))


# legal pages are already full English (from generator) — verify
for slug in ["privacy", "terms", "refund", "dmca"]:
    p = pathlib.Path(f"src/app/{slug}/page.tsx")
    r = p.read_text(encoding="utf-8")
    bad = [w for w in ["kredit", "riwayat", "upload", "masuk", "logout", "tautan",
                       "unggah", "saldo", "aksi", "loading"] if w in r]
    if bad:
        print("WARNING legal", slug, "still contains:", bad)
    else:
        print("legal page clean:", slug)
