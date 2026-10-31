/* Video crowd-count check: upload a recorded video, run the person detector on sampled frames (tiled at native
   resolution for dense / high-resolution footage), watch the live analysis while it runs, play the annotated
   output with boxes, track ids and a synced count, inspect per-frame results and optionally push the result
   through the live crowd pipeline (source "video") to verify the whole chain before real camera feeds. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, CircleAlert, CircleCheck, Cpu, Download, FileVideo, Grid2x2, Image as ImageIcon, Pause, Play, Radio, Send, Square, Trash2, Upload, Users, X,
} from 'lucide-react'
import { API, api, getToken, type CrowdStatus } from '../../api'
import { useLang } from '../../i18n'
import { useStore } from '../../store'
import { EmptyState, ErrorState, Field, Notice, PageHead, Sheet, Skeleton, SubmitButton, useBreakpoint, useSubmit, useToast } from '../../components/ui'

interface Health {
  available: boolean; cuda: boolean; device: string; model_path: string; model_loaded: boolean; ultralytics?: string; torch?: string; opencv?: string
  error?: string; install?: string; model_name?: string; loaded_in_s?: number; ffmpeg?: boolean; output_video?: boolean
  limits: { max_mb: number; max_seconds: number; default_sample_fps: number; imgsz: number }
  tiling?: { default_mode: string; auto_min_px: number; tile_px: number; overlap: number }
}
type Mode = 'auto' | 'standard' | 'tiled'
interface Job {
  id: number; created_by: number | null; location_id: number | null; filename: string; size_bytes: number
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; sample_fps: number; confidence: number; model_name: string | null; device: string | null
  video_fps: number | null; video_frames: number | null; video_width: number | null; video_height: number | null; video_duration_s: number | null
  frames_expected: number; frames_processed: number; detection_mode: Mode | null; tiles: number | null; last_count: number | null; unique_tracks: number | null
  output_video: boolean; summary: Summary; error: string | null; note: string | null; published_reading_id: number | null
  created_at: string; started_at: string | null; finished_at: string | null
}
interface Summary {
  frames_sampled?: number; count_max?: number; count_min?: number; count_mean?: number; count_median?: number; count_p95?: number
  peak_t?: number; peak_frame?: number; peak_image?: string | null; detections_total?: number; unique_tracks?: number; infer_ms_median?: number; processing_s?: number
  annotated_frames?: number; analysed_seconds?: number | null; truncated?: boolean; detection_mode?: Mode; tiles?: number; output_video?: boolean; output_size?: [number, number] | null
}
interface Frame { index: number; frame: number; t: number; count: number; unique_so_far?: number; infer_ms: number; image?: string; detections: number }

const STATUS_CLS: Record<Job['status'], string> = { queued: 'neutral', running: 'brand', done: 'low', failed: 'critical', cancelled: 'unknown' }
const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`)
const authHeaders = () => ({ Authorization: `Bearer ${getToken() ?? ''}` })
const download = (path: string, filename: string) => fetch(API + path, { headers: authHeaders() }).then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = filename; a.click(); URL.revokeObjectURL(u) })
const modeLabel = (m: Mode | null | undefined, tiles?: number | null) => (m === 'tiled' ? `tiled · ${tiles ?? '?'} tiles at native resolution` : m === 'standard' ? 'standard · one pass' : 'auto')

/** Protected media needs the bearer token, which <img>/<video> cannot send: fetch into an object URL. */
function useAuthUrl(path: string | null, refreshKey = 0) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    let alive = true
    let obj: string | null = null
    setError(null)
    fetch(API + path, { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => { if (alive) { obj = URL.createObjectURL(b); setUrl(obj) } })
      .catch((e) => { if (alive) setError((e as Error).message) })
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj) }
  }, [path, refreshKey])
  return { url, error }
}

function AuthImage({ src, alt, style, onClick, refreshKey }: { src: string; alt: string; style?: React.CSSProperties; onClick?: () => void; refreshKey?: number }) {
  const { url } = useAuthUrl(src, refreshKey)
  const last = useRef<string | null>(null)
  if (url) last.current = url
  if (!last.current) return <div className="skel" style={{ ...style, minHeight: 90 }} aria-busy="true" />
  return <img src={last.current} alt={alt} style={{ ...style, cursor: onClick ? 'zoom-in' : undefined, display: 'block' }} onClick={onClick} />
}

/** Count-over-time chart (inline SVG). `cursor` = playback time; click/drag seeks. */
function CountChart({ frames, peak, cursor, onSeek }: { frames: Frame[]; peak?: number; cursor?: number | null; onSeek?: (t: number) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  if (frames.length < 2) return null
  const W = 720, H = 200, px = 44, py = 18
  const maxC = Math.max(1, ...frames.map((f) => f.count))
  const maxT = frames[frames.length - 1].t || 1
  const x = (t: number) => px + (t / maxT) * (W - px - 12)
  const y = (c: number) => H - py - (c / maxC) * (H - 2 * py)
  const d = frames.map((f, i) => `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(f.count).toFixed(1)}`).join(' ')
  const ticks = [0, Math.round(maxC / 2), maxC]
  const seek = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onSeek || !ref.current || (e.type === 'pointermove' && e.buttons !== 1)) return
    const r = ref.current.getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width * W - px) / (W - px - 12) * maxT
    onSeek(Math.max(0, Math.min(maxT, t)))
  }
  const cur = cursor != null ? frames.reduce((a, f) => (f.t <= cursor ? f : a), frames[0]) : null
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', cursor: onSeek ? 'pointer' : undefined, touchAction: 'none' }} role="img" aria-label="People detected per sampled frame" onPointerDown={seek} onPointerMove={seek}>
      {ticks.map((c) => <g key={c}><line x1={px} x2={W - 12} y1={y(c)} y2={y(c)} stroke="var(--line)" /><text x={px - 6} y={y(c) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{c}</text></g>)}
      <path d={`${d} L${x(frames[frames.length - 1].t).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--brand-100)" />
      <path d={d} fill="none" stroke="var(--brand-700)" strokeWidth="2" />
      {peak != null && frames[peak] && <circle cx={x(frames[peak].t)} cy={y(frames[peak].count)} r="4" fill="var(--accent)" />}
      {cursor != null && cur && (
        <g>
          <line x1={x(cursor)} x2={x(cursor)} y1={py} y2={H - py} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
          <circle cx={x(cur.t)} cy={y(cur.count)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          <text x={Math.min(x(cursor) + 6, W - 60)} y={py + 12} fontSize="12" fontWeight="700" fill="var(--text)">{cur.count}</text>
        </g>
      )}
      <text x={px} y={H - 2} fontSize="11" fill="var(--muted)">0 s</text>
      <text x={W - 12} y={H - 2} fontSize="11" fill="var(--muted)" textAnchor="end">{maxT.toFixed(0)} s</text>
    </svg>
  )
}

/** Live analysis while running: latest annotated frame + running counts. */
function LiveRun({ job }: { job: Job }) {
  const [tick, setTick] = useState(0)
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id) }, [])
  const pct = job.frames_expected ? Math.min(100, Math.round((job.frames_processed / job.frames_expected) * 100)) : 0
  const portrait = (job.video_height ?? 0) > (job.video_width ?? 1)
  return (
    <div className="card">
      <div className="card-head"><h2><Radio size={18} aria-hidden style={{ verticalAlign: '-3px' }} className="spin-icon" /> Live analysis</h2><span className="chip brand">running · {pct}%</span></div>
      <div className="layout-split media" style={{ '--split-cols': portrait ? 'minmax(0, 360px) minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(220px, 300px)' } as React.CSSProperties}>
        <div style={{ background: '#0b1220', borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--line)', minHeight: 180 }}>
          {job.frames_processed > 0
            ? <AuthImage src={`/crowd/video/analyses/${job.id}/live.jpg`} refreshKey={tick} alt="Latest analysed frame with detections" style={{ width: '100%', height: 'auto', maxHeight: 560, objectFit: 'contain' }} />
            : <div className="muted small" style={{ padding: 24, color: '#cbd5e1' }}>Opening the video and loading the detector…</div>}
        </div>
        <div className="stack">
          <div className="kpi" style={{ padding: 16 }}><div className="v" style={{ fontSize: 44 }}>{job.last_count ?? '–'}</div><div className="l">People in the latest frame</div></div>
          <div className="kpi"><div className="v">{job.unique_tracks ?? '–'}</div><div className="l">Distinct people tracked so far (approx.)</div></div>
          <div className="kpi"><div className="v">{job.frames_processed}<span className="muted" style={{ fontSize: 14 }}> / {job.frames_expected}</span></div><div className="l">Frames analysed at {job.sample_fps}/s</div></div>
          <div className="meter"><span className="low" style={{ width: `${Math.max(3, pct)}%` }} /></div>
          <span className="muted xs">{modeLabel(job.detection_mode, job.tiles)} · {job.device}</span>
        </div>
      </div>
    </div>
  )
}

/** Finished job: annotated video player with the count synced to playback, or a frame scrubber when no video was encoded. */
function Playback({ job, frames, onZoom }: { job: Job; frames: Frame[]; onZoom: (f: Frame) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { url, error } = useAuthUrl(job.output_video ? `/crowd/video/analyses/${job.id}/video` : null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [scrub, setScrub] = useState(0)
  const cur = useMemo(() => frames.reduce((a, f) => (f.t <= t ? f : a), frames[0]), [frames, t])
  const seek = (to: number) => { if (videoRef.current) { videoRef.current.currentTime = to } setT(to) }
  const toggle = () => { const v = videoRef.current; if (!v) return; if (v.paused) void v.play(); else v.pause() }
  const portrait = (job.video_height ?? 0) > (job.video_width ?? 1)
  const stills = frames.filter((f) => f.image)
  const s = job.summary
  const readout = (count: number | undefined, unique: number | undefined, at: number) => (
    <div className="stack">
      <div className="kpi" style={{ padding: 16 }}><div className="v" style={{ fontSize: 44 }}>{count ?? '–'}</div><div className="l">People in frame at {at.toFixed(1)} s</div></div>
      <div className="kpi"><div className="v">{unique ?? '–'}</div><div className="l">Distinct people tracked so far (approx.)</div></div>
      <div className="kpi"><div className="v">{s.count_max}</div><div className="l">Peak in the clip{s.peak_t != null ? ` at ${s.peak_t}s` : ''}</div></div>
      <span className="muted xs">{modeLabel(job.detection_mode, job.tiles)} · boxes update {job.sample_fps}× per second of video · ids from a lightweight tracker</span>
    </div>
  )
  return (
    <div className="card">
      <div className="card-head"><h2><Users size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Tracking playback</h2>{job.output_video && url && <a className="btn sm ghost" href={url} download={`video-analysis-${job.id}-annotated.mp4`}><Download size={14} aria-hidden />Annotated MP4</a>}</div>
      {job.output_video ? (
        <div className="layout-split media" style={{ '--split-cols': portrait ? 'minmax(0, 420px) minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(220px, 300px)' } as React.CSSProperties}>
          <div>
            <div style={{ background: '#0b1220', borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--line)', position: 'relative' }}>
              {url
                ? <video ref={videoRef} src={url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 640, display: 'block', background: '#0b1220' }}
                    onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onSeeking={(e) => setT(e.currentTarget.currentTime)} />
                : error ? <div className="muted small" style={{ padding: 24, color: '#fca5a5' }}>Could not load the annotated video ({error}).</div>
                : <div className="skel" style={{ aspectRatio: portrait ? '9 / 16' : '16 / 9', maxHeight: 640 }} aria-busy="true" />}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn sm" onClick={toggle} disabled={!url}>{playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}{playing ? 'Pause' : 'Play'}</button>
              <button className="btn sm ghost" onClick={() => seek(s.peak_t ?? 0)} disabled={!url}>Jump to peak</button>
              <span className="muted xs">Click the chart below to seek.</span>
            </div>
          </div>
          {readout(cur?.count, cur?.unique_so_far, t)}
        </div>
      ) : (
        <div className="layout-split media" style={{ '--split-cols': portrait ? 'minmax(0, 420px) minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(220px, 300px)' } as React.CSSProperties}>
          <div>
            <Notice tone="warn">No annotated video was encoded on the server (ffmpeg not available), so this scrubber steps through the annotated stills instead.</Notice>
            {stills.length > 0 && (
              <>
                <AuthImage src={`/crowd/video/analyses/${job.id}/frames/${stills[Math.min(scrub, stills.length - 1)].image}`} alt="Annotated frame" style={{ width: '100%', height: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', marginTop: 8 }} onClick={() => onZoom(stills[Math.min(scrub, stills.length - 1)])} />
                <input className="input" type="range" min={0} max={stills.length - 1} value={Math.min(scrub, stills.length - 1)} onChange={(e) => { const i = Number(e.target.value); setScrub(i); setT(stills[i].t) }} style={{ padding: 0, minHeight: 44 }} aria-label="Scrub annotated frames" />
              </>
            )}
          </div>
          {readout(stills[Math.min(scrub, stills.length - 1)]?.count, stills[Math.min(scrub, stills.length - 1)]?.unique_so_far, t)}
        </div>
      )}
      <h3 style={{ margin: '16px 0 8px' }}>People per sampled frame</h3>
      <CountChart frames={frames} peak={s.peak_frame != null ? frames.findIndex((f) => f.frame === s.peak_frame) : undefined} cursor={t} onSeek={seek} />
    </div>
  )
}

export default function VideoAnalysisAdminPage() {
  const { name, clock, ago, num } = useLang()
  const { places, user } = useStore()
  const bp = useBreakpoint()
  const toast = useToast()
  const [health, setHealth] = useState<Health | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [frames, setFrames] = useState<Frame[] | null>(null)
  const [zoom, setZoom] = useState<Frame | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [locId, setLocId] = useState('')
  const [fps, setFps] = useState('2')
  const [conf, setConf] = useState(0.35)
  const [mode, setMode] = useState<Mode>('auto')
  const [note, setNote] = useState('')
  const [pubLoc, setPubLoc] = useState('')
  const [pubStat, setPubStat] = useState<'p95' | 'max' | 'mean' | 'median'>('p95')
  const [pubConfirm, setPubConfirm] = useState(false)
  const [pipeline, setPipeline] = useState<CrowdStatus | null>(null)
  const upload = useSubmit<Job>()
  const act = useSubmit<unknown>()
  const fileRef = useRef<HTMLInputElement>(null)

  const monitored = useMemo(() => places.filter((p) => p.monitored || p.type === 'ghat' || p.type === 'gate'), [places])
  const locById = useCallback((id: number | null) => (id ? places.find((p) => p.id === id) ?? null : null), [places])

  const loadJobs = useCallback(() => api.get<Job[]>('/crowd/video/analyses').then(setJobs).catch((e) => { setJobs([]); setHealthErr((e as Error).message) }), [])
  useEffect(() => {
    api.get<Health>('/crowd/video/health').then(setHealth).catch((e) => setHealthErr((e as Error).message))
    void loadJobs()
  }, [loadJobs])

  // poll while anything is queued/running
  const active = jobs?.some((j) => j.status === 'queued' || j.status === 'running') ?? false
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => void loadJobs(), 1000)
    return () => clearInterval(id)
  }, [active, loadJobs])

  const open = openId ? jobs?.find((j) => j.id === openId) ?? null : null
  useEffect(() => {
    if (!open || open.status !== 'done') { setFrames(null); return }
    let alive = true
    api.get<{ frames: Frame[] }>(`/crowd/video/analyses/${open.id}/frames`).then((r) => { if (alive) setFrames(r.frames) }).catch(() => { if (alive) setFrames([]) })
    return () => { alive = false }
  }, [open?.id, open?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPipeline(null); setPubConfirm(false); if (open?.location_id) setPubLoc(String(open.location_id)) }, [open?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const doUpload = async () => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    if (locId) fd.append('location_id', locId)
    fd.append('sample_fps', fps)
    fd.append('confidence', String(conf))
    fd.append('detection_mode', mode)
    if (note.trim()) fd.append('note', note.trim())
    const job = await upload.run(() => api.postForm<Job>('/crowd/video/analyses', fd))
    if (job) {
      toast(`Queued: ${job.filename}`)
      setFile(null); setNote('')
      if (fileRef.current) fileRef.current.value = ''
      setJobs((prev) => [job, ...(prev ?? [])])
      setOpenId(job.id)
    }
  }
  const cancel = (j: Job) => act.run(() => api.post(`/crowd/video/analyses/${j.id}/cancel`)).then(() => void loadJobs())
  const remove = (j: Job) => act.run(() => api.del(`/crowd/video/analyses/${j.id}`)).then(() => { if (openId === j.id) setOpenId(null); void loadJobs() })
  const publish = async () => {
    if (!open || !pubLoc) return
    const r = await act.run(() => api.post<Job>(`/crowd/video/analyses/${open.id}/publish`, { location_id: Number(pubLoc), statistic: pubStat, note: 'Pipeline verification from recorded video' }))
    if (r) {
      toast('Count sent through the crowd pipeline')
      setPubConfirm(false)
      await loadJobs()
      const st = await api.get<CrowdStatus[]>('/crowd/status').catch(() => [] as CrowdStatus[])
      setPipeline(st.find((s) => s.location_id === Number(pubLoc)) ?? null)
    }
  }

  const s = open?.summary ?? {}
  const pubValue = s.count_max != null ? { max: s.count_max, mean: s.count_mean, p95: s.count_p95, median: s.count_median }[pubStat] : null
  const pubTarget = pubLoc ? places.find((p) => p.id === Number(pubLoc)) : null
  const smallPeople = open?.status === 'done' && open.detection_mode === 'standard' && (open.video_width ?? 0) * (open.video_height ?? 0) > 1280 * 720 && (s.count_max ?? 0) < 15

  const jobList = (
    <div className="card">
      <div className="card-head"><h2><FileVideo size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Analyses</h2><span className="muted small">{jobs ? `${jobs.length} total` : ''}</span></div>
      {!jobs && <Skeleton rows={3} />}
      {jobs && jobs.length === 0 && <EmptyState icon={FileVideo} title="No videos analysed yet" body="Upload a recorded clip from a ghat or gate camera to check that people are detected, tracked and counted correctly." />}
      {jobs && jobs.length > 0 && (
        <div className="list" style={{ gap: 6 }}>
          {jobs.map((j) => {
            const pct = j.frames_expected ? Math.min(100, Math.round((j.frames_processed / j.frames_expected) * 100)) : 0
            return (
              <button key={j.id} type="button" className="lrow" onClick={() => setOpenId(j.id)} style={openId === j.id ? { borderColor: 'var(--brand-500)', background: 'var(--brand-50)' } : undefined}>
                <span className={`lead ${j.status === 'failed' ? 'danger' : ''}`} aria-hidden>{j.status === 'running' ? <Activity size={20} className="spin-icon" /> : j.status === 'done' ? <CircleCheck size={20} /> : j.status === 'failed' ? <CircleAlert size={20} /> : <FileVideo size={20} />}</span>
                <span className="body">
                  <span className="title" style={{ overflowWrap: 'anywhere' }}>{j.filename}</span>
                  <span className="meta">
                    <span className={`chip ${STATUS_CLS[j.status]}`}>{j.status}</span>
                    {j.detection_mode === 'tiled' && <span className="chip neutral"><Grid2x2 size={11} aria-hidden /> tiled</span>}
                    {j.status === 'running' && <span>{pct}% · now {j.last_count ?? '–'} people</span>}
                    {j.status === 'done' && <span>max {j.summary.count_max} · mean {j.summary.count_mean}</span>}
                    <span>{ago(j.created_at)}</span>
                    {j.location_id && <span>{name(locById(j.location_id) ?? { name: '' })}</span>}
                  </span>
                  {j.status === 'running' && <span className="meter" style={{ marginTop: 6 }}><span className="low" style={{ width: `${Math.max(3, pct)}%` }} /></span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  const detail = open && (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 style={{ overflowWrap: 'anywhere' }}>{open.filename}</h2>
            <div className="muted small">{fmtBytes(open.size_bytes)}{open.video_width ? ` · ${open.video_width}×${open.video_height} · ${open.video_fps} fps · ${open.video_duration_s} s` : ''}{open.note ? ` · ${open.note}` : ''}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {(open.status === 'queued' || open.status === 'running') && <button className="btn sm" onClick={() => void cancel(open)} disabled={act.busy}><Square size={14} aria-hidden />Cancel</button>}
            <button className="btn sm danger-outline" onClick={() => void remove(open)} disabled={act.busy} aria-label="Delete analysis"><Trash2 size={14} aria-hidden />Delete</button>
            <button className="btn icon sm ghost" onClick={() => setOpenId(null)} aria-label="Close"><X size={18} aria-hidden /></button>
          </div>
        </div>
        {open.status === 'queued' && <Notice>Waiting for the detector (one video is processed at a time).</Notice>}
        {open.status === 'failed' && <Notice tone="danger" icon={CircleAlert}>Analysis failed: {open.error}</Notice>}
        {open.status === 'cancelled' && <Notice tone="warn">Cancelled before completion.</Notice>}
        {open.status === 'running' && <span className="muted small">Analysing {open.frames_processed} of {open.frames_expected} sampled frames · {modeLabel(open.detection_mode, open.tiles)} · {open.device}</span>}
        {open.status === 'done' && (
          <>
            <div className="kpis" style={{ marginBottom: 'var(--s4)' }}>
              <div className="kpi"><div className="v">{num(s.count_max ?? 0)}</div><div className="l">Peak people in a frame{s.peak_t != null ? ` (at ${s.peak_t}s)` : ''}</div></div>
              <div className="kpi"><div className="v">{s.count_p95}</div><div className="l">95th percentile</div></div>
              <div className="kpi"><div className="v">{s.count_mean}</div><div className="l">Mean per frame</div></div>
              <div className="kpi"><div className="v">{num(s.unique_tracks ?? 0)}</div><div className="l">Distinct people tracked (approx.)</div></div>
              <div className="kpi"><div className="v">{num(s.frames_sampled ?? 0)}</div><div className="l">Frames sampled at {open.sample_fps}/s</div></div>
              <div className="kpi"><div className="v">{s.infer_ms_median} ms</div><div className="l">Detection per frame · {s.detection_mode === 'tiled' ? `${s.tiles} tiles` : 'one pass'} · {open.device}</div></div>
              <div className="kpi"><div className="v">{s.processing_s} s</div><div className="l">Processing time · {open.model_name}</div></div>
            </div>
            {s.truncated && <Notice tone="warn">Only the first {s.analysed_seconds} s were analysed (server limit).</Notice>}
            {s.count_max === 0 && <Notice tone="warn" icon={CircleAlert}>No people were detected. Check that the clip really shows people at a usable size, lower the confidence threshold, or re-run with detail "Tiled".</Notice>}
            {smallPeople && <Notice tone="warn" icon={CircleAlert}>This high-resolution clip was analysed in one pass, so small or distant people may have been missed. Re-upload with detail "Tiled (native resolution)" for dense or aerial footage.</Notice>}
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn sm" onClick={() => void download(`/crowd/video/analyses/${open.id}/frames?format=csv`, `video-analysis-${open.id}.csv`)}><Download size={14} aria-hidden />Frame counts (CSV)</button>
              <button className="btn sm" onClick={() => void download(`/crowd/video/analyses/${open.id}/frames?boxes=true`, `video-analysis-${open.id}.json`)}><Download size={14} aria-hidden />Detections with boxes and track ids (JSON)</button>
            </div>
          </>
        )}
      </div>

      {open.status === 'running' && <LiveRun job={open} />}

      {open.status === 'done' && (frames ? <Playback job={open} frames={frames} onZoom={setZoom} /> : <div className="card"><Skeleton rows={4} /></div>)}

      {open.status === 'done' && frames && frames.some((f) => f.image) && (
        <div className="card">
          <div className="card-head"><h2><ImageIcon size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Annotated stills</h2><span className="muted small">{s.annotated_frames} of {s.frames_sampled} sampled frames</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {frames.filter((f) => f.image).map((f) => (
              <figure key={f.index} style={{ margin: 0 }}>
                <AuthImage src={`/crowd/video/analyses/${open.id}/frames/${f.image}`} alt={`Frame at ${f.t}s, ${f.count} people`} style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }} onClick={() => setZoom(f)} />
                <figcaption className="xs muted" style={{ marginTop: 4 }}>{f.t.toFixed(1)} s · <strong style={{ color: 'var(--text)' }}>{f.count}</strong> people</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {open.status === 'done' && frames && (
        <div className="card">
          <div className="card-head"><h2>Frame-by-frame results</h2><span className="muted small">{frames.length} rows</span></div>
          <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>#</th><th>Video frame</th><th>Time</th><th>People</th><th>Tracked so far</th><th>Detection</th><th>Image</th></tr></thead>
              <tbody>
                {frames.map((f) => (
                  <tr key={f.index} style={f.frame === s.peak_frame ? { background: 'var(--accent-soft)' } : undefined}>
                    <td>{f.index}</td><td>{f.frame}</td><td>{f.t.toFixed(2)} s</td><td><strong>{f.count}</strong></td><td className="muted">{f.unique_so_far ?? '–'}</td><td className="muted">{f.infer_ms} ms</td>
                    <td>{f.image ? <button className="btn sm ghost" onClick={() => setZoom(f)}>View</button> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open.status === 'done' && (
        <div className="card">
          <div className="card-head"><h2><Send size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Send through the crowd pipeline</h2></div>
          <p className="small muted" style={{ marginBottom: 12 }}>Posts the chosen statistic as a crowd reading with source <strong>video</strong>, exactly as a live camera device would. Pilgrims will see it as a recorded-video verification, never as a live feed. Use a test location or clear it afterwards with a staff reading.</p>
          <div className="cols-2" style={{ gap: 12 }}>
            <Field label="Location"><select className="input" value={pubLoc} onChange={(e) => setPubLoc(e.target.value)}><option value="">Choose a ghat or gate</option>{monitored.map((p) => <option key={p.id} value={p.id}>{name(p)}{p.capacity ? ` (capacity ${num(p.capacity)})` : ' (no capacity set)'}</option>)}</select></Field>
            <Field label="Statistic"><select className="input" value={pubStat} onChange={(e) => setPubStat(e.target.value as typeof pubStat)}><option value="p95">95th percentile ({s.count_p95})</option><option value="max">Peak ({s.count_max})</option><option value="mean">Mean ({s.count_mean})</option><option value="median">Median ({s.count_median})</option></select></Field>
          </div>
          {pubTarget && !pubTarget.capacity && <div style={{ marginTop: 10 }}><Notice tone="warn">This location has no safe capacity set, so the level will show as "No recent data" even with a count. Set the capacity in Locations to see a level.</Notice></div>}
          {!pubConfirm
            ? <button className="btn primary" style={{ marginTop: 12 }} disabled={!pubLoc || act.busy} onClick={() => setPubConfirm(true)}><Send size={16} aria-hidden />Send {pubValue} people to {pubTarget ? name(pubTarget) : 'location'}</button>
            : <div className="row wrap" style={{ marginTop: 12, gap: 8 }}><SubmitButton className="btn primary" busy={act.busy} onClick={() => void publish()}>Confirm: record {pubValue} at {pubTarget ? name(pubTarget) : ''}</SubmitButton><button className="btn" onClick={() => setPubConfirm(false)}>Cancel</button></div>}
          {open.published_reading_id && <div style={{ marginTop: 12 }}><Notice tone="ok" icon={CircleCheck}>Published as crowd reading #{open.published_reading_id}{pipeline ? ` · live status now shows ${pipeline.current_count} people, source "${pipeline.source}", updated ${clock(pipeline.updated_at)} → pipeline verified end-to-end` : ''}.</Notice></div>}
          {act.error && <ErrorState message={act.error} />}
        </div>
      )}
    </div>
  )

  return (
    <div className="stack loose">
      <PageHead back={false} title="Video crowd-count check" sub="Temporary verification tool: analyse a recorded clip with the same person detector the camera pipeline will use, watch the tracking live, then confirm the count reaches the live status." />

      <div className="cols-2">
        <div className="card">
          <div className="card-head"><h2><Cpu size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Detector</h2>{health && <span className={`chip ${health.available ? 'low' : 'critical'}`}>{health.available ? 'ready' : 'not installed'}</span>}</div>
          {healthErr && <ErrorState message={healthErr} />}
          {!health && !healthErr && <Skeleton rows={2} kind="line" />}
          {health && (
            <dl className="kv">
              <dt>Model</dt><dd>{health.model_name ?? health.model_path} (YOLOv8, class "person"){health.model_loaded ? '' : ' · loads on first run'}</dd>
              <dt>Device</dt><dd>{health.device}{health.cuda ? ' (CUDA)' : ' (CPU – slower)'}</dd>
              {health.available && <><dt>Versions</dt><dd>ultralytics {health.ultralytics} · torch {health.torch} · OpenCV {health.opencv}</dd></>}
              <dt>Dense crowds</dt><dd>{health.tiling ? `${health.tiling.tile_px} px tiles, ${Math.round(health.tiling.overlap * 100)}% overlap · automatic from ${health.tiling.auto_min_px} px` : '—'}</dd>
              <dt>Annotated video</dt><dd>{health.output_video ? 'ffmpeg available · H.264 playback' : 'ffmpeg not found · stills only'}</dd>
              <dt>Limits</dt><dd>{health.limits.max_mb} MB · first {health.limits.max_seconds} s · {health.limits.imgsz} px standard pass</dd>
            </dl>
          )}
          {health && !health.available && <Notice tone="danger" icon={CircleAlert}>{health.error}. Install with <code>{health.install}</code> and restart the API.</Notice>}
        </div>

        <div className="card">
          <div className="card-head"><h2><Upload size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> Analyse a video</h2></div>
          <div className="stack">
            <Field label="Video file" hint={`MP4, MOV, AVI, MKV or WebM · up to ${health?.limits.max_mb ?? 300} MB`} htmlFor="vfile">
              <input id="vfile" ref={fileRef} className="input" type="file" accept="video/*,.mp4,.mov,.avi,.mkv,.webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <div className="cols-2" style={{ gap: 12 }}>
              <Field label="Sample rate" hint="Frames analysed per second of video (higher = smoother tracking, slower)"><select className="input" value={fps} onChange={(e) => setFps(e.target.value)}><option value="0.5">0.5 / s (fast)</option><option value="1">1 / s</option><option value="2">2 / s (default)</option><option value="5">5 / s (smooth tracking)</option><option value="10">10 / s (very slow on 4K)</option></select></Field>
              <Field label="Detail" hint="Tiled: native-resolution tiles for dense, aerial or 4K footage"><select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}><option value="auto">Auto (tiled from {health?.tiling?.auto_min_px ?? 1600} px)</option><option value="tiled">Tiled (native resolution)</option><option value="standard">Standard (one 640 px pass)</option></select></Field>
            </div>
            <div className="cols-2" style={{ gap: 12 }}>
              <Field label={`Confidence threshold: ${conf.toFixed(2)}`} hint="Lower = more detections, more false positives"><input className="input" type="range" min={0.1} max={0.8} step={0.05} value={conf} onChange={(e) => setConf(Number(e.target.value))} style={{ padding: 0, minHeight: 44 }} /></Field>
              <Field label="Location (optional)" hint="Where the clip was recorded"><select className="input" value={locId} onChange={(e) => setLocId(e.target.value)}><option value="">Not linked</option>{monitored.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}</select></Field>
            </div>
            <Field label="Note (optional)"><input className="input" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gate B camera, evening test" /></Field>
            {upload.error && <ErrorState message={upload.error} />}
            <SubmitButton className="btn primary" busy={upload.busy} disabled={!file || !health?.available} onClick={() => void doUpload()}><Play size={16} aria-hidden />{upload.busy ? 'Uploading…' : 'Upload and count people'}</SubmitButton>
            {file && <span className="muted xs">{file.name} · {fmtBytes(file.size)}</span>}
          </div>
        </div>
      </div>

      {bp === 'desktop' ? (
        <div className="layout-split" style={{ gridTemplateColumns: 'minmax(300px, 360px) minmax(0, 1fr)' }}>
          <div>{jobList}</div>
          <div>{detail ?? <div className="card"><EmptyState icon={Activity} title="Select an analysis" body="Live analysis, tracking playback, per-frame counts and annotated stills appear here." /></div>}</div>
        </div>
      ) : (
        <div className="stack">{jobList}{detail}</div>
      )}

      <Notice>This tool verifies the detection and counting chain on recorded clips. Live camera feeds will post readings continuously through <code>POST /api/v1/crowd/readings</code> with a device key (source "camera"); readings from this page carry source "video" and are shown as a recorded-video verification. Counts are people per frame (occupancy). "Distinct people tracked" comes from a lightweight tracker and is approximate, especially with low sample rates or a moving camera. Logged in as {user?.name ?? user?.role}.</Notice>

      <Sheet open={!!zoom} onClose={() => setZoom(null)} title={zoom ? `${zoom.t.toFixed(1)} s · ${zoom.count} people` : ''}>
        {zoom && open && <AuthImage src={`/crowd/video/analyses/${open.id}/frames/${zoom.image}`} alt={`Frame at ${zoom.t}s`} style={{ width: '100%', height: 'auto', borderRadius: 'var(--r-md)' }} />}
      </Sheet>
    </div>
  )
}
