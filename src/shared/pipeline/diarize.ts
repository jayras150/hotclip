/**
 * Speaker diarization — "who is speaking when". Layer 1 of the multi-speaker
 * stack: audio-only turns from pyannote segmentation + 3D-Speaker embeddings
 * (both shipped through sherpa-onnx, zero new runtimes). Returns:
 *   - turn list (signal-only, no I/O),
 *   - word→speaker labeling (pure, transcript-transform),
 *   - speaker-count / dominant-speaker / labelTranscript.
 */

import { join } from "path";
import type { Transcript, TranscriptSegment, TranscriptWord } from "../api-types";

export interface SpeakerTurn {
  startSec: number;
  endSec: number;
  /** 0-based cluster id; stable within one run, not across runs. */
  speaker: number;
}

export interface DiarizeOptions {
  /** Known speaker count; omit/-1 = discover via clustering threshold. */
  numSpeakers?: number;
  /** Clustering distance threshold when discovering (lower = more speakers). */
  threshold?: number;
  signal?: AbortSignal;
}

/** Overlap length between a word and a turn, in seconds. */
function overlap(w: TranscriptWord, t: SpeakerTurn): number {
  return Math.max(0, Math.min(w.endSec, t.endSec) - Math.max(w.startSec, t.startSec));
}

/**
 * Label each word with the speaker whose turn overlaps it most (whisperX's
 * assign_word_speakers rule). Words with no overlapping turn adopt the
 * nearest turn within `maxGapSec`, else stay unlabeled.
 */
export function assignWordSpeakers(
  words: TranscriptWord[],
  turns: SpeakerTurn[],
  maxGapSec = 0.5
): TranscriptWord[] {
  if (turns.length === 0) return words;
  return words.map((w) => {
    let best: SpeakerTurn | null = null;
    let bestOverlap = 0;
    for (const t of turns) {
      const o = overlap(w, t);
      if (o > bestOverlap) {
        bestOverlap = o;
        best = t;
      }
    }
    if (!best) {
      let nearest: SpeakerTurn | null = null;
      let nearestGap = Infinity;
      for (const t of turns) {
        const gap = w.startSec > t.endSec ? w.startSec - t.endSec : t.startSec - w.endSec;
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = t;
        }
      }
      if (nearest && nearestGap <= maxGapSec) best = nearest;
    }
    return best ? { ...w, speaker: best.speaker } : w;
  });
}

/** Count distinct speakers in a turn list. */
export function speakerCount(turns: SpeakerTurn[]): number {
  return new Set(turns.map((t) => t.speaker)).size;
}

/** The speaker owning the most word-time in a segment (majority vote). */
export function dominantSpeaker(words: TranscriptWord[]): number | undefined {
  const byId = new Map<number, number>();
  for (const w of words) {
    if (w.speaker === undefined) continue;
    byId.set(w.speaker, (byId.get(w.speaker) ?? 0) + (w.endSec - w.startSec));
  }
  let best: number | undefined;
  let bestDur = 0;
  for (const [id, dur] of byId) {
    if (dur > bestDur) {
      bestDur = dur;
      best = id;
    }
  }
  return best;
}

/**
 * Label a whole transcript: assign each word a speaker (max-overlap), then set
 * each segment's dominant speaker. Returns a new transcript; the original is
 * untouched. Words already carry the labeling for caption coloring downstream.
 */
export function labelTranscript(transcript: Transcript, turns: SpeakerTurn[]): Transcript {
  if (turns.length === 0) return transcript;
  const segments: TranscriptSegment[] = transcript.segments.map((seg) => {
    const words = assignWordSpeakers(seg.words, turns);
    return { ...seg, words, speaker: dominantSpeaker(words) };
  });
  return { ...transcript, segments };
}
