import re
import pathlib


def replace_in_file(path, replacements):
    p = pathlib.Path(path)
    s = p.read_text(encoding="utf-8")
    for old, new in replacements:
        if old in s:
            s = s.replace(old, new)
            print("FIXED", path, "::", old[:60])
    if s != p.read_text(encoding="utf-8"):
        p.write_text(s, encoding="utf-8")


BILLING_REPLACEMENTS = [
    (">Wallet kredit &amp; riwayat transaksi", ">Wallet credits &amp; transaction history"),
    (">{currency} kredit tersedia", ">{currency} credits available"),
    (">{currency} total", ">{currency} total"),
    (">{LOW_BALANCE_THRESHOLD} kredit", ">{LOW_BALANCE_THRESHOLD} credits"),
    ("<p className=\"mt-1 text-xs text-[var(--text-muted)]\">{currency} total</p>", "<p className=\"mt-1 text-xs text-[var(--text-muted)]\">{currency} total</p>"),
    ("<p className=\"mb-4 text-sm text-[var(--text-muted)]\">Sisa kredit {formatCredits(credits)} &lt; {LOW_BALANCE_THRESHOLD} kredit. Pastikan top-up untuk menjaga keberlangsungan pekerjaan.</p>", "<p className=\"mb-4 text-sm text-[var(--text-muted)]\">Remaining credits {formatCredits(credits)} &lt; {LOW_BALANCE_THRESHOLD} credits. Top up to keep rendering.</p>"),
    ("Saldo rendah", "Low balance"),
    (">Kredit aktif", ">Credits active"),
    (">Saldo lokal", ">Local balance"),
]


def fix_billing(path):
    replace_in_file(path, BILLING_REPLACEMENTS)


def fix_topup(path):
    # TopupDialog
    replacements = [
        ("Belum ada transaksi. Top-up untuk menambah kredit.", "No transactions yet. Top up to add credits."),
        ("Saldo rendah", "Low balance"),
        ("Pilih gateway pembayaran.", "Choose a payment gateway."),
        ("Jumlah minimal 1", "Minimum amount 1"),
        ("Jumlah tidak valid", "Invalid amount"),
        ("Mata uang tidak valid", "Invalid currency"),
        ("Pembayaran tidak valid", "Invalid payment"),
        ("Top-up pending · ", "Top-up pending · "),
        ("Top-up berhasil dibuat", "Top-up created"),
        ("Masukkan jumlah top-up", "Enter top-up amount"),
        ("Top Up", "Top Up"),
        ("Batal", "Cancel"),
        ("Metode pembayaran", "Payment method"),
        ("Jumlah (Rp / $)", "Amount (Rp / $)"),
        ("Mata uang", "Currency"),
    ]
    replace_in_file(path, replacements)


def fix_auth_pages():
    dir = pathlib.Path("src/app/(auth)")
    for f in dir.glob("[[...sign-in]]/page.tsx"):
        replace_in_file(f, [
            ("Masuk ke HotClip Studio untuk mengelola klip, kredit, dan ekspor.",
             "Enter HotClip Studio to manage clips, credits and exports."),
            ("Lanjutkan ke HotClip Studio", "Continue to HotClip Studio"),
            ("Belum punya akun?", "Don't have an account?"),
            ("Buat akun HotClip Studio: nama, email, dan kata sandi.",
             "Create a HotClip Studio account: name, email, and password."),
            ("Buat akun", "Create account"),
            ("Sudah punya akun?", "Already have an account?"),
        ])
    for f in dir.glob("[[...sign-up]]/page.tsx"):
        replace_in_file(f, [
            ("Buat akun HotClip Studio: nama, email, dan kata sandi.",
             "Create a HotClip Studio account: name, email and password."),
            ("Buat akun", "Create account"),
            ("Sudah punya akun?", "Already have an account?"),
        ])


def fix_admin_pages():
    dir = pathlib.Path("src/app/admin")
    # audit page
    for f in dir.glob("audit/page.tsx"):
        replace_in_file(f, [
            ("Belum ada aktivitas tercatat.", "No activity recorded yet."),
        ])
    # users page
    for f in dir.glob("users/page.tsx"):
        replace_in_file(f, [
            ("Aksi gagal dijalankan", "Action failed to run"),
            ("Belum ada user terdaftar.", "No users registered yet."),
            ("User tidak akan bisa login atau membuat job baru sampai di-unban.",
             "User will be unable to log in or create jobs until unbanned."),
            ("Saldo credits user akan direset menjadi 0.", "User credit balance will be reset to 0."),
        ])
    # page root
    for f in dir.glob("page.tsx"):
        replace_in_file(f, [
            ("Matikan penyedia penyimpanan ini?",
             "Deactivate this storage provider?"),
            ("Aktifkan penyedia penyimpanan ini?",
             "Enable this storage provider?"),
            ("Gagal mengeksekusi aksi instance",
             "Failed to execute instance action"),
            ("Eksekusi aksi \"{label}\" pada instance ini?",
             "Run action \"{label}\" on this instance?"),
            ("Deaktifkan penyedia ini", "Deactivate this provider"),
            ("Aktifkan penyedia ini", "Enable this provider"),
            ("Autentikasi lingkungan pada mulai pertama; pandu ke layanan yang diperlukan.",
             "Environment authentication on first run; guide you to the services required."),
        ])


def fix_audit():
    replace_in_file("src/app/admin/audit/page.tsx", [
        ("Belum ada aktivitas tercatat.", "No activity recorded yet."),
    ])


def fix_users():
    replace_in_file("src/app/admin/users/page.tsx", [
        ("Aksi gagal dijalankan", "Action failed to run"),
        ("Belum ada user terdaftar.", "No users registered yet."),
        ("User tidak akan bisa login atau membuat job baru sampai di-unban.",
         "User will be unable to log in or create jobs until unbanned."),
        ("Saldo credits user akan direset menjadi 0.",
         "User credit balance will be reset to 0."),
    ])


def fix_legal_pages():
    # legal pages are full English already — check no Indonesian remains
    legal = ["privacy", "terms", "refund", "dmca"]
    for slug in legal:
        p = pathlib.Path(f"src/app/{slug}/page.tsx")
        s = p.read_text(encoding="utf-8")
        if "kredit" in s or "riwayat" in s or "upload" in s or "masuk" in s or "logout" in s:
            print("WARNING Indonesian remains in legal page", slug)


def fix_clips():
    replace_in_file("src/app/clips/page.tsx", [
        ("My Clips", "My Clips"),
        ("Job Tracker", "Job Tracker"),
    ])


if __name__ == "__main__":
    fix_billing("src/app/billing/page.tsx")
    fix_topup("src/components/TopupDialog.tsx")
    fix_auth_pages()
    fix_admin_pages()
    fix_audit()
    fix_users()
    fix_legal_pages()
    fix_clips()
    print("done")
