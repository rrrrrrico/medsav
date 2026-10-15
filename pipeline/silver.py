"""Cleaned layer: gov premiums extended from each plan's PDF, parsed in parallel."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Iterator

import pandas as pd
from delta.tables import DeltaTable
from pyspark.sql import functions as F

from . import config

PREMIUM_SCHEMA = (
    "certification_no string, prem_date string, currency string, age_counting_method string, "
    "max_age int, pdf_extended_cells int, age int, status string, annual_premium double, "
    "source string, pdf_outcome string"
)
KEY = ["certification_no", "prem_date", "status", "age"]


def _extend_plans(batches: Iterator[pd.DataFrame]) -> Iterator[pd.DataFrame]:
    import build_plan_csvs as bpc

    for batch in batches:
        out = []
        for plan in batch.itertuples(index=False):
            gov_maps = {}
            for cell in json.loads(plan.gov_cells):
                gov_maps.setdefault(cell["status"], {})[int(cell["age"])] = float(cell["annual_premium"])

            maps, added, outcome = gov_maps, 0, "missing"
            if plan.content is not None:
                try:
                    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
                        tmp.write(plan.content)
                        tmp.flush()
                        pdf_maps = bpc.extract_pdf_series(Path(tmp.name), gov_maps=gov_maps)
                    maps, added = bpc.extend_with_pdf(gov_maps, pdf_maps)
                    if added:
                        outcome = "extended"
                    elif bpc.max_age_in_maps(pdf_maps) > bpc.max_age_in_maps(gov_maps):
                        outcome = "failed_validate"
                    else:
                        outcome = "complete"
                except Exception as exc:  # noqa: BLE001
                    print(f"  PDF parse error {plan.certification_no}: {exc}")
                    maps, added, outcome = gov_maps, 0, "error"

            max_age = bpc.max_age_in_maps(maps)
            for status, ages in maps.items():
                gov_ages = gov_maps.get(status, {})
                for age, premium in ages.items():
                    out.append((
                        plan.certification_no, plan.prem_date, plan.currency, plan.age_counting_method,
                        max_age, added, age, status, float(premium),
                        "gov" if age in gov_ages else "pdf", outcome,
                    ))
        yield pd.DataFrame(out, columns=[c.split()[0] for c in PREMIUM_SCHEMA.split(", ")])


def run() -> None:
    spark = config.spark_session()
    catalog = spark.read.format("delta").load(str(config.BRONZE_CATALOG))
    gov = spark.read.format("delta").load(str(config.BRONZE_GOV))
    pdfs = spark.read.format("delta").load(str(config.BRONZE_PDFS))

    per_plan = (
        gov.groupBy("certification_no", "prem_date", "currency", "age_counting_method")
        .agg(F.to_json(F.collect_list(F.struct("status", "age", "annual_premium"))).alias("gov_cells"))
        .join(catalog.select("certification_no", "pdf_path"), "certification_no")
        .join(pdfs.select("pdf_path", "content"), "pdf_path", "left")
        .repartition(16, "certification_no")
    )

    premiums = per_plan.mapInPandas(_extend_plans, PREMIUM_SCHEMA)
    premiums.write.format("delta").mode("overwrite").option("overwriteSchema", "true").save(
        str(config.SILVER_PREMIUMS))

    current = spark.read.format("delta").load(str(config.SILVER_PREMIUMS))
    (current.groupBy("certification_no")
        .agg(F.first("pdf_outcome").alias("pdf_outcome"),
             F.max("max_age").alias("max_age"),
             F.max("pdf_extended_cells").alias("pdf_extended_cells"),
             F.count("*").alias("rows"))
        .write.format("delta").mode("overwrite").option("overwriteSchema", "true")
        .save(str(config.SILVER_PLAN_STATUS)))
    print(f"[silver] {current.count()} premium rows")


def merge_history() -> None:
    """Upsert this release into premium history. CI starts from the committed Parquet copy."""
    spark = config.spark_session()
    current = (spark.read.format("delta").load(str(config.SILVER_PREMIUMS))
               .select(*KEY, "annual_premium", "source")
               .withColumn("first_seen", F.current_date()))

    path = str(config.SILVER_HISTORY)
    if not DeltaTable.isDeltaTable(spark, path):
        if any(config.HISTORY.glob("prem_date=*/*.parquet")):
            seed = spark.read.parquet(str(config.HISTORY))
        else:
            seed = current.limit(0)
        seed.select(*KEY, "annual_premium", "source", "first_seen").write.format("delta").save(path)

    history = DeltaTable.forPath(spark, path)
    (history.alias("h")
        .merge(current.alias("c"), " AND ".join(f"h.{k} = c.{k}" for k in KEY))
        .whenMatchedUpdate(
            condition="abs(h.annual_premium - c.annual_premium) > 0.005 OR h.source <> c.source",
            set={"annual_premium": "c.annual_premium", "source": "c.source"})
        .whenNotMatchedInsertAll()
        .execute())

    release_dates = [r.prem_date for r in current.select("prem_date").distinct().collect()]
    snapshot = (spark.read.format("delta").load(path)
                .where(F.col("prem_date").isin(release_dates)).toPandas())
    for prem_date, part in snapshot.groupby("prem_date"):
        target = config.HISTORY / f"prem_date={prem_date}"
        target.mkdir(parents=True, exist_ok=True)
        (part.drop(columns="prem_date")
            .sort_values(["certification_no", "status", "age"])
            .reset_index(drop=True)
            .to_parquet(target / "part-0.parquet", index=False))
    print(f"[silver] history covers {len(release_dates)} premium dates in this release")
