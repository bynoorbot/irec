"""Unit tests for the decision engine's pure scoring rules (PROJECT.md)."""
from app.decision_routes import bucket_for, passes_strict, score_checks, sector_verdict, verdict_for

GOOD = {
    "revenueGrowth": 0.22, "earningsGrowth": 0.30, "operatingMargins": 0.32,
    "returnOnEquity": 0.28, "debtToEquity": 35.0, "freeCashflow": 5_000_000_000,
    "pegRatio": 1.2, "currentPrice": 120.0, "fiftyDayAverage": 110.0, "twoHundredDayAverage": 100.0,
}
WEAK = {
    "revenueGrowth": 0.01, "earningsGrowth": -0.20, "operatingMargins": 0.03,
    "returnOnEquity": 0.02, "debtToEquity": 320.0, "freeCashflow": -100_000_000,
    "pegRatio": 3.4, "currentPrice": 80.0, "fiftyDayAverage": 100.0, "twoHundredDayAverage": 110.0,
}
AURA_HOT = {"sentiment": 0.8, "conviction": 75, "mentions_30d": 4}


def test_bucket_ticker_map_wins_and_counts_once():
    assert bucket_for("NVDA") == "Semis & AI Infra"
    assert bucket_for("CRWD") == "Cybersecurity"
    assert bucket_for("LLY") == "Healthcare"
    assert bucket_for("ZZZZ", "Healthcare") == "Healthcare"


def test_good_stock_passes_strict_with_aura_confirmation():
    checks = score_checks(GOOD, AURA_HOT, {})
    assert sum(c["score"] for c in checks) >= 10
    assert passes_strict(checks) is True


def test_weak_stock_fails_and_aura_alone_cannot_approve():
    checks = score_checks(WEAK, AURA_HOT, {})
    # Even with a hot Aura idea-feed, weak numbers must not pass the buy bar.
    assert passes_strict(checks) is False
    assert verdict_for(sum(c["score"] for c in checks), held=True) in ("Probation", "Watch")


def test_decision_state_actions_persist_in_payload():
    """Regression: dismiss/ETF actions must mutate persisted state, not vanish."""
    from app.decision_routes import apply_dismiss, apply_etf, default_state

    state = default_state()
    assert state["etf_whitelist"] == ["ISDU"]
    state = apply_dismiss(state, "TSLA", "never", "personal restriction")
    state = apply_dismiss(state, "SHOP", "not_now", None)
    assert state["never"] == ["TSLA"]
    assert [n["ticker"] for n in state["not_now"]] == ["SHOP"]
    state = apply_dismiss(state, "TSLA", "clear", None)
    assert state["never"] == []
    state = apply_etf(state, "ISUS", "approve")
    assert state["etf_whitelist"] == ["ISDU", "ISUS"]
    state = apply_etf(state, "ISUS", "remove")
    assert state["etf_whitelist"] == ["ISDU"]


def test_not_now_names_are_excluded_from_candidates():
    """Regression: 'Not now' must park a name, not leave it in the buy list."""
    from app.decision_routes import select_candidates

    aura = {
        "AAA": {"mentions_30d": 9, "conviction": 90},
        "BBB": {"mentions_30d": 8, "conviction": 80},
        "CCC": {"mentions_30d": 7, "conviction": 70},
        "ISDU": {"mentions_30d": 6, "conviction": 60},
    }
    picked = select_candidates(aura, held={"CCC"}, never={"AAA"}, not_now={"BBB"})
    assert picked == []


def test_snapshot_served_only_when_fresh_and_inputs_unchanged():
    """Page loads must serve the cached snapshot, not refetch everything."""
    from app.decision_routes import fingerprint_state, snapshot_is_fresh

    state = {"never": ["TSLA"], "not_now": [], "etf_whitelist": ["ISDU"]}
    snap = {"computed_at": 1_000_000, "sheet_asof": "2026-10-20", "fingerprint": fingerprint_state(state)}
    assert snapshot_is_fresh(snap, now=1_000_000 + 3600, sheet_asof="2026-10-20", fingerprint=fingerprint_state(state)) is True
    # Expired (>6h), stale sheet, or changed lists must all force recompute.
    assert snapshot_is_fresh(snap, now=1_000_000 + 7 * 3600, sheet_asof="2026-10-20", fingerprint=fingerprint_state(state)) is False
    assert snapshot_is_fresh(snap, now=1_000_000 + 60, sheet_asof="2026-10-23", fingerprint=fingerprint_state(state)) is False
    changed = fingerprint_state({**state, "never": []})
    assert snapshot_is_fresh(snap, now=1_000_000 + 60, sheet_asof="2026-10-20", fingerprint=changed) is False
    assert snapshot_is_fresh(None, now=1_000_000, sheet_asof="x", fingerprint="y") is False


def test_verdicts_and_sector_bands():
    assert verdict_for(11, held=False) == "Master List"
    assert verdict_for(9, held=True) == "Watch"
    assert sector_verdict(8) == "Hot"
    assert sector_verdict(5) == "Neutral"
    assert sector_verdict(2) == "Ignore"


def test_etf_detection_and_bucketing():
    from app.decision_routes import is_etf, is_etf_ticker

    assert is_etf_ticker("SPUS") is True
    assert is_etf_ticker("HLAL") is True
    assert is_etf_ticker("ISDU") is True
    assert is_etf_ticker("ISDU.L") is True
    assert is_etf_ticker("AAPL") is False

    assert is_etf("RANDOM", sector_text="ETF") is True
    assert is_etf("CUSTOM", cap_size_text="ETFs") is True
    assert is_etf("FND", info={"quoteType": "ETF"}) is True
    assert is_etf("AAPL", sector_text="Technology", info={"quoteType": "EQUITY"}) is False

    assert bucket_for("SPUS") == "ETF Base"
    assert bucket_for("HLAL") == "ETF Base"
    assert bucket_for("UNKNOWN", "ETF") == "ETF Base"

