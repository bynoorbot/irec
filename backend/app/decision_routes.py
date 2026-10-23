"""Owner-only weekly decision engine for Aura.

Implements the settled rules in PROJECT.md: numbers-first 6-check scorecard,
Strict buy bar (>=10 + Why-Now green + valuation not red, else ETF), sector
ranking, portfolio audit with probation, personal blacklist ("Never" vs
"Not now"), and a decision log benchmarked against the Shariah ETF base.
Aura/YouTube consensus is an idea feed only; it never approves a buy alone.
Fundamentals come from yfinance (.info) and are labelled with source/date.
"""

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from jose import jwt
from pydantic import BaseModel

from app.auth import verify_owner
from app.database import _get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/decision", tags=["decision"])

DEFAULT_ETF_WHITELIST = ["ISDU"]
KNOWN_ETFS = {"ISDU", "ISWD", "ISUS", "ISDE", "IGDA", "ISDX", "WITS", "SKUK"}

BUCKET_TICKERS: Dict[str, set] = {
    "Semis & AI Infra": {"NVDA", "AVGO", "AMD", "MU", "INTC", "MRVL", "TSM", "ASML", "ARM", "QCOM", "LRCX", "AMAT", "KLAC", "ON", "SMCI", "TXN", "ADI"},
    "Hyperscalers & Cloud": {"MSFT", "AMZN", "GOOGL", "GOOG", "ORCL", "IBM", "SNOW", "DDOG", "MDB"},
    "Cybersecurity": {"CRWD", "PANW", "ZS", "FTNT", "NET", "S", "OKTA"},
    "AI Software & SaaS": {"CRM", "PLTR", "ADBE", "NOW", "INTU", "WDAY", "SHOP", "APP", "DUOL", "HUBS", "TEAM"},
    "Big Tech Platforms": {"AAPL", "META", "NFLX", "UBER", "ABNB", "BKNG"},
    "Healthcare": {"LLY", "UNH", "JNJ", "MRK", "ABBV", "AMGN", "TMO", "DHR", "ISRG", "VRTX", "REGN", "SYK", "BSX"},
    "Industrials & Energy Transition": {"CAT", "GE", "HON", "ETN", "TSLA", "ENPH", "FSLR", "NEE", "WM", "DE", "RTX", "LMT"},
    "Consumer": {"WMT", "COST", "HD", "PG", "KO", "PEP", "MCD", "SBUX", "NKE", "LULU", "TJX", "LOW"},
}
BUCKETS = list(BUCKET_TICKERS.keys()) + ["Other"]

_fund_cache: Dict[str, tuple] = {}
_FUND_TTL = 6 * 3600


def bucket_for(ticker: str, sector_text: Optional[str] = None) -> str:
    t = (ticker or "").upper()
    for bucket, tickers in BUCKET_TICKERS.items():
        if t in tickers:
            return bucket
    s = (sector_text or "").lower()
    if "semiconductor" in s:
        return "Semis & AI Infra"
    if "security" in s or "cyber" in s:
        return "Cybersecurity"
    if "health" in s or "pharma" in s or "biotech" in s:
        return "Healthcare"
    if "consumer" in s or "retail" in s:
        return "Consumer"
    if "industrial" in s or "energy" in s or "material" in s or "utilit" in s:
        return "Industrials & Energy Transition"
    if "software" in s:
        return "AI Software & SaaS"
    if "tech" in s or "internet" in s or "cloud" in s:
        return "Hyperscalers & Cloud"
    return "Other"


def _check(key: str, label: str, score: int, evidence: str) -> Dict[str, Any]:
    return {"key": key, "label": label, "score": score, "evidence": evidence}


def score_checks(info: Dict[str, Any], aura: Optional[Dict[str, Any]], momentum: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Score the 6 checks 0/1/2 from fundamentals + Aura idea-feed + trend."""
    info = info or {}
    aura = aura or {}
    momentum = momentum or {}
    checks: List[Dict[str, Any]] = []

    rev, earn = info.get("revenueGrowth"), info.get("earningsGrowth")
    if rev is not None:
        s = 2 if rev >= 0.10 and (earn is None or earn >= 0) else (1 if rev >= 0.05 else 0)
        ev = f"Revenue growth {rev*100:.1f}%"
        if earn is not None:
            ev += f", EPS growth {earn*100:.1f}%"
    else:
        s, ev = 1, "Growth not reported by data source - verify in filing"
    checks.append(_check("growth", "Growth", s, ev))

    om, roe = info.get("operatingMargins"), info.get("returnOnEquity")
    if om is not None:
        s = 2 if om >= 0.20 and (roe is None or roe >= 0.15) else (1 if om >= 0.10 else 0)
        ev = f"Operating margin {om*100:.1f}%"
        if roe is not None:
            ev += f", ROE {roe*100:.1f}%"
    else:
        s, ev = 1, "Margins not reported - verify quality in filing"
    checks.append(_check("quality", "Quality & Moat", s, ev))

    dte, fcf = info.get("debtToEquity"), info.get("freeCashflow")
    if dte is not None or fcf is not None:
        s = 2 if (dte is None or dte < 100) and (fcf is None or fcf > 0) else (1 if (dte is not None and dte < 200) else 0)
        parts = []
        if dte is not None:
            parts.append(f"Debt/Equity {dte:.0f}%")
        if fcf is not None:
            parts.append(f"FCF ${fcf/1e9:.1f}B" if abs(fcf) >= 1e9 else "FCF positive" if fcf > 0 else "FCF negative")
        ev = ", ".join(parts)
    else:
        s, ev = 1, "Balance sheet not reported - verify debt/FCF in filing"
    checks.append(_check("strength", "Financial Strength", s, ev))

    peg, pe, fpe = info.get("pegRatio"), info.get("trailingPE"), info.get("forwardPE")
    metric, val = ("PEG", peg) if peg is not None else (("Forward P/E", fpe) if fpe is not None else ("P/E", pe))
    if val is not None:
        if metric == "PEG":
            s = 2 if val <= 1.5 else (1 if val <= 2.2 else 0)
        else:
            s = 2 if val <= 25 else (1 if val <= 35 else 0)
        ev = f"{metric} {val:.2f}"
    else:
        s, ev = 1, "Valuation multiple not reported - compare vs 5yr average manually"
    checks.append(_check("valuation", "Valuation (GARP)", s, ev))

    sent, conv, mentions = aura.get("sentiment"), aura.get("conviction"), aura.get("mentions_30d") or 0
    if sent is not None:
        s = 2 if sent > 0.3 and (conv or 0) >= 55 and mentions >= 1 else (1 if sent > 0 else 0)
        ev = f"Aura idea-feed: sentiment {sent:.2f}, conviction {conv:.0f}/100, {mentions} mentions/30d - confirm guidance in earnings release"
    elif earn is not None:
        s = 1 if earn >= 0 else 0
        ev = "No Aura coverage; EPS growth proxy only - check earnings call guidance"
    else:
        s, ev = 1, "No recent catalyst signal - check earnings calendar"
    checks.append(_check("whynow", "Why Now / Earnings Momentum", s, ev))

    price, d50, d200 = info.get("currentPrice") or momentum.get("price"), info.get("fiftyDayAverage"), info.get("twoHundredDayAverage")
    wk, mo = momentum.get("weekly"), momentum.get("monthly")
    if price and d50 and d200:
        s = 2 if price > d50 and price > d200 else (1 if price > d50 or price > d200 else 0)
        ev = f"Price vs 50d/200d average: {'above both' if s == 2 else 'mixed/below'}"
    elif wk is not None or mo is not None:
        base = mo if mo is not None else wk
        s = 2 if base > 5 else (1 if base > -5 else 0)
        ev = f"Momentum 1M {mo}%" if mo is not None else f"Momentum 1W {wk}%"
    else:
        s, ev = 1, "Trend averages unavailable"
    checks.append(_check("trend", "Trend Confirmation", s, ev))
    return checks


def total_score(checks: List[Dict[str, Any]]) -> int:
    return sum(c["score"] for c in checks)


def passes_strict(checks: List[Dict[str, Any]]) -> bool:
    by = {c["key"]: c["score"] for c in checks}
    return total_score(checks) >= 10 and by.get("whynow") == 2 and by.get("valuation", 0) > 0


def verdict_for(score: int, held: bool) -> str:
    if score >= 10:
        return "Master List" if not held else "Healthy"
    if score >= 8:
        return "Watchlist" if not held else "Watch"
    return "Reject" if not held else "Probation"


def sector_verdict(score: float) -> str:
    return "Hot" if score >= 7 else ("Neutral" if score >= 4.5 else "Ignore")


def _user_id(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(authorization[7:], os.environ.get("SUPABASE_JWT_SECRET") or "",
                             algorithms=["HS256", "RS256", "EdDSA", "ES256"],
                             options={"verify_aud": False, "verify_signature": False})
        return payload.get("sub")
    except Exception:
        return None


def _fetch_info(ticker: str) -> Dict[str, Any]:
    try:
        import yfinance as yf
        return yf.Ticker(ticker).info or {}
    except Exception as e:
        logger.warning(f"fundamentals fetch failed {ticker}: {e}")
        return {}


def fetch_fundamentals(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
    now = time.time()
    out, todo = {}, []
    for t in tickers:
        hit = _fund_cache.get(t)
        if hit and now - hit[0] < _FUND_TTL:
            out[t] = hit[1]
        else:
            todo.append(t)
    if todo:
        with ThreadPoolExecutor(max_workers=8) as ex:
            for t, info in zip(todo, ex.map(_fetch_info, todo)):
                _fund_cache[t] = (now, info)
                out[t] = info
    return out


def aura_aggregates() -> Dict[str, Dict[str, Any]]:
    """Aggregate Aura/YouTube recommendations (idea feed) per ticker, 30d."""
    try:
        client = _get_client()
        rows: List[Dict[str, Any]] = []
        for i in range(6):
            res = client.table("recommendations").select(
                "ticker, stock_name, sentiment, sentiment_score, conviction_level, conviction_score, videos!inner(published_at, channels!inner(channel_name, trust_weight))"
            ).range(i * 1000, (i + 1) * 1000 - 1).execute()
            if not res.data:
                break
            rows.extend(res.data)
            if len(res.data) < 1000:
                break
    except Exception as e:
        logger.warning(f"aura aggregates unavailable: {e}")
        return {}
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    agg: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        t = r.get("ticker")
        if not t:
            continue
        a = agg.setdefault(t, {"ticker": t, "stock_name": r.get("stock_name"), "sent_sum": 0.0, "w_sum": 0.0,
                               "conv_sum": 0.0, "conv_n": 0, "mentions_30d": 0, "analysts": set(), "latest": None})
        video = r.get("videos") or {}
        chan = video.get("channels") or {}
        pub = video.get("published_at")
        if pub and (a["latest"] is None or pub > a["latest"]):
            a["latest"] = pub
        if pub and pub >= cutoff:
            a["mentions_30d"] += 1
            if chan.get("channel_name"):
                a["analysts"].add(chan["channel_name"])
        s = r.get("sentiment_score")
        if s is None:
            s = r.get("sentiment")
        if s is not None:
            tw = chan.get("trust_weight") or 1.0
            a["sent_sum"] += float(s) * tw
            a["w_sum"] += tw
        cs = r.get("conviction_score")
        if cs is None and r.get("conviction_level") is not None:
            cs = float(r["conviction_level"]) * 10.0
        if cs is not None:
            a["conv_sum"] += float(cs)
            a["conv_n"] += 1
    out = {}
    for t, a in agg.items():
        out[t] = {"ticker": t, "stock_name": a["stock_name"],
                  "sentiment": (a["sent_sum"] / a["w_sum"]) if a["w_sum"] else None,
                  "conviction": (a["conv_sum"] / a["conv_n"]) if a["conv_n"] else None,
                  "mentions_30d": a["mentions_30d"], "analyst_count": len(a["analysts"]), "latest_mention": a["latest"]}
    return out


def _safe_table(fn, default):
    try:
        return fn()
    except Exception as e:
        logger.warning(f"decision table unavailable (run migration 021): {e}")
        return default


class DismissRequest(BaseModel):
    ticker: str
    kind: str  # never | not_now
    reason: Optional[str] = None


class EtfRequest(BaseModel):
    ticker: str
    action: str  # approve | propose | remove


@router.get("/state")
async def decision_state(authorization: str = Header(None), _owner: str = Depends(verify_owner)):
    uid = _user_id(authorization)
    client = _get_client()
    never, not_now, etfs = [], [], list(DEFAULT_ETF_WHITELIST)
    if uid:
        rows = _safe_table(lambda: client.table("decision_blacklist").select("ticker,kind,reason").eq("user_id", uid).execute().data or [], [])
        never = [r["ticker"] for r in rows if r.get("kind") == "never"]
        not_now = [{"ticker": r["ticker"], "reason": r.get("reason")} for r in rows if r.get("kind") == "not_now"]
        erows = _safe_table(lambda: client.table("decision_etf_whitelist").select("ticker,status").eq("user_id", uid).execute().data or [], [])
        approved = [r["ticker"] for r in erows if r.get("status") == "approved"]
        if approved:
            etfs = approved
    return {"never": never, "not_now": not_now, "etf_whitelist": etfs}


@router.post("/dismiss")
async def decision_dismiss(body: DismissRequest, authorization: str = Header(None), _owner: str = Depends(verify_owner)):
    uid = _user_id(authorization)
    if not uid:
        raise HTTPException(status_code=401, detail="User ID not found in token")
    if body.kind not in ("never", "not_now", "clear"):
        raise HTTPException(status_code=400, detail="kind must be never, not_now or clear")
    client = _get_client()
    t = body.ticker.upper().strip()
    if body.kind == "clear":
        _safe_table(lambda: client.table("decision_blacklist").delete().eq("user_id", uid).eq("ticker", t).execute(), None)
        return {"status": "success", "ticker": t, "kind": "clear"}
    _safe_table(lambda: client.table("decision_blacklist").upsert(
        {"user_id": uid, "ticker": t, "kind": body.kind, "reason": body.reason}, on_conflict="user_id,ticker").execute(), None)
    return {"status": "success", "ticker": t, "kind": body.kind}


@router.post("/etf")
async def decision_etf(body: EtfRequest, authorization: str = Header(None), _owner: str = Depends(verify_owner)):
    uid = _user_id(authorization)
    if not uid:
        raise HTTPException(status_code=401, detail="User ID not found in token")
    if body.action not in ("approve", "propose", "remove"):
        raise HTTPException(status_code=400, detail="action must be approve, propose or remove")
    client = _get_client()
    t = body.ticker.upper().strip()
    if body.action == "remove":
        _safe_table(lambda: client.table("decision_etf_whitelist").delete().eq("user_id", uid).eq("ticker", t).execute(), None)
    else:
        _safe_table(lambda: client.table("decision_etf_whitelist").upsert(
            {"user_id": uid, "ticker": t, "status": "approved" if body.action == "approve" else "proposed"},
            on_conflict="user_id,ticker").execute(), None)
    return {"status": "success", "ticker": t, "action": body.action}


@router.get("/")
async def get_decision(authorization: str = Header(None), _owner: str = Depends(verify_owner)):
    uid = _user_id(authorization)
    if not uid:
        raise HTTPException(status_code=401, detail="User ID not found in token")
    client = _get_client()
    state = await decision_state(authorization=authorization, _owner=_owner)
    never = set(state["never"])
    etf_whitelist = state["etf_whitelist"]

    pres = client.table("user_portfolio").select("*").eq("user_id", uid).execute()
    holdings_raw = [p for p in (pres.data or []) if (p.get("shares") or 0) > 0]
    total_value = sum((p.get("shares") or 0) * (p.get("current_price") or p.get("average_cost") or 0) for p in holdings_raw)
    sheet_asof = max((p.get("updated_at") or "" for p in holdings_raw), default=None)

    aura = aura_aggregates()
    held_set = {p["ticker"] for p in holdings_raw}
    cand_tickers = [t for t, a in sorted(aura.items(), key=lambda kv: ((kv[1]["mentions_30d"] or 0), (kv[1]["conviction"] or 0)), reverse=True)
                    if t not in held_set and t not in never and t not in KNOWN_ETFS][:12]
    fund = fetch_fundamentals(sorted(held_set) + cand_tickers)

    def build(ticker: str, held_row: Optional[dict]) -> Dict[str, Any]:
        a = aura.get(ticker) or {}
        mom = {}
        if held_row:
            mom = {"price": held_row.get("current_price"), "weekly": held_row.get("weekly_change_pct"), "monthly": held_row.get("monthly_change_pct")}
        info = fund.get(ticker) or {}
        checks = score_checks(info, a, mom)
        score = total_score(checks)
        weight = 0.0
        if held_row and total_value:
            weight = (held_row.get("shares") or 0) * (held_row.get("current_price") or held_row.get("average_cost") or 0) / total_value * 100
        sector_text = (held_row or {}).get("sector") or info.get("sector")
        return {"ticker": ticker, "stock_name": a.get("stock_name") or info.get("shortName") or info.get("longName"),
                "bucket": bucket_for(ticker, sector_text), "sector": sector_text,
                "held": held_row is not None, "weight_pct": round(weight, 2),
                "price": info.get("currentPrice") or (held_row or {}).get("current_price"),
                "score": score, "checks": checks, "passes_strict": passes_strict(checks),
                "verdict": verdict_for(score, held_row is not None),
                "aura": {"sentiment": a.get("sentiment"), "conviction": a.get("conviction"),
                         "mentions_30d": a.get("mentions_30d") or 0, "analyst_count": a.get("analyst_count") or 0,
                         "source": "Aura/YouTube idea-feed" if a else None, "latest_mention": a.get("latest")},
                "evidence_source": "yfinance fundamentals (Yahoo Finance)", "cap_size": (held_row or {}).get("cap_size") or info.get("marketCap")}

    holdings = [build(p["ticker"], p) for p in holdings_raw]
    candidates = [build(t, None) for t in cand_tickers]

    # Sector scores /10 from 5 factors proxied by member checks + momentum.
    sector_items: Dict[str, List[Dict[str, Any]]] = {}
    for it in holdings + candidates:
        sector_items.setdefault(it["bucket"], []).append(it)
    sectors = []
    for bucket in BUCKETS:
        members = sector_items.get(bucket, [])
        if not members:
            sectors.append({"bucket": bucket, "score": 0, "verdict": "Ignore", "members": 0, "weight_pct": 0})
            continue
        def avg_check(key):
            vals = [{c["key"]: c["score"] for c in m["checks"]}.get(key, 1) for m in members]
            return sum(vals) / len(vals) if vals else 0
        # Five 0-2 factors (growth breadth proxied by growth, valuation reset, why-now breadth, trend, catalyst density) sum to /10.
        score10 = round(avg_check("growth") + avg_check("valuation") + avg_check("whynow") + avg_check("trend") + min(2.0, sum(m["aura"]["mentions_30d"] for m in members) / 5), 1)
        sectors.append({"bucket": bucket, "score": score10, "verdict": sector_verdict(score10),
                        "members": len(members), "weight_pct": round(sum(m["weight_pct"] for m in members if m["held"]), 1)})
    sectors.sort(key=lambda x: x["score"], reverse=True)
    sector_map = {s["bucket"]: s for s in sectors}

    for c in candidates:
        if sector_map.get(c["bucket"], {}).get("verdict") == "Ignore":
            c["passes_strict"] = False
    candidates.sort(key=lambda x: (x["passes_strict"], x["score"]), reverse=True)

    etf_weight = sum(h["weight_pct"] for h in holdings if h["ticker"] in set(etf_whitelist) | KNOWN_ETFS)
    stock_weight = round(100 - etf_weight, 1) if holdings else 0
    top = next((c for c in candidates if c["passes_strict"]), None)
    if top:
        this_week = {"action": "Add" if top["held"] else "Start", "ticker": top["ticker"], "bucket": top["bucket"],
                     "reason": "Passes Strict: score >=10, Why-Now green, valuation not red, sector not Ignore. Tranche 1 of 2-3 toward 5% cap.",
                     "tranche_note": "Build in 2-3 tranches; later tranches must re-confirm on earnings/guidance or a buy-zone dip."}
    else:
        this_week = {"action": "Buy ETF", "ticker": etf_whitelist[0] if etf_whitelist else "ISDU", "bucket": "ETF Base",
                     "reason": "No single stock passes Strict this run. Weekly money defaults to the approved Shariah ETF; cash target 5-10% is kept.",
                     "tranche_note": "Patience is the position. Re-run on demand or after earnings."}

    alerts = []
    for h in holdings:
        if h["weight_pct"] > 5.5:
            alerts.append({"ticker": h["ticker"], "type": "Trim", "detail": f"Weight {h['weight_pct']}% above ~5% single-name cap - trim on strength, not on a price drop alone."})
        if h["verdict"] == "Probation":
            alerts.append({"ticker": h["ticker"], "type": "Probation", "detail": f"Score {h['score']}/12 below 8 - no adding; re-judge after next earnings, two weak quarters trigger exit plan."})
        elif h["verdict"] == "Watch":
            alerts.append({"ticker": h["ticker"], "type": "Watch", "detail": f"Score {h['score']}/12 - thesis intact but weakening; check next earnings."})
    for s in sectors:
        if s["weight_pct"] > 30:
            alerts.append({"ticker": s["bucket"], "type": "Bucket warning", "detail": f"Bucket weight {s['weight_pct']}% - soft warning only, high conviction may override."})
    if holdings and etf_weight < 20:
        alerts.append({"ticker": "ETF Base", "type": "Allocation", "detail": f"ETF base {etf_weight:.1f}% below 20-35% target range."})

    now = datetime.now(timezone.utc)
    payload = {"generated_at": now.isoformat(), "market_provisional": now.weekday() < 5 and 13 <= now.hour < 21,
               "anchor": "Weekly anchor: Tuesday US close / Wednesday morning Jordan (UTC+3). On-demand runs are labelled provisional intraday.",
               "sheet_asof": sheet_asof, "total_value": round(total_value, 2),
               "allocation": {"etf_pct": round(etf_weight, 1), "stocks_pct": stock_weight, "etf_target": "20-35%", "cash_target": "5-10% (held outside sheet equities)"},
               "this_week": this_week, "sectors": sectors, "candidates": candidates[:7],
               "holdings": sorted(holdings, key=lambda x: x["weight_pct"], reverse=True), "alerts": alerts,
               "state": state, "benchmark_note": "Stock picks as a group must beat the approved Shariah ETF over rolling periods, or weight shifts back to ETF."}
    _safe_table(lambda: client.table("decision_log").insert(
        {"user_id": uid, "action": this_week["action"], "ticker": this_week["ticker"], "reason": this_week["reason"]}).execute(), None)
    return payload


@router.get("/log")
async def decision_log(authorization: str = Header(None), _owner: str = Depends(verify_owner)):
    uid = _user_id(authorization)
    client = _get_client()
    rows = _safe_table(lambda: client.table("decision_log").select("*").eq("user_id", uid).order("created_at", desc=True).limit(30).execute().data or [], [])
    return {"log": rows}
