/**
 * HotClip Pipeline — 公共管线入口(thin adapter)。
 *
 * 本文件不再包含管线计算逻辑,仅做公共 API 入口。将高层切片管线
 * (transcribeCached / detectForPipeline / autoClip / analyzeReferenceVideo
 * 等)交由 `../shared/pipeline` 提供,以保持 CLI、MCP、录播监听、桌面端
 * 的导入契约一致。纯计算走 `../shared/pipeline`,I/O 经 Deps 注入。
 */

export * from "../shared/pipeline";
export type { PipelineDeps, AutoClipConfig, AutoClipResult } from "../shared/pipeline";