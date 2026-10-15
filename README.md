# MedSav — Medical Finance Calculator

Frontend-only Next.js PWA of the insurance-toolbox **醫療融資** calculator. No auth. Plan catalog + one premium CSV per certified plan.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The illustration page is [http://localhost:3000/illustration](http://localhost:3000/illustration).

## Illustration page

`/illustration` reads a savings-plan image with in-browser OCR (Tesseract). Year-1 **累計保證現金儲備 (B)** is the fixed cash available every year to pay VHIS Plan A/B premiums. No external API.

## Data

| Path | Contents |
|------|----------|
| `public/data/plans.csv` | Catalog of certified VHIS plans (live open data) |
| `public/data/premiums/<certification_no>.csv` | Independent premium file per plan |
| `public/data/premiums-manifest.json` | Build stats |

Each premium CSV is long-format:

```text
certification_no,prem_date,currency,age_counting_method,max_age,pdf_extended_cells,age,status,annual_premium
```

Status codes: `(R|S)` + `(M|F)` + `(Y|N)` → rider/standard, male/female, smoker yes/no.

### How premiums are built

1. **Gov open data** (`plan-premium.zip`) is the base for each plan’s ages.
2. Each plan’s **premium table PDF** is parsed; ages the API lacks (often 81+) are appended when the PDF’s annual table validates against the gov boundary age.
3. Frontend loads the catalog once, then fetches only the selected plan’s CSV.

Refresh / audit:

```bash
python3 -m venv .venv
.venv/bin/pip install pdfplumber requests
npm run build-data   # fetch gov JSON + extend from premium PDFs
npm run audit-data   # compare CSV max ages vs PDF (writes public/data/max-age-audit.json)
```

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- PWA via `@ducanh2912/next-pwa`
- Plotly charts, XLSX export
- EN / 中文, light / dark theme
