'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Check,
  Compass,
  PieChart,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'

import { DecisionSkeleton } from '@/components/decision/DecisionSkeleton'
import { DecisionTelemetryHeader } from '@/components/decision/DecisionTelemetryHeader'
import { DecisionApexConsole } from '@/components/decision/DecisionApexConsole'
import { DecisionCandidateRow, Idea } from '@/components/decision/DecisionCandidateRow'
import { DecisionHoldingsTable } from '@/components/decision/DecisionHoldingsTable'
import { DecisionSectorHeatmap } from '@/components/decision/DecisionSectorHeatmap'
import { DecisionControlLists } from '@/components/decision/DecisionControlLists'
import { DecisionAuditLog, LogEntry } from '@/components/decision/DecisionAuditLog'
import { DecisionDataSources } from '@/components/decision/DecisionDataSources'

type Decision = {
  generated_at: string
  market_provisional: boolean
  anchor: string
  sheet_asof?: string | null
  total_value: number
  allocation: {
    etf_pct: number
    stocks_pct: number
    etf_target: string
    cash_target: string
  }
  this_week: {
    action: string
    ticker: string
    bucket: string
    reason: string
    tranche_note: string
  }
  sectors: {
    bucket: string
    score: number
    verdict: string
    members: number
    weight_pct: number
  }[]
  candidates: Idea[]
  holdings: Idea[]
  alerts: { ticker: string; type: string; detail: string }[]
  state: {
    never: string[]
    not_now: { ticker: string; reason?: string | null }[]
    etf_whitelist: string[]
  }
  benchmark_note: string
  served_from_cache?: boolean
}

type TabMode = 'terminal' | 'candidates' | 'holdings' | 'sectors'

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

export default function DecisionPage() {
  const router = useRouter()
  const [data, setData] = useState<Decision | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ msg: string; undoTicker?: string; undoIdea?: Idea; undoKind?: string } | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabMode>('terminal')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string, undoTicker?: string, undoIdea?: Idea, undoKind?: string) => {
    setNotice({ msg, undoTicker, undoIdea, undoKind })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 6000)
  }

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      setError(null)

      try {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
          throw new Error(
            'Supabase is not configured in this local copy (frontend/.env.local is missing), so login and your portfolio cannot load here. Use live Aura, or add the env file locally.'
          )
        }

        const supabase = createClient()
        const {
          data: { session },
        } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Login check timed out after 10s. Check your connection, then retry.'
                  )
                ),
              10000
            )
          ),
        ])

        if (!session) {
          router.push('/admin/login')
          return
        }

        setToken(session.access_token)
        const headers = { Authorization: `Bearer ${session.access_token}` }
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 120000)

        const [dRes, lRes] = await Promise.all([
          fetch(`${BACKEND}/api/v1/decision/?fresh=${isRefresh ? 'true' : 'false'}`, {
            headers,
            signal: ctrl.signal,
          }),
          fetch(`${BACKEND}/api/v1/decision/log`, { headers }),
        ])
        clearTimeout(timer)

        if (!dRes.ok) {
          const errData = await dRes.json().catch(() => ({}))
          throw new Error(
            errData.detail ||
              `Decision service returned ${dRes.status}. Retry in a minute.`
          )
        }

        const decisionData = await dRes.json()
        setData(decisionData)

        const lj = await lRes.json().catch(() => ({ log: [] }))
        setLog(lj.log || [])

        if (isRefresh) {
          flash('Decision refreshed with live fundamental and consensus metrics.')
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load decision'
        const isAbort = e instanceof Error && e.name === 'AbortError'
        setError(
          isAbort
            ? 'The decision service took over 2 minutes (live fundamentals can take time on first run). Retry — subsequent runs are cached.'
            : msg
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [router]
  )

  useEffect(() => {
    let active = true
    const run = async () => {
      await Promise.resolve()
      if (active) {
        await load()
      }
    }
    run()
    return () => {
      active = false
    }
  }, [load])

  const post = async (
    path: string,
    body: Record<string, unknown>,
    key: string,
    okMsg: string,
    undoCandidate?: Idea
  ) => {
    if (!token) return
    setBusy(key)

    try {
      const res = await fetch(`${BACKEND}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail || 'Save failed. Try again.')

      setData((prev) => {
        if (!prev) return prev
        const isDismiss = body.kind === 'never' || body.kind === 'not_now'
        return {
          ...prev,
          candidates: isDismiss
            ? prev.candidates.filter((c) => c.ticker !== body.ticker)
            : prev.candidates,
          state: {
            never: json.never ?? prev.state.never,
            not_now: json.not_now ?? prev.state.not_now,
            etf_whitelist: json.etf_whitelist ?? prev.state.etf_whitelist,
          },
        }
      })

      flash(okMsg, body.ticker as string, undoCandidate, body.kind as string)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      flash(`Not saved: ${msg}`)
    } finally {
      setBusy(null)
    }
  }

  const handleDismissCandidate = (ticker: string, kind: 'never' | 'not_now') => {
    const candidateToDismiss = data?.candidates.find((c) => c.ticker === ticker)
    const label = kind === 'never' ? 'Never for me blacklist' : 'Not now (parked)'
    post(
      '/api/v1/decision/dismiss',
      { ticker, kind, reason: kind === 'never' ? 'personal restriction' : 'parked until next cycle' },
      ticker,
      `${ticker} moved to ${label}.`,
      candidateToDismiss
    )
  }

  const handleUndoDismiss = async () => {
    if (!notice?.undoTicker) return
    const ticker = notice.undoTicker
    const cachedIdea = notice.undoIdea

    setNotice(null)
    setBusy(ticker)

    try {
      if (!token) return
      const res = await fetch(`${BACKEND}/api/v1/decision/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticker, kind: 'clear' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail || 'Restore failed')

      setData((prev) => {
        if (!prev) return prev
        const exists = prev.candidates.some((c) => c.ticker === ticker)
        const newCandidates = exists || !cachedIdea
          ? prev.candidates
          : [cachedIdea, ...prev.candidates]

        return {
          ...prev,
          candidates: newCandidates,
          state: {
            never: json.never ?? prev.state.never,
            not_now: json.not_now ?? prev.state.not_now,
            etf_whitelist: prev.state.etf_whitelist,
          },
        }
      })
      flash(`Restored ${ticker} to candidates.`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      flash(`Could not restore: ${msg}`)
    } finally {
      setBusy(null)
    }
  }

  const handleClearDismiss = (ticker: string) => {
    post(
      '/api/v1/decision/dismiss',
      { ticker, kind: 'clear' },
      ticker,
      `${ticker} un-parked. It will be re-evaluated next run.`
    )
  }

  const handleEtfAction = (ticker: string, action: 'approve' | 'remove') => {
    post(
      '/api/v1/decision/etf',
      { ticker, action },
      'etf',
      action === 'approve'
        ? `${ticker} approved. It can now receive the systematic weekly allocation.`
        : `${ticker} removed from approved ETF list.`
    )
  }

  // 1. Loading State: Full Layout Skeleton
  if (loading) {
    return <DecisionSkeleton />
  }

  // 2. Error State: Calm Glass Card
  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-[#FF4D6A]/40 bg-[#141B2D] p-6 sm:p-8 space-y-4 shadow-xl">
          <div className="flex items-center gap-2 text-base font-bold text-[#FF8FA3]">
            <ShieldAlert size={20} />
            <span>Could Not Load Weekly Decision</span>
          </div>
          <p className="text-sm leading-relaxed text-[#CBD5E1]">
            {error || 'No decision data was returned from the backend service.'}
          </p>
          <p className="text-xs text-[#8B95A8] leading-relaxed">
            Verify the Aura backend is active and your portfolio sheet is synced on{' '}
            <Link className="text-[#00D4AA] underline underline-offset-4" href="/portfolio">
              Portfolio
            </Link>
            .
          </p>
          <div className="pt-2">
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#00D4AA] px-4 py-2.5 text-xs font-bold text-[#06251D] transition-colors hover:bg-[#00FFD0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]"
            >
              <span>Retry Decision Service</span>
            </button>
          </div>
        </div>
      </main>
    )
  }

  const candidatesCount = data.candidates.length

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 space-y-8">
      {/* 1. Integrated Telemetry Header */}
      <DecisionTelemetryHeader
        totalValue={data.total_value}
        allocation={data.allocation}
        generatedAt={data.generated_at}
        servedFromCache={data.served_from_cache}
        marketProvisional={data.market_provisional}
        sheetAsof={data.sheet_asof}
        refreshing={refreshing}
        onRefresh={() => load(true)}
        holdingsCount={data.holdings.length}
      />

      {/* Persistent Toast / Flash Notification with Instant Undo */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#00D4AA]/40 bg-[#0A1F18]/90 px-4 py-3 text-xs sm:text-sm text-[#7EF0D4] shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center gap-2">
            <Check size={16} className="text-[#00FFD0] shrink-0" />
            <span>{notice.msg}</span>
          </div>
          {notice.undoTicker && (
            <button
              onClick={handleUndoDismiss}
              className="inline-flex items-center gap-1 font-bold text-[#00FFD0] underline underline-offset-4 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#00FFD0] rounded px-1"
            >
              <RotateCcw size={12} />
              <span>Undo</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Apex Directive Console */}
      <DecisionApexConsole thisWeek={data.this_week} />

      {/* Responsive View Switcher / Focus Tabs */}
      <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'terminal'
                ? 'bg-[#1E293B] text-[#00FFD0]'
                : 'text-[#8B95A8] hover:text-[#F1F5F9]'
            }`}
          >
            <Compass size={13} />
            <span>Terminal View</span>
          </button>

          <button
            onClick={() => setActiveTab('candidates')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'candidates'
                ? 'bg-[#1E293B] text-[#00FFD0]'
                : 'text-[#8B95A8] hover:text-[#F1F5F9]'
            }`}
          >
            <Sparkles size={13} />
            <span>Candidates ({candidatesCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('holdings')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'holdings'
                ? 'bg-[#1E293B] text-[#00FFD0]'
                : 'text-[#8B95A8] hover:text-[#F1F5F9]'
            }`}
          >
            <PieChart size={13} />
            <span>Holdings Audit ({data.holdings.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('sectors')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'sectors'
                ? 'bg-[#1E293B] text-[#00FFD0]'
                : 'text-[#8B95A8] hover:text-[#F1F5F9]'
            }`}
          >
            <SlidersHorizontal size={13} />
            <span>Sectors & Rules</span>
          </button>
        </div>
      </div>

      {/* 3. Main Operational Layout */}
      {activeTab === 'terminal' ? (
        /* Bloomberg 2-Column Terminal View */
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left Column: Candidates & Holdings */}
          <div className="space-y-10 min-w-0">
            {/* Candidates Section */}
            <section aria-label="Candidates Scored on the Numbers" className="space-y-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[#F1F5F9]">
                  Candidates Scored on Fundamentals
                </h2>
                <p className="text-xs sm:text-sm text-[#8B95A8] leading-relaxed">
                  A stock qualifies for capital allocation only at score ≥10/12, with Why-Now catalyst green and valuation multiple not red. Aura YouTube consensus discovers candidate ideas; it can never approve one alone.
                </p>
              </div>

              <div className="space-y-3.5">
                {data.candidates.map((candidate) => (
                  <DecisionCandidateRow
                    key={candidate.ticker}
                    candidate={candidate}
                    isBusy={busy === candidate.ticker}
                    onDismiss={handleDismissCandidate}
                  />
                ))}

                {data.candidates.length === 0 && (
                  <div className="rounded-xl border border-[#1E293B] bg-[#141B2D]/40 p-6 text-center space-y-1.5">
                    <p className="text-sm font-semibold text-[#F1F5F9]">
                      No Single Stock Passes Strict This Cycle
                    </p>
                    <p className="text-xs text-[#8B95A8]">
                      All weekly dry powder automatically deploys to the Shariah ETF base above.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Holdings & Cap Corridor Section */}
            <DecisionHoldingsTable holdings={data.holdings} alerts={data.alerts} />
          </div>

          {/* Right Rail: Sectors, Rules & Log */}
          <aside className="space-y-8">
            <DecisionSectorHeatmap sectors={data.sectors} />

            <div className="border-t border-[#1E293B] pt-6">
              <DecisionControlLists
                neverList={data.state.never}
                notNowList={data.state.not_now}
                etfWhitelist={data.state.etf_whitelist}
                busy={busy}
                onClearDismiss={handleClearDismiss}
                onEtfAction={handleEtfAction}
              />
            </div>

            <div className="border-t border-[#1E293B] pt-6">
              <DecisionAuditLog log={log} benchmarkNote={data.benchmark_note} />
            </div>
          </aside>
        </div>
      ) : activeTab === 'candidates' ? (
        /* Candidates Focused View */
        <div className="space-y-4 max-w-4xl mx-auto">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[#F1F5F9]">
              Candidates Scored on Fundamentals
            </h2>
            <p className="text-xs sm:text-sm text-[#8B95A8] leading-relaxed">
              Score ≥10/12 required · Why-Now Green · Valuation Non-Red · Sector Not Ignored
            </p>
          </div>

          <div className="space-y-3.5">
            {data.candidates.map((candidate) => (
              <DecisionCandidateRow
                key={candidate.ticker}
                candidate={candidate}
                isBusy={busy === candidate.ticker}
                onDismiss={handleDismissCandidate}
              />
            ))}
          </div>
        </div>
      ) : activeTab === 'holdings' ? (
        /* Holdings & Risk Audit Focused View */
        <div className="max-w-4xl mx-auto">
          <DecisionHoldingsTable holdings={data.holdings} alerts={data.alerts} />
        </div>
      ) : (
        /* Sectors & Rules Focused View */
        <div className="grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
          <DecisionSectorHeatmap sectors={data.sectors} />
          <div className="space-y-8">
            <DecisionControlLists
              neverList={data.state.never}
              notNowList={data.state.not_now}
              etfWhitelist={data.state.etf_whitelist}
              busy={busy}
              onClearDismiss={handleClearDismiss}
              onEtfAction={handleEtfAction}
            />
            <DecisionAuditLog log={log} benchmarkNote={data.benchmark_note} />
          </div>
        </div>
      )}

      {/* 4. Fiduciary Provenance & Data Sources */}
      <DecisionDataSources />
    </main>
  )
}
