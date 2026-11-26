
# Aturan Wajib Sebelum Eksekusi Tugas (Skill-First Protocol)
- **DILARANG LANGSUNG NGODING ATAU MENJAWAB TUGAS TEKNIS** sebelum memeriksa seluruh daftar skills yang tersedia (baik di .claude/skills/ proyek maupun ~/.claude/skills/ global, serta plugin aktif).
- Setiap kali menerima perintah, langkah pertama yang **WAJIB** dilakukan adalah mencocokkan intent tugas dengan deskripsi seluruh skill yang ada.
- Jika ditemukan satu atau lebih skill yang relevan, **WAJIB baca dan terapkan seluruh aturan dari file SKILL.md tersebut** terlebih dahulu.
- Selalu tampilkan baris status singkat di awal respons, misalnya:
  [Skill Aktif: nama-skill-1, nama-skill-2] (atau [Skill Aktif: Tidak ada yang cocok] jika memang tidak ada skill terkait) sebelum mulai bekerja.
