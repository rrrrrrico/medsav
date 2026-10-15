"""
MedSav VHIS data pipeline.

  python -m pipeline.run                      # full refresh, publish to public/data
  python -m pipeline.run --limit 20 --out /tmp/medsav-data
  python -m pipeline.run --no-publish         # build and check only

Exits with status 1 when the quality gate fails; nothing is published in that case.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

from . import bronze, config, gold, publish, quality, silver


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="only the first N plans (testing)")
    parser.add_argument("--skip-pdf", action="store_true", help="gov data only")
    parser.add_argument("--no-download", action="store_true", help="use cached PDFs only")
    parser.add_argument("--no-publish", action="store_true")
    parser.add_argument("--out", type=Path, default=config.PUBLIC_DATA)
    parser.add_argument("--allow-shrink", action="store_true",
                        help="one-off: accept a release smaller than the last one")
    args = parser.parse_args()

    started = time.time()
    bronze.run(limit=args.limit, skip_pdf=args.skip_pdf, download=not args.no_download)
    silver.run()

    if not quality.run(limit=args.limit, allow_shrink=args.allow_shrink):
        print("[pipeline] quality gate FAILED, nothing published", file=sys.stderr)
        return 1

    if args.limit:
        print("[pipeline] --limit run: history not updated")
    else:
        silver.merge_history()

    if args.no_publish:
        gold.run()
    else:
        gold.run(export_dir=args.out / "insights")
        publish.run(args.out)
        shutil.copy(config.REPORTS / "quality-report.json", args.out / "quality-report.json")
    print(f"[pipeline] done in {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
