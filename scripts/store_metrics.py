"""Store-level KPIs, trends, repeat role models and category mix from the raw Manyavar CSVs.

Usage: python scripts/store_metrics.py <csv-dir> <out.json>
Output feeds the Command Centre, Stores and Insights screens. Every number is computed here.
"""
import json
import sys
from pathlib import Path

import pandas as pd

CSV, OUT = Path(sys.argv[1]), Path(sys.argv[2])
T = pd.Timestamp("2026-10-31")
rd = lambda n: pd.read_csv(CSV / f"{n}.csv", dtype=str)

stores, items, bills, lines, ff, sp, ams = (rd(n) for n in
    ["stores", "items", "bills", "bill_lines", "footfall_daily", "salespeople", "area_managers"])
bills["d"] = pd.to_datetime(bills.bill_date)
ff["d"] = pd.to_datetime(ff.date)
ff["footfall"] = ff.footfall.astype(int)
lines["qty"] = lines.qty.astype(int)
lines["mrp"] = lines.mrp.astype(float)
lines["sp"] = lines.selling_price.astype(float)
lines = lines.merge(items[["sku_id", "category", "is_packaging"]], on="sku_id")
prod = lines[lines.is_packaging != "1"].copy()
prod["rev"], prod["mrpv"] = prod.qty * prod.sp, prod.qty * prod.mrp
bt = prod.groupby("bill_id").agg(units=("qty", "sum"), rev=("rev", "sum"), mrpv=("mrpv", "sum"))
B = bills.set_index("bill_id").join(bt).dropna(subset=["units"])
B = B.merge(stores[["store_id", "city", "state", "area_manager_id"]], left_on="store_id", right_on="store_id").set_index(B.index)

# door-camera faults (0 walk-ins on a day with bills) are excluded from conversion
bpd = B.groupby(["store_id", "d"]).size().rename("bills")
fq = ff.set_index(["store_id", "d"]).join(bpd).fillna({"bills": 0})
fq["bad"] = (fq.footfall == 0) & (fq.bills > 0)
good_ff = fq[~fq.bad].reset_index()
bad_keys = set(fq[fq.bad].index)
B["camera_ok"] = [(s, d) not in bad_keys for s, d in zip(B.store_id, B.d)]


def kpis(b, f):
    bills_n, sales = len(b), float(b.rev.sum())
    conv_bills = int(b.camera_ok.sum())
    foot = int(f.footfall.sum())
    return {"sales": round(sales), "bills": bills_n, "footfall": foot,
            "conversion": round(conv_bills / foot, 4) if foot else None,
            "atv": round(sales / bills_n) if bills_n else None,
            "ipb": round(float(b.units.sum()) / bills_n, 3) if bills_n else None,
            "discount": round(float(1 - b.rev.sum() / b.mrpv.sum()), 4) if bills_n else None}


def win(df, end, days):
    return df[(df.d > end - pd.Timedelta(days=days)) & (df.d <= end)]


# repeat (brief's definition): a customer billing again 30+ days after their first bill.
# Mature cohort = first-ever bill (network-wide) at least 365 days before T, so everyone had a year to come back.
first = B.reset_index().sort_values(["d", "bill_id"]).groupby("customer_id").first()
coh = first[first.d <= T - pd.Timedelta(days=365)].copy()
nxt = B[B.customer_id.isin(coh.index)][["customer_id", "d"]].join(coh.d.rename("fd"), on="customer_id")
back = set(nxt[(nxt.d >= nxt.fd + pd.Timedelta(days=30)) & (nxt.d <= T)].customer_id)
coh["back"] = coh.index.isin(back)
REPEAT_DEF = (f"Customers whose first-ever bill was between {B.d.min().date()} and {(T - pd.Timedelta(days=365)).date()} "
              f"(so each had at least a year to return); repeat = billed again 30+ days after that first bill, up to {T.date()}. "
              "Data starts Nov 2024, so some 'first' bills may be older customers.")

scope_rows = {"network": (B, good_ff)}
for _, s in stores.iterrows():
    scope_rows[s.store_id] = (B[B.store_id == s.store_id], good_ff[good_ff.store_id == s.store_id])
for _, a in ams.iterrows():
    ids = [x.strip() for x in a.stores.split(",")]
    scope_rows[a.area_manager_id] = (B[B.store_id.isin(ids)], good_ff[good_ff.store_id.isin(ids)])

out = {"as_of": str(T.date()), "repeat_definition": REPEAT_DEF, "scopes": {}}
for key, (b, f) in scope_rows.items():
    cur = kpis(win(b, T, 28), win(f, T, 28))
    prev = kpis(win(b, T - pd.Timedelta(days=28), 28), win(f, T - pd.Timedelta(days=28), 28))
    ly = kpis(win(b, T - pd.Timedelta(days=364), 28), win(f, T - pd.Timedelta(days=364), 28))
    ids = set(b.store_id.unique())
    c = coh[coh.store_id.isin(ids)]
    cur["repeat"] = round(float(c.back.mean()), 4) if len(c) >= 30 else None
    cur["repeat_n"] = int(len(c))
    b["month"] = b.d.dt.strftime("%Y-%m")
    f = f.assign(month=f.d.dt.strftime("%Y-%m"))
    mb = b.groupby("month").agg(sales=("rev", "sum"), bills=("rev", "size"), conv_bills=("camera_ok", "sum"), units=("units", "sum"))
    mf = f.groupby("month").footfall.sum()
    monthly = [{"month": m, "sales": round(float(r.sales)), "bills": int(r.bills),
                "conversion": round(float(r.conv_bills / mf[m]), 4) if mf.get(m) else None, "ipb": round(float(r.units / r.bills), 3)}
               for m, r in mb.iterrows()]
    wk = win(b, T, 84).assign(week=lambda x: (x.d - pd.to_timedelta((x.d.dt.dayofweek + 1) % 7, unit="D")).dt.strftime("%Y-%m-%d"))
    weekly = wk.groupby("week").agg(sales=("rev", "sum"), bills=("rev", "size")).reset_index()
    out["scopes"][key] = {"last28": cur, "prev28": prev, "ly28": ly, "monthly": monthly,
                          "weekly": [{"week": r.week, "sales": round(float(r.sales)), "bills": int(r.bills)} for r in weekly.itertuples()]}

# repeat role models per store: salespeople whose first-time customers come back most (cohort >= 30)
rm = {}
for store, g in coh.groupby("store_id"):
    per = g.groupby("salesperson_id").back.agg(["sum", "count"])
    per = per[per["count"] >= 30].assign(rate=lambda x: x["sum"] / x["count"]).sort_values("rate", ascending=False)
    rm[store] = [{"salesperson_id": p, "name": sp.set_index("salesperson_id").loc[p, "name"], "back": int(r["sum"]), "cohort": int(r["count"]),
                  "rate": round(float(r.rate), 4)} for p, r in per.iterrows()]
out["repeat_by_salesperson"] = rm

# category mix by city, last 90 days (units)
p90 = prod.merge(B[["store_id", "city", "d"]], left_on="bill_id", right_index=True)
p90 = p90[p90.d > T - pd.Timedelta(days=90)]
mix = p90.groupby(["city", "category"]).qty.sum()
mix = (mix / mix.groupby("city").transform("sum")).round(4)
out["category_mix_90d"] = {c: g.droplevel(0).to_dict() for c, g in mix.groupby(level=0)}
out["data_quality"] = [{"store_id": s, "date": str(d.date()), "issue": "Footfall 0 while the store billed", "bills": int(fq.loc[(s, d), "bills"])}
                       for (s, d) in sorted(bad_keys)]
out["stores"] = stores.to_dict("records")
out["area_managers"] = ams.to_dict("records")
OUT.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")
n = out["scopes"]["network"]
print("network last28", n["last28"], "\nprev28", n["prev28"], "\nly28", n["ly28"])
print({s: out["scopes"][s]["last28"]["repeat"] for s in stores.store_id})
print("bytes", OUT.stat().st_size)
