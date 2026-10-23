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


def test_verdicts_and_sector_bands():
    assert verdict_for(11, held=False) == "Master List"
    assert verdict_for(9, held=True) == "Watch"
    assert sector_verdict(8) == "Hot"
    assert sector_verdict(5) == "Neutral"
    assert sector_verdict(2) == "Ignore"
