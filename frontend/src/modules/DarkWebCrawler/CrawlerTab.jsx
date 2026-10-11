import React, { useState, useEffect, useRef } from "react";
import { getSources, getCrawlJobs, createCrawlJob } from "../../api";

export default function CrawlerTab({ crawlerStatus = "idle", onCrawlerStatusChange = () => {} }) { // INTEGRATION: props from the page
  const [status, setStatus] = useState(crawlerStatus); // idle | running | paused | stopped
  useEffect(() => { onCrawlerStatusChange(status); }, [status]); // INTEGRATION: report status -> AppContext
  const [latency, setLatency] = useState(null);
  const [circuit, setCircuit] = useState("Not reported by a worker");
  const [jobs, setJobs] = useState([]);
  const [queueing, setQueueing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [source, setSource] = useState({
    name: "No active source",
    url: "The source registry has not returned an active source."
  });
  const [logs, setLogs] = useState([]);

  // BACKEND: sources and job state are the authoritative crawler data.
  const sourcesRef = useRef([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [sourcesResult, jobsResult] = await Promise.allSettled([getSources(), getCrawlJobs()]);
      if (!alive) return;
      const sources = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];
      const currentJobs = jobsResult.status === "fulfilled" ? jobsResult.value : [];
      sourcesRef.current = sources;
      setJobs(currentJobs);
      if (sources[0]) {
        const health = sources[0].health || {};
        setSource({ name: sources[0].name, url: sources[0].onion_addr || sources[0].source_type });
        setLatency(Number.isFinite(Number(health.latency_ms)) ? Number(health.latency_ms) : null);
        setCircuit(health.circuit || "Not reported by a worker");
      }
      setStatus(currentJobs.some((job) => job.state === "running") ? "running" : currentJobs.some((job) => job.state === "queued") ? "queued" : "idle");
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [refreshKey]);

  const logRef = useRef(null);
  const canvasRef = useRef(null);

  // Auto-scroll activity terminal
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Visual Crawl Node Visualization (Fills empty bottom space)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animationId;

    const nodes = Array.from({ length: 18 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      radius: Math.random() * 2.5 + 2,
      active: Math.random() > 0.5
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw radar grid lines
      ctx.strokeStyle = "rgba(0, 255, 157, 0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 110) {
            ctx.strokeStyle = status === "running" ? "rgba(0, 212, 255, 0.18)" : "rgba(71, 85, 105, 0.12)";
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Update and render nodes
      nodes.forEach((node) => {
        if (status === "running") {
          node.x += node.vx;
          node.y += node.vy;

          if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
          if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
        }

        ctx.fillStyle = status === "running" ? (node.active ? "#00ff9d" : "#00d4ff") : "#475569";
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        if (status === "running" && node.active) {
          ctx.strokeStyle = "rgba(0, 255, 157, 0.4)";
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [status]);

  const addNotice = (lvl, col, txt) => {
    const time = new Date().toTimeString().split(" ")[0];
    setLogs((prev) => [...prev, { id: Date.now(), time, level: lvl, color: col, text: txt }]);
  };

  const handleStart = async () => {
    if (!sourcesRef.current.length) {
      addNotice("WARN", "#f59e0b", "No active sources are available to queue.");
      return;
    }
    setQueueing(true);
    setStatus("queued");
    addNotice("SCAN", "#00d4ff", "Queueing crawl jobs for active sources.");
    const results = await Promise.allSettled(sourcesRef.current.map((src) =>
      createCrawlJob({ intent_id: `ui-${Date.now()}-${src.source_id}`, source_id: src.source_id })
    ));
    results.forEach((result, index) => {
      const source = sourcesRef.current[index];
      if (result.status === "fulfilled") addNotice("OK", "#00ff9d", `Job ${result.value.job_id} queued for ${source.name}`);
      else addNotice("WARN", "#f59e0b", `Could not queue ${source.name}: ${result.reason?.message || "request failed"}`);
    });
    setQueueing(false);
    setRefreshKey((value) => value + 1);
  };

  const handleRefresh = () => {
    addNotice("INDEX", "#38bdf8", "Refreshing source registry and crawl-job status.");
    setRefreshKey((value) => value + 1);
  };

  const reportedPages = jobs.reduce((total, job) => {
    const stats = job.stats || {};
    return total + Number(stats.pages_crawled ?? stats.pagesCrawled ?? stats.pages ?? stats.documents_processed ?? stats.documentsProcessed ?? 0);
  }, 0);
  const queuedJobs = jobs.filter((job) => job.state === "queued").length;
  const completedJobs = jobs.filter((job) => job.state === "done").length;
  const progress = jobs.length ? Math.round((completedJobs / jobs.length) * 100) : 0;

  const getStatusBadge = () => {
    const map = {
      running: { col: "#00ff9d", bg: "rgba(0,255,157,0.1)", text: "RUNNING" },
      queued: { col: "#38bdf8", bg: "rgba(56,189,248,0.1)", text: "QUEUED" },
      paused: { col: "#f59e0b", bg: "rgba(245,158,11,0.1)", text: "PAUSED" },
      stopped: { col: "#ff0055", bg: "rgba(255,0,85,0.1)", text: "STOPPED" },
      idle: { col: "#94a3b8", bg: "rgba(148,163,184,0.1)", text: "IDLE" }
    };
    return map[status] || map.idle;
  };

  const currentTheme = getStatusBadge();

  return (
    <div style={css.container}>
      {/* Top Header & Execution Controls */}
      <div style={css.header}>
        <div>
          <div style={css.tag}>DARKTRACE // RECON ENGINE</div>
          <h2 style={{ margin: 0, color: "#f8fafc", letterSpacing: "1px" }}>DARK WEB CRAWLER</h2>
        </div>

        <div style={css.row}>
          <div style={{ ...css.badge, color: currentTheme.col, background: currentTheme.bg, borderColor: currentTheme.col }}>
            ● {currentTheme.text}
          </div>
          <button style={{ ...css.btn, background: "#00ff9d", color: "#020617" }} onClick={handleStart} disabled={queueing}>
            {queueing ? "QUEUEING…" : "QUEUE JOBS"}
          </button>
          <button style={{ ...css.btn, background: "#334155", color: "#cbd5e1" }} onClick={handleRefresh}>
            REFRESH
          </button>
        </div>
      </div>

      {/* Target URL Card */}
      <div style={css.targetBox}>
        <div style={css.targetLabel}>TARGET: {source.name.toUpperCase()}</div>
        <div style={{ color: "#f1f5f9", fontSize: "0.9rem", wordBreak: "break-all" }}>{source.url}</div>
      </div>

      {/* Small Tor Status & Circuit Indicator */}
      <div style={css.torStatusStrip}>
        <div style={css.torItem}>
          <span style={css.torLabel}>TOR ROUTE:</span>
          <span style={{ color: status === "running" ? "#00ff9d" : "#94a3b8", fontWeight: 700 }}>
            {status === "running" ? "ACTIVE" : status === "queued" ? "QUEUED" : "STANDBY"}
          </span>
        </div>
        <div style={css.torItem}>
          <span style={css.torLabel}>CIRCUIT:</span>
          <span style={{ color: "#38bdf8", fontWeight: 600 }}>{circuit}</span>
        </div>
        <div style={css.torItem}>
          <span style={css.torLabel}>LATENCY:</span>
          <span style={{ color: latency != null && latency < 190 ? "#00ff9d" : "#94a3b8", fontWeight: 700 }}>{latency == null ? "NOT REPORTED" : `${latency}ms`}</span>
        </div>
      </div>

      {/* Telemetry Metrics Grid */}
      <div style={css.grid}>
        <div style={css.card}>
          <div style={css.cardTitle}>PAGES CRAWLED</div>
          <div style={css.metricVal}>{reportedPages.toLocaleString()}</div>
          <div style={css.cardFoot}>Worker-reported crawl statistics</div>
        </div>

        <div style={css.card}>
          <div style={css.cardTitle}>QUEUED JOBS</div>
          <div style={css.metricVal}>{queuedJobs.toLocaleString()}</div>
          <div style={css.cardFoot}>Total jobs tracked: {jobs.length}</div>
        </div>

        <div style={css.card}>
          <div style={css.cardTitle}>WORKER CONTROL</div>
          <div style={{ color: "#cbd5e1", fontSize: "0.85rem", margin: "14px 0" }}>Service-managed</div>
          <div style={css.cardFoot}>The worker owns rate and lifecycle changes</div>
        </div>

        <div style={css.card}>
          <div style={css.cardTitle}>PROGRESS ({progress}%)</div>
          <div style={css.progressBg}>
            <div style={{ ...css.progressBar, width: `${progress}%` }} />
          </div>
          <div style={css.cardFoot}>Completed crawl jobs: {completedJobs}</div>
        </div>
      </div>

      {/* Split Bottom Workspace: Activity Terminal + Live Node Visualization */}
      <div style={css.bottomWorkspace}>
        {/* Terminal Section */}
        <div style={css.terminal}>
          <div style={css.terminalHead}>
            <span>● QUEUE &amp; WORKER LOG</span>
            <button style={css.clearBtn} onClick={() => setLogs([])}>
              CLEAR
            </button>
          </div>
          <div style={css.terminalBody} ref={logRef}>
            {logs.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: "8px", margin: "4px 0" }}>
                <span style={{ color: "#475569" }}>[{l.time}]</span>
                <span style={{ color: l.color, fontWeight: 700 }}>[{l.level}]</span>
                <span style={{ color: "#cbd5e1" }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Live Crawl Graph / Node Visualization Canvas */}
        <div style={css.vizPanel}>
          <div style={css.vizHead}>
            <span>● MONITORED-SOURCE TOPOLOGY</span>
            <span style={{ color: "#00ff9d", fontSize: "0.7rem" }}>
              {status === "running" ? "WORKER RUNNING" : status === "queued" ? "AWAITING WORKER" : "STANDBY"}
            </span>
          </div>
          <div style={css.canvasContainer}>
            <canvas ref={canvasRef} width={420} height={210} style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const css = {
  container: {
    padding: "20px",
    background: "#080c14",
    minHeight: "100vh",
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    boxSizing: "border-box"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid #1e293b",
    paddingBottom: "16px",
    marginBottom: "16px",
    flexWrap: "wrap",
    gap: "10px"
  },
  tag: { fontSize: "0.7rem", color: "#00ff9d", letterSpacing: "2px" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
  badge: { padding: "5px 12px", border: "1px solid", borderRadius: "3px", fontSize: "0.75rem", fontWeight: 700 },
  btn: {
    padding: "6px 12px",
    border: "none",
    borderRadius: "3px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: "0.75rem",
    transition: "all 0.2s ease"
  },
  targetBox: {
    background: "#0f172a",
    borderLeft: "4px solid #00d4ff",
    padding: "10px 14px",
    borderRadius: "3px",
    marginBottom: "12px"
  },
  targetLabel: { fontSize: "0.68rem", color: "#00d4ff", letterSpacing: "1px", marginBottom: "3px" },
  torStatusStrip: {
    display: "flex",
    gap: "24px",
    background: "#0d1424",
    border: "1px solid #1e293b",
    borderRadius: "3px",
    padding: "8px 14px",
    marginBottom: "16px",
    fontSize: "0.75rem",
    flexWrap: "wrap"
  },
  torItem: { display: "flex", gap: "8px", alignItems: "center" },
  torLabel: { color: "#64748b", fontWeight: 700, letterSpacing: "1px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginBottom: "16px"
  },
  card: { background: "#0d1424", border: "1px solid #1e293b", padding: "14px", borderRadius: "4px" },
  cardTitle: { fontSize: "0.7rem", color: "#64748b", letterSpacing: "1px" },
  metricVal: { fontSize: "1.6rem", fontWeight: 700, color: "#f8fafc", margin: "4px 0" },
  cardFoot: { fontSize: "0.68rem", color: "#64748b" },
  speedBtn: {
    flex: 1,
    padding: "4px",
    background: "#1e293b",
    border: "1px solid #334155",
    color: "#94a3b8",
    cursor: "pointer",
    borderRadius: "2px"
  },
  speedActive: { background: "#00ff9d", color: "#020617", fontWeight: 700 },
  progressBg: {
    width: "100%",
    height: "6px",
    background: "#1e293b",
    borderRadius: "2px",
    marginTop: "10px",
    marginBottom: "6px",
    overflow: "hidden"
  },
  progressBar: { height: "100%", background: "#00ff9d", transition: "width 0.2s ease" },
  bottomWorkspace: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "12px"
  },
  terminal: { background: "#05080f", border: "1px solid #1e293b", borderRadius: "4px", overflow: "hidden" },
  terminalHead: {
    background: "#0d1424",
    padding: "8px 12px",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#cbd5e1",
    fontSize: "0.75rem"
  },
  terminalBody: { height: "220px", overflowY: "auto", padding: "10px 14px", fontSize: "0.8rem", lineHeight: "1.5" },
  clearBtn: {
    background: "transparent",
    border: "1px solid #334155",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "0.7rem",
    padding: "2px 6px"
  },
  vizPanel: {
    background: "#05080f",
    border: "1px solid #1e293b",
    borderRadius: "4px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  },
  vizHead: {
    background: "#0d1424",
    padding: "8px 12px",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    justifyContent: "space-between",
    color: "#cbd5e1",
    fontSize: "0.75rem",
    letterSpacing: "1px"
  },
  canvasContainer: { flex: 1, position: "relative", minHeight: "220px" }
};
