"""Ticker normalization utilities for US, UK, London, and Ireland assets."""

from typing import Tuple, Optional, Set

# Known UK / Ireland exchange prefixes (e.g. Google Finance "LON:ISDU", "LSE:ISDU")
UK_PREFIXES = ("LON:", "LSE:", "LON.", "LSE.", "ISE:", "DUB:")

# Known UK / Ireland exchange suffixes (e.g. Yahoo Finance "ISDU.L", "AZN.L")
UK_SUFFIXES = (".L", ".LON", ".LSE", ".IL", ".IR")

# Known London / Ireland UCITS Shariah ETFs (LSE / Euronext Dublin)
KNOWN_UK_IRELAND_ETFS = {
    "ISDU",   # iShares MSCI USA Islamic UCITS ETF (LSE)
    "ISWD",   # iShares MSCI World Islamic UCITS ETF (LSE)
    "ISUS",   # iShares MSCI USA Islamic UCITS ETF dist (LSE)
    "ISDE",   # iShares MSCI EM Islamic UCITS ETF (LSE)
    "IGDA",   # Invesco Dow Jones Islamic Global Dev Mkts UCITS ETF (LSE)
    "WITS",   # Invesco Dow Jones Islamic Global Dev Mkts UCITS ETF USD (LSE)
    "ISDX",   # iShares MSCI Emerging Markets Islamic
    "SKUK",   # Franklin Global Sukuk UCITS ETF (LSE)
    "HIUS",   # HSBC MSCI USA Islamic ESG UCITS ETF (LSE)
    "HIPS",   # HSBC MSCI World Islamic ESG UCITS ETF (LSE)
    "HIES",   # HSBC MSCI EM Islamic ESG UCITS ETF (LSE)
}

# Known US & Global Shariah ETFs
KNOWN_US_SHARIAH_ETFS = {
    "SPUS",   # SP Funds S&P 500 Sharia Industry Exclusions ETF
    "HLAL",   # Wahed FTSE USA Shariah ETF
    "UMMA",   # Wahed Dow Jones Islamic World ETF
    "SPSK",   # SP Funds Dow Jones Global Sukuk ETF
    "SPRE",   # SP Funds S&P Global RE Sharia ETF
    "SPWO",   # SP Funds S&P World Sharia ETF
    "KSA",    # iShares MSCI Saudi Arabia ETF
    "GLD",    # SPDR Gold Shares
    "IAU",    # iShares Gold Trust
}

# Major broad index and sector ETFs
KNOWN_BROAD_ETFS = {
    "SPY", "VOO", "IVV", "QQQ", "QQQM", "VTI", "VXUS", "VT", "VEA", "VWO",
    "SMH", "SOXX", "XLK", "XLE", "XLF", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE",
    "IWM", "IWF", "IWD", "DIA", "SCHD", "ARKK", "TLT", "BND", "AGG",
}

ALL_KNOWN_ETFS: Set[str] = KNOWN_UK_IRELAND_ETFS | KNOWN_US_SHARIAH_ETFS | KNOWN_BROAD_ETFS


def parse_ticker(ticker: str) -> Tuple[str, str, bool]:
    """
    Parse any ticker string into:
    (base_symbol, yfinance_symbol, is_uk_ireland)

    Examples:
    - 'LON:ISDU' -> ('ISDU', 'ISDU.L', True)
    - 'lon:isdu' -> ('ISDU', 'ISDU.L', True)
    - 'ISDU.L'   -> ('ISDU', 'ISDU.L', True)
    - 'ISDU'     -> ('ISDU', 'ISDU.L', True)
    - 'LON:AZN'  -> ('AZN', 'AZN.L', True)
    - 'AZN.L'    -> ('AZN', 'AZN.L', True)
    - 'lon:ulvr' -> ('ULVR', 'ULVR.L', True)
    - 'ULVR.L'   -> ('ULVR', 'ULVR.L', True)
    - 'SPUS'     -> ('SPUS', 'SPUS', False)
    - 'NVDA'     -> ('NVDA', 'NVDA', False)
    - 'BRK.B'    -> ('BRK-B', 'BRK-B', False)
    """
    raw = (ticker or "").strip().upper()
    if not raw:
        return "", "", False

    is_uk = False
    s = raw

    # Strip UK prefixes (Google Finance / LSE format)
    for prefix in UK_PREFIXES:
        if s.startswith(prefix):
            s = s[len(prefix):].strip()
            is_uk = True
            break

    # Strip UK suffixes (Yahoo Finance / Euronext Dublin format)
    for suffix in UK_SUFFIXES:
        if s.endswith(suffix):
            s = s[:-len(suffix)].strip()
            is_uk = True
            break

    # Handle dot/dash notation for US shares (e.g. BRK.B -> BRK-B)
    if not is_uk and ("." in s or "/" in s):
        if s in ("BRK.B", "BRK/B"):
            s = "BRK-B"
        elif s in ("BF.B", "BF/B"):
            s = "BF-B"

    base = s.split(".")[0].split("-")[0].strip() if not s.startswith("BRK-") else s

    # If base is in known London/Ireland UCITS ETFs, it is UK/IE
    if base in KNOWN_UK_IRELAND_ETFS:
        is_uk = True

    yf_symbol = f"{base}.L" if is_uk else base
    return base, yf_symbol, is_uk


def to_yfinance_symbol(ticker: str) -> str:
    """Return the symbol suitable for yfinance lookup."""
    _, yf_symbol, _ = parse_ticker(ticker)
    return yf_symbol or ticker.strip().upper()


def clean_base_symbol(ticker: str) -> str:
    """Return the bare ticker symbol without exchange prefixes or suffixes."""
    base, _, _ = parse_ticker(ticker)
    return base or ticker.strip().upper()


def is_uk_ireland_ticker(ticker: str) -> bool:
    """Return True if the ticker is listed on the London or Irish stock exchanges."""
    _, _, is_uk = parse_ticker(ticker)
    return is_uk
