# Mariam Coffee · Sales analytics

A browser-only web app that reads the ASEAL POS / accounting **Paradox (.DB)** files
and produces reconciled sales reports. Nothing is uploaded or stored: files are
processed in the browser tab.

## What you can upload
- The database folder, the loose `.DB` files, or one `.zip` / `.rar` archive of them.
- Tables used: `Invoices.DB` + `StockTransDetails.DB` (accounting, primary source),
  `CROldInvoices.DB` + `CROldDetails.DB` (cash-register history for earlier dates),
  optional `Items.DB` (names) and `CRInvoices.DB` (open tables).

## Reports
- **Dashboard**: last 7 days, orders, avg ticket, latest day, month-to-date + projection,
  discounts, daily trend with 7-day average, top increasing / declining products,
  best sellers, insights, weekday × hour heatmap, weekday and hour averages,
  monthly trend, payment mix.
- **Sales per month / day / hour**, **Products** (summary, amount by month, quantity by month
  with forecast), **Orders**. Every table sorts on any column, filters by orders and
  amount (min/max) and exports to CSV. Global filters: start/end date, channel, net/gross.
- **Reconciliation**: daily and monthly proof that product totals = invoice totals,
  invoices whose lines don't add up, POS vs accounting per day, open tables.

## Data rules
- Business day = the working date the system books (after-midnight sales → previous day).
- Gross = sum of product lines; Net = Gross − invoice discounts; returns are negative.
- Any invoice whose lines don't match its header gets an "Unallocated" line for the gap,
  so product totals always equal invoice totals. Discounts are allocated to lines pro-rata.

## Development
```bash
npm install
npm run dev            # local dev server
npm run build          # dist/ for Cloudflare Pages
npm run build:single   # dist-single/index.html: one self-contained file
npm test -- "<folder with .DB files>"   # prints monthly totals + reconciliation checks
```

## Deploy (Cloudflare Pages)
Build command `npm run build`, output directory `dist`, Node 20+.
