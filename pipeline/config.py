"""Paths and the Spark session shared by every pipeline stage."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
LAKE = ROOT / ".lakehouse"
HISTORY = ROOT / "pipeline" / "history" / "premiums"
PUBLIC_DATA = ROOT / "public" / "data"
REPORTS = LAKE / "reports"

BRONZE_CATALOG = LAKE / "bronze" / "catalog"
BRONZE_GOV = LAKE / "bronze" / "gov_premiums"
BRONZE_PDFS = LAKE / "bronze" / "pdf_files"
SILVER_PREMIUMS = LAKE / "silver" / "premiums"
SILVER_PLAN_STATUS = LAKE / "silver" / "plan_status"
SILVER_HISTORY = LAKE / "silver" / "premium_history"
GOLD = LAKE / "gold"

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
# Spark's Python workers are separate processes and need the same import path.
os.environ["PYTHONPATH"] = os.pathsep.join(
    p for p in (str(SCRIPTS), str(ROOT), os.environ.get("PYTHONPATH", "")) if p
)

MAC_JDK = Path("/opt/homebrew/opt/openjdk@17")
if not os.environ.get("JAVA_HOME") and MAC_JDK.exists():
    os.environ["JAVA_HOME"] = str(MAC_JDK)

_spark = None


def spark_session():
    global _spark
    if _spark is not None:
        return _spark
    from delta import configure_spark_with_delta_pip
    from pyspark.sql import SparkSession

    os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
    builder = (
        SparkSession.builder.appName("medsav-vhis")
        .master(os.environ.get("SPARK_MASTER", "local[*]"))
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
        .config("spark.sql.shuffle.partitions", "8")
        .config("spark.sql.session.timeZone", "Asia/Hong_Kong")
        # prem_date=20260601 folders must stay strings, not become integers.
        .config("spark.sql.sources.partitionColumnTypeInference.enabled", "false")
        .config("spark.driver.memory", os.environ.get("SPARK_DRIVER_MEMORY", "3g"))
        .config("spark.sql.execution.arrow.pyspark.enabled", "true")
        .config("spark.ui.showConsoleProgress", "false")
    )
    _spark = configure_spark_with_delta_pip(builder).getOrCreate()
    _spark.sparkContext.setLogLevel("WARN")
    return _spark
