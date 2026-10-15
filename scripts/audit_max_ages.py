#!/usr/bin/env python3
"""Holistically compare each plan CSV max_age vs gov-calibrated PDF max age."""

from __future__ import annotations

import csv
import json
import sys
import zipfile
import io
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_plan_csvs import (  # noqa: E402
    calibrate_scale,
    extract_pdf_series,
    extend_with_pdf,
    find_local_pdf,
    gov_age_maps,
    max_age_in_maps,
    scale_maps,
    PREMIUM_ZIP,
)

PREMIUMS = ROOT / "public" / "data" / "premiums"
CATALOG = ROOT / "public" / "data" / "plans.csv"
OUT = ROOT / "public" / "data" / "max-age-audit.json"


def csv_max(path: Path) -> int:
    with path.open(encoding="utf-8") as f:
        row = next(csv.DictReader(f), None)
    if not row:
        return -1
    return int(float(row.get("max_age") or 0))


def load_gov() -> dict:
    resp = requests.get(PREMIUM_ZIP, timeout=180)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        data = json.loads(zf.read("plan-premium.json"))
    return {p["certification-no"]: p for p in data["certified-plans"]}


def main() -> None:
    gov_by_cert = load_gov()
    gaps = []
    ok = 0
    pdf_missing = 0
    checked = 0

    with CATALOG.open(encoding="utf-8") as f:
        catalog = list(csv.DictReader(f))

    for row in catalog:
        cert = row["certification_no"]
        csv_path = PREMIUMS / f"{cert}.csv"
        if not csv_path.exists():
            gaps.append({"cert": cert, "issue": "missing_csv"})
            continue

        cmax = csv_max(csv_path)
        pdf = find_local_pdf(cert)
        if pdf is None:
            pdf_missing += 1
            continue
        if cert not in gov_by_cert:
            continue

        checked += 1
        try:
            gov_maps = gov_age_maps(gov_by_cert[cert])
            pdf_maps = extract_pdf_series(pdf, gov_maps)
            factor = calibrate_scale(gov_maps, pdf_maps) or 1.0
            scaled = scale_maps(pdf_maps, factor)
            pmax = max_age_in_maps(scaled)
            merged, added = extend_with_pdf(gov_maps, pdf_maps)
            expected = max_age_in_maps(merged)
        except Exception as exc:  # noqa: BLE001
            gaps.append({"cert": cert, "issue": f"pdf_parse_error:{exc}", "csv_max": cmax})
            continue

        if expected > cmax:
            gaps.append(
                {
                    "cert": cert,
                    "issue": "csv_max_below_expected",
                    "csv_max": cmax,
                    "expected_max": expected,
                    "pdf_max": pmax,
                    "added_if_rebuilt": added,
                    "gap": expected - cmax,
                }
            )
        elif pmax > cmax and added == 0:
            gaps.append(
                {
                    "cert": cert,
                    "issue": "pdf_has_higher_ages_but_unvalidated",
                    "csv_max": cmax,
                    "pdf_max": pmax,
                    "gap": pmax - cmax,
                }
            )
        else:
            ok += 1

    report = {
        "checked_with_pdf": checked,
        "ok": ok,
        "gaps": len(gaps),
        "pdf_missing_local": pdf_missing,
        "gap_details": sorted(gaps, key=lambda g: (-(g.get("gap") or 0), g["cert"])),
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("checked_with_pdf", "ok", "gaps", "pdf_missing_local")}, indent=2))
    print(f"Wrote {OUT}")
    if gaps:
        print("Top gaps:")
        for g in report["gap_details"][:25]:
            print(" ", g)


if __name__ == "__main__":
    main()
