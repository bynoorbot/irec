'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AlertTriangle, ArrowRight, Ban, Check, Database, FileText, Landmark,
  Loader2, Newspaper, RefreshCw, ShieldCheck, Video,
} from 'lucide-react'

type Check = { key: string; label: string; score: number; evidence: string }
type Idea = {
  ticker: string; stock_name?: string | null; bucket: string; held: boolean
  weight_pct: number; price?: number | null; score: number; checks: Check[]
  passes_strict: boolean; verdict: string
  aura: { sentiment?: number | null; conviction?: number | null; mentions_30d: number; analyst_count: number; source?: string | null }
  evidence_source: string
}
type Decision = {
  generated_at: string; market_provisional: boolean; anchor: string
  sheet_asof?: string | null; total_value: number
  allocation: { etf_pct: number; stocks_pct: number; etf_target: string; cash_target: string }
  this_week: { action: string; ticker: string; bucket: string; reason: string; tranche_note: string }
  sectors: { bucket: string; score: number; verdict: string; members: number; weight_pct: number }[]
  candidates: Idea[]; holdings: Idea[]
  alerts: { ticker: string; type: string; detail: string }[]
  state: { never: string[]; not_now: { ticker: string; reason?: string | null }[]; etf_whitelist: string[] }
  benchmark_note: string
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
const dot = (s: number) => (s === 2 ? 'bg-[#00D4AA]' : s === 1 ? 'bg-amber-400' : 'bg-[#FF4D6A]')
const scoreText = (s: number) => (s >= 10 ? 'text-[#00D4AA]' : s >= 8 ? 'text-amber-300' : 'text-[#FF8FA3]')

export default function DecisionPage() {
  const router = useRouter()
  const [data, setData] = useState<Decision | null>(null)
  const [log, setLog] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [etfInput, setEtfInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        throw new Error('Supabase is not configured in this local copy (frontend/.env.local is missing), so login and your portfolio cannot load here. Use live Aura, or add the env file locally.')
      }
      const supabase = createClient()
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Login check timed out after 10s. Check your connection, then retry.')), 10000)),
      ])
      if (!session) { router.push('/admin/login'); return }
      setToken(session.access_token)
      const headers = { Authorization: `Bearer ${session.access_token}` }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 120000)
      const [dRes, lRes] = await Promise.all([
        fetch(`${BACKEND}/api/v1/decision/`, { headers, signal: ctrl.signal }),
        fetch(`${BACKEND}/api/v1/decision/log`, { headers }),
      ])
      clearTimeout(timer)
      if (!dRes.ok) throw new Error((await dRes.json().catch(() => ({}))).detail || `Decision service returned ${dRes.status}. Retry in a minute.`)
      setData(await dRes.json())
      const lj = await lRes.json().catch(() => ({ log: [] }))
      setLog(lj.log || [])
      if (isRefresh) flash('Decision refreshed with the latest data.')
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'The decision service took over 2 minutes (fundamentals are slow on first run). Retry - the second run is cached.' : (e.message || 'Failed to load decision'))
    } finally { setLoading(false); setRefreshing(false) }
  }, [router])

  useEffect(() => { load() }, [load])

  const post = async (path: string, body: any, key: string, okMsg: string) => {
    if (!token) return
    setBusy(key)
    try {
      const res = await fetch(`${BACKEND}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail || 'Save failed. Try again.')
      setData(prev => prev ? {
        ...prev,
        candidates: body.kind === 'never' ? prev.candidates.filter(c => c.ticker !== body.ticker) : prev.candidates,
        state: {
          never: json.never ?? prev.state.never,
          not_now: json.not_now ?? prev.state.not_now,
          etf_whitelist: json.etf_whitelist ?? prev.state.etf_whitelist,
        },
      } : prev)
      flash(okMsg)
    } catch (e: any) { flash(`Not saved: ${e.message}`) } finally { setBusy(null) }
  }

  if (loading) return (
    <main className="mx-auto max-w-5xl px-5 py-20">
      <Loader2 className="mr-2 inline animate-spin text-[#00D4AA]" />
      <span className="text-[#CBD5E1]">Building your weekly decision. First run fetches live fundamentals and can take up to a minute.</span>
    </main>
  )
  if (error || !data) return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-2xl font-semibold text-[#F1F5F9]">This week&apos;s decision</h1>
      <p className="mt-4 border border-[#FF4D6A]/40 bg-[#141B2D] p-4 leading-6 text-[#FF8FA3]">{error || 'No data returned.'}</p>
      <p className="mt-3 text-sm leading-6 text-[#8B95A8]">Check the Aura backend is up and your portfolio is synced from <Link className="text-[#00D4AA] underline underline-offset-4" href="/portfolio">Portfolio</Link>, then retry.</p>
      <button onClick={() => load()} className="mt-5 rounded-md bg-[#00D4AA] px-4 py-2 text-sm font-semibold text-[#06251D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00D4AA]">Retry</button>
    </main>
  )

  const staleDays = data.sheet_asof ? Math.floor((Date.now() - new Date(data.sheet_asof).getTime()) / 86400000) : null
  const tw = data.this_week
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#F1F5F9]">This week&apos;s decision</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">Owner only · Jordan (UTC+3) · {data.anchor}</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="flex items-center gap-2 rounded-md border border-[#2A364D] bg-[#141B2D] px-4 py-2.5 text-sm font-medium text-[#F1F5F9] transition-colors hover:border-[#00D4AA]/60 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#00D4AA]">
          {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {refreshing ? 'Refreshing…' : 'Refresh on demand'}
        </button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#94A3B8]">
        <span>Generated {new Date(data.generated_at).toLocaleString()}</span>
        <span aria-hidden="true">·</span><span>{data.market_provisional ? 'Intraday · provisional' : 'After close · official'}</span>
        <span aria-hidden="true">·</span><span>Sheet as of {data.sheet_asof ? new Date(data.sheet_asof).toLocaleDateString() : 'unknown'}</span>
        {staleDays !== null && staleDays > 10 && <span className="flex items-center gap-1 font-medium text-[#FF8FA3]"><AlertTriangle size={13} /> Sheet stale {staleDays}d — update it before acting</span>}
      </div>

      {notice && <p role="status" className="mt-4 flex items-center gap-2 rounded-md border border-[#00D4AA]/40 bg-[#0D2019] px-4 py-2.5 text-sm text-[#7EF0D4]"><Check size={15} /> {notice}</p>}

      <section aria-label="Where this week's money goes" className="mt-6 rounded-lg bg-[#00D4AA] px-5 py-6 text-[#05231B] sm:px-7">
        <p className="text-[13px] font-semibold">Where this week&apos;s money goes</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <span className="text-4xl font-bold tracking-[-0.02em]">{tw.action} {tw.ticker}</span>
          <span className="text-sm font-medium opacity-80">{tw.bucket}</span>
        </div>
        <p className="mt-2 max-w-[68ch] leading-6">{tw.reason}</p>
        <p className="mt-1 text-sm opacity-80">{tw.tranche_note}</p>
      </section>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Candidates">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#F1F5F9]">Candidates, scored on the numbers</h2>
          <p className="mt-1 max-w-[68ch] text-sm leading-6 text-[#94A3B8]">A stock gets money only at 10/12 or more, with Why-Now green and valuation not red. Aura video sentiment can suggest a name; it can never approve one.</p>

          <div className="mt-5 divide-y divide-[#1E293B] border-y border-[#1E293B]">
            {data.candidates.map(c => (
              <article key={c.ticker} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/ticker?ticker=${c.ticker}`} className="text-xl font-semibold text-[#F1F5F9] underline-offset-4 hover:text-[#00D4AA] hover:underline focus-visible:outline-2 focus-visible:outline-[#00D4AA]">{c.ticker}</Link>
                    <span className="ml-2 text-sm text-[#94A3B8]">{c.stock_name || ''}</span>
                    <p className="mt-0.5 text-[13px] text-[#7C8AA0]">{c.bucket}{c.held ? ` · you hold ${c.weight_pct}%` : ''}{c.price ? ` · $${Number(c.price).toFixed(2)}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-2xl font-semibold tabular-nums ${scoreText(c.score)}`}>{c.score}<span className="text-sm text-[#7C8AA0]">/12</span></p>
                    <p className={`text-xs font-semibold ${c.passes_strict ? 'text-[#00D4AA]' : 'text-[#94A3B8]'}`}>{c.passes_strict ? 'Passes Strict — buyable' : c.verdict}</p>
                  </div>
                </div>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#1E293B]" role="img" aria-label={`Score ${c.score} of 12`}>
                  <div className={`h-full ${c.score >= 10 ? 'bg-[#00D4AA]' : c.score >= 8 ? 'bg-amber-400' : 'bg-[#FF4D6A]'}`} style={{ width: `${(c.score / 12) * 100}%` }} />
                </div>

                <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {c.checks.map(ch => (
                    <li key={ch.key} className="flex gap-2 text-[13px] leading-5">
                      <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${dot(ch.score)}`} aria-hidden="true" />
                      <span><span className="font-medium text-[#E2E8F0]">{ch.label}.</span> <span className="text-[#94A3B8]">{ch.evidence}</span></span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button disabled={busy === c.ticker} onClick={() => post('/api/v1/decision/dismiss', { ticker: c.ticker, kind: 'never', reason: 'personal restriction' }, c.ticker, `${c.ticker} saved to Never for me. It will not be suggested again.`)} className="flex items-center gap-1.5 rounded-md border border-[#FF4D6A]/50 px-3 py-2 text-[13px] font-medium text-[#FF8FA3] transition-colors hover:bg-[#FF4D6A]/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#FF4D6A]">
                    {busy === c.ticker ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Never for me
                  </button>
                  <button disabled={busy === c.ticker} onClick={() => post('/api/v1/decision/dismiss', { ticker: c.ticker, kind: 'not_now' }, c.ticker, `${c.ticker} parked as Not now. It can resurface when price or thesis changes.`)} className="rounded-md border border-[#2A364D] px-3 py-2 text-[13px] font-medium text-[#CBD5E1] transition-colors hover:border-[#94A3B8] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#00D4AA]">Not now</button>
                  <span className="ml-1 text-xs text-[#7C8AA0]">{c.aura.mentions_30d} video mentions in 30d · evidence from filings data, not videos</span>
                </div>
              </article>
            ))}
            {data.candidates.length === 0 && <p className="py-6 text-sm text-[#94A3B8]">No candidates right now. The ETF default above is this week&apos;s position.</p>}
          </div>

          <section aria-label="Holdings" className="mt-10">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-[#F1F5F9]">Your holdings</h2>
            {data.alerts.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {data.alerts.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-md border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
                    <span><span className="font-semibold text-[#F1F5F9]">{a.ticker}</span> <span className="text-amber-300">· {a.type}</span><br /><span className="leading-6 text-[#B6C2D2]">{a.detail}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 flex items-center gap-2 text-sm text-[#00D4AA]"><ShieldCheck size={16} /> Nothing needs action. Healthy holdings stay silent by design.</p>}

            <div className="mt-5 overflow-x-auto rounded-lg border border-[#1E293B]">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead><tr className="bg-[#141B2D] text-xs text-[#94A3B8]"><th className="px-4 py-3 font-medium">Holding</th><th className="px-4 py-3 font-medium">Weight</th><th className="px-4 py-3 font-medium">Score</th><th className="px-4 py-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-[#1E293B]">
                  {data.holdings.map(h => (
                    <tr key={h.ticker} className="hover:bg-[#111827]">
                      <td className="px-4 py-2.5"><span className="font-medium text-[#F1F5F9]">{h.ticker}</span> <span className="text-[#7C8AA0]">{h.bucket}</span></td>
                      <td className="px-4 py-2.5 tabular-nums text-[#CBD5E1]">{h.weight_pct}%</td>
                      <td className={`px-4 py-2.5 font-mono tabular-nums ${scoreText(h.score)}`}>{h.score}/12</td>
                      <td className={`px-4 py-2.5 font-medium ${h.verdict === 'Healthy' ? 'text-[#00D4AA]' : h.verdict === 'Probation' ? 'text-[#FF8FA3]' : 'text-amber-300'}`}>{h.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="space-y-8">
          <section aria-label="Sector ranking">
            <h2 className="text-base font-semibold text-[#F1F5F9]">Sector ranking</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">Hot gets new money. Ignore gets none, this week.</p>
            <ul className="mt-3 divide-y divide-[#1E293B] border-y border-[#1E293B]">
              {data.sectors.map(s => (
                <li key={s.bucket} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[#CBD5E1]">{s.bucket}</span>
                  <span className="font-mono tabular-nums text-[#F1F5F9]">{s.score}</span>
                  <span className={`w-[74px] text-right text-xs font-semibold ${s.verdict === 'Hot' ? 'text-[#00D4AA]' : s.verdict === 'Neutral' ? 'text-amber-300' : 'text-[#7C8AA0]'}`}>{s.verdict}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] leading-5 text-[#94A3B8]">Portfolio ${data.total_value.toLocaleString()} · ETF base {data.allocation.etf_pct}% (target {data.allocation.etf_target}) · stocks {data.allocation.stocks_pct}% · cash target {data.allocation.cash_target}.</p>
          </section>

          <section aria-label="Your lists">
            <h2 className="text-base font-semibold text-[#F1F5F9]">Your lists</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">You are the final judge. These save instantly and shape every future run.</p>
            <h3 className="mt-4 text-[13px] font-semibold text-[#FF8FA3]">Never for me</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.state.never.map(t => (
                <button key={t} onClick={() => post('/api/v1/decision/dismiss', { ticker: t, kind: 'clear' }, t, `${t} removed from Never. It can be suggested again.`)} title="Remove from Never" aria-label={`Remove ${t} from Never list`} className="rounded-full border border-[#FF4D6A]/40 px-2.5 py-1 font-mono text-xs text-[#FF8FA3] hover:bg-[#FF4D6A]/10 focus-visible:outline-2 focus-visible:outline-[#FF4D6A]">{t} ×</button>
              ))}
              {data.state.never.length === 0 && <span className="text-sm text-[#7C8AA0]">Empty. Use “Never for me” on a candidate.</span>}
            </div>
            <h3 className="mt-4 text-[13px] font-semibold text-[#CBD5E1]">Not now</h3>
            <p className="mt-1 text-sm leading-6 text-[#94A3B8]">{data.state.not_now.map(n => n.ticker).join(', ') || 'Empty. Parked names can resurface when price or thesis changes.'}</p>
            <h3 className="mt-4 text-[13px] font-semibold text-[#CBD5E1]">Approved Shariah ETFs (Ireland)</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.state.etf_whitelist.map(t => (
                <button key={t} onClick={() => post('/api/v1/decision/etf', { ticker: t, action: 'remove' }, 'etf', `${t} removed from approved ETFs.`)} title="Remove ETF" aria-label={`Remove ${t} from approved ETFs`} className="rounded-full border border-[#00D4AA]/40 px-2.5 py-1 font-mono text-xs text-[#00D4AA] hover:bg-[#00D4AA]/10 focus-visible:outline-2 focus-visible:outline-[#00D4AA]">{t} ×</button>
              ))}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (etfInput) post('/api/v1/decision/etf', { ticker: etfInput, action: 'approve' }, 'etf', `${etfInput} approved. It can now receive the weekly default.`).then(() => setEtfInput('')) }}>
              <label className="sr-only" htmlFor="etf-input">Add approved ETF ticker</label>
              <input id="etf-input" value={etfInput} onChange={e => setEtfInput(e.target.value.toUpperCase())} placeholder="ETF ticker, e.g. ISUS" className="w-full min-w-0 rounded-md border border-[#2A364D] bg-[#0A0F1A] px-3 py-2 font-mono text-[13px] text-[#F1F5F9] placeholder:text-[#5B6B82] focus:border-[#00D4AA] focus:outline-none" />
              <button disabled={!etfInput || busy === 'etf'} className="shrink-0 rounded-md bg-[#00D4AA] px-3 py-2 text-[13px] font-semibold text-[#06251D] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00D4AA]">{busy === 'etf' ? 'Saving…' : 'Approve'}</button>
            </form>
          </section>

          <section aria-label="Decision log">
            <h2 className="text-base font-semibold text-[#F1F5F9]">Decision log</h2>
            <ul className="mt-3 space-y-2.5">
              {log.slice(0, 6).map((l: any, i: number) => (
                <li key={i} className="text-sm leading-5"><span className="font-mono text-xs tabular-nums text-[#7C8AA0]">{l.created_at ? new Date(l.created_at).toLocaleDateString() : ''}</span><br /><span className="font-medium text-[#E2E8F0]">{l.action} {l.ticker || ''}</span> <span className="text-[#94A3B8]">— {l.reason}</span></li>
              ))}
              {log.length === 0 && <li className="text-sm text-[#7C8AA0]">No decisions logged yet. Each run records its call here, so picks can later be judged against the ETF.</li>}
            </ul>
            <p className="mt-3 text-[13px] leading-5 text-[#7C8AA0]">{data.benchmark_note}</p>
          </section>
        </aside>
      </div>

      <section aria-label="Where the data comes from" className="mt-12 border-t border-[#1E293B] pt-8">
        <h2 className="text-lg font-semibold text-[#F1F5F9]">Where the data comes from</h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="flex items-center gap-2 font-medium text-[#E2E8F0]"><Database size={15} className="text-[#00D4AA]" /> Your portfolio</p><p className="mt-1 text-sm leading-6 text-[#94A3B8]">Your Google Sheet (Global_Equities), synced into Aura when you press Sync on Portfolio. Weights, cost, returns and sectors come from there.</p></div>
          <div><p className="flex items-center gap-2 font-medium text-[#E2E8F0]"><FileText size={15} className="text-[#00D4AA]" /> The scores</p><p className="mt-1 text-sm leading-6 text-[#94A3B8]">Company fundamentals from Yahoo Finance data (revenue and EPS growth, margins, ROE, debt, free cash flow, PEG, price vs 50/200-day averages), fetched live and cached for 6 hours. No AI model scores your money.</p></div>
          <div><p className="flex items-center gap-2 font-medium text-[#E2E8F0]"><Video size={15} className="text-[#00D4AA]" /> Idea feed only</p><p className="mt-1 text-sm leading-6 text-[#94A3B8]">Aura&apos;s YouTube analyst consensus (extracted by Claude when videos are ingested) suggests candidates and feeds the Why-Now check. It cannot pass a stock on its own.</p></div>
          <div><p className="flex items-center gap-2 font-medium text-[#E2E8F0]"><Landmark size={15} className="text-[#00D4AA]" /> Your lists</p><p className="mt-1 text-sm leading-6 text-[#94A3B8]">Never, Not-now, approved ETFs and this log are saved in Aura&apos;s database under your owner account, and shape every future run. Personal use only — decision support, not financial advice. You place every trade.</p></div>
        </div>
        <p className="mt-6 flex items-center gap-2 text-sm text-[#7C8AA0]"><ArrowRight size={14} /> Holdings, sync and charts live on <Link className="text-[#00D4AA] underline underline-offset-4" href="/portfolio">Portfolio</Link><span aria-hidden="true">·</span><Newspaper size={14} /> Raw analyst videos live on <Link className="text-[#00D4AA] underline underline-offset-4" href="/today">Today</Link></p>
      </section>
    </main>
  )
}
