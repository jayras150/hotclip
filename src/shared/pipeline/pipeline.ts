/**
 * HotClip Pipeline — 端侧切片管线(共享、与运行时无关)高层 API。
 *
 * 封装 CLI / MCP / 桌面端 / 录播监听 共用的高层切片流程:
 * 转写 → 找爆点 → 导出。纯计算部分复用 `./` 的纯函数,
 * I/O (转写模型/LLM/export/探针/检测) 通过 Deps 注入,保证
 * 本地桌面端与 Vast.ai 容器在同一套决策逻辑下通过各自 I/O 者运行。
 */

import { join, dirname, basename, extname } from "path";
import { stat } from "fs/promises";
import type {
  GlossaryEntry,
  LlmConfig,
  Transcript,
  HighlightCandidate,
  DetectionOptions,
  SpeechRunOptions,
  ExportedClip,
} from "../api-types";
import type { AnalysisVideoOptions } from "../../core/analysis-video";
import type { ReferenceProfile } from "../../core/reference";
import type { ReviewRecord } from "../../core/review-memory";
import type { PerformanceEntry } from "../../shared/api-types";
import { applyGlossaryToTranscript } from "../glossary";
import { sliceWords } from "../../core/subtitle";
import { wordsInPieces } from "../pieces";
import { collectEmotionSignal } from "../../core/emotion";
import { collectDanmakuSignal } from "../../core/danmaku";
import { collectVoiceEmotionSignal } from "../../core/voice-emotion";
import { exportClips, sanitizeFilename } from "../../core/export";
import { probeMedia } from "../../core/probe";
import { planColorRender } from "../../core/color";
import { parseGenre } from "../../core/genre";
import { detectShotBoundariesEvidence, collectSignalsEvidence } from "../../core/media-evidence";
import { buildReferenceProfile } from "../../core/reference";
import { SenseVoiceEngine } from "../../core/transcribe/sensevoice";
import { ParaformerEngine } from "../../core/transcribe/paraformer";
import { FireRedEngine } from "../../core/transcribe/firered";
import { QwenLocalEngine } from "../../core/transcribe/qwen-local";
import { importSubtitleFile } from "../../core/subtitle-import";
import { readTranscriptCache, writeTranscriptCache } from "../../core/transcribe/cache";
import { detectHighlights } from "../../core/highlight/detect";
import { isClipLength, normalizeMaxClips } from "../detection-options";

export interface PipelineDeps {
  modelsRoot: string;
  cacheDir: string;
  renderCacheDir?: string;
  evidenceCacheDir?: string;
  llm: LlmConfig;
  fontsDir?: string;
  outDir?: string;
  onStage?: (stage: "transcribing" | "detecting" | "exporting") => void;
  signal?: AbortSignal;
}

export interface AutoClipConfig extends DetectionOptions {
  modelsRoot: string;
  cacheDir: string;
  subtitlePath?: string;
  asr?: SpeechRunOptions & { engineId?: string };
  renderCacheDir?: string;
  evidenceCacheDir?: string;
  llm: LlmConfig;
  outDir?: string;
  fontsDir?: string;
  glossary?: GlossaryEntry[];
  vertical?: boolean;
  captions?: boolean;
  autoEnhance?: boolean;
  denoiseMode?: "basic" | "smart";
  reference?: ReferenceProfile;
  reviewMemory?: ReviewRecord[];
  performanceMemory?: PerformanceEntry[];
  onStage?: (stage: "transcribing" | "detecting" | "exporting") => void;
  signal?: AbortSignal;
}

export interface AutoClipResult {
  outDir: string;
  transcript: Transcript;
  candidates: HighlightCandidate[];
  exported: ExportedClip[];
}

export async function transcribeCached(
  videoPath: string,
  modelsRoot: string,
  cacheDir: string,
  glossary?: GlossaryEntry[],
  signal?: AbortSignal,
  subtitlePath?: string,
  asr: SpeechRunOptions & { engineId?: string } = {}
): Promise<Transcript> {
  signal?.throwIfAborted();
  if (subtitlePath !== undefined) return importSubtitleFile(videoPath, subtitlePath, signal);
  const s = await stat(videoPath).catch(() => null);
  if (!s || !s.isFile()) throw new Error("文件不存在或不可读: " + videoPath);
  const fileStat = { size: s.size, mtimeMs: s.mtimeMs };
  const applied = (t: Transcript): Transcript => applyGlossaryToTranscript(t, glossary ?? []).transcript;
  const engineId = asr.engineId ?? "sensevoice";
  if (!["sensevoice", "paraformer", "fireredasr", "qwen3"].includes(engineId)) throw new Error("Unknown local ASR engine");
  const cached = !asr.restart && engineId !== "qwen3" ? await readTranscriptCache(cacheDir, videoPath, fileStat, engineId) : undefined;
  if (cached) return applied(cached);
  const engine = engineId === "qwen3" ? new QwenLocalEngine(asr.localServiceUrl)
    : engineId === "paraformer" ? new ParaformerEngine(modelsRoot)
    : engineId === "fireredasr" ? new FireRedEngine(modelsRoot) : new SenseVoiceEngine(modelsRoot);
  const t = await engine.transcribe(videoPath, { ...asr, signal, cacheDir });
  if (engineId !== "qwen3") await writeTranscriptCache(cacheDir, videoPath, fileStat, engineId, t).catch(() => {});
  return applied(t);
}

export async function analyzeReferenceVideo(
  refPath: string,
  cfg: Pick<AutoClipConfig, "modelsRoot" | "cacheDir" | "evidenceCacheDir" | "glossary" | "signal">
): Promise<ReferenceProfile> {
  const transcript = await transcribeCached(refPath, cfg.modelsRoot, cfg.cacheDir, cfg.glossary, cfg.signal);
  const durationSec =
    transcript.durationSec > 0
      ? transcript.durationSec
      : transcript.segments[transcript.segments.length - 1]?.endSec ?? 0;
  const media = await probeMedia(refPath).catch(() => null);
  const analysis: AnalysisVideoOptions = media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {};
  const boundaries = await detectShotBoundariesEvidence({
    videoPath: refPath,
    startSec: 0,
    endSec: durationSec,
    modelsRoot: cfg.modelsRoot,
    evidenceDir: cfg.evidenceCacheDir,
    signal: cfg.signal,
    analysis,
  }).catch(() => null);
  return buildReferenceProfile(transcript, boundaries);
}

export async function detectForPipeline(
  videoPath: string,
  transcript: Transcript,
  cfg: Pick<AutoClipConfig, "modelsRoot" | "evidenceCacheDir" | "llm" | "maxClips" | "clipLength" | "genre" | "reference" | "reviewMemory" | "performanceMemory" | "signal">
): Promise<HighlightCandidate[]> {
  const selection = validateDetectionOptions(cfg);
  if (transcript.segments.length === 0) throw new Error("转写结果为空(可能是无人声素材)");
  const media = await probeMedia(videoPath).catch(() => null);
  const analysis: AnalysisVideoOptions = media?.hasVideo
    ? { videoStreamIndex: media.videoStreamIndex, color: planColorRender(media) }
    : {};
  const signals = await collectSignalsEvidence({
    videoPath,
    evidenceDir: cfg.evidenceCacheDir,
    signal: cfg.signal,
    analysis,
  }).catch((error) => {
    if (cfg.signal?.aborted) throw error;
    return undefined;
  });
  const danmaku = await collectDanmakuSignal(videoPath, transcript.durationSec);
  const guided = danmaku
    ? { loudPeaks: [], cutDense: [], ...signals, danmakuPeaks: danmaku.danmakuPeaks }
    : signals;
  const emotion = await collectEmotionSignal({
    videoPath,
    durationSec: transcript.durationSec,
    modelsRoot: cfg.modelsRoot,
    signals: guided,
  }).catch(() => null);
  const voice = await collectVoiceEmotionSignal({
    videoPath,
    durationSec: transcript.durationSec,
    modelsRoot: cfg.modelsRoot,
    signals: guided,
  }).catch(() => null);
  const merged =
    emotion || voice
      ? {
          loudPeaks: [],
          cutDense: [],
          ...guided,
          ...(emotion ? { emotionPeaks: emotion.emotionPeaks } : {}),
          ...(voice
            ? { voiceEmotionPeaks: voice.voiceEmotionPeaks, audioEventPeaks: voice.audioEventPeaks }
            : {}),
        }
      : guided;
  const outcome = await detectHighlights(
    transcript, cfg.llm, cfg.signal, merged,
    undefined, selection.clipLength, undefined, cfg.reference, cfg.reviewMemory,
    selection.genre, undefined, cfg.performanceMemory, cfg.maxClips
  );
  return outcome.candidates.slice(0, selection.maxClips);
}

export async function autoClip(videoPath: string, cfg: AutoClipConfig): Promise<AutoClipResult> {
  cfg.signal?.throwIfAborted();
  cfg.onStage?.("transcribing");
  const selection = validateDetectionOptions(cfg);
  const transcript = await transcribeCached(videoPath, cfg.modelsRoot, cfg.cacheDir, cfg.glossary, cfg.signal, cfg.subtitlePath, cfg.asr);
  cfg.signal?.throwIfAborted();
  cfg.onStage?.("detecting");
  const candidates = await detectForPipeline(videoPath, transcript, cfg);
  cfg.signal?.throwIfAborted();
  const publishable = candidates.filter((c) => c.recommended && (c.gate === undefined || c.gate === "publish"));
  const outDir = cfg.outDir ?? join(dirname(videoPath), sanitizeFilename(basename(videoPath, extname(videoPath)), "video") + "-hotclip");
  if (publishable.length === 0) return { outDir, transcript, candidates, exported: [] };
  cfg.onStage?.("exporting");
  const vertical = cfg.vertical !== false;
  const captions = cfg.captions !== false;
  const exported = await exportClips(
    videoPath,
    publishable.map((c) => ({
      id: c.id,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      pieces: c.pieces && c.pieces.length > 1 ? c.pieces : undefined,
      words: captions
        ? c.pieces && c.pieces.length > 1
          ? wordsInPieces(sliceWords(transcript, c.startSec, c.endSec), c.pieces)
          : sliceWords(transcript, c.startSec, c.endSec)
        : undefined,
      keywords: c.keywords,
      meta: {
        hook: c.hook,
        score: c.score,
        reason: c.reason,
        text: c.text,
        recommended: c.recommended,
        reviewNote: c.reviewNote,
        visualEvidence: c.visualEvidence,
      },
    })),
    outDir,
    {
      vertical,
      captionStyle: captions ? "keyword" : undefined,
      jumpCut: true,
      cleanFillers: true,
      titleCard: true,
      normalizeLoudness: true,
      autoEnhance: Boolean(cfg.autoEnhance),
      denoise: Boolean(cfg.denoiseMode),
      denoiseMode: cfg.denoiseMode,
      faceTrack: vertical,
      snapToShots: true,
      modelsRoot: cfg.modelsRoot,
      fontsDir: cfg.fontsDir,
      renderCacheDir: cfg.renderCacheDir,
      evidenceCacheDir: cfg.evidenceCacheDir,
      genreId: selection.genre?.id,
    },
    undefined,
    cfg.signal
  );
  return { outDir, transcript, candidates, exported };
}

export function validateDetectionOptions(value: unknown = {}): DetectionOptions & { maxClips: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid detection options");
  const options = value as DetectionOptions;
  if (options.clipLength !== undefined && !isClipLength(options.clipLength)) {
    throw new Error("clipLength: short | standard | long | extended");
  }
  if (options.genre !== undefined && (!options.genre || typeof options.genre !== "object" || Array.isArray(options.genre))) throw new Error("genre must be an object");
  if (options.genre?.id !== undefined && typeof options.genre.id !== "string") throw new Error("genre.id must be a string");
  if (options.genre?.custom !== undefined && typeof options.genre.custom !== "string") throw new Error("genre.custom must be a string");
  return {
    clipLength: options.clipLength,
    maxClips: normalizeMaxClips(options.maxClips),
    genre: parseGenre(options.genre?.id, options.genre?.custom),
  };
}
