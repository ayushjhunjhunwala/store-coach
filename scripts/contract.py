"""Shared metric and data-quality contract for SUTRA.

Every script (engine, store metrics, salesperson metrics, tests) uses these definitions so the
dashboard, detector, coach card and follow-up all count the same population.

- Money includes GST. Line revenue = qty * selling_price. Bill value = sum of its lines.
- Product units exclude packaging rows (is_packaging == "1"); packaging is Rs 0 so revenue is unaffected.
- Camera-fault store-day: footfall == 0 while the store billed. Conversion excludes those store-days from BOTH
  numerator (bills) and denominator (footfall). Sales metrics keep those bills.
- Repeat: customer's first observed bill (network-wide) on or before `cohort_end`; "returned" = any network bill
  at least 30 days after that first bill and on or before `as_of`. Numerator and denominator are stored explicitly.
- `cutoff` (optional) drops every row dated after it, to prove recommendations never use later data.
"""
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

REPEAT_GAP_DAYS = 30


@dataclass
class Pack:
    stores: pd.DataFrame
    ams: pd.DataFrame
    items: pd.DataFrame
    sp: pd.DataFrame
    bills: pd.DataFrame        # one row per bill, with units/rev/mrpv/cats (product lines only)
    prod: pd.DataFrame         # product (non-packaging) bill lines joined to bills
    ff: pd.DataFrame           # footfall_daily with d
    roster: pd.DataFrame
    stock_w: pd.DataFrame
    bad_days: set              # {(store_id, Timestamp)} camera-fault store-days
    rejected: dict             # join/validation problems, counted not hidden


def load(csv_dir, cutoff=None):
    c = Path(csv_dir)
    rd = lambda n: pd.read_csv(c / f"{n}.csv", dtype=str)
    stores, ams, items, sp = rd("stores"), rd("area_managers"), rd("items"), rd("salespeople")
    bills, lines, ff, roster, stock_w = rd("bills"), rd("bill_lines"), rd("footfall_daily"), rd("roster_daily"), rd("stock_weekly")
    bills["d"] = pd.to_datetime(bills.bill_date)
    ff["d"] = pd.to_datetime(ff.date)
    roster["d"] = pd.to_datetime(roster.date)
    stock_w["d"] = pd.to_datetime(stock_w.week_ending)
    if cutoff is not None:
        cut = pd.Timestamp(cutoff)
        bills = bills[bills.d <= cut]
        ff = ff[ff.d <= cut]
        roster = roster[roster.d <= cut]
        stock_w = stock_w[stock_w.d <= cut]
        lines = lines[lines.bill_id.isin(bills.bill_id)]
    ff["footfall"] = ff.footfall.astype(int)
    roster["present"] = (roster.status == "Present").astype(int)
    stock_w["on_hand"] = stock_w.closing_on_hand.astype(int)
    lines = lines.copy()
    lines["qty"] = lines.qty.astype(int)
    lines["mrp"] = lines.mrp.astype(float)
    lines["sp"] = lines.selling_price.astype(float)
    rejected = {"bill_lines_unknown_sku": int((~lines.sku_id.isin(items.sku_id)).sum()),
                "bill_lines_unknown_bill": int((~lines.bill_id.isin(bills.bill_id)).sum()),
                "bills_unknown_store": int((~bills.store_id.isin(stores.store_id)).sum())}
    lines = lines.merge(items[["sku_id", "category", "is_packaging"]], on="sku_id", how="inner")
    prod = lines[lines.is_packaging != "1"].copy()
    prod["rev"] = prod.qty * prod.sp
    prod["mrpv"] = prod.qty * prod.mrp
    bt = prod.groupby("bill_id").agg(units=("qty", "sum"), rev=("rev", "sum"), mrpv=("mrpv", "sum"),
                                     cats=("category", lambda x: frozenset(x)))
    rejected["bills_without_product_lines"] = int((~bills.bill_id.isin(bt.index)).sum())
    B = bills.set_index("bill_id").join(bt, how="inner")
    B["weekday"] = B.d.dt.day_name()
    prod = prod.merge(bills[["bill_id", "d", "store_id", "salesperson_id", "customer_id"]], on="bill_id")
    stock_w = stock_w.merge(items[["sku_id", "category"]], on="sku_id")
    bad = camera_fault_days(B, ff)
    B["camera_ok"] = [(s, d) not in bad for s, d in zip(B.store_id, B.d)]
    ff["camera_ok"] = [(s, d) not in bad for s, d in zip(ff.store_id, ff.d)]
    stores = stores.copy()
    stores["opened"] = pd.to_datetime(stores.opened_on)
    return Pack(stores, ams, items, sp, B, prod, ff, roster, stock_w, bad, rejected)


def camera_fault_days(B, ff):
    """The ONE camera mask: a store-day with 0 counted walk-ins but at least one bill."""
    per_day = B.groupby(["store_id", "d"]).size()
    z = ff[ff.footfall == 0]
    return {(s, d) for s, d in zip(z.store_id, z.d) if per_day.get((s, d), 0) > 0}


def conversion(B, ff, stores_ids, start, end):
    """Eligible bills / footfall on the same eligible (non-fault) store-days."""
    b = B[B.store_id.isin(stores_ids) & (B.d >= start) & (B.d <= end) & B.camera_ok]
    f = ff[ff.store_id.isin(stores_ids) & (ff.d >= start) & (ff.d <= end) & ff.camera_ok]
    num, den = len(b), int(f.footfall.sum())
    return {"num": num, "den": den, "rate": (num / den) if den else None}


def repeat_cohort(B, as_of, cohort_end, store_ids=None, by=None):
    """First observed bill per customer on or before cohort_end; returned = another bill >= 30 days later, <= as_of.

    Returns a DataFrame indexed by customer with first-bill store/salesperson and a boolean `returned`.
    """
    as_of, cohort_end = pd.Timestamp(as_of), pd.Timestamp(cohort_end)
    hist = B[B.d <= as_of].reset_index().sort_values(["d", "bill_id"])
    first = hist.groupby("customer_id").first()
    coh = first[first.d <= cohort_end].copy()
    later = hist[hist.customer_id.isin(coh.index)][["customer_id", "d"]].join(coh.d.rename("fd"), on="customer_id")
    returned = set(later[later.d >= later.fd + pd.Timedelta(days=REPEAT_GAP_DAYS)].customer_id)
    coh["returned"] = coh.index.isin(returned)
    if store_ids is not None:
        coh = coh[coh.store_id.isin(store_ids)]
    return coh


def frac(num, den):
    return {"num": int(num), "den": int(den), "rate": (num / den) if den else None}
