import React from "react";
import { useState, useEffect, useRef, useCallback } from "react";

const COLORS = {
  bg: "#0a0e17",
  surface: "#111827",
  surfaceHigh: "#1a2235",
  border: "#1e2d45",
  accent: "#00d4ff",
  accentDim: "#0099bb",
  task: "#00e5a0",
  taskDim: "#009966",
  rest: "#f59e0b",
  restDim: "#a06800",
  danger: "#f87171",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#94a3b8",
};

const defaultBlocks = [
  { id: 1, type: "task", hz: 2, duration: 30 },
  { id: 2, type: "rest", hz: null, duration: 30 },
  { id: 3, type: "task", hz: 5, duration: 30 },
  { id: 4, type: "rest", hz: null, duration: 30 },
];

let idCounter = 10;

function createAudioContext() {
  return new (window.AudioContext || window.webkitAudioContext)();
}

function playClick(audioCtx, time, type = "task") {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(type === "task" ? 880 : 440, time);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.6, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
  osc.start(time);
  osc.stop(time + 0.1);
}

export default function App() {
  const [blocks, setBlocks] = useState(defaultBlocks);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runState, setRunState] = useState(null);
  const [beatFlash, setBeatFlash] = useState(false);

  const audioCtxRef = useRef(null);
  const schedulerRef = useRef(null);
  const runStateRef = useRef(null);
  const pausedRef = useRef(false);
  const startTimeRef = useRef(null);
  const pauseOffsetRef = useRef(0);
  const pauseStartRef = useRef(null);
  const animFrameRef = useRef(null);
  const nextBeatTimeRef = useRef(0);
  const currentBlockIndexRef = useRef(0);
  const blockStartTimeRef = useRef(0);
  const scheduledUpToRef = useRef(0);

  const totalRunDuration = blocks.reduce((s, b) => s + b.duration, 0);

  // ── UI update loop ──────────────────────────────────────────────
  const updateUI = useCallback(() => {
    if (!running || pausedRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const elapsed = ctx.currentTime - startTimeRef.current - pauseOffsetRef.current;

    let acc = 0;
    let blockIdx = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (elapsed < acc + blocks[i].duration) { blockIdx = i; break; }
      acc += blocks[i].duration;
      if (i === blocks.length - 1) { blockIdx = i; acc -= blocks[i].duration; }
    }

    const block = blocks[blockIdx];
    const blockElapsed = elapsed - acc;
    const blockRemaining = Math.max(0, block.duration - blockElapsed);
    const totalRemaining = Math.max(0, totalRunDuration - elapsed);

    setRunState({
      blockIdx,
      block,
      blockElapsed,
      blockRemaining,
      totalRemaining,
      elapsed,
      progress: Math.min(1, elapsed / totalRunDuration),
      blockProgress: Math.min(1, blockElapsed / block.duration),
    });

    if (elapsed >= totalRunDuration) {
      stopRun();
      return;
    }
    animFrameRef.current = requestAnimationFrame(updateUI);
  }, [running, blocks, totalRunDuration]);

  // ── Scheduler ──────────────────────────────────────────────────
  const scheduleBeats = useCallback(() => {
    if (!audioCtxRef.current || pausedRef.current) return;
    const ctx = audioCtxRef.current;
    const scheduleAhead = 0.1;
    const now = ctx.currentTime;

    while (nextBeatTimeRef.current < now + scheduleAhead) {
      const beatTime = nextBeatTimeRef.current;
      const elapsed = beatTime - startTimeRef.current - pauseOffsetRef.current;

      if (elapsed >= totalRunDuration) break;

      // find which block this beat falls in
      let acc = 0;
      let blk = blocks[0];
      for (let i = 0; i < blocks.length; i++) {
        if (elapsed < acc + blocks[i].duration) { blk = blocks[i]; break; }
        acc += blocks[i].duration;
      }

      if (blk.type === "task" && blk.hz > 0) {
        playClick(ctx, beatTime, "task");
        // flash
        const flashDelay = (beatTime - now) * 1000;
        setTimeout(() => {
          setBeatFlash(true);
          setTimeout(() => setBeatFlash(false), 60);
        }, Math.max(0, flashDelay));
        nextBeatTimeRef.current += 1 / blk.hz;
      } else {
        // rest — advance by small step so we keep checking
        nextBeatTimeRef.current += 0.05;
      }
    }
    schedulerRef.current = setTimeout(scheduleBeats, 25);
  }, [blocks, totalRunDuration]);

  const startRun = useCallback(() => {
    if (!blocks.length) return;
    const ctx = createAudioContext();
    audioCtxRef.current = ctx;
    pauseOffsetRef.current = 0;
    pauseStartRef.current = null;
    pausedRef.current = false;

    startTimeRef.current = ctx.currentTime;
    nextBeatTimeRef.current = ctx.currentTime;

    setRunning(true);
    setPaused(false);
    setRunState({ blockIdx: 0, block: blocks[0], blockRemaining: blocks[0].duration, totalRemaining: totalRunDuration, elapsed: 0, progress: 0, blockProgress: 0 });

    scheduleBeats();
    animFrameRef.current = requestAnimationFrame(updateUI);
  }, [blocks, scheduleBeats, updateUI, totalRunDuration]);

  const pauseRun = useCallback(() => {
    pausedRef.current = true;
    pauseStartRef.current = audioCtxRef.current?.currentTime;
    audioCtxRef.current?.suspend();
    clearTimeout(schedulerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    setPaused(true);
  }, []);

  const resumeRun = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const pausedDuration = ctx.currentTime - pauseStartRef.current;
    pauseOffsetRef.current += pausedDuration;
    pausedRef.current = false;
    ctx.resume();
    setPaused(false);
    scheduleBeats();
    animFrameRef.current = requestAnimationFrame(updateUI);
  }, [scheduleBeats, updateUI]);

  const stopRun = useCallback(() => {
    clearTimeout(schedulerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    pausedRef.current = false;
    setRunning(false);
    setPaused(false);
    setRunState(null);
    setBeatFlash(false);
  }, []);

  useEffect(() => {
    if (running && !paused) {
      animFrameRef.current = requestAnimationFrame(updateUI);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [running, paused, updateUI]);

  // ── Block editing ───────────────────────────────────────────────
  const addBlock = (type) => {
    idCounter++;
    setBlocks(b => [...b, { id: idCounter, type, hz: type === "task" ? 2 : null, duration: 30 }]);
  };

  const removeBlock = (id) => setBlocks(b => b.filter(x => x.id !== id));

  const updateBlock = (id, field, value) => {
    setBlocks(b => b.map(x => x.id === id ? { ...x, [field]: value } : x));
  };

  const moveBlock = (idx, dir) => {
    const nb = [...blocks];
    const swap = idx + dir;
    if (swap < 0 || swap >= nb.length) return;
    [nb[idx], nb[swap]] = [nb[swap], nb[idx]];
    setBlocks(nb);
  };

  const saveConfig = () => {
    const config = {
      version: 1,
      name: `block-metronome-${new Date().toISOString().slice(0, 10)}`,
      blocks: blocks.map(({ type, hz, duration }) => ({ type, hz, duration })),
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadConfig = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const config = JSON.parse(ev.target.result);
        if (!Array.isArray(config.blocks)) throw new Error("Invalid format");
        const loaded = config.blocks.map((b) => {
          idCounter++;
          return {
            id: idCounter,
            type: b.type === "rest" ? "rest" : "task",
            hz: b.type === "task" ? (parseFloat(b.hz) || 2) : null,
            duration: parseInt(b.duration) || 30,
          };
        });
        if (loaded.length === 0) throw new Error("No blocks found");
        setBlocks(loaded);
      } catch {
        alert("Could not load config — make sure it's a valid Block Metronome JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const fileInputRef = useRef(null);

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ── Styles ──────────────────────────────────────────────────────
  const s = {
    app: {
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      background: COLORS.bg,
      minHeight: "100vh",
      color: COLORS.text,
      display: "flex",
      flexDirection: "column",
      padding: "0",
    },
    header: {
      background: COLORS.surface,
      borderBottom: `1px solid ${COLORS.border}`,
      padding: "14px 28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "16px",
    },
    headerTitle: {
      fontSize: "16px",
      letterSpacing: "0.2em",
      textTransform: "uppercase",
      color: COLORS.accent,
      fontWeight: 600,
    },
    headerSub: { fontSize: "13px", color: COLORS.textMuted, letterSpacing: "0.1em" },
    main: { display: "flex", flex: 1, gap: "0", overflow: "hidden" },
    panel: {
      background: COLORS.surface,
      borderRight: `1px solid ${COLORS.border}`,
      width: "380px",
      minWidth: "340px",
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
    },
    panelHeader: {
      padding: "14px 20px",
      borderBottom: `1px solid ${COLORS.border}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    panelTitle: { fontSize: "13px", letterSpacing: "0.2em", textTransform: "uppercase", color: COLORS.textMuted },
    runArea: { flex: 1, display: "flex", flexDirection: "column", padding: "28px", gap: "20px", overflowY: "auto" },
    blockItem: (type, isActive) => ({
      background: isActive
        ? type === "task" ? `${COLORS.task}18` : `${COLORS.rest}18`
        : COLORS.surfaceHigh,
      border: isActive
        ? `1px solid ${type === "task" ? COLORS.task : COLORS.rest}`
        : `1px solid ${COLORS.border}`,
      borderRadius: "6px",
      padding: "10px 12px",
      marginBottom: "6px",
      transition: "all 0.2s",
    }),
    blockRow: { display: "flex", alignItems: "center", gap: "8px" },
    blockLabel: (type) => ({
      fontSize: "12px",
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      fontWeight: 700,
      color: type === "task" ? COLORS.task : COLORS.rest,
      width: "36px",
      flexShrink: 0,
    }),
    input: {
      background: COLORS.bg,
      border: `1px solid ${COLORS.border}`,
      borderRadius: "4px",
      color: COLORS.text,
      fontFamily: "inherit",
      fontSize: "14px",
      padding: "4px 8px",
      width: "64px",
    },
    inputLabel: { fontSize: "13px", color: COLORS.textMuted, whiteSpace: "nowrap" },
    iconBtn: (color = COLORS.textMuted) => ({
      background: "none",
      border: "none",
      color,
      cursor: "pointer",
      fontSize: "16px",
      padding: "2px 5px",
      borderRadius: "3px",
      lineHeight: 1,
    }),
    addBtns: { padding: "12px 16px", display: "flex", gap: "8px", borderTop: `1px solid ${COLORS.border}` },
    addBtn: (type) => ({
      flex: 1,
      background: type === "task" ? `${COLORS.task}20` : `${COLORS.rest}20`,
      border: `1px solid ${type === "task" ? COLORS.taskDim : COLORS.restDim}`,
      color: type === "task" ? COLORS.task : COLORS.rest,
      borderRadius: "5px",
      padding: "8px",
      fontSize: "13px",
      letterSpacing: "0.1em",
      cursor: "pointer",
      fontFamily: "inherit",
    }),
    summaryBar: {
      padding: "10px 16px",
      borderTop: `1px solid ${COLORS.border}`,
      display: "flex",
      justifyContent: "space-between",
      fontSize: "12px",
      color: COLORS.textMuted,
    },
    // Run display
    runCard: {
      background: COLORS.surfaceHigh,
      border: `1px solid ${COLORS.border}`,
      borderRadius: "10px",
      padding: "28px 32px",
    },
    statusChip: (type) => ({
      display: "inline-block",
      padding: "5px 16px",
      borderRadius: "20px",
      fontSize: "13px",
      letterSpacing: "0.2em",
      textTransform: "uppercase",
      fontWeight: 700,
      background: type === "task" ? `${COLORS.task}25` : `${COLORS.rest}25`,
      color: type === "task" ? COLORS.task : COLORS.rest,
      border: `1px solid ${type === "task" ? COLORS.taskDim : COLORS.restDim}`,
    }),
    bigTimer: {
      fontSize: "72px",
      fontWeight: 700,
      letterSpacing: "-2px",
      lineHeight: 1,
      color: COLORS.text,
      textAlign: "center",
      margin: "16px 0",
    },
    progressTrack: {
      background: COLORS.bg,
      borderRadius: "4px",
      height: "6px",
      overflow: "hidden",
      border: `1px solid ${COLORS.border}`,
    },
    progressFill: (pct, color) => ({
      height: "100%",
      width: `${pct * 100}%`,
      background: color,
      borderRadius: "4px",
      transition: "width 0.1s linear",
    }),
    beatIndicator: (active) => ({
      width: "20px",
      height: "20px",
      borderRadius: "50%",
      background: active ? COLORS.accent : COLORS.border,
      transition: "background 0.03s",
      boxShadow: active ? `0 0 12px ${COLORS.accent}` : "none",
      flexShrink: 0,
    }),
    ctrlRow: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "10px" },
    ctrlBtn: (color, disabled) => ({
      padding: "10px 28px",
      background: disabled ? COLORS.border : `${color}25`,
      border: `1px solid ${disabled ? COLORS.border : color}`,
      color: disabled ? COLORS.textMuted : color,
      borderRadius: "6px",
      fontSize: "13px",
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit",
      fontWeight: 600,
    }),
    // Block timeline strip
    timelineWrap: { display: "flex", gap: "3px", alignItems: "stretch", height: "28px", marginTop: "4px" },
    timelineBlock: (type, pct, isActive) => ({
      height: "100%",
      flex: pct,
      background: isActive
        ? type === "task" ? COLORS.task : COLORS.rest
        : type === "task" ? `${COLORS.task}40` : `${COLORS.rest}30`,
      borderRadius: "3px",
      transition: "background 0.2s",
      minWidth: "4px",
      position: "relative",
    }),
    seqList: { padding: "8px 16px", overflowY: "auto", flex: 1 },
    configBtn: {
      background: `${COLORS.accent}15`,
      border: `1px solid ${COLORS.accentDim}`,
      color: COLORS.accent,
      borderRadius: "4px",
      padding: "5px 12px",
      fontSize: "11px",
      letterSpacing: "0.15em",
      fontFamily: "inherit",
      fontWeight: 600,
      cursor: "pointer",
    },
  };

  const activeBlockIdx = runState?.blockIdx ?? -1;

  return (
    <div style={s.app}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>Block Metronome</div>
          <div style={s.headerSub}>Auditory cue · block design · research tool</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {running && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={s.beatIndicator(beatFlash)} />
              <span style={{ fontSize: "12px", color: COLORS.textMuted, letterSpacing: "0.1em" }}>
                {paused ? "PAUSED" : "RUNNING"}
              </span>
            </div>
          )}
          <div style={{ fontSize: "13px", color: COLORS.textMuted }}>
            Total: <span style={{ color: COLORS.accent }}>{fmt(totalRunDuration)}</span>
          </div>
        </div>
      </div>

      <div style={s.main}>
        {/* Left Panel – Block Editor */}
        <div style={s.panel}>
          <div style={s.panelHeader}>
            <span style={s.panelTitle}>Block Sequence</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                title="Load configuration from JSON file"
                style={{ ...s.configBtn, opacity: running ? 0.35 : 1 }}
                onClick={() => !running && fileInputRef.current?.click()}
                disabled={running}
              >
                ↑ LOAD
              </button>
              <button
                title="Save current configuration as JSON file"
                style={{ ...s.configBtn, opacity: running ? 0.35 : 1 }}
                onClick={saveConfig}
                disabled={running}
              >
                ↓ SAVE
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={loadConfig}
              />
            </div>
          </div>

          <div style={s.seqList}>
            {blocks.map((block, idx) => (
              <div key={block.id} style={s.blockItem(block.type, idx === activeBlockIdx)}>
                <div style={s.blockRow}>
                  {/* Move arrows */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                    <button style={s.iconBtn(idx === 0 ? COLORS.border : COLORS.textMuted)} onClick={() => moveBlock(idx, -1)} disabled={running}>▲</button>
                    <button style={s.iconBtn(idx === blocks.length - 1 ? COLORS.border : COLORS.textMuted)} onClick={() => moveBlock(idx, 1)} disabled={running}>▼</button>
                  </div>

                  {/* Block number */}
                  <span style={{ fontSize: "12px", color: COLORS.textMuted, width: "20px", textAlign: "right", flexShrink: 0 }}>
                    {idx + 1}
                  </span>

                  {/* Label */}
                  <span style={s.blockLabel(block.type)}>{block.type}</span>

                  {/* Hz (task only) */}
                  {block.type === "task" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="number"
                        min="0.1"
                        max="20"
                        step="0.1"
                        value={block.hz}
                        disabled={running}
                        onChange={e => updateBlock(block.id, "hz", parseFloat(e.target.value) || 1)}
                        style={s.input}
                      />
                      <span style={s.inputLabel}>Hz</span>
                    </div>
                  ) : (
                    <div style={{ width: "80px" }} />
                  )}

                  {/* Duration */}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <input
                      type="number"
                      min="1"
                      max="3600"
                      step="1"
                      value={block.duration}
                      disabled={running}
                      onChange={e => updateBlock(block.id, "duration", parseInt(e.target.value) || 1)}
                      style={s.input}
                    />
                    <span style={s.inputLabel}>s</span>
                  </div>

                  {/* Delete */}
                  <button
                    style={{ ...s.iconBtn(COLORS.danger), marginLeft: "auto", opacity: running ? 0.3 : 1 }}
                    onClick={() => !running && removeBlock(block.id)}
                  >✕</button>
                </div>

                {/* Active progress bar */}
                {idx === activeBlockIdx && runState && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={s.progressTrack}>
                      <div style={s.progressFill(runState.blockProgress, block.type === "task" ? COLORS.task : COLORS.rest)} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add buttons */}
          <div style={s.addBtns}>
            <button style={s.addBtn("task")} onClick={() => addBlock("task")} disabled={running}>
              + TASK
            </button>
            <button style={s.addBtn("rest")} onClick={() => addBlock("rest")} disabled={running}>
              + REST
            </button>
          </div>

          {/* Summary */}
          <div style={s.summaryBar}>
            <span>
              {blocks.filter(b => b.type === "task").length} task ·{" "}
              {blocks.filter(b => b.type === "rest").length} rest
            </span>
            <span>Total: {fmt(totalRunDuration)}</span>
          </div>
        </div>

        {/* Right – Run Display */}
        <div style={s.runArea}>
          {/* Timeline strip */}
          <div>
            <div style={{ fontSize: "12px", color: COLORS.textMuted, marginBottom: "6px", letterSpacing: "0.15em" }}>
              SEQUENCE TIMELINE
            </div>
            <div style={s.timelineWrap}>
              {blocks.map((b, i) => (
                <div
                  key={b.id}
                  style={s.timelineBlock(b.type, b.duration / totalRunDuration, i === activeBlockIdx)}
                  title={`${b.type}${b.type === "task" ? ` @ ${b.hz}Hz` : ""} · ${b.duration}s`}
                />
              ))}
            </div>
            {/* Timeline labels */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: COLORS.textMuted, marginTop: "4px" }}>
              <span>0:00</span>
              <span>{fmt(totalRunDuration / 2)}</span>
              <span>{fmt(totalRunDuration)}</span>
            </div>
          </div>

          {/* Overall progress */}
          {running && runState && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: COLORS.textMuted, marginBottom: "4px" }}>
                <span style={{ letterSpacing: "0.1em" }}>OVERALL PROGRESS</span>
                <span>{fmt(runState.totalRemaining)} remaining</span>
              </div>
              <div style={s.progressTrack}>
                <div style={s.progressFill(runState.progress, COLORS.accent)} />
              </div>
            </div>
          )}

          {/* Current block card */}
          <div style={s.runCard}>
            {!running ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "13px", letterSpacing: "0.2em", color: COLORS.textMuted, marginBottom: "24px" }}>
                  READY · {blocks.length} BLOCKS · {fmt(totalRunDuration)}
                </div>
                {/* Block summary */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "320px", margin: "0 auto 28px" }}>
                  {blocks.map((b, i) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 10px", background: COLORS.bg, borderRadius: "4px", border: `1px solid ${COLORS.border}` }}>
                      <span style={{ fontSize: "11px", color: COLORS.textMuted, width: "20px" }}>{i + 1}</span>
                      <span style={{ ...s.blockLabel(b.type), width: "auto" }}>{b.type}</span>
                      {b.type === "task" && (
                        <span style={{ fontSize: "13px", color: COLORS.task }}>{b.hz} Hz</span>
                      )}
                      <span style={{ fontSize: "13px", color: COLORS.textDim, marginLeft: "auto" }}>{b.duration}s</span>
                    </div>
                  ))}
                </div>
                <button
                  style={{ ...s.ctrlBtn(COLORS.accent, blocks.length === 0), fontSize: "12px", padding: "12px 48px" }}
                  onClick={startRun}
                  disabled={blocks.length === 0}
                >
                  ▶ START RUN
                </button>
              </div>
            ) : (
              <>
                {/* Block info */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={s.statusChip(runState.block.type)}>
                    {runState.block.type === "task" ? `TASK — ${runState.block.hz} Hz` : "REST"}
                  </span>
                  <span style={{ fontSize: "12px", color: COLORS.textMuted }}>
                    Block {runState.blockIdx + 1} / {blocks.length}
                  </span>
                </div>

                {/* Big countdown */}
                <div style={s.bigTimer}>
                  {fmt(runState.blockRemaining)}
                </div>

                {/* Block progress */}
                <div style={s.progressTrack}>
                  <div style={s.progressFill(runState.blockProgress, runState.block.type === "task" ? COLORS.task : COLORS.rest)} />
                </div>

                {/* Hz indicator */}
                {runState.block.type === "task" && (
                  <div style={{ textAlign: "center", marginTop: "14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                    <div style={s.beatIndicator(beatFlash)} />
                    <span style={{ fontSize: "32px", fontWeight: 700, color: COLORS.task, letterSpacing: "-0.5px" }}>
                      {runState.block.hz} Hz
                    </span>
                    <div style={s.beatIndicator(beatFlash)} />
                  </div>
                )}

                {/* Next block preview */}
                {runState.blockIdx + 1 < blocks.length && (
                  <div style={{ marginTop: "14px", padding: "8px 12px", background: COLORS.bg, borderRadius: "5px", border: `1px solid ${COLORS.border}`, fontSize: "12px", color: COLORS.textMuted, display: "flex", justifyContent: "space-between" }}>
                    <span>NEXT →</span>
                    <span style={{ color: blocks[runState.blockIdx + 1].type === "task" ? COLORS.task : COLORS.rest }}>
                      {blocks[runState.blockIdx + 1].type.toUpperCase()}
                      {blocks[runState.blockIdx + 1].type === "task" && ` · ${blocks[runState.blockIdx + 1].hz} Hz`}
                    </span>
                    <span>{blocks[runState.blockIdx + 1].duration}s</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Controls */}
          {running && (
            <div style={s.ctrlRow}>
              <button
                style={s.ctrlBtn(COLORS.rest, false)}
                onClick={paused ? resumeRun : pauseRun}
              >
                {paused ? "▶ RESUME" : "⏸ PAUSE"}
              </button>
              <button
                style={s.ctrlBtn(COLORS.danger, false)}
                onClick={stopRun}
              >
                ■ STOP
              </button>
            </div>
          )}

          {/* Legend */}
          <div style={{ display: "flex", gap: "20px", marginTop: "auto", paddingTop: "16px", borderTop: `1px solid ${COLORS.border}`, fontSize: "12px", color: COLORS.textMuted }}>
            <span style={{ color: COLORS.task }}>■</span> Task block (auditory cue active)
            <span style={{ color: COLORS.rest, marginLeft: "8px" }}>■</span> Rest block (silence)
          </div>
        </div>
      </div>
    </div>
  );
}
