'use client'

import { useState } from 'react'
import { Ban, Clock, Loader2, Plus, ShieldCheck, X } from 'lucide-react'

interface ControlListsProps {
  neverList: string[]
  notNowList: { ticker: string; reason?: string | null }[]
  etfWhitelist: string[]
  busy: string | null
  onClearDismiss: (ticker: string) => void
  onEtfAction: (ticker: string, action: 'approve' | 'remove') => void
}

const SHARIAH_ETF_PRESETS = [
  { ticker: 'ISDU', label: 'iShares MSCI USA Islamic' },
  { ticker: 'ISWD', label: 'iShares MSCI World Islamic' },
  { ticker: 'ISUS', label: 'iShares MSCI USA Acc' },
  { ticker: 'ISDE', label: 'iShares MSCI EM Islamic' },
  { ticker: 'IGDA', label: 'Invesco DJ Islamic Global' },
  { ticker: 'WITS', label: 'HSBC MSCI World Islamic' },
]

export function DecisionControlLists({
  neverList,
  notNowList,
  etfWhitelist,
  busy,
  onClearDismiss,
  onEtfAction,
}: ControlListsProps) {
  const [etfInput, setEtfInput] = useState('')

  const handleApproveCustomEtf = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = etfInput.trim().toUpperCase()
    if (!clean) return
    onEtfAction(clean, 'approve')
    setEtfInput('')
  }

  return (
    <section aria-label="Personal Governance & Whitelists" className="space-y-6">
      <div>
        <h3 className="text-sm font-bold tracking-tight text-[#F1F5F9]">
          Personal Rules & Whitelists
        </h3>
        <p className="text-xs text-[#8B95A8]">
          You are the final judge. Changes persist instantly and govern future runs.
        </p>
      </div>

      {/* 1. Never for Me Blacklist */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#FF8FA3]">
          <Ban size={13} />
          <span>Never for Me (Permanent Blacklist)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {neverList.map((t) => (
            <button
              key={t}
              onClick={() => onClearDismiss(t)}
              disabled={busy === t}
              title={`Remove ${t} from Never list`}
              aria-label={`Remove ${t} from Never list`}
              className="inline-flex items-center gap-1 rounded-full border border-[#FF4D6A]/40 bg-[#FF4D6A]/5 px-2.5 py-1 font-mono text-xs font-medium text-[#FF8FA3] transition-colors hover:bg-[#FF4D6A]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4D6A]"
            >
              <span>{t}</span>
              {busy === t ? <Loader2 size={10} className="animate-spin" /> : <X size={11} />}
            </button>
          ))}
          {neverList.length === 0 && (
            <span className="text-xs text-[#64748B] italic">
              Empty. Use &ldquo;Never for me&rdquo; on any candidate to permanently filter it.
            </span>
          )}
        </div>
      </div>

      {/* 2. Not Now (Parked) */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#CBD5E1]">
          <Clock size={13} className="text-[#8B95A8]" />
          <span>Not Now (Parked until Catalysts Shift)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {notNowList.map((n) => (
            <button
              key={n.ticker}
              onClick={() => onClearDismiss(n.ticker)}
              disabled={busy === n.ticker}
              title={`Un-park ${n.ticker}${n.reason ? `: ${n.reason}` : ''}`}
              aria-label={`Un-park ${n.ticker}`}
              className="inline-flex items-center gap-1 rounded-full border border-[#2A364D] bg-[#0A0F1A] px-2.5 py-1 font-mono text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#8B95A8] hover:text-[#F1F5F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]"
            >
              <span>{n.ticker}</span>
              {busy === n.ticker ? <Loader2 size={10} className="animate-spin" /> : <X size={11} />}
            </button>
          ))}
          {notNowList.length === 0 && (
            <span className="text-xs text-[#64748B] italic">
              Empty. Park names to temporarily withhold them from suggestions.
            </span>
          )}
        </div>
      </div>

      {/* 3. Approved Shariah ETFs */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#00FFD0]">
            <ShieldCheck size={13} />
            <span>Approved Shariah ETFs (UCITS Ireland)</span>
          </div>
          <span className="text-[10px] text-[#64748B] font-mono">1st is Weekly Default</span>
        </div>

        {/* Current Approved Whitelist */}
        <div className="flex flex-wrap gap-1.5">
          {etfWhitelist.map((t) => (
            <button
              key={t}
              onClick={() => onEtfAction(t, 'remove')}
              disabled={busy === 'etf'}
              title={`Remove ${t} from approved ETF whitelist`}
              aria-label={`Remove ${t} from approved ETFs`}
              className="inline-flex items-center gap-1 rounded-full border border-[#00D4AA]/40 bg-[#00D4AA]/10 px-2.5 py-1 font-mono text-xs font-bold text-[#00FFD0] transition-colors hover:bg-[#FF4D6A]/15 hover:border-[#FF4D6A]/40 hover:text-[#FF8FA3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]"
            >
              <span>{t}</span>
              <X size={11} />
            </button>
          ))}
        </div>

        {/* 1-Click ETF Presets */}
        <div className="pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
            Quick-Add Presets
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {SHARIAH_ETF_PRESETS.map((preset) => {
              const isAlreadyApproved = etfWhitelist.includes(preset.ticker)
              if (isAlreadyApproved) return null

              return (
                <button
                  key={preset.ticker}
                  type="button"
                  onClick={() => onEtfAction(preset.ticker, 'approve')}
                  disabled={busy === 'etf'}
                  title={`Approve ${preset.label}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#2A364D] bg-[#0A0F1A] px-2 py-1 text-[11px] font-mono text-[#8B95A8] transition-colors hover:border-[#00D4AA]/60 hover:text-[#00FFD0] disabled:opacity-50"
                >
                  <Plus size={10} />
                  <span>{preset.ticker}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom ETF Input Form */}
        <form onSubmit={handleApproveCustomEtf} className="mt-2 flex gap-2">
          <label className="sr-only" htmlFor="custom-etf-input">
            Add approved ETF ticker
          </label>
          <input
            id="custom-etf-input"
            value={etfInput}
            onChange={(e) => setEtfInput(e.target.value.toUpperCase())}
            placeholder="Custom ETF (e.g. ISUS)"
            spellCheck={false}
            autoComplete="off"
            className="w-full min-w-0 rounded-lg border border-[#2A364D] bg-[#0A0F1A] px-3 py-1.5 font-mono text-xs text-[#F1F5F9] placeholder:text-[#5B6B82] focus:border-[#00D4AA] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!etfInput.trim() || busy === 'etf'}
            className="shrink-0 rounded-lg bg-[#00D4AA] px-3 py-1.5 text-xs font-bold text-[#06251D] transition-colors hover:bg-[#00FFD0] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]"
          >
            {busy === 'etf' ? <Loader2 size={13} className="animate-spin" /> : 'Approve'}
          </button>
        </form>
      </div>
    </section>
  )
}
