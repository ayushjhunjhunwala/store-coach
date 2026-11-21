"""Quick exploration of the Manyavar data pack to find planted patterns. Usage: python scripts/explore.py <csv-dir>"""
import sys
from pathlib import Path

import pandas as pd

C = Path(sys.argv[1])
rd = lambda n: pd.read_csv(C / f"{n}.csv", dtype=str)
pd.set_option("display.width", 250, "display.max_columns", 40, "display.max_rows", 200)

stores, items, bills, lines, ff, roster, sp, cal = (rd(n) for n in
    ["stores", "items", "bills", "bill_lines", "footfall_daily", "roster_daily", "salespeople", "calendar"])
print(stores.to_string())
print(rd("area_managers").to_string())
lines["qty"] = lines.qty.astype(int)
for c in ["mrp", "selling_price"]:
    lines[c] = pd.to_numeric(lines[c], errors="coerce")
lines = lines.merge(items[["sku_id", "category", "is_packaging"]], on="sku_id", how="left")
print("lines with unknown sku:", lines.category.isna().sum(), " neg/zero price non-pack:",
      ((lines.selling_price <= 0) & (lines.is_packaging != "1")).sum(), " sp>mrp:", (lines.selling_price > lines.mrp).sum(),
      " qty<=0:", (lines.qty <= 0).sum(), " nan price:", lines.selling_price.isna().sum())
prod = lines[lines.is_packaging != "1"].copy()
prod["rev"] = prod.qty * prod.selling_price
bl = prod.groupby("bill_id").agg(units=("qty", "sum"), rev=("rev", "sum"))
b = bills.merge(bl, left_on="bill_id", right_index=True, how="left")
b["month"] = b.bill_date.str[:7]
print("bills without product lines:", b.units.isna().sum(), " bills w/o salesperson:", b.salesperson_id.isna().sum(),
      " w/o customer:", b.customer_id.isna().sum())
ff["footfall"] = pd.to_numeric(ff.footfall, errors="coerce")
ff["month"] = ff.date.str[:7]
print("footfall nan/neg/zero:", ff.footfall.isna().sum(), (ff.footfall < 0).sum(), (ff.footfall == 0).sum())

recent = b[b.bill_date >= "2026-05-01"]
m = recent.groupby(["store_id", "month"]).agg(bills=("bill_id", "count"), ipb=("units", "mean"), atv=("rev", "mean"))
f = ff[ff.date >= "2026-05-01"].groupby(["store_id", "month"]).footfall.sum()
m = m.join(f)
m["conv"] = (m.bills / m.footfall * 100).round(1)
print(m.round(2).unstack("month")[["conv"]].to_string())
print(m.round(2).unstack("month")[["ipb"]].to_string())
print(m.round(0).unstack("month")[["bills"]].to_string())

# YoY Oct
for mo in ["2025-10", "2026-10", "2025-09", "2026-09"]:
    x = b[b.month == mo].groupby("store_id").bill_id.count()
    print(mo, x.to_dict())

# roster: present staff per store per month
roster["p"] = (roster.status == "Present").astype(int)
roster["month"] = roster.date.str[:7]
print(roster.groupby(["store_id", "month"]).p.sum().unstack().to_string())
# salespeople with present days by month (to spot leavers)
sm = roster.groupby(["salesperson_id", "month"]).p.sum().unstack().fillna(0)
drop = sm[(sm["2026-05"] > 15) & (sm["2026-10"] < 5)]
print("possible leavers / absentees:\n", drop.join(sp.set_index("salesperson_id")[["store_id", "name"]]).to_string())
# bills by salesperson last 3 months vs earlier
bs = b[b.bill_date >= "2026-05-01"].groupby(["salesperson_id", "month"]).bill_id.count().unstack().fillna(0)
print("top sellers trend:\n", bs.sort_values("2026-06", ascending=False).head(25).join(sp.set_index("salesperson_id")[["store_id", "name"]]).to_string())
# discount by salesperson last 92d
d = prod.merge(bills[["bill_id", "store_id", "salesperson_id", "bill_date"]], on="bill_id")
d = d[d.bill_date >= "2026-08-01"]
d["disc"] = (d.mrp - d.selling_price) * d.qty
d["mrpv"] = d.mrp * d.qty
ds = d.groupby(["store_id", "salesperson_id"]).agg(disc=("disc", "sum"), mrpv=("mrpv", "sum"))
ds["pct"] = (ds.disc / ds.mrpv * 100).round(1)
st_norm = d.groupby("store_id").apply(lambda g: g.disc.sum() / g.mrpv.sum() * 100).round(1)
ds = ds.join(st_norm.rename("store_pct"), on="store_id")
print("discount outliers:\n", ds[ds.pct > ds.store_pct + 4].to_string())
# category mix by salesperson vs city
d = d.merge(stores[["store_id", "city"]], on="store_id")
cm = d.groupby(["city", "category"]).qty.sum()
cm = (cm / cm.groupby("city").transform("sum") * 100).round(1)
print(cm.unstack().to_string())
spm = d.groupby(["city", "salesperson_id", "category"]).qty.sum()
spm = (spm / spm.groupby(["city", "salesperson_id"]).transform("sum") * 100).unstack().fillna(0)
cmu = cm.unstack()
gap = spm.sub(cmu.reindex(spm.index.get_level_values(0)).values)
print("category avoidance (share - city share < -12):\n", gap[(gap < -12).any(axis=1)].round(1).to_string())
print(cal[cal.festival.notna()].tail(40).to_string())
