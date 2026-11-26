/**
 * YuNet face detection on raw BGR frames via onnxruntime-node.
 * Decode verified against the 2023mar fixed-640 export: three anchor scales
 * (stride 8/16/32), score = sqrt(cls·obj), box = (col+dx, row+dy, e^dw, e^dh)
 * scaled by stride, greedy NMS. Pure decode is exported for tests.
 */

export const YUNET_INPUT = 640;

export interface FaceBox {
  /** Coordinates in YUNET_INPUT space. */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

interface OrtTensorLike {
  data: Float32Array;
}

export function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Decode raw YuNet outputs into NMS-filtered face boxes. Pure. */
export function decodeYunet(
  outputs: Record<string, OrtTensorLike>,
  scoreThreshold = 0.6,
  nmsIou = 0.45
): FaceBox[] {
  const boxes: FaceBox[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = outputs[`cls_${stride}`]?.data;
    const obj = outputs[`obj_${stride}`]?.data;
    const bbox = outputs[`bbox_${stride}`]?.data;
    if (!cls || !obj || !bbox) continue;
    const fw = YUNET_INPUT / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(
        Math.min(Math.max(cls[i], 0), 1) * Math.min(Math.max(obj[i], 0), 1)
      );
      if (score < scoreThreshold) continue;
      const row = Math.floor(i / fw);
      const col = i % fw;
      const cx = (col + bbox[i * 4]) * stride;
      const cy = (row + bbox[i * 4 + 1]) * stride;
      const bw = Math.exp(bbox[i * 4 + 2]) * stride;
      const bh = Math.exp(bbox[i * 4 + 3]) * stride;
      boxes.push({ score, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
    }
  }
  boxes.sort((a, b) => b.score - a.score);
  const kept: FaceBox[] = [];
  for (const b of boxes) {
    if (kept.every((k) => iou(k, b) < nmsIou)) kept.push(b);
  }
  return kept;
}
