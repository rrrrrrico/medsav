# Databricks notebook source
# MAGIC %md
# MAGIC # MedSav – VHIS premium analysis
# MAGIC Runs on Databricks Free Edition. Upload `pipeline/history/premiums/` and `public/data/plans.csv`
# MAGIC from the repo to the Volume below (Catalog → workspace → medsav → raw → Upload), then run all.

# COMMAND ----------

spark.sql("CREATE SCHEMA IF NOT EXISTS workspace.medsav")
spark.sql("CREATE VOLUME IF NOT EXISTS workspace.medsav.raw")
RAW = "/Volumes/workspace/medsav/raw"

# COMMAND ----------

from pyspark.sql import Window
from pyspark.sql import functions as F

history = spark.read.parquet(f"{RAW}/premiums")
history.write.mode("overwrite").saveAsTable("workspace.medsav.premium_history")

plans = spark.read.option("header", True).csv(f"{RAW}/plans.csv")
plans.write.mode("overwrite").saveAsTable("workspace.medsav.plans")

latest = (history
    .withColumn("rn", F.row_number().over(
        Window.partitionBy("certification_no", "status", "age").orderBy(F.desc("prem_date"))))
    .where("rn = 1").drop("rn"))
latest.write.mode("overwrite").saveAsTable("workspace.medsav.premiums_latest")

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Lifetime premiums from age 40 to 99, non-smoking male, standard plans
# MAGIC SELECT p.company_name_en, p.plan_name_en, round(sum(l.annual_premium)) AS premiums_40_to_99
# MAGIC FROM workspace.medsav.premiums_latest l
# MAGIC JOIN workspace.medsav.plans p USING (certification_no)
# MAGIC WHERE l.status = 'SMN' AND l.age BETWEEN 40 AND 99 AND p.type_en LIKE 'Standard%'
# MAGIC GROUP BY ALL
# MAGIC HAVING count(*) = 60
# MAGIC ORDER BY premiums_40_to_99
# MAGIC LIMIT 20

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Premium curve by age: median across plans, by sex
# MAGIC SELECT age, status, percentile_approx(annual_premium, 0.5) AS median_premium
# MAGIC FROM workspace.medsav.premiums_latest
# MAGIC WHERE status IN ('SMN', 'SFN')
# MAGIC GROUP BY age, status
# MAGIC ORDER BY age

# COMMAND ----------

# MAGIC %sql
# MAGIC -- How much of each insurer's table comes from the PDFs rather than the gov API
# MAGIC SELECT p.company_name_en,
# MAGIC        round(avg(CASE WHEN l.source = 'pdf' THEN 1 ELSE 0 END) * 100, 1) AS pct_cells_from_pdf,
# MAGIC        max(l.age) AS oldest_age_priced
# MAGIC FROM workspace.medsav.premiums_latest l
# MAGIC JOIN workspace.medsav.plans p USING (certification_no)
# MAGIC GROUP BY p.company_name_en
# MAGIC ORDER BY pct_cells_from_pdf DESC
