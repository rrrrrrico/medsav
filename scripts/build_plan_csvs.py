#!/usr/bin/env python3
"""
Build MedSav premium data:
  - Refresh plan catalog from live VHIS open data
  - One CSV per certification-no under public/data/premiums/
  - Gov JSON premiums as base; extend ages from each plan's premium PDF
    only beyond the ages the API already provides

Usage:
  .venv/bin/python scripts/build_plan_csvs.py
  .venv/bin/python scripts/build_plan_csvs.py --skip-pdf   # gov only
  .venv/bin/python scripts/build_plan_csvs.py --limit 20
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

try:
    import pdfplumber
except ImportError as exc:  # pragma: no cover
    raise SystemExit("pdfplumber required. Run: .venv/bin/pip install pdfplumber") from exc


ROOT = Path(__file__).resolve().parents[1]
OUT_CATALOG = ROOT / "public" / "data" / "plans.csv"
OUT_PREMIUMS = ROOT / "public" / "data" / "premiums"
PDF_DIRS = [
    ROOT / ".cache" / "pdfs",
    Path("/Users/ricong/Documents/vhis-data/pdfs"),
]

BASE = "https://www.vhis.gov.hk"
PREMIUM_ZIP = f"{BASE}/public/data/plan-premium.zip"
STANDARD_URL = f"{BASE}/public/data/standard-plans.json"
FLEXI_URL = f"{BASE}/public/data/flexi-plans.json"

STATUSES = ("SFN", "SFY", "SMN", "SMY", "RFN", "RFY", "RMN", "RMY")
MAX_REASONABLE_AGE = 130
BOUNDARY_TOLERANCE = 0.35  # relative


def pick_lang(obj: Any, *keys: str) -> str:
    if not isinstance(obj, dict):
        return str(obj or "")
    for key in keys:
        if obj.get(key):
            return str(obj[key])
    return ""


def choose_premium_url(doc: Any) -> Optional[str]:
    if not isinstance(doc, dict):
        return None
    for key in ("zh-hk", "zh-cn", "en"):
        rel = doc.get(key)
        if rel and "VATGST" not in rel:
            return BASE + rel if rel.startswith("/") else rel
    return None


def fetch_json(url: str) -> Any:
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.json()


def fetch_premiums() -> List[Dict[str, Any]]:
    resp = requests.get(PREMIUM_ZIP, timeout=180)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".json"))
        data = json.loads(zf.read(name))
    return list(data.get("certified-plans") or [])


def flatten_plans(standard: dict, flexi: dict) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    seen = set()

    for bundle in (standard.get("certified-plans") or [], flexi.get("certified-plans") or []):
        for plan in bundle:
            company_en = pick_lang(plan.get("company-name"), "en")
            company_zh = pick_lang(plan.get("company-name"), "zh-hk", "zh-cn", "en")
            plan_en = pick_lang(plan.get("plan-name"), "en")
            plan_zh = pick_lang(plan.get("plan-name"), "zh-hk", "zh-cn", "en")
            infos = plan.get("plan-info-certified") or []
            for info in infos:
                cert = info.get("certification-no")
                if not cert or cert in seen:
                    continue
                seen.add(cert)
                rows.append(
                    {
                        "certification_no": cert,
                        "company_name_en": company_en,
                        "company_name_zh": company_zh,
                        "plan_name_en": plan_en,
                        "plan_name_zh": plan_zh,
                        "type_en": pick_lang(info.get("plan-level"), "en"),
                        "type_zh": pick_lang(info.get("plan-level"), "zh-hk", "zh-cn", "en"),
                        "premium_pdf_url": choose_premium_url(info.get("premium-doc-url")) or "",
                    }
                )
    rows.sort(key=lambda r: r["certification_no"])
    return rows


def write_catalog(rows: List[Dict[str, str]]) -> None:
    OUT_CATALOG.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "certification_no",
        "company_name_en",
        "company_name_zh",
        "plan_name_en",
        "plan_name_zh",
        "type_en",
        "type_zh",
        "premium_pdf_url",
    ]
    with OUT_CATALOG.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def gov_age_maps(premium_obj: Dict[str, Any]) -> Dict[str, Dict[int, float]]:
    out: Dict[str, Dict[int, float]] = {}
    for status, ages in (premium_obj.get("premium") or {}).items():
        if not ages or not isinstance(ages, dict):
            continue
        mapped: Dict[int, float] = {}
        for age_s, val in ages.items():
            try:
                age = int(age_s)
                num = float(val)
            except (TypeError, ValueError):
                continue
            if 0 <= age <= MAX_REASONABLE_AGE:
                mapped[age] = num
        if mapped:
            out[status] = mapped
    return out


def max_age_in_maps(maps: Dict[str, Dict[int, float]]) -> int:
    m = -1
    for ages in maps.values():
        if ages:
            m = max(m, max(ages))
    return m


def find_local_pdf(cert: str) -> Optional[Path]:
    for directory in PDF_DIRS:
        if not directory.exists():
            continue
        matches = sorted(directory.glob(f"{cert}*.pdf"))
        if matches:
            return matches[0]
    return None


def download_pdf(url: str, cert: str) -> Optional[Path]:
    cache = PDF_DIRS[0]
    cache.mkdir(parents=True, exist_ok=True)
    name = url.rstrip("/").split("/")[-1] or f"{cert}.pdf"
    dest = cache / name
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    try:
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return dest
    except requests.RequestException as exc:
        print(f"  PDF download failed {cert}: {exc}")
        return None


def parse_number(token: str) -> Optional[float]:
    token = token.replace(",", "").replace("*", "").strip()
    if not token:
        return None
    if not re.fullmatch(r"\d+(\.\d+)?", token):
        return None
    return float(token)


def parse_age_token(token: str) -> Optional[int]:
    token = token.strip().replace("*", "").replace("#", "")
    # ages like 80*, 99*, or 80
    m = re.fullmatch(r"(\d{1,3})", token)
    if not m:
        return None
    age = int(m.group(1))
    if 0 <= age <= MAX_REASONABLE_AGE:
        return age
    return None


def _empty_table() -> Dict[str, Dict[int, float]]:
    return {
        "male_basic": {},
        "male_rider": {},
        "female_basic": {},
        "female_rider": {},
    }


def _table_to_status_maps(table: Dict[str, Dict[int, float]]) -> Dict[str, Dict[int, float]]:
    male_basic = table["male_basic"]
    male_rider = table["male_rider"]
    female_basic = table["female_basic"]
    female_rider = table["female_rider"]
    series = {
        "SMN": male_basic,
        "SMY": dict(male_basic),
        "SFN": female_basic,
        "SFY": dict(female_basic),
        "RMN": male_rider,
        "RMY": dict(male_rider),
        "RFN": female_rider,
        "RFY": dict(female_rider),
    }
    return {k: v for k, v in series.items() if v}


def _apply_nums_to_table(table: Dict[str, Dict[int, float]], age: int, nums: List[float]) -> None:
    if len(nums) >= 8:
        m_ann, f_ann = nums[0], nums[2]
        table["male_basic"][age] = m_ann
        table["male_rider"][age] = m_ann
        table["female_basic"][age] = f_ann
        table["female_rider"][age] = f_ann
    elif len(nums) >= 4:
        # ann/mon pairs vs basic/rider × sex
        if nums[0] > 0 and nums[1] < nums[0] * 0.2 and nums[2] > 0 and nums[3] < nums[2] * 0.2:
            table["male_basic"][age] = nums[0]
            table["male_rider"][age] = nums[0]
            table["female_basic"][age] = nums[2]
            table["female_rider"][age] = nums[2]
        else:
            table["male_basic"][age] = nums[0]
            table["male_rider"][age] = nums[1]
            table["female_basic"][age] = nums[2]
            table["female_rider"][age] = nums[3]
    elif len(nums) >= 2:
        # annual+monthly for one column (monthly ≈ annual * 0.087) vs male|female annuals
        if nums[0] > 0 and nums[1] < nums[0] * 0.2:
            table["male_basic"][age] = nums[0]
            table["male_rider"][age] = nums[0]
            table["female_basic"][age] = nums[0]
            table["female_rider"][age] = nums[0]
        else:
            table["male_basic"][age] = nums[0]
            table["male_rider"][age] = nums[0]
            table["female_basic"][age] = nums[1]
            table["female_rider"][age] = nums[1]
    elif len(nums) == 1:
        # Single cell — sex assigned by caller via _set_sex_premium when known
        table["male_basic"][age] = nums[0]
        table["male_rider"][age] = nums[0]


def _set_sex_premium(
    table: Dict[str, Dict[int, float]], age: int, premium: float, sex: str
) -> None:
    if sex == "male":
        table["male_basic"][age] = premium
        table["male_rider"][age] = premium
    else:
        table["female_basic"][age] = premium
        table["female_rider"][age] = premium


def _male_premium_for_nums(nums: List[float]) -> Optional[float]:
    """Preview the male-basic premium a nums vector would write."""
    temp = _empty_table()
    _apply_nums_to_table(temp, 0, nums)
    return temp["male_basic"].get(0)


def _can_ocr_join(parts: List[str], j: int) -> bool:
    """
    True when parts[j] and parts[j+1] are a split premium ('1'+'9610'), not the
    next age in a two-column row ('51' + '6381.00').
    A 2-digit token plus a 4-digit premium is an age. A 2-digit age plus a
    finished 3-digit premium ('51' + '450.00') is also an age. A 1-digit age
    plus a complete premium ('1' + '2,532.40', or '0' + '1,950') is an age.
    Only join a 1–9 lead with a 3–4 digit fragment that has no decimal, or a
    1–9 lead with a 3-digit amount that still has a decimal ('6'+'992.96').
    A 2-digit lead joins only a 3-digit fragment with no decimal.
    """
    if j + 1 >= len(parts):
        return False
    first, second = parts[j] or "", parts[j + 1] or ""
    if first == "0":
        return False
    if re.fullmatch(r"\d", first) and re.fullmatch(r"\d{3,4}", second):
        return True
    if re.fullmatch(r"\d", first) and re.fullmatch(r"\d{3}\.\d+", second):
        return True
    if re.fullmatch(r"\d{2}", first) and re.fullmatch(r"\d{3}", second):
        return True
    return False


def _parse_premium_token(parts: List[str], j: int) -> Tuple[Optional[float], int]:
    """
    Parse a premium at parts[j], joining OCR splits like '1'+'9610' → 19610.
    Returns (value, next_index).
    """
    if j >= len(parts):
        return None, j
    if _can_ocr_join(parts, j):
        combined = parse_number(parts[j] + parts[j + 1])
        if combined is not None and combined >= 1000:
            return combined, j + 2

    num = parse_number(parts[j])
    if num is not None:
        return num, j + 1
    return None, j + 1


def _normalize_split_numbers(line: str) -> str:
    """
    pdfplumber sometimes breaks a premium apart: '2 ,280.00', '9 07.92',
    '1 4,835.00'. Rejoin those fragments. A leading age ('0 2,280.00') and a
    later column age ('51 10,808.00 1 2,532.40') stay intact.
    """
    line = re.sub(r"(\d) ,(\d{3})", r"\1,\2", line)
    # Hundreds digit split off a short decimal ('9 07.92', '1 54.23'), not the
    # first age on the line.
    line = re.sub(r"(?<!^)(?<!\d)(\d) (\d{2}\.\d+)", r"\1\2", line, flags=re.M)
    return line


def _join_leading_digit(parts: List[str], j: int) -> Optional[Tuple[float, int]]:
    """
    '80 1 4,835.00 13,448.00' → male premium 14835, not age-fragment 1 plus 4835.
    Join only when the glued premium sits near the next premium; a real column
    age stays put because that ratio gets worse, not better.
    """
    if j + 2 >= len(parts) or not re.fullmatch(r"[1-9]", parts[j] or ""):
        return None
    left = parse_number(parts[j + 1])
    right = parse_number(parts[j + 2])
    joined = parse_number(parts[j] + parts[j + 1])
    if left is None or right is None or joined is None or left <= 0 or right <= 0:
        return None
    raw_ratio = max(left, right) / min(left, right)
    join_ratio = max(joined, right) / min(joined, right)
    if join_ratio + 0.05 < raw_ratio and join_ratio < 2.5:
        return joined, j + 2
    return None


def _parse_age_num_blocks(line: str) -> List[Tuple[int, List[float]]]:
    line = _normalize_split_numbers(line)
    line = re.sub(r"(\d)\*", r"\1 ", line)
    # Normalize "99+ *" / "101+*" style renewal ages
    line = re.sub(r"(\d+)\s*\+", r"\1", line)
    parts = line.replace(",", "").split()
    blocks: List[Tuple[int, List[float]]] = []
    i = 0
    while i < len(parts):
        age = parse_age_token(parts[i])
        if age is None:
            i += 1
            continue
        nums: List[float] = []
        j = i + 1
        while j < len(parts):
            if not nums:
                joined = _join_leading_digit(parts, j)
                if joined is not None:
                    premium, j = joined
                    nums.append(premium)
                    continue
            # Peek: if this token is an age AND cannot OCR-join into a premium,
            # it starts the next age block (two-column layouts).
            age_peek = parse_age_token(parts[j])
            if age_peek is not None and nums:
                # The same age already started this row, so this token opens the
                # female columns ('… 69 9,560 1 1,950' repeats age 1).
                repeated_age = age_peek == age or any(age_peek == prev_age for prev_age, _ in blocks)
                if not repeated_age and _can_ocr_join(parts, j):
                    pass
                else:
                    # A monthly premium of 100–130 sits between two annuals and is
                    # also a legal age. It is the monthly amount when it is well
                    # below the previous premium and the next number is its annual.
                    nxt = parse_number(parts[j + 1]) if j + 1 < len(parts) else None
                    prev = nums[-1]
                    monthly_not_age = (
                        not repeated_age
                        and nxt is not None
                        and prev > 0
                        and 100 <= age_peek <= 130
                        and age_peek < prev * 0.2
                        and nxt <= age_peek * 20
                    )
                    if not monthly_not_age:
                        break

            num, next_j = _parse_premium_token(parts, j)
            if num is None:
                j = max(next_j, j + 1)
                continue
            nums.append(num)
            j = next_j
        if nums:
            blocks.append((age, nums))
            i = j
        else:
            i += 1
    return blocks


def extract_pdf_tables(pdf_path: Path) -> List[Dict[str, Dict[int, float]]]:
    """
    Parse VHIS premium PDF into one or more age tables.

    Handles:
      - complementary two-column layouts (age 0|50, 1|51, …) in ONE table
      - parallel same-age columns (two plan variants side by side) as separate streams
      - payment-mode repeats when the same age reappears with a different premium
    """
    # Up to 4 parallel streams for multi-variant pages
    streams: List[Dict[str, Dict[int, float]]] = [_empty_table() for _ in range(4)]
    finished: List[Dict[str, Dict[int, float]]] = []

    def commit_stream(idx: int) -> None:
        if any(streams[idx][k] for k in streams[idx]):
            finished.append(streams[idx])
        streams[idx] = _empty_table()

    def maybe_rotate(idx: int, age: int, premium: float, sex: str) -> None:
        key = "male_basic" if sex == "male" else "female_basic"
        old = streams[idx][key].get(age)
        if old is not None and old > 0 and abs(premium - old) / old > 0.05:
            commit_stream(idx)
        _set_sex_premium(streams[idx], age, premium, sex)

    def write_block(idx: int, age: int, nums: List[float]) -> None:
        new_male = _male_premium_for_nums(nums)
        old_male = streams[idx]["male_basic"].get(age)
        if (
            old_male is not None
            and new_male is not None
            and old_male > 0
            and abs(new_male - old_male) / old_male > 0.05
        ):
            commit_stream(idx)
        _apply_nums_to_table(streams[idx], age, nums)

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw_line in text.split("\n"):
                line = raw_line.strip()
                if not line or not (line[0].isdigit() or line[0] == "*"):
                    continue
                blocks = _parse_age_num_blocks(line)
                if not blocks:
                    continue

                ages = [a for a, _ in blocks]
                single = all(len(nums) == 1 for _, nums in blocks)

                # Male block then the same ages again for female:
                # 0 pM 51 pM 0 pF 51 pF
                # 0 pM 34 pM 68 pM 0 pF 34 pF 68 pF
                if (
                    single
                    and len(blocks) >= 4
                    and len(blocks) % 2 == 0
                    and len(set(ages)) > 1
                ):
                    half = len(blocks) // 2
                    if ages[:half] == ages[half:]:
                        for i in range(half):
                            maybe_rotate(0, ages[i], blocks[i][1][0], "male")
                            maybe_rotate(0, ages[half + i], blocks[half + i][1][0], "female")
                        continue

                # Same age twice with single cells → male | female
                if single and len(blocks) >= 2 and len(set(ages)) == 1:
                    maybe_rotate(0, ages[0], blocks[0][1][0], "male")
                    maybe_rotate(0, ages[0], blocks[1][1][0], "female")
                    if len(blocks) >= 4:
                        maybe_rotate(1, ages[0], blocks[2][1][0], "male")
                        maybe_rotate(1, ages[0], blocks[3][1][0], "female")
                    continue

                # Parallel multi-premium variants: same age repeated on one row
                if len(blocks) >= 2 and len(set(ages)) == 1:
                    for idx, (_, nums) in enumerate(blocks[:4]):
                        write_block(idx, ages[0], nums)
                    continue

                # Complementary columns (0|50) or single-age rows → stream 0
                for age, nums in blocks:
                    write_block(0, age, nums)

    for idx in range(len(streams)):
        commit_stream(idx)
    return finished


def _raw_score(
    gov_maps: Dict[str, Dict[int, float]],
    pdf_maps: Dict[str, Dict[int, float]],
) -> float:
    scores: List[float] = []
    for status in ("SMN", "SFN", "RMN", "RFN"):
        g = gov_maps.get(status) or {}
        p = pdf_maps.get(status) or {}
        overlap = sorted(set(g) & set(p))
        if not overlap:
            continue
        sample = overlap[-5:]
        for age in sample:
            if g[age] > 0:
                scores.append(abs(p[age] - g[age]) / g[age])
    if not scores:
        return float("inf")
    return sum(scores) / len(scores)


def score_table_against_gov(
    gov_maps: Dict[str, Dict[int, float]],
    pdf_maps: Dict[str, Dict[int, float]],
) -> float:
    """Lower is better. Considers monthly/semi/quarterly scale factors."""
    best = _raw_score(gov_maps, pdf_maps)
    for factor in (12.0, 2.0, 4.0):
        scaled = scale_maps(pdf_maps, factor)
        best = min(best, _raw_score(gov_maps, scaled))
    return best


def _coverage_key(pdf_maps: Dict[str, Dict[int, float]]) -> Tuple[int, int]:
    return (
        max_age_in_maps(pdf_maps),
        max((len(v) for v in pdf_maps.values()), default=0),
    )


def stitch_tables_prefer_annual(
    tables: List[Dict[str, Dict[int, float]]],
) -> Dict[str, Dict[int, float]]:
    """
    Merge fragmented complementary-column extracts into one table.

    When annual and monthly fragments collide on an age, keep the larger
    premium (annual).
    """
    stitched = _empty_table()
    for table in tables:
        for key in stitched:
            for age, val in table[key].items():
                old = stitched[key].get(age)
                if old is None or val > old * 1.2:
                    stitched[key][age] = val
    return stitched


def extract_pdf_series(
    pdf_path: Path,
    gov_maps: Optional[Dict[str, Dict[int, float]]] = None,
) -> Dict[str, Dict[int, float]]:
    """
    Parse VHIS premium PDF into status -> {age: premium}.

    When multiple payment-mode tables exist, pick the annual table that matches
    gov open-data, preferring the candidate with the fullest age coverage.
    """
    tables = extract_pdf_tables(pdf_path)
    if not tables:
        return {}

    candidates = [_table_to_status_maps(t) for t in tables]
    stitched = _table_to_status_maps(stitch_tables_prefer_annual(tables))
    if stitched:
        candidates.append(stitched)
    candidates = [c for c in candidates if c]
    if not candidates:
        return {}

    if not gov_maps:
        def peak(c: Dict[str, Dict[int, float]]) -> Tuple[float, int]:
            vals = [v for ages in c.values() for v in ages.values()]
            return (max(vals) if vals else 0, max_age_in_maps(c))

        return max(candidates, key=peak)

    # Prefer candidates that actually extend past gov max after calibration
    extendable: List[Tuple[int, Tuple[int, int], float, Dict[str, Dict[int, float]]]] = []
    scored: List[Tuple[float, Dict[str, Dict[int, float]]]] = []
    for c in candidates:
        score = score_table_against_gov(gov_maps, c)
        scored.append((score, c))
        _, added = extend_with_pdf(gov_maps, c)
        if added > 0:
            extendable.append((added, _coverage_key(c), score, c))

    if extendable:
        return max(extendable, key=lambda item: (item[1], item[0], -item[2]))[3]

    good = [(s, c) for s, c in scored if s <= BOUNDARY_TOLERANCE]
    if good:
        return max(good, key=lambda sc: (_coverage_key(sc[1]), -sc[0]))[1]

    finite = [(s, c) for s, c in scored if s != float("inf")]
    if finite:
        return min(finite, key=lambda sc: (sc[0], -_coverage_key(sc[1])[0]))[1]

    return max(candidates, key=_coverage_key)


def boundary_ok(gov: Dict[int, float], pdf: Dict[int, float], boundary: int) -> bool:
    if boundary not in gov or boundary not in pdf:
        # try nearby ages
        for age in (boundary, boundary - 1, boundary - 2):
            if age in gov and age in pdf:
                boundary = age
                break
        else:
            return False
    g = gov[boundary]
    p = pdf[boundary]
    if g <= 0:
        return False
    return abs(p - g) / g <= BOUNDARY_TOLERANCE


def calibrate_scale(
    gov_maps: Dict[str, Dict[int, float]],
    pdf_maps: Dict[str, Dict[int, float]],
) -> Optional[float]:
    """
    Median gov/pdf ratio on overlapping ages.
    Accept ~1 (already annual) or ~12 (monthly table extracted).
    """
    ratios: List[float] = []
    for status in ("SMN", "SFN", "RMN", "RFN"):
        g = gov_maps.get(status) or {}
        p = pdf_maps.get(status) or {}
        for age in set(g) & set(p):
            if p[age] > 0 and g[age] > 0:
                ratios.append(g[age] / p[age])
    if len(ratios) < 3:
        return None
    ratios.sort()
    med = ratios[len(ratios) // 2]
    if 0.85 <= med <= 1.15:
        return 1.0
    if 10.0 <= med <= 14.0:
        return 12.0
    if 1.8 <= med <= 2.2:
        return 2.0  # semi-annual
    if 3.5 <= med <= 4.5:
        return 4.0  # quarterly
    return None


def scale_maps(
    pdf_maps: Dict[str, Dict[int, float]], factor: float
) -> Dict[str, Dict[int, float]]:
    if factor == 1.0:
        return pdf_maps
    return {
        status: {age: premium * factor for age, premium in ages.items()}
        for status, ages in pdf_maps.items()
    }


def extend_with_pdf(
    gov_maps: Dict[str, Dict[int, float]],
    pdf_maps: Dict[str, Dict[int, float]],
) -> Tuple[Dict[str, Dict[int, float]], int]:
    """Return merged maps and count of PDF-sourced cells added."""
    merged = {status: dict(ages) for status, ages in gov_maps.items()}
    gov_max = max_age_in_maps(gov_maps)
    if gov_max < 0 or not pdf_maps:
        return merged, 0

    factor = calibrate_scale(gov_maps, pdf_maps)
    if factor is None:
        # Fall back: accept unscaled if boundary already matches
        scaled = pdf_maps
    else:
        scaled = scale_maps(pdf_maps, factor)

    validated = False
    for status in STATUSES:
        if status in gov_maps and status in scaled and boundary_ok(
            gov_maps[status], scaled[status], gov_max
        ):
            validated = True
            break
    if not validated:
        return merged, 0

    added = 0
    partner = {
        "SMN": "RMN",
        "SFN": "RFN",
        "SMY": "RMY",
        "SFY": "RFY",
        "RMN": "SMN",
        "RFN": "SFN",
        "RMY": "SMY",
        "RFY": "SFY",
    }
    for status, pdf_ages in scaled.items():
        target = merged.setdefault(status, {})
        gov_ages = gov_maps.get(status) or {}
        if gov_ages:
            # Keep API ages; only older PDF ages are new.
            status_max = max(gov_ages)
        elif status.startswith("R") and (gov_maps.get(partner[status]) or {}):
            # API published the standard plan but not the rider. The PDF still
            # has rider (or unisex) premiums from age 0.
            status_max = -1
        else:
            status_max = gov_max
        for age, premium in pdf_ages.items():
            if age <= status_max or age in target:
                continue
            target[age] = round(premium, 2)
            added += 1

    # Unisex tables publish one premium column. Gov male and female match, but
    # the PDF parse only stores that column on one sex, so the other sex stops
    # at the API max. Copy the extended ages across when the shared ages agree.
    for left, right in (("SMN", "SFN"), ("SMY", "SFY"), ("RMN", "RFN"), ("RMY", "RFY")):
        gov_left = gov_maps.get(left) or {}
        gov_right = gov_maps.get(right) or {}
        overlap = set(gov_left) & set(gov_right)
        if not overlap:
            continue
        if any(abs(gov_left[age] - gov_right[age]) > 0.01 for age in overlap):
            continue
        merged_left = merged.setdefault(left, {})
        merged_right = merged.setdefault(right, {})
        for src, dst in ((merged_left, merged_right), (merged_right, merged_left)):
            for age, premium in src.items():
                if age not in dst:
                    dst[age] = premium
                    added += 1
    return merged, added


def write_plan_csv(
    path: Path,
    cert: str,
    meta: Dict[str, str],
    maps: Dict[str, Dict[int, float]],
    pdf_added: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    all_ages = sorted({age for ages in maps.values() for age in ages})
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "certification_no",
                "prem_date",
                "currency",
                "age_counting_method",
                "max_age",
                "pdf_extended_cells",
                "age",
                "status",
                "annual_premium",
            ]
        )
        max_age = all_ages[-1] if all_ages else ""
        for age in all_ages:
            for status in STATUSES:
                if status not in maps or age not in maps[status]:
                    continue
                writer.writerow(
                    [
                        cert,
                        meta.get("prem_date", ""),
                        meta.get("currency", "HKD"),
                        meta.get("age_counting_method", ""),
                        max_age,
                        pdf_added,
                        age,
                        status,
                        maps[status][age],
                    ]
                )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-pdf", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--download-missing-pdfs", action="store_true", default=True)
    args = parser.parse_args()

    print("Fetching live VHIS open data...")
    standard = fetch_json(STANDARD_URL)
    flexi = fetch_json(FLEXI_URL)
    premium_list = fetch_premiums()
    catalog = flatten_plans(standard, flexi)
    write_catalog(catalog)
    print(f"Wrote catalog: {len(catalog)} plans → {OUT_CATALOG}")

    by_cert = {p["certification-no"]: p for p in premium_list}
    url_by_cert = {r["certification_no"]: r["premium_pdf_url"] for r in catalog}

    if OUT_PREMIUMS.exists():
        shutil.rmtree(OUT_PREMIUMS)
    OUT_PREMIUMS.mkdir(parents=True, exist_ok=True)

    # Remove legacy monolithic file if present
    legacy = ROOT / "public" / "data" / "premiums.csv"
    if legacy.exists():
        legacy.unlink()

    stats = {
        "written": 0,
        "pdf_extended": 0,
        "pdf_failed_validate": 0,
        "pdf_missing": 0,
        "no_gov": 0,
        "max_age_gt_80": 0,
    }

    rows = catalog[: args.limit] if args.limit else catalog
    for idx, row in enumerate(rows, 1):
        cert = row["certification_no"]
        gov = by_cert.get(cert)
        if not gov:
            stats["no_gov"] += 1
            continue

        maps = gov_age_maps(gov)
        meta = {
            "prem_date": str(gov.get("prem-date") or ""),
            "currency": str(gov.get("currency") or "HKD"),
            "age_counting_method": str(gov.get("age-counting-method") or ""),
        }
        pdf_added = 0

        if not args.skip_pdf:
            pdf_path = find_local_pdf(cert)
            if pdf_path is None and args.download_missing_pdfs and url_by_cert.get(cert):
                pdf_path = download_pdf(url_by_cert[cert], cert)
            if pdf_path is None:
                stats["pdf_missing"] += 1
            else:
                try:
                    pdf_maps = extract_pdf_series(pdf_path, gov_maps=maps)
                    maps, pdf_added = extend_with_pdf(maps, pdf_maps)
                    if pdf_added:
                        stats["pdf_extended"] += 1
                    else:
                        # had pdf but no extension (already complete or failed validation)
                        gov_max = max_age_in_maps(gov_age_maps(gov))
                        pdf_max = max_age_in_maps(pdf_maps)
                        if pdf_max > gov_max:
                            stats["pdf_failed_validate"] += 1
                except Exception as exc:  # noqa: BLE001
                    print(f"  PDF parse error {cert}: {exc}")

        out_max = max_age_in_maps(maps)
        if out_max > 80:
            stats["max_age_gt_80"] += 1

        write_plan_csv(OUT_PREMIUMS / f"{cert}.csv", cert, meta, maps, pdf_added)
        stats["written"] += 1
        if idx % 50 == 0 or idx == len(rows):
            print(f"  {idx}/{len(rows)} plans...")

    # Manifest for quick frontend checks
    manifest_path = ROOT / "public" / "data" / "premiums-manifest.json"
    manifest = {
        "plan_count": stats["written"],
        "catalog_count": len(catalog),
        "premium_source": PREMIUM_ZIP,
        "stats": stats,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Done:", json.dumps(stats, indent=2))
    print(f"Per-plan CSVs → {OUT_PREMIUMS}")


if __name__ == "__main__":
    main()
