'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AlertTriangle, Ban, CheckCircle2, Clock, EyeOff, RefreshCw, Loader2,
  Shield, Target, TrendingUp, Wallet, XCircle,
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
const verdictColor = (v: string) =>
  v === 'Hot' ? 'text-[#00D4AA] border-[#00D4AA]/40' : v === 'Neutral' ? 'text-amber-300 border-amber-400/40' : 'text-[#8B95A8] border-[#1E293B]'

export default function DecisionPage() {
  const router = useRouter()
  const [data, setData] = useState<Decision | null>(null)
  const [log, setLog] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [etfInput, setEtfInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        throw new Error('Supabase is not configured in this local copy (frontend/.env.local is missing), so login and your portfolio cannot load here. This page only has real data where Aura is deployed with its env set, or after adding .env.local locally.')
      }
      const supabase = createClient()
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Login check timed out after 10s - check connection and Supabase config.')), 10000)),
      ])
      if (!session) { router.push('/admin/login'); return }
      setToken(session.access_token)
      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [dRes, lRes] = await Promise.all([
        fetch(`${BACKEND}/api/v1/decision/`, { headers }),
        fetch(`${BACKEND}/api/v1/decision/log`, { headers }),
      ])
      if (!dRes.ok) throw new Error((await dRes.json().catch(() => ({}))).detail || `Decision API ${dRes.status}`)
      setData(await dRes.json())
      const lj = await lRes.json().catch(() => ({ log: [] }))
      setLog(lj.log || [])
    } catch (e: any) { setError(e.message || 'Failed to load decision') } finally { setLoading(false) }
  }, [router])

  useEffect(() => { load() }, [load])

  const post = async (path: string, body: any, key: string) => {
    if (!token) return
    setBusy(key)
    try {
      const res = await fetch(`${BACKEND}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Action failed')
      await load()
    } catch (e: any) { alert(e.message) } finally { setBusy(null) }
  }

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-16 text-[#8B95A8]"><Loader2 className="mr-2 inline animate-spin" /> Building your weekly decision…</main>
  if (error || !data) return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold text-[#F1F5F9]">This Week&apos;s Decision</h1>
      <p className="mt-3 border border-[#FF4D6A]/40 bg-[#141B2D] p-4 text-[#FF8FA3]">{error || 'No data'}</p>
      <p className="mt-3 text-sm text-[#8B95A8]">Make sure the Aura backend is running and your portfolio is synced from <Link className="text-[#00D4AA] underline" href="/portfolio">/portfolio</Link>. Fundamentals are fetched live and can take up to a minute on first run.</p>
      <button onClick={load} className="mt-4 border border-[#00D4AA]/50 px-4 py-2 text-[#00D4AA]">Retry</button>
    </main>
  )

  const staleDays = data.sheet_asof ? Math.floor((Date.now() - new Date(data.sheet_asof).getTime()) / 86400000) : null
  const tw = data.this_week
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-[#64748B]">OWNER ONLY · JORDAN (UTC+3)</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#F1F5F9]">This Week&apos;s Decision</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#8B95A8]">{data.anchor}</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 border border-[#1E293B] bg-[#141B2D] px-4 py-2 text-sm text-[#F1F5F9]">
          <RefreshCw size={15} /> Refresh on demand
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs text-[#8B95A8]">
        <span className="border border-[#1E293B] bg-[#141B2D] px-2 py-1">Generated {new Date(data.generated_at).toLocaleString()}</span>
        <span className="border border-[#1E293B] bg-[#141B2D] px-2 py-1">{data.market_provisional ? 'INTRADAY · PROVISIONAL' : 'AFTER CLOSE · OFFICIAL'}</span>
        <span className="border border-[#1E293B] bg-[#141B2D] px-2 py-1">Sheet as of {data.sheet_asof ? new Date(data.sheet_asof).toLocaleDateString() : 'unknown'}</span>
        {staleDays !== null && staleDays > 10 && <span className="border border-[#FF4D6A]/50 px-2 py-1 text-[#FF8FA3]"><AlertTriangle size={12} className="mr-1 inline" />Sheet stale {staleDays}d — update before acting</span>}
      </div>

      <section className="mt-6 border border-[#00D4AA]/30 bg-[#141B2D] p-5">
        <p className="flex items-center gap-2 font-mono text-xs text-[#00D4AA]"><Target size={14} /> WHERE THIS WEEK&apos;S MONEY GOES</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-semibold text-[#F1F5F9]">{tw.action} {tw.ticker}</span>
          <span className="text-sm text-[#8B95A8]">{tw.bucket}</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#CBD5E1]">{tw.reason}</p>
        <p className="mt-1 text-sm text-[#8B95A8]">{tw.tranche_note}</p>
        <p className="mt-3 border-t border-[#1E293B] pt-3 text-xs text-[#64748B]">{data.benchmark_note}</p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="border border-[#1E293B] bg-[#141B2D] p-4">
          <p className="flex items-center gap-2 font-mono text-xs text-[#64748B]"><Wallet size={14} /> ALLOCATION</p>
          <p className="mt-2 text-sm text-[#CBD5E1]">ETF base <b className="text-[#F1F5F9]">{data.allocation.etf_pct}%</b> (target {data.allocation.etf_target})</p>
          <p className="text-sm text-[#CBD5E1]">Single stocks <b className="text-[#F1F5F9]">{data.allocation.stocks_pct}%</b> · Portfolio ${data.total_value.toLocaleString()}</p>
          <p className="mt-1 text-xs text-[#64748B]">Cash target {data.allocation.cash_target}. Max ~5% per name, build in 2-3 tranches.</p>
        </div>
        <div className="border border-[#1E293B] bg-[#141B2D] p-4 md:col-span-2">
          <p className="flex items-center gap-2 font-mono text-xs text-[#64748B]"><TrendingUp size={14} /> SECTOR RANKING — HOT GETS NEW MONEY</p>
          <div className="mt-3 space-y-2">
            {data.sectors.map(s => (
              <div key={s.bucket} className="flex items-center gap-3 text-sm">
                <span className="w-52 shrink-0 text-[#CBD5E1]">{s.bucket}</span>
                <span className="h-2 flex-1 bg-[#0A0F1A]"><span className="block h-2 bg-[#00D4AA]" style={{ width: `${s.score * 10}%` }} /></span>
                <span className="w-10 font-mono text-[#F1F5F9]">{s.score}</span>
                <span className={`border px-1.5 py-0.5 font-mono text-[11px] ${verdictColor(s.verdict)}`}>{s.verdict}</span>
                <span className="w-16 text-right text-xs text-[#64748B]">{s.weight_pct}% held</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold text-[#F1F5F9]">Candidates — numbers first, Aura is idea-feed only</h2>
        <p className="mt-1 text-sm text-[#8B95A8]">A stock buys only at score ≥10 with Why-Now green and valuation not red. Everything shows its evidence; Aura sentiment alone never approves a buy.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.candidates.map(c => (
            <article key={c.ticker} className="border border-[#1E293B] bg-[#141B2D] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/ticker?ticker=${c.ticker}`} className="text-lg font-semibold text-[#F1F5F9] hover:text-[#00D4AA]">{c.ticker}</Link>
                  <span className="ml-2 text-sm text-[#8B95A8]">{c.stock_name || ''}</span>
                  <p className="text-xs text-[#64748B]">{c.bucket}{c.held ? ` · held ${c.weight_pct}%` : ''}{c.price ? ` · $${Number(c.price).toFixed(2)}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl text-[#F1F5F9]">{c.score}<span className="text-sm text-[#64748B]">/12</span></p>
                  <p className={c.passes_strict ? 'font-mono text-xs text-[#00D4AA]' : 'font-mono text-xs text-[#8B95A8]'}>{c.passes_strict ? 'PASSES STRICT' : c.verdict}</p>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {c.checks.map(ch => (
                  <li key={ch.key} className="flex gap-2 text-[13px] leading-5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot(ch.score)}`} />
                    <span><b className="text-[#E2E8F0]">{ch.label}:</b> <span className="text-[#8B95A8]">{ch.evidence}</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-mono text-[11px] text-[#64748B]">Evidence: {c.evidence_source} · Idea source: {c.aura.source || 'fundamentals scan'} ({c.aura.mentions_30d} mentions/30d)</p>
              <div className="mt-3 flex gap-2">
                <button disabled={busy === c.ticker} onClick={() => post('/api/v1/decision/dismiss', { ticker: c.ticker, kind: 'never', reason: 'personal restriction' }, c.ticker)} className="flex items-center gap-1 border border-[#FF4D6A]/50 px-3 py-1.5 text-xs text-[#FF8FA3]"><Ban size={13} /> Never for me</button>
                <button disabled={busy === c.ticker} onClick={() => post('/api/v1/decision/dismiss', { ticker: c.ticker, kind: 'not_now' }, c.ticker)} className="flex items-center gap-1 border border-[#1E293B] px-3 py-1.5 text-xs text-[#CBD5E1]"><EyeOff size={13} /> Not now</button>
              </div>
            </article>
          ))}
          {data.candidates.length === 0 && <p className="text-sm text-[#8B95A8]">No Aura candidates right now — the ETF default above applies.</p>}
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="border border-[#1E293B] bg-[#141B2D] p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#F1F5F9]"><AlertTriangle size={16} className="text-amber-300" /> Holdings needing action</h2>
          <p className="mt-1 text-xs text-[#64748B]">Healthy holdings stay silent. Sell only on broken thesis, trim on overweight or red valuation — never on price alone.</p>
          <ul className="mt-3 space-y-2">
            {data.alerts.map((a, i) => (
              <li key={i} className="border border-[#1E293B] bg-[#0A0F1A] p-3 text-sm">
                <b className="text-[#F1F5F9]">{a.ticker}</b> <span className="ml-1 font-mono text-xs text-amber-300">{a.type}</span>
                <p className="mt-0.5 text-[#8B95A8]">{a.detail}</p>
              </li>
            ))}
            {data.alerts.length === 0 && <li className="flex items-center gap-2 text-sm text-[#00D4AA]"><CheckCircle2 size={15} /> No action needed. Hold.</li>}
          </ul>
          <div className="mt-4 max-h-72 overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="font-mono text-[11px] text-[#64748B]"><th className="py-1">HOLDING</th><th>WEIGHT</th><th>SCORE</th><th>STATUS</th></tr></thead>
              <tbody>
                {data.holdings.map(h => (
                  <tr key={h.ticker} className="border-t border-[#1E293B]">
                    <td className="py-1.5 text-[#F1F5F9]">{h.ticker} <span className="text-[#64748B]">{h.bucket}</span></td>
                    <td className="text-[#CBD5E1]">{h.weight_pct}%</td><td className="font-mono text-[#CBD5E1]">{h.score}/12</td>
                    <td className={h.verdict === 'Healthy' ? 'text-[#00D4AA]' : h.verdict === 'Probation' ? 'text-[#FF8FA3]' : 'text-amber-300'}>{h.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border border-[#1E293B] bg-[#141B2D] p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#F1F5F9]"><Shield size={16} className="text-[#00D4AA]" /> Your lists — you are the final judge</h2>
            <p className="mt-2 font-mono text-xs text-[#64748B]">NEVER FOR ME (PERMANENT)</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.state.never.map(t => (
                <button key={t} title="Click to unblock" onClick={() => post('/api/v1/decision/dismiss', { ticker: t, kind: 'clear' }, t)} className="border border-[#FF4D6A]/40 px-2 py-0.5 font-mono text-xs text-[#FF8FA3]">{t} ×</button>
              ))}
              {data.state.never.length === 0 && <span className="text-sm text-[#64748B]">None yet — dismiss a candidate with “Never for me”.</span>}
            </div>
            <p className="mt-3 font-mono text-xs text-[#64748B]">NOT NOW (CAN RESURFACE)</p>
            <p className="text-sm text-[#8B95A8]">{data.state.not_now.map(n => n.ticker).join(', ') || 'None'}</p>
            <p className="mt-3 flex items-center gap-2 font-mono text-xs text-[#64748B]"><Clock size={12} /> APPROVED SHARIAH ETFs (IRELAND, WHITELIST)</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.state.etf_whitelist.map(t => <span key={t} className="border border-[#00D4AA]/40 px-2 py-0.5 font-mono text-xs text-[#00D4AA]">{t}</span>)}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={etfInput} onChange={e => setEtfInput(e.target.value.toUpperCase())} placeholder="Add ETF ticker" className="w-36 border border-[#1E293B] bg-[#0A0F1A] px-2 py-1.5 font-mono text-xs text-[#F1F5F9]" />
              <button disabled={!etfInput || busy === 'etf'} onClick={async () => { await post('/api/v1/decision/etf', { ticker: etfInput, action: 'approve' }, 'etf'); setEtfInput('') }} className="border border-[#00D4AA]/50 px-3 py-1.5 text-xs text-[#00D4AA]">Approve ETF</button>
            </div>
            <p className="mt-1 text-xs text-[#64748B]">Only approved ETFs can receive the weekly default. The system may propose, you approve.</p>
          </div>

          <div className="border border-[#1E293B] bg-[#141B2D] p-4">
            <h2 className="text-base font-semibold text-[#F1F5F9]">Decision log</h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {log.slice(0, 8).map((l: any, i: number) => (
                <li key={i} className="flex gap-2 text-[#8B95A8]"><XCircle size={13} className="mt-0.5 hidden" /><span className="font-mono text-xs text-[#64748B]">{l.created_at ? new Date(l.created_at).toLocaleDateString() : ''}</span><span><b className="text-[#E2E8F0]">{l.action} {l.ticker || ''}</b> — {l.reason}</span></li>
              ))}
              {log.length === 0 && <li className="text-[#64748B]">No logged decisions yet. Each visit logs this week&apos;s call for the benchmark audit.</li>}
            </ul>
            <p className="mt-3 text-xs leading-5 text-[#64748B]">Personal use only, decision support — not financial advice. You place every trade. Run migration 021 in Supabase to persist blacklist, ETF whitelist and this log; until then lists show defaults.</p>
          </div>
        </div>
      </section>
    </main>
  )
}
