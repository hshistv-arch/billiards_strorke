import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ScoreCard } from "./components/ScoreCard";
import { PathPlot } from "./components/PathPlot";
import { analyzeCueBall } from "./lib/analyzeCueBall";
import { analyzeStroke } from "./lib/analyzeStroke";
import { trackCueBall } from "./lib/cueBallTrack";
import { drawCueBall, drawPose, drawSeedMarker } from "./lib/drawLandmarks";
import { extractFrames } from "./lib/extractFrames";
import type { CueBallFrame, FrameLandmarks, Handedness, Point2D } from "./lib/types";

type Stage = "idle" | "loaded" | "processing" | "ready";
type CueBallStage = "idle" | "seed-ball" | "seed-cue" | "tracking" | "done" | "error";

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
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [cbStage, setCbStage] = useState<CueBallStage>("idle");
  const [ballSeed, setBallSeed] = useState<Point2D | null>(null);
  const [cueBallFrames, setCueBallFrames] = useState<CueBallFrame[]>([]);
  const [cbProgress, setCbProgress] = useState(0);
  const [cbError, setCbError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);
    setFrames([]);
    setProgress(0);
    resetCueBall();
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setStage("loaded");
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
    try {
      const result = await extractFrames(video, setProgress);
      if (result.length < 5) {
        setError("人物の姿勢をうまく検出できませんでした。人物全体が映る動画でお試しください。");
        setStage("loaded");
        return;
      }
      setFrames(result);
      setStage("ready");
      video.currentTime = 0;
    } catch (e) {
      console.error(e);
      setError("解析中にエラーが発生しました。別の動画でお試しください。");
      setStage("loaded");
    }
  }

  // Continuously draw the skeleton + cue/ball overlay in sync with video playback/scrubbing.
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
        drawPose(ctx, frame.landmarks);
      }
      const cbFrame = nearestByTime(cueBallFrames, video.currentTime * 1000);
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
  }, [frames, cueBallFrames, cbStage, ballSeed]);

  const trimmedFrames = useMemo(
    () => frames.filter((f) => f.timeMs >= trimStart * 1000 && f.timeMs <= trimEnd * 1000),
    [frames, trimStart, trimEnd]
  );

  const analysis = useMemo(() => {
    if (stage !== "ready" || trimmedFrames.length < 5) return null;
    return analyzeStroke(trimmedFrames, hand);
  }, [trimmedFrames, hand, stage]);

  const cueBallAnalysis = useMemo(() => {
    if (cbStage !== "done") return null;
    return analyzeCueBall(cueBallFrames);
  }, [cueBallFrames, cbStage]);

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
    setError(null);
    resetCueBall();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const avgConfidence =
    cueBallFrames.length > 0
      ? cueBallFrames.reduce((s, f) => s + Math.min(f.ballConfidence, f.cueConfidence), 0) / cueBallFrames.length
      : 0;

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
            構えからフォロースルーまで、体全体が映った動画をアップロードしてください（真横からの撮影推奨）。
          </p>
        </div>
      )}

      {stage !== "idle" && (
        <div className="workspace">
          <div className="video-panel">
            <div className="video-stage">
              <video
                ref={videoRef}
                src={videoUrl ?? undefined}
                controls
                playsInline
                onLoadedMetadata={onLoadedMetadata}
              />
              <canvas
                ref={canvasRef}
                className={`overlay ${cbStage === "seed-ball" || cbStage === "seed-cue" ? "overlay-clickable" : ""}`}
                onClick={handleStageClick}
              />
              {(cbStage === "seed-ball" || cbStage === "seed-cue") && (
                <div className="seed-banner">
                  {cbStage === "seed-ball" ? "① 手球（狙う球）の中心をタップ" : "② キューの先端をタップ"}
                </div>
              )}
            </div>

            {stage === "loaded" && (
              <div className="controls">
                <label className="hand-select">
                  利き手:
                  <select value={hand} onChange={(e) => setHand(e.target.value as Handedness)}>
                    <option value="right">右</option>
                    <option value="left">左</option>
                  </select>
                </label>
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

            {stage === "ready" && (
              <div className="controls">
                <label className="hand-select">
                  利き手:
                  <select value={hand} onChange={(e) => setHand(e.target.value as Handedness)}>
                    <option value="right">右</option>
                    <option value="left">左</option>
                  </select>
                </label>
                <div className="trim-row">
                  <span>評価範囲:</span>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.05}
                    value={trimStart}
                    onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.1))}
                  />
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.05}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))}
                  />
                  <span className="trim-label">
                    {trimStart.toFixed(1)}s - {trimEnd.toFixed(1)}s
                  </span>
                </div>
                <p className="hint">
                  スライダーで、実際に打つ「ストローク動作」の区間だけに絞ると、より正確な評価になります。
                </p>

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

          {analysis && (
            <div className="results-panel">
              <div className="overall-score">
                <div className="overall-score-ring">{analysis.overallScore}</div>
                <div>
                  <h2>総合スコア</h2>
                  <p className="hint">4つの観点からストロークを自動採点しています。</p>
                </div>
              </div>

              <div className="metrics-grid">
                {analysis.metrics.map((m) => (
                  <ScoreCard key={m.key} metric={m} />
                ))}
              </div>

              <div className="path-section">
                <div>
                  <h3>手首の軌道</h3>
                  <p className="hint">
                    点が実際の手首の動き、線が理想の直線です。点が線に近いほどまっすぐなストロークです。
                  </p>
                </div>
                <PathPlot points={analysis.wristPath} line={analysis.fittedLine} />
              </div>

              {cueBallAnalysis && (
                <div className="cueball-results">
                  <h3>詳細解析（キュー・ボール, β）</h3>
                  {avgConfidence < 0.4 && (
                    <p className="hint warning">
                      追跡の信頼度が低めです。照明やボールとキューの映り具合によって精度が変わります。参考程度にご覧ください。
                    </p>
                  )}
                  <div className="metrics-grid">
                    {cueBallAnalysis.metrics.map((m) => (
                      <ScoreCard key={m.key} metric={m} />
                    ))}
                  </div>
                  <div className="path-section">
                    <div>
                      <h3>キュー先端の軌道（実測）</h3>
                      <p className="hint">赤丸がボール、青点がキュー先端の追跡結果です。</p>
                    </div>
                    <PathPlot points={cueBallAnalysis.cuePath} line={cueBallAnalysis.fittedLine} />
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
