"""Analysis layer: lifetime cost, cheapest plans by age, insurer loadings, price changes."""

from __future__ import annotations

import json
from datetime import datetime

from pathlib import Path
from typing import Optional

from delta.tables import DeltaTable
from pyspark.sql import Window
from pyspark.sql import functions as F

from . import config

def _save(df, name: str, export_dir: Optional[Path] = None) -> None:
    df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").save(str(config.GOLD / name))
    if export_dir is not None:
        export_dir.mkdir(parents=True, exist_ok=True)
        df.toPandas().to_csv(export_dir / f"{name}.csv", index=False)


def run(export_dir: Optional[Path] = None) -> None:
    spark = config.spark_session()
    prem = spark.read.format("delta").load(str(config.SILVER_PREMIUMS))
    catalog = spark.read.format("delta").load(str(config.BRONZE_CATALOG)).select(
        "certification_no", "company_name_en", "company_name_zh", "plan_name_en", "plan_name_zh", "type_en")
    if DeltaTable.isDeltaTable(spark, str(config.SILVER_HISTORY)):
        history = spark.read.format("delta").load(str(config.SILVER_HISTORY))
    else:
        history = prem.select("certification_no", "prem_date", "status", "age", "annual_premium").limit(0)

    # Premiums paid from age 0 to each age; the cost between ages a and b is cum[b] - cum[a - 1].
    by_age = Window.partitionBy("certification_no", "status").orderBy("age")
    cumulative = prem.select("certification_no", "status", "age", "annual_premium").withColumn(
        "cumulative_premium", F.round(F.sum("annual_premium").over(by_age), 2))
    _save(cumulative, "cumulative_premium")

    cheapest = (prem.join(catalog, "certification_no")
        .withColumn("rank", F.row_number().over(
            Window.partitionBy("currency", "status", "age").orderBy("annual_premium", "certification_no")))
        .where("rank <= 3")
        .select("currency", "status", "age", "rank", "certification_no", "company_name_en",
                "company_name_zh", "plan_name_en", "plan_name_zh", "type_en", "annual_premium")
        .orderBy("currency", "status", "age", "rank"))
    _save(cheapest, "cheapest_by_age", export_dir)

    wide = (prem.where("age BETWEEN 30 AND 60")
            .groupBy("certification_no", "age").pivot("status", ["SMN", "SMY", "SFN", "SFY"])
            .agg(F.first("annual_premium")))
    loadings = (wide.join(catalog, "certification_no")
        .groupBy("company_name_en", "company_name_zh")
        .agg(F.round(F.avg(F.col("SMY") / F.col("SMN")), 3).alias("male_smoker_loading"),
             F.round(F.avg(F.col("SFY") / F.col("SFN")), 3).alias("female_smoker_loading"),
             F.round(F.avg(F.col("SFN") / F.col("SMN")), 3).alias("female_to_male_ratio"),
             F.countDistinct("certification_no").alias("plans"))
        .orderBy("company_name_en"))
    _save(loadings, "insurer_loadings", export_dir)

    by_release = Window.partitionBy("certification_no", "status", "age").orderBy("prem_date")
    changes = (history
        .withColumn("previous_premium", F.lag("annual_premium").over(by_release))
        .withColumn("previous_prem_date", F.lag("prem_date").over(by_release))
        .where(F.col("previous_premium").isNotNull())
        .groupBy("certification_no", "previous_prem_date", "prem_date")
        .agg(F.round(F.avg(F.col("annual_premium") / F.col("previous_premium") - 1) * 100, 2)
             .alias("avg_change_pct"),
             F.count("*").alias("cells"))
        .join(catalog, "certification_no")
        .orderBy(F.desc("prem_date"), F.desc("avg_change_pct")))
    _save(changes, "premium_changes", export_dir)
    if export_dir is not None:
        _export_summary(prem, catalog, loadings, export_dir)
        _export_matrix(prem, spark.read.format("delta").load(str(config.BRONZE_CATALOG)), export_dir)
    print(f"[gold] tables written; {changes.count()} plan price changes on record")


MATRIX_MAX_AGE = 99
STATUSES = ("SMN", "SFN", "SMY", "SFY")


def _export_matrix(prem, catalog, export_dir: Path) -> None:
    """Every plan's premiums for ages 0-99 by status, so the Insights page can filter in the browser.

    A status whose premiums equal an earlier status is stored as that status's name instead of a list.
    Rider-only plans (R* statuses) are stored under the matching S* keys with kind "r".
    "m" is the plan's highest priced age in the full data, which may exceed MATRIX_MAX_AGE.
    """
    cols = [c for c in ("company_name_en", "company_name_zh", "plan_name_en", "plan_name_zh", "type_en", "type_zh")
            if c in catalog.columns]
    plans = {r.certification_no: r.asDict() for r in catalog.select("certification_no", *cols).collect()}
    top_age = {(r.certification_no, r.currency): int(r.top) for r in
               prem.groupBy("certification_no", "currency").agg(F.max("age").alias("top")).collect()}
    cells = (prem.where(F.col("age") <= MATRIX_MAX_AGE)
             .select("certification_no", "currency", "status", "age", "annual_premium").toPandas())

    insurers: list[list[str]] = []
    insurer_index: dict[str, int] = {}
    out = []
    for (cert, currency), group in cells.groupby(["certification_no", "currency"], sort=True):
        meta = plans.get(cert, {})
        name_en = meta.get("company_name_en") or ""
        if name_en not in insurer_index:
            insurer_index[name_en] = len(insurers)
            insurers.append([name_en, meta.get("company_name_zh") or name_en])
        rider = not group["status"].str.startswith("S").any()
        prices: dict[str, object] = {}
        for status in STATUSES:
            s = group[group["status"] == ("R" + status[1:] if rider else status)]
            if s.empty:
                continue
            series = [None] * (MATRIX_MAX_AGE + 1)
            for age, premium in zip(s["age"], s["annual_premium"]):
                series[int(age)] = round(float(premium))
            same = next((k for k, v in prices.items() if v == series), None)
            prices[status] = same if same else series
        out.append({
            "c": cert,
            "k": "r" if rider else ("s" if cert.startswith("S") else "f"),
            "cur": currency,
            "i": insurer_index[name_en],
            "n": [meta.get("plan_name_en") or cert, meta.get("plan_name_zh") or meta.get("plan_name_en") or cert],
            "t": [meta.get("type_en") or "", meta.get("type_zh") or meta.get("type_en") or ""],
            "m": top_age.get((cert, currency)),
            "p": prices,
        })
    matrix = {"max_age": MATRIX_MAX_AGE, "insurers": insurers, "plans": out}
    (export_dir / "matrix.json").write_text(json.dumps(matrix, ensure_ascii=False, separators=(",", ":")),
                                            encoding="utf-8")


def _export_summary(prem, catalog, loadings, export_dir: Path) -> None:
    """Compact JSON behind the site's Insights page (HKD plans; USD plans are counted only)."""
    hkd = (prem.where("currency = 'HKD'")
           .withColumn("plan_kind", F.when(F.col("certification_no").startswith("S"), "standard")
                       .otherwise("flexi")))

    curve = (hkd.where(F.col("status").isin("SMN", "SFN"))
        .groupBy("plan_kind", "status", "age")
        .agg(F.percentile_approx("annual_premium", [0.25, 0.5, 0.75]).alias("q"),
             F.countDistinct("certification_no").alias("plans"))
        .select("plan_kind", "status", "age", F.col("q")[0].alias("p25"), F.col("q")[1].alias("median"),
                F.col("q")[2].alias("p75"), "plans")
        .orderBy("plan_kind", "status", "age"))

    lifetime = (hkd.where("status = 'SMN' AND age BETWEEN 40 AND 99")
        .groupBy("certification_no", "plan_kind")
        .agg(F.sum("annual_premium").alias("total"), F.count("*").alias("years"))
        .where("years = 60")
        .join(catalog, "certification_no")
        .select("certification_no", "plan_kind", "company_name_en", "company_name_zh",
                "plan_name_en", "plan_name_zh", "type_en", F.round("total").alias("total"))
        .orderBy("total"))

    by_age = Window.partitionBy("certification_no").orderBy("age")
    growth = (hkd.where("status = 'SMN'")
        .withColumn("prev", F.lag("annual_premium").over(by_age))
        .where("prev > 0 AND age <= 99")
        .groupBy("age")
        .agg(F.round(F.percentile_approx(F.col("annual_premium") / F.col("prev") - 1, 0.5) * 100, 2)
             .alias("median_increase_pct"))
        .orderBy("age"))

    sources = {r.source: r["count"] for r in prem.groupBy("source").count().collect()}
    plans_by_currency = {r.currency: r["plans"] for r in
                         prem.groupBy("currency").agg(F.countDistinct("certification_no").alias("plans")).collect()}

    def rows(df):
        return [r.asDict() for r in df.collect()]

    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "plans_by_currency": plans_by_currency,
        "insurers": loadings.count(),
        "rows": sum(sources.values()),
        "cells_by_source": sources,
        "prem_dates": sorted(r.prem_date for r in prem.select("prem_date").distinct().collect()),
        "curve": rows(curve),
        "lifetime_40_99_male_non_smoker": rows(lifetime),
        "median_yearly_increase_by_age": rows(growth),
        "insurers_pricing": rows(loadings),
    }
    (export_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
