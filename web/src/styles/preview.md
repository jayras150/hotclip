# UI Primitives Preview — HookClip Obsidian Cyber-Studio

Dokumentasi penggunaan komponen di `web/src/components/ui/`. Semua komponen
dark-only, mobile-first (aman di 360px), dan mengambil warna dari CSS tokens
di `web/src/styles/tokens.css` (diekspos ke Tailwind via `@theme inline`).

## Tokens utama

| Token | Nilai | Keterangan |
|---|---|---|
| `--bg` | `#06080D` | Kanvas dasar obsidian |
| `--surface` | `#0C1018` | Glass surface (dipakai dengan `backdrop-blur-xl`) |
| `--surface-2` | `#121826` | Surface terangkat |
| `--border` | `rgba(255,255,255,0.08)` | Border 1px standar |
| `--text` / `--text-muted` | `#E6EDF6` / `#8A97AB` | Teks primer/sekunder |
| `--accent` | `#00F0FF` | Electric Cyan |
| `--accent-2` | `#3B82F6` | Cyber Blue |
| `--success` / `--warning` / `--danger` | `#10B981` / `#F59E0B` / `#EF4444` | Status |
| `--glow` | `rgba(0,240,255,0.35)` | Active glow / focus ring |
| `--font-display` / `--font-mono` | Space Grotesk / JetBrains Mono | Display & telemetry |

Alias lama tetap tersedia: `--background`, `--foreground`, `--sidebar`,
`--primary`, `--mint`, `--danger`, `--amber`, `--sky`, `--rose`.

## Contoh pemakaian

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast, Toaster } from '@/components/ui/toast';

export function Demo() {
  return (
    <Card glow>
      <CardHeader>
        <CardTitle>Render queue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="primary">Export clip</Button>
        <Button variant="secondary" loading>Rendering…</Button>
        <Button variant="ghost" size="sm">Cancel</Button>
        <Button variant="danger" size="sm">Delete</Button>
        <Button onClick={() => toast.success('Clip exported', { title: 'Done' })}>
          Notify me
        </Button>
      </CardContent>
    </Card>
  );
}

export function AppRoot({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster /> {/* pasang sekali di root */}
    </>
  );
}
```

## Daftar komponen

| File | Ekspor | Catatan |
|---|---|---|
| `button.tsx` | `Button`, `buttonVariants` | varian: `default`/`primary` (gradien cyan), `secondary` (glass), `ghost`, `outline`, `danger`; size `sm/md/lg/icon`; prop `loading`, `leftIcon`, `rightIcon` |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | glass + border; prop `glow`, `elevated` |
| `input.tsx` / `textarea.tsx` / `label.tsx` | `Input` / `Textarea` / `Label` | focus ring glow, `aria-invalid` merah |
| `dialog.tsx` | `Dialog` (Root), `DialogTrigger`, `DialogContent` (portal+backdrop+panel+close), `DialogTitle`, `DialogDescription`, `DialogFooter`, dst. | Base UI Dialog: focus trap, Escape, animasi scale/slide; mobile = bottom sheet |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsIndicator`, `TabsTab`, `TabsPanel` | sliding pill via `TabsIndicator` |
| `select.tsx` | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectGroupLabel` | Base UI Select lengkap dengan check indicator |
| `slider.tsx` | `Slider`, `SliderValue`, `SliderControl`, `SliderThumb` | track gradien cyan-blue |
| `switch.tsx` | `Switch` | transisi spring-ish (cubic-bezier overshoot) |
| `tooltip.tsx` | `Tooltip`, `TooltipProvider` | `Tooltip` komposisi siap pakai; `TooltipProvider` dipasang sekali di root |
| `progress.tsx` | `Progress` | shimmer sweep; prop `indeterminate` |
| `toast.tsx` | `toast.{success,error,info,dismiss}`, `Toaster` | imperative, auto-dismiss 4s, portal, GPU slide-in |
| `badge.tsx` | `Badge`, `badgeVariants` | varian `accent/success/warning/danger/outline` |
| `skeleton.tsx` | `Skeleton` | shimmer GPU-only |
| `separator.tsx` | `Separator` | `orientation: horizontal \| vertical` |
| `spinner.tsx` | `Spinner` | prop `size` |

## Animasi (web/src/styles/animations.css)

Utility: `.anim-cyber-grid`, `.anim-orb-float`, `.anim-text-shimmer`,
`.anim-border-glow`, `.anim-cursor-blink`, `.anim-fade-in`,
`.anim-slide-up-in`, `.anim-slide-down-in`, `.anim-scale-in`,
`.anim-slide-in-right`, `.anim-marquee`.

Semua hanya menganimasikan `transform` / `opacity` / `filter` /
`background-position` (teks) — aman untuk compositor. Semua non-esensial
dimatikan lewat `@media (prefers-reduced-motion: reduce)`.

## Font

`--font-display` menunjuk ke `'Space Grotesk'` dengan fallback system; jika
ingin self-host, letakkan woff2 di `web/public/fonts/` dan tambahkan
`@font-face` di `tokens.css`. Tanpa file font, fallback system tetap konsisten.

## Catatan integrasi

- `globals.css` mengimpor `../styles/tokens.css`, `animations.css`,
  `utilities.css` (Tailwind v4 CSS-first, tidak ada `tailwind.config`).
- Kelas legacy `.card`, `.btn`, `.badge` di `globals.css` sudah di-re-skin ke
  palet obsidian sehingga komponen lama tidak putih.
- Tidak ada light mode: `color-scheme: dark` dipaksa di `:root`, tanpa
  override `prefers-color-scheme`.
