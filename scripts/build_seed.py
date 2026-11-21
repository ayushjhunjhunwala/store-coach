"""Build the verified PAT-02 Kurta Set -> Jacket case seed from the Manyavar CSVs.

Usage: python scripts/build_seed.py <path-to-csv-folder> <out.json>
All numbers in the output are computed here from the raw CSVs; nothing is typed in by hand.
"""
import json
import sys
from pathlib import Path

import pandas as pd

CSV = Path(sys.argv[1])
OUT = Path(sys.argv[2])
STORE, START, END = "PAT-02", "2026-08-01", "2026-10-31"
BASE, ADDON = "Kurta Set", "Jacket"


def rd(name):
    return pd.read_csv(CSV / f"{name}.csv", dtype=str)


bills, lines, items, sp, stock, stores = (rd(n) for n in
    ["bills", "bill_lines", "items", "salespeople", "stock_snapshot", "stores"])
lines["qty"] = lines["qty"].astype(int)
lines["selling_price"] = lines["selling_price"].astype(float)
lines = lines.merge(items[["sku_id", "category", "is_packaging"]], on="sku_id")
lines = lines[lines["is_packaging"] != "1"]

b = bills[(bills.store_id == STORE) & (bills.bill_date >= START) & (bills.bill_date <= END)]
cats = lines[lines.bill_id.isin(b.bill_id)].groupby("bill_id")["category"].agg(set)
b = b.set_index("bill_id").join(cats.rename("cats")).dropna(subset=["cats"])
q = b[b.cats.apply(lambda c: BASE in c)].copy()
q["has_addon"] = q.cats.apply(lambda c: ADDON in c)

per = q.groupby("salesperson_id")["has_addon"].agg(["sum", "count"]).reset_index()
per.columns = ["salesperson_id", "with_addon", "eligible_bills"]
per = per.merge(sp[["salesperson_id", "name"]], on="salesperson_id")
per["rate"] = per.with_addon / per.eligible_bills
MIN_N = 30
ranked = per[per.eligible_bills >= MIN_N].sort_values("rate")
focus = ranked.iloc[0]
role = ranked.iloc[-1]
others = q[q.salesperson_id != focus.salesperson_id]
peer_rate = others.has_addon.mean()

jl = lines[(lines.category == ADDON) & lines.bill_id.isin(b.index)]
jacket_price = (jl.qty * jl.selling_price).sum() / jl.qty.sum()
extra_bills = (peer_rate - focus.rate) * focus.eligible_bills

st = stock[(stock.location_id == STORE)].merge(items[["sku_id", "category", "size"]], on="sku_id")
st["on_hand"] = st.on_hand.astype(int)
js = st[(st.category == ADDON) & (st.on_hand > 0)]

focus_bills = q[q.salesperson_id == focus.salesperson_id]
store_row = stores[stores.store_id == STORE].iloc[0].to_dict()

seed = {
    "case_id": "PAT-02-KURTA-JACKET-92D",
    "data_as_of": END,
    "window": {"start": START, "end": END, "days": 92, "kind": "historical 92-day showcase (not the 28-day detector)"},
    "store": {k: store_row[k] for k in ["store_id", "city", "state", "zone", "tier", "area_manager_id"]},
    "lever": "Bigger baskets",
    "behaviour": f"Attach a {ADDON.lower()} to {BASE.lower()} bills",
    "rule": f"Eligible bill = bill at {STORE} in window containing >=1 non-packaging {BASE} line; success = bill also contains a {ADDON} line. Min sample per salesperson = {MIN_N}.",
    "focus": {"salesperson_id": focus.salesperson_id, "name": focus["name"], "with_addon": int(focus.with_addon),
              "eligible_bills": int(focus.eligible_bills), "rate": round(float(focus.rate), 4),
              "bills_with_addon": sorted(focus_bills[focus_bills.has_addon].index.tolist()),
              "bills_without_addon": sorted(focus_bills[~focus_bills.has_addon].index.tolist())},
    "role_model": {"salesperson_id": role.salesperson_id, "name": role["name"], "with_addon": int(role.with_addon),
                   "eligible_bills": int(role.eligible_bills), "rate": round(float(role.rate), 4)},
    "peers_excluding_focus": {"with_addon": int(others.has_addon.sum()), "eligible_bills": int(len(others)),
                              "rate": round(float(peer_rate), 4)},
    "all_salespeople": per.sort_values("rate").assign(rate=lambda d: d.rate.round(4)).to_dict("records"),
    "stock_at_cutoff": {"as_of": "2026-10-31", "category": ADDON, "units_on_hand": int(js.on_hand.sum()),
                        "skus_on_hand": int(len(js)),
                        "by_size": js.groupby("size").on_hand.sum().astype(int).to_dict(),
                        "caveat": "Stock is the 31 Oct close snapshot; a customer's exact size must still be checked."},
    "scenario": {"label": "Hypothetical scenario, not guaranteed recovery or proof of cause",
                 "assumption": "Focus salesperson's attach rate rises to the same-store peer rate over the same eligible bills",
                 "extra_bills_with_addon": round(float(extra_bills), 2),
                 "avg_addon_selling_price": round(float(jacket_price), 2),
                 "hypothetical_sales_inr": round(float(extra_bills * jacket_price))},
    "follow_up": {"status": "Pending / Not measurable",
                  "reason": "Data ends 31 Oct 2026; no following 7 days exist in the dataset."},
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(seed, indent=2, default=str))
print(json.dumps({k: seed[k] for k in ["focus", "role_model", "peers_excluding_focus", "stock_at_cutoff", "scenario"]}, default=str)[:2500])
