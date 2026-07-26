import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ScoreCard } from "./components/ScoreCard";
import { PathPlot } from "./components/PathPlot";
import { HistoryList } from "./components/HistoryList";
import { analyzeStroke, scoreWristStraightness } from "./lib/analyzeStroke";
import { drawLineHandles, drawTrackOverlay } from "./lib/drawLandmarks";
import { extractFrames } from "./lib/extractFrames";
import { deleteResult, loadHistory, saveResult, updateResult } from "./lib/history";
import type { FrameLandmarks, Handedness, Point2D, SavedResult, ViewAngle } from "./lib/types";

type Stage = "idle" | "loaded" | "processing" | "ready";
type ZoomState = { scale: number; x: number; y: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clampZoomState(z: ZoomState, containerW: number, containerH: number): ZoomState {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z.scale));
  const maxX = (containerW * (scale - 1)) / 2;
  const maxY = (containerH * (scale - 1)) / 2;
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, z.x)),
    y: Math.min(maxY, Math.max(-maxY, z.y)),
  };
}

function touchDistance(touches: React.TouchList): number {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

// The ideal-line editor only ever has one line (the wrist trajectory fit) now
// that cue tracking has been removed, so a handle is just "which endpoint".
type LineEndpoint = 0 | 1;
const HANDLE_HIT_RADIUS = 0.05;

function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<FrameLandmarks[]>([]);
  const [hand, setHand] = useState<Handedness>("right");
  const [viewAngle, setViewAngle] = useState<ViewAngle>("front");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [processedRange, setProcessedRange] = useState<{ start: number; end: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showGuideLines, setShowGuideLines] = useState(true);
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });

  const [lineEditMode, setLineEditMode] = useState(false);
  const [wristLineOverride, setWristLineOverride] = useState<[Point2D, Point2D] | null>(null);

  const [history, setHistory] = useState<SavedResult[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pinchStateRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const dragHandleRef = useRef<LineEndpoint | null>(null);

  function updateZoom(updater: (z: ZoomState) => ZoomState) {
    setZoom((z) => {
      const next = updater(z);
      const el = stageRef.current;
      const w = el?.clientWidth ?? 1;
      const h = el?.clientHeight ?? 1;
      return clampZoomState(next, w, h);
    });
  }

  function resetZoom() {
    setZoom({ scale: 1, x: 0, y: 0 });
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    updateZoom((z) => ({ ...z, scale: z.scale * factor }));
  }

  function toNormalizedPoint(clientX: number, clientY: number): Point2D {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  function nearestHandle(p: Point2D): LineEndpoint | null {
    if (!displayedWristLine) return null;
    let best: LineEndpoint | null = null;
    let bestDist = HANDLE_HIT_RADIUS;
    (displayedWristLine as [Point2D, Point2D]).forEach((pt, i) => {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = i as LineEndpoint;
      }
    });
    return best;
  }

  function moveHandle(endpoint: LineEndpoint, p: Point2D) {
    setWristLineOverride((prev) => {
      const current = prev ?? displayedWristLine ?? [p, p];
      const next: [Point2D, Point2D] = [current[0], current[1]];
      next[endpoint] = p;
      return next;
    });
  }

  function beginPointerInteraction(clientX: number, clientY: number): boolean {
    if (lineEditMode) {
      const p = toNormalizedPoint(clientX, clientY);
      const handle = nearestHandle(p);
      if (handle !== null) {
        dragHandleRef.current = handle;
        return true;
      }
      return false;
    }
    if (zoom.scale > 1) {
      dragStateRef.current = { startX: clientX, startY: clientY, origX: zoom.x, origY: zoom.y };
      return true;
    }
    return false;
  }

  function movePointerInteraction(clientX: number, clientY: number) {
    if (dragHandleRef.current !== null) {
      moveHandle(dragHandleRef.current, toNormalizedPoint(clientX, clientY));
      return;
    }
    const drag = dragStateRef.current;
    if (!drag) return;
    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    updateZoom((z) => ({ ...z, x: drag.origX + dx, y: drag.origY + dy }));
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchStateRef.current = { startDist: touchDistance(e.touches), startScale: zoom.scale };
    } else if (e.touches.length === 1) {
      beginPointerInteraction(e.touches[0].clientX, e.touches[0].clientY);
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchStateRef.current) {
      e.preventDefault();
      const dist = touchDistance(e.touches);
      const scale = pinchStateRef.current.startScale * (dist / pinchStateRef.current.startDist);
      updateZoom((z) => ({ ...z, scale }));
    } else if (e.touches.length === 1 && (dragHandleRef.current !== null || dragStateRef.current)) {
      e.preventDefault();
      movePointerInteraction(e.touches[0].clientX, e.touches[0].clientY);
    }
  }

  function handleTouchEnd() {
    pinchStateRef.current = null;
    dragStateRef.current = null;
    dragHandleRef.current = null;
  }

  function handleMouseDown(e: React.MouseEvent) {
    beginPointerInteraction(e.clientX, e.clientY);
  }

  function handleMouseMove(e: React.MouseEvent) {
    movePointerInteraction(e.clientX, e.clientY);
  }

  function handleDragEnd() {
    dragStateRef.current = null;
    dragHandleRef.current = null;
  }

  function handleFile(file: File) {
    setError(null);
    setFrames([]);
    setProgress(0);
    setProcessedRange(null);
    resetZoom();
    setLineEditMode(false);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setStage("loaded");
  }

  // Frame-advances the video to match a trim-slider handle being dragged.
  function seekVideoTo(t: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = t;
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }

  // Custom controls live below the video (not overlaid on it) so they never
  // sit on top of the person in frame; this keeps them in sync with the
  // underlying <video> element regardless of what else drives playback/seeking.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setPlaybackTime(video.currentTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [videoUrl]);

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setTrimStart(0);
    setTrimEnd(video.duration);
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
  }

  async function startProcessing() {
    const video = videoRef.current;
    if (!video) return;
    setStage("processing");
    setError(null);
    const range = { start: trimStart, end: trimEnd };
    try {
      const result = await extractFrames(video, range.start, range.end, setProgress);
      if (result.length < 5) {
        setError("人物の姿勢をうまく検出できませんでした。人物全体が映る動画でお試しください。");
        setStage("loaded");
        return;
      }
      setFrames(result);
      setProcessedRange(range);
      setStage("ready");
      video.currentTime = range.start;
    } catch (e) {
      console.error(e);
      setError("解析中にエラーが発生しました。別の動画でお試しください。");
      setStage("loaded");
    }
  }

  const trimmedFrames = useMemo(
    () => frames.filter((f) => f.timeMs >= trimStart * 1000 && f.timeMs <= trimEnd * 1000),
    [frames, trimStart, trimEnd]
  );

  const analysis = useMemo(() => {
    if (stage !== "ready" || trimmedFrames.length < 5) return null;
    return analyzeStroke(trimmedFrames, hand, viewAngle);
  }, [trimmedFrames, hand, viewAngle, stage]);

  const displayedWristLine = wristLineOverride ?? analysis?.fittedLine ?? null;

  // When the ideal line is manually edited, rescore against the edited line instead
  // of the auto-fit one, so the score card always matches what's drawn on screen.
  const effectiveAnalysis = useMemo(() => {
    if (!analysis || !wristLineOverride) return analysis;
    const updated = scoreWristStraightness(analysis.wristPath, wristLineOverride, analysis.scale, viewAngle);
    const metrics = analysis.metrics.map((m) => (m.key === "straightness" ? updated : m));
    const overallScore = Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length);
    return { ...analysis, metrics, overallScore };
  }, [analysis, wristLineOverride, viewAngle]);

  // A manually-edited ideal line stays put across evaluation-range (timeline) changes,
  // since that's just narrowing/widening the scored window on the same footage. It only
  // resets on a genuinely new processing run or a hand/angle change, since those change
  // what's actually being measured.
  useEffect(() => {
    setWristLineOverride(null);
  }, [frames, hand, viewAngle]);

  // Continuously draw the wrist trajectory + ideal line in sync with video playback/scrubbing.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      if (!video || !canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (showGuideLines && analysis) {
        drawTrackOverlay(ctx, analysis.wristPath, displayedWristLine, canvas.width, canvas.height, "255, 213, 74", "#F472B6");
      }
      if (lineEditMode && displayedWristLine) {
        drawLineHandles(ctx, displayedWristLine, canvas.width, canvas.height, "#F472B6");
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analysis, showGuideLines, lineEditMode, displayedWristLine]);

  function handleSaveResult() {
    if (!effectiveAnalysis) return;
    const result: SavedResult = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: Date.now(),
      hand,
      viewAngle,
      overallScore: effectiveAnalysis.overallScore,
      metrics: effectiveAnalysis.metrics.map((m) => ({ label: m.label, score: m.score })),
    };
    setHistory(saveResult(result));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  function handleDeleteHistoryItem(id: string) {
    setHistory(deleteResult(id));
  }

  function handleUpdateHistoryItem(id: string, patch: Partial<SavedResult>) {
    setHistory(updateResult(id, patch));
  }

  function reset() {
    setStage("idle");
    setVideoUrl(null);
    setFrames([]);
    setProgress(0);
    setProcessedRange(null);
    setError(null);
    resetZoom();
    setLineEditMode(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const handAngleSelectors = (
    <>
      <label className="hand-select">
        利き手:
        <select value={hand} onChange={(e) => setHand(e.target.value as Handedness)}>
          <option value="right">右</option>
          <option value="left">左</option>
        </select>
      </label>
      <label className="hand-select">
        撮影アングル:
        <select value={viewAngle} onChange={(e) => setViewAngle(e.target.value as ViewAngle)}>
          <option value="side">真横から</option>
          <option value="front">正面から</option>
        </select>
      </label>
    </>
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎱 ストローク解析君</h1>
        <p className="subtitle">動画をアップロードすると、フォームの修正ポイントをAIが自動で採点します。</p>
      </header>

      {stage === "idle" && (
        <div className="upload-zone">
          <div className="upload-actions">
            <button type="button" className="primary-btn" onClick={() => fileInputRef.current?.click()}>
              動画を選択
            </button>
            <button type="button" className="ghost-btn wide" onClick={() => cameraInputRef.current?.click()}>
              📷 カメラで撮影
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <p className="hint">
            構えからフォロースルーまで、体全体が映った動画をアップロードしてください（真横・正面どちらの撮影にも対応しています）。
          </p>
        </div>
      )}

      {stage === "idle" && (
        <HistoryList items={history} onDelete={handleDeleteHistoryItem} onUpdate={handleUpdateHistoryItem} />
      )}

      {stage !== "idle" && (
        <div className="workspace">
          <div className="video-panel">
            <div
              className="video-stage"
              ref={stageRef}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleDragEnd}
              onMouseLeave={handleDragEnd}
            >
              <div
                className="zoom-wrapper"
                style={{
                  transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                  cursor: lineEditMode ? "crosshair" : zoom.scale > 1 ? "grab" : "default",
                }}
              >
                <video ref={videoRef} src={videoUrl ?? undefined} playsInline onLoadedMetadata={onLoadedMetadata} />
                <canvas ref={canvasRef} className={`overlay ${lineEditMode ? "overlay-clickable" : ""}`} />
              </div>
              {lineEditMode && <div className="seed-banner">ハンドル（●）をドラッグしてラインを調整</div>}
              <div className="zoom-controls">
                <button type="button" onClick={() => updateZoom((z) => ({ ...z, scale: z.scale * 1.4 }))}>
                  ＋
                </button>
                <button type="button" onClick={() => updateZoom((z) => ({ ...z, scale: z.scale / 1.4 }))}>
                  −
                </button>
                {zoom.scale > 1 && (
                  <button type="button" onClick={resetZoom}>
                    ⟲
                  </button>
                )}
              </div>
            </div>

            <div className="custom-controls">
              <button type="button" className="play-btn" onClick={togglePlay} aria-label={isPlaying ? "一時停止" : "再生"}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <input
                type="range"
                className="seek-slider"
                min={0}
                max={duration || 0}
                step={0.01}
                value={playbackTime}
                onChange={(e) => seekVideoTo(Number(e.target.value))}
              />
              <span className="time-label">
                {formatTime(playbackTime)} / {formatTime(duration)}
              </span>
            </div>

            {stage === "loaded" && (
              <div className="controls">
                {handAngleSelectors}
                <div className="trim-row">
                  <span>解析範囲:</span>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.05}
                    value={trimStart}
                    onChange={(e) => {
                      const v = Math.min(Number(e.target.value), trimEnd - 0.1);
                      setTrimStart(v);
                      seekVideoTo(v);
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.05}
                    value={trimEnd}
                    onChange={(e) => {
                      const v = Math.max(Number(e.target.value), trimStart + 0.1);
                      setTrimEnd(v);
                      seekVideoTo(v);
                    }}
                  />
                  <span className="trim-label">
                    {trimStart.toFixed(1)}s - {trimEnd.toFixed(1)}s
                  </span>
                </div>
                <p className="hint">
                  実際にストロークしている部分だけに絞るほど解析が速く終わります（動画全体を解析すると時間がかかります）。
                </p>
                <button type="button" className="primary-btn" onClick={startProcessing}>
                  解析を開始する
                </button>
                <button type="button" className="ghost-btn" onClick={reset}>
                  動画を選び直す
                </button>
              </div>
            )}

            {stage === "processing" && (
              <div className="progress-wrap">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p>姿勢を解析しています… {Math.round(progress * 100)}%</p>
              </div>
            )}

            {stage === "ready" && processedRange && (
              <div className="controls">
                {handAngleSelectors}
                <div className="trim-row">
                  <span>評価範囲:</span>
                  <input
                    type="range"
                    min={processedRange.start}
                    max={processedRange.end}
                    step={0.05}
                    value={trimStart}
                    onChange={(e) => {
                      const v = Math.min(Number(e.target.value), trimEnd - 0.1);
                      setTrimStart(v);
                      seekVideoTo(v);
                    }}
                  />
                  <input
                    type="range"
                    min={processedRange.start}
                    max={processedRange.end}
                    step={0.05}
                    value={trimEnd}
                    onChange={(e) => {
                      const v = Math.max(Number(e.target.value), trimStart + 0.1);
                      setTrimEnd(v);
                      seekVideoTo(v);
                    }}
                  />
                  <span className="trim-label">
                    {trimStart.toFixed(1)}s - {trimEnd.toFixed(1)}s
                  </span>
                </div>
                <p className="hint">
                  スライダーで、実際に打つ「ストローク動作」の区間だけに絞ると、より正確な評価になります。
                </p>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={showGuideLines}
                    onChange={(e) => setShowGuideLines(e.target.checked)}
                  />
                  動画上に手首の軌道ポイント・理想ラインを表示
                </label>
                {analysis && (
                  <p className="hint legend">
                    <span className="legend-swatch" style={{ background: "#FFD54A" }} /> 実際の軌道
                    <span className="legend-swatch" style={{ background: "#F472B6" }} /> 理想の直線
                    ・ピンチ / ホイールで動画をズームできます
                  </p>
                )}
                {displayedWristLine && (
                  <div className="line-edit-row">
                    <button
                      type="button"
                      className={lineEditMode ? "primary-btn" : "ghost-btn"}
                      onClick={() => setLineEditMode((v) => !v)}
                    >
                      {lineEditMode ? "✅ ラインの編集を終える" : "✏️ 理想ラインを編集"}
                    </button>
                    {wristLineOverride && (
                      <button type="button" className="ghost-btn" onClick={() => setWristLineOverride(null)}>
                        ↺ 自動計算に戻す
                      </button>
                    )}
                  </div>
                )}
                {lineEditMode && (
                  <p className="hint">
                    ピンクのハンドル（●）をドラッグしてラインを調整できます。編集すると「直線性」のスコアもこのラインを基準に再計算されます。
                  </p>
                )}

                <button type="button" className="ghost-btn" onClick={reset}>
                  別の動画を解析する
                </button>
              </div>
            )}

            {error && <p className="error">{error}</p>}
          </div>

          {effectiveAnalysis && (
            <div className="results-panel">
              <div className="overall-score">
                <div className="overall-score-ring">{effectiveAnalysis.overallScore}</div>
                <div>
                  <h2>総合スコア</h2>
                  <p className="hint">4つの観点からストロークを自動採点しています。</p>
                </div>
              </div>

              <div className="save-result-row">
                <button type="button" className="ghost-btn" onClick={handleSaveResult}>
                  💾 この結果を保存
                </button>
                {savedFlash && <span className="save-flash">保存しました ✓</span>}
              </div>

              <div className="metrics-grid">
                {effectiveAnalysis.metrics.map((m) => (
                  <ScoreCard key={m.key} metric={m} />
                ))}
              </div>

              <div className="path-section">
                <div>
                  <h3>手首の軌道</h3>
                  <p className="hint">点が薄い→濃いの順で時間経過を表します。</p>
                </div>
                <PathPlot points={effectiveAnalysis.wristPath} line={displayedWristLine} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
