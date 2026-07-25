import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ScoreCard } from "./components/ScoreCard";
import { PathPlot } from "./components/PathPlot";
import { analyzeCueBall, scoreCueMetrics } from "./lib/analyzeCueBall";
import { analyzeStroke, scoreWristStraightness } from "./lib/analyzeStroke";
import { trackCueBall } from "./lib/cueBallTrack";
import { drawArmOnly, drawCueBall, drawLineHandles, drawPose, drawSeedMarker, drawTrackOverlay } from "./lib/drawLandmarks";
import { extractFrames } from "./lib/extractFrames";
import type { CueBallFrame, FrameLandmarks, Handedness, Point2D, ViewAngle } from "./lib/types";

type Stage = "idle" | "loaded" | "processing" | "ready";
type CueBallStage = "idle" | "seed-ball" | "seed-cue" | "tracking" | "done" | "error";
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

type LineKey = "wrist" | "cue";
type LineHandle = { line: LineKey; endpoint: 0 | 1 };
const HANDLE_HIT_RADIUS = 0.05;

function nearestByTime<T extends { timeMs: number }>(items: T[], timeMs: number): T | null {
  if (items.length === 0) return null;
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(items[lo - 1].timeMs - timeMs) < Math.abs(items[lo].timeMs - timeMs)) {
    return items[lo - 1];
  }
  return items[lo];
}

function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<FrameLandmarks[]>([]);
  const [hand, setHand] = useState<Handedness>("right");
  const [viewAngle, setViewAngle] = useState<ViewAngle>("side");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [processedRange, setProcessedRange] = useState<{ start: number; end: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cbStage, setCbStage] = useState<CueBallStage>("idle");
  const [ballSeed, setBallSeed] = useState<Point2D | null>(null);
  const [cueBallFrames, setCueBallFrames] = useState<CueBallFrame[]>([]);
  const [cbProgress, setCbProgress] = useState(0);
  const [cbError, setCbError] = useState<string | null>(null);

  const [showGuideLines, setShowGuideLines] = useState(true);
  const [armOnly, setArmOnly] = useState(false);
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });

  const [lineEditMode, setLineEditMode] = useState(false);
  const [wristLineOverride, setWristLineOverride] = useState<[Point2D, Point2D] | null>(null);
  const [cueLineOverride, setCueLineOverride] = useState<[Point2D, Point2D] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pinchStateRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const dragHandleRef = useRef<LineHandle | null>(null);

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

  function seedingActive() {
    return cbStage === "seed-ball" || cbStage === "seed-cue";
  }

  function toNormalizedPoint(clientX: number, clientY: number): Point2D {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  function nearestHandle(p: Point2D): LineHandle | null {
    const candidates: { handle: LineHandle; pt: Point2D }[] = [];
    if (displayedWristLine) {
      candidates.push({ handle: { line: "wrist", endpoint: 0 }, pt: displayedWristLine[0] });
      candidates.push({ handle: { line: "wrist", endpoint: 1 }, pt: displayedWristLine[1] });
    }
    if (displayedCueLine) {
      candidates.push({ handle: { line: "cue", endpoint: 0 }, pt: displayedCueLine[0] });
      candidates.push({ handle: { line: "cue", endpoint: 1 }, pt: displayedCueLine[1] });
    }
    let best: LineHandle | null = null;
    let bestDist = HANDLE_HIT_RADIUS;
    for (const c of candidates) {
      const d = Math.hypot(c.pt.x - p.x, c.pt.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = c.handle;
      }
    }
    return best;
  }

  function moveHandle(handle: LineHandle, p: Point2D) {
    const setter = handle.line === "wrist" ? setWristLineOverride : setCueLineOverride;
    const base = handle.line === "wrist" ? displayedWristLine : displayedCueLine;
    setter((prev) => {
      const current = prev ?? base ?? [p, p];
      const next: [Point2D, Point2D] = [current[0], current[1]];
      next[handle.endpoint] = p;
      return next;
    });
  }

  function beginPointerInteraction(clientX: number, clientY: number): boolean {
    if (lineEditMode) {
      const p = toNormalizedPoint(clientX, clientY);
      const handle = nearestHandle(p);
      if (handle) {
        dragHandleRef.current = handle;
        return true;
      }
      return false;
    }
    if (zoom.scale > 1 && !seedingActive()) {
      dragStateRef.current = { startX: clientX, startY: clientY, origX: zoom.x, origY: zoom.y };
      return true;
    }
    return false;
  }

  function movePointerInteraction(clientX: number, clientY: number) {
    if (dragHandleRef.current) {
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
    } else if (e.touches.length === 1 && (dragHandleRef.current || dragStateRef.current)) {
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
    resetCueBall();
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

  const cueBallAnalysis = useMemo(() => {
    if (cbStage !== "done") return null;
    return analyzeCueBall(cueBallFrames);
  }, [cueBallFrames, cbStage]);

  const displayedWristLine = wristLineOverride ?? analysis?.fittedLine ?? null;
  const displayedCueLine = cueLineOverride ?? cueBallAnalysis?.fittedLine ?? null;

  // When the ideal line is manually edited, rescore against the edited line instead
  // of the auto-fit one, so the score card always matches what's drawn on screen.
  const effectiveAnalysis = useMemo(() => {
    if (!analysis || !wristLineOverride) return analysis;
    const updated = scoreWristStraightness(analysis.wristPath, wristLineOverride, analysis.scale, viewAngle);
    const metrics = analysis.metrics.map((m) => (m.key === "straightness" ? updated : m));
    const overallScore = Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length);
    return { ...analysis, metrics, overallScore };
  }, [analysis, wristLineOverride, viewAngle]);

  const effectiveCueBallAnalysis = useMemo(() => {
    if (!cueBallAnalysis || !cueLineOverride) return cueBallAnalysis;
    const metrics = scoreCueMetrics(cueBallAnalysis.prePath, cueLineOverride, cueBallAnalysis.ballPosition);
    return { ...cueBallAnalysis, metrics };
  }, [cueBallAnalysis, cueLineOverride]);

  // A fresh analysis (new trim/hand/angle/tracking run) invalidates any manual line edit.
  useEffect(() => {
    setWristLineOverride(null);
  }, [analysis]);

  useEffect(() => {
    setCueLineOverride(null);
  }, [cueBallAnalysis]);

  // Continuously draw the skeleton, guide lines, and cue/ball overlay in sync with video playback/scrubbing.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      if (!video || !canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = nearestByTime(frames, video.currentTime * 1000);
      if (frame) {
        if (armOnly) drawArmOnly(ctx, frame.landmarks, hand, canvas.width, canvas.height);
        else drawPose(ctx, frame.landmarks);
      }
      if (showGuideLines && analysis) {
        drawTrackOverlay(
          ctx,
          analysis.wristPath,
          displayedWristLine,
          canvas.width,
          canvas.height,
          "rgba(255, 213, 74, 0.6)",
          "#F472B6"
        );
      }
      const cbFrame = nearestByTime(cueBallFrames, video.currentTime * 1000);
      if (showGuideLines && cueBallAnalysis) {
        drawTrackOverlay(
          ctx,
          cueBallAnalysis.cuePath,
          displayedCueLine,
          canvas.width,
          canvas.height,
          "rgba(56, 189, 248, 0.6)",
          "#F472B6"
        );
      }
      if (lineEditMode) {
        if (displayedWristLine) drawLineHandles(ctx, displayedWristLine, canvas.width, canvas.height, "#F472B6");
        if (displayedCueLine) drawLineHandles(ctx, displayedCueLine, canvas.width, canvas.height, "#F472B6");
      }
      if (cbFrame && (cbStage === "done" || cbStage === "tracking")) {
        drawCueBall(ctx, cbFrame.ball, cbFrame.cueTip, canvas.width, canvas.height);
      }
      if (cbStage === "seed-cue" && ballSeed) {
        drawSeedMarker(ctx, ballSeed, "#FF6B6B", canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    frames,
    cueBallFrames,
    cbStage,
    ballSeed,
    analysis,
    cueBallAnalysis,
    showGuideLines,
    armOnly,
    hand,
    lineEditMode,
    displayedWristLine,
    displayedCueLine,
  ]);

  function resetCueBall() {
    setCbStage("idle");
    setBallSeed(null);
    setCueBallFrames([]);
    setCbProgress(0);
    setCbError(null);
  }

  function startCueBallSeeding() {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = trimStart;
    setBallSeed(null);
    setCbError(null);
    setCbStage("seed-ball");
  }

  function handleStageClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (cbStage !== "seed-ball" && cbStage !== "seed-cue") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point: Point2D = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    if (cbStage === "seed-ball") {
      setBallSeed(point);
      setCbStage("seed-cue");
    } else {
      runCueBallTracking(point);
    }
  }

  async function runCueBallTracking(cueSeedPoint: Point2D) {
    const video = videoRef.current;
    if (!video || !ballSeed) return;
    setCbStage("tracking");
    setCbProgress(0);
    try {
      const result = await trackCueBall(video, trimStart, trimEnd, ballSeed, cueSeedPoint, setCbProgress);
      setCueBallFrames(result);
      setCbStage("done");
    } catch (e) {
      console.error(e);
      setCbError("キュー・ボールの追跡に失敗しました。ボールとキュー先端がはっきり映っている動画でお試しください。");
      setCbStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setVideoUrl(null);
    setFrames([]);
    setProgress(0);
    setProcessedRange(null);
    setError(null);
    resetCueBall();
    resetZoom();
    setLineEditMode(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const avgConfidence =
    cueBallFrames.length > 0
      ? cueBallFrames.reduce((s, f) => s + Math.min(f.ballConfidence, f.cueConfidence), 0) / cueBallFrames.length
      : 0;

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
        <h1>🎱 ビリヤード ストローク解析</h1>
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
                  cursor: lineEditMode ? "crosshair" : zoom.scale > 1 && !seedingActive() ? "grab" : "default",
                }}
              >
                <video
                  ref={videoRef}
                  src={videoUrl ?? undefined}
                  controls
                  playsInline
                  onLoadedMetadata={onLoadedMetadata}
                />
                <canvas
                  ref={canvasRef}
                  className={`overlay ${seedingActive() || lineEditMode ? "overlay-clickable" : ""}`}
                  onClick={handleStageClick}
                />
              </div>
              {seedingActive() && (
                <div className="seed-banner">
                  {cbStage === "seed-ball" ? "① 手球（狙う球）の中心をタップ" : "② キューの先端をタップ"}
                </div>
              )}
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
                  動画上に軌道・理想ラインを表示
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={armOnly} onChange={(e) => setArmOnly(e.target.checked)} />
                  キューを持つ腕以外のポイントを非表示
                </label>
                {analysis && (
                  <p className="hint legend">
                    <span className="legend-swatch" style={{ background: "#FFD54A" }} /> 実際の軌道
                    <span className="legend-swatch" style={{ background: "#F472B6" }} /> 理想の直線
                    {cueBallAnalysis && (
                      <>
                        <span className="legend-swatch" style={{ background: "#38BDF8" }} /> キュー先端の軌道
                      </>
                    )}
                    ・ピンチ / ホイールで動画をズームできます
                  </p>
                )}
                {(displayedWristLine || displayedCueLine) && (
                  <div className="line-edit-row">
                    <button
                      type="button"
                      className={lineEditMode ? "primary-btn" : "ghost-btn"}
                      onClick={() => setLineEditMode((v) => !v)}
                    >
                      {lineEditMode ? "✅ ラインの編集を終える" : "✏️ 理想ラインを編集"}
                    </button>
                    {(wristLineOverride || cueLineOverride) && (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setWristLineOverride(null);
                          setCueLineOverride(null);
                        }}
                      >
                        ↺ 自動計算に戻す
                      </button>
                    )}
                  </div>
                )}
                {lineEditMode && (
                  <p className="hint">
                    ピンクのハンドル（●）をドラッグしてラインを調整できます。編集すると「直線性」「芯を捉えているか」のスコアもこのラインを基準に再計算されます。
                  </p>
                )}

                <div className="cueball-controls">
                  {cbStage === "idle" && (
                    <button type="button" className="ghost-btn wide" onClick={startCueBallSeeding}>
                      🎯 詳細解析（β）: キュー・ボールを検出
                    </button>
                  )}
                  {(cbStage === "seed-ball" || cbStage === "seed-cue") && (
                    <p className="hint">動画の上でタップして位置を指定してください。</p>
                  )}
                  {cbStage === "tracking" && (
                    <div className="progress-wrap">
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${Math.round(cbProgress * 100)}%` }} />
                      </div>
                      <p>キュー・ボールを追跡しています… {Math.round(cbProgress * 100)}%</p>
                    </div>
                  )}
                  {(cbStage === "done" || cbStage === "error") && (
                    <button type="button" className="ghost-btn" onClick={resetCueBall}>
                      詳細解析をやり直す
                    </button>
                  )}
                  {cbError && <p className="error">{cbError}</p>}
                </div>

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

              <div className="metrics-grid">
                {effectiveAnalysis.metrics.map((m) => (
                  <ScoreCard key={m.key} metric={m} />
                ))}
              </div>

              <div className="path-section">
                <div>
                  <h3>手首の軌道</h3>
                  <p className="hint">
                    点が薄い→濃いの順で時間経過を表します。動画上のマーカーの秒数が、今の再生位置に対応するタイミングです。
                  </p>
                </div>
                <PathPlot points={effectiveAnalysis.wristPath} line={displayedWristLine} />
              </div>

              {effectiveCueBallAnalysis && (
                <div className="cueball-results">
                  <h3>詳細解析（キュー・ボール, β）</h3>
                  {avgConfidence < 0.4 && (
                    <p className="hint warning">
                      追跡の信頼度が低めです。照明やボールとキューの映り具合によって精度が変わります。参考程度にご覧ください。
                    </p>
                  )}
                  <div className="metrics-grid">
                    {effectiveCueBallAnalysis.metrics.map((m) => (
                      <ScoreCard key={m.key} metric={m} />
                    ))}
                  </div>
                  <div className="path-section">
                    <div>
                      <h3>キュー先端の軌道（実測）</h3>
                      <p className="hint">赤丸がボール、点は薄い→濃いの順で時間経過を表すキュー先端の軌道です。</p>
                    </div>
                    <PathPlot points={effectiveCueBallAnalysis.cuePath} line={displayedCueLine} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
