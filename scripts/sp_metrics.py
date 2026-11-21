"""Per-salesperson view for the Salesperson portal: own KPIs vs own store, own recent bills, roster.

Usage: python scripts/sp_metrics.py <csv-dir> <out.json>
Last 90 days to 31 Oct 2026. Every number is computed here from the CSVs.
"""
import json
import sys
from pathlib import Path

import pandas as pd

CSV, OUT = Path(sys.argv[1]), Path(sys.argv[2])
T = pd.Timestamp("2026-10-31")
START = T - pd.Timedelta(days=89)
rd = lambda n: pd.read_csv(CSV / f"{n}.csv", dtype=str)
items, bills, lines, sp, roster, stores = (rd(n) for n in ["items", "bills", "bill_lines", "salespeople", "roster_daily", "stores"])
bills["d"] = pd.to_datetime(bills.bill_date)
roster["d"] = pd.to_datetime(roster.date)
lines["qty"] = lines.qty.astype(int)
lines["mrp"] = lines.mrp.astype(float)
lines["sp"] = lines.selling_price.astype(float)
lines = lines.merge(items[["sku_id", "category", "style_name", "is_packaging"]], on="sku_id")
prod = lines[lines.is_packaging != "1"].copy()
prod["rev"], prod["mrpv"] = prod.qty * prod.sp, prod.qty * prod.mrp
bt = prod.groupby("bill_id").agg(units=("qty", "sum"), rev=("rev", "sum"), mrpv=("mrpv", "sum"), cats=("category", lambda c: sorted(set(c))))
B = bills.set_index("bill_id").join(bt).dropna(subset=["units"])

first = B.reset_index().sort_values(["d", "bill_id"]).groupby("customer_id").first()
coh = first[first.d <= T - pd.Timedelta(days=365)].copy()
nxt = B[B.customer_id.isin(coh.index)][["customer_id", "d"]].join(coh.d.rename("fd"), on="customer_id")
coh["back"] = coh.index.isin(set(nxt[(nxt.d >= nxt.fd + pd.Timedelta(days=30)) & (nxt.d <= T)].customer_id))

W = B[(B.d >= START) & (B.d <= T)]


def metrics(b, c):
    n = len(b)
    if not n:
        return None
    kur = b[b.cats.apply(lambda x: "Kurta Set" in x)]
    shw = b[b.cats.apply(lambda x: "Sherwani" in x)]
    return {"bills": n, "sales": round(float(b.rev.sum())), "atv": round(float(b.rev.mean())), "ipb": round(float(b.units.mean()), 2),
            "discount": round(float(1 - b.rev.sum() / b.mrpv.sum()), 4),
            "jacket_attach": {"num": int(kur.cats.apply(lambda x: "Jacket" in x).sum()), "den": len(kur)},
            "sherwani_addon": {"num": int(shw.cats.apply(lambda x: bool({"Safa", "Mojari", "Mala"} & set(x))).sum()), "den": len(shw)},
            "repeat": {"num": int(c.back.sum()), "den": int(len(c))}}


out = {"as_of": str(T.date()), "window": [str(START.date()), str(T.date())], "people": {}, "stores": {}}
for store, g in W.groupby("store_id"):
    out["stores"][store] = metrics(g, coh[coh.store_id == store])
    n_people = g.salesperson_id.nunique()
    out["stores"][store]["people"] = int(n_people)
    for k in ["bills", "sales"]:
        out["stores"][store][f"{k}_per_person"] = round(out["stores"][store][k] / n_people)

r28 = roster[(roster.d > T - pd.Timedelta(days=28)) & (roster.d <= T)]
for p, row in sp.set_index("salesperson_id").iterrows():
    b = W[W.salesperson_id == p]
    if b.empty:
        continue
    m = metrics(b, coh[coh.salesperson_id == p])
    mine = r28[r28.salesperson_id == p]
    recent = b.sort_values("d", ascending=False).head(12)
    out["people"][p] = {"name": row["name"], "store_id": row.store_id, "join_date": row.join_date, "metrics": m,
                        "roster_28d": {"present": int((mine.status == "Present").sum()), "off": int((mine.status == "Off").sum())},
                        "recent_bills": [{"bill_id": i, "date": str(r.d.date()), "value": round(float(r.rev)), "items": int(r.units), "categories": r.cats}
                                         for i, r in recent.iterrows()]}
OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(len(out["people"]), "people;", OUT.stat().st_size, "bytes;", out["people"].get("SP1083", {}).get("metrics"))
