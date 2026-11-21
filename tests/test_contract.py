"""Golden reconciliation tests against the supplied Manyavar pack.

Run from store-coach/:  python -m pytest tests -q
Needs the organiser data at manyavar-vch3-data/manyavar-vch3-data/csv (not committed).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "manyavar-vch3-data" / "manyavar-vch3-data" / "csv"
sys.path.insert(0, str(ROOT / "scripts"))
pytestmark = pytest.mark.skipif(not CSV.exists(), reason="organiser data not present")


@pytest.fixture(scope="module")
def pack():
    import contract
    return contract.load(CSV)


def test_no_join_inflation_and_clean_keys(pack):
    assert len(pack.bills) == 90805  # one row per bill after joining lines
    assert all(v == 0 for v in pack.rejected.values()), pack.rejected


def test_network_golden_window(pack):
    b = pack.bills[(pack.bills.d >= "2026-10-04") & (pack.bills.d <= "2026-10-31")]
    assert len(b) == 3735
    assert round(b.rev.sum()) == 34848213
    assert int(b.units.sum()) == 6759
    assert abs(b.units.sum() / len(b) - 1.8096385542) < 1e-9


def test_camera_mask_pat03(pack):
    days = sorted(d for s, d in pack.bad_days if s == "PAT-03")
    assert len(days) == 11
    n = pack.bills[[(s, d) in pack.bad_days for s, d in zip(pack.bills.store_id, pack.bills.d)]]
    assert len(n) == 24
    # sales keep those bills; conversion drops them from both sides
    import contract
    c = contract.conversion(pack.bills, pack.ff, ["PAT-03"], pd.Timestamp("2026-10-01"), pd.Timestamp("2026-10-31"))
    oct_bills = pack.bills[(pack.bills.store_id == "PAT-03") & (pack.bills.d >= "2026-10-01")]
    assert c["num"] == len(oct_bills) - 24


def test_repeat_golden(pack):
    import contract
    coh = contract.repeat_cohort(pack.bills, "2026-10-31", "2025-10-31")
    assert (int(coh.returned.sum()), len(coh)) == (4783, 40183)
    am01 = [s.strip() for s in pack.ams.set_index("area_manager_id").loc["AM-01", "stores"].split(",")]
    c1 = coh[coh.store_id.isin(am01)]
    assert (int(c1.returned.sum()), len(c1)) == (1188, 9988)


def test_sp1083_attach(pack):
    b = pack.bills[(pack.bills.salesperson_id == "SP1083") & (pack.bills.d >= "2026-08-03") & (pack.bills.d <= "2026-10-31")]
    kur = b[b.cats.apply(lambda c: "Kurta Set" in c)]
    shw = b[b.cats.apply(lambda c: "Sherwani" in c)]
    assert (int(kur.cats.apply(lambda c: "Jacket" in c).sum()), len(kur)) == (2, 57)
    assert (int(shw.cats.apply(lambda c: bool({"Safa", "Mojari", "Mala"} & c)).sum()), len(shw)) == (0, 5)


def test_published_repeat_has_explicit_fraction():
    d = json.loads((ROOT / "web" / "src" / "data" / "stores.json").read_text(encoding="utf-8"))
    r = d["scopes"]["AM-01"]["last28"]
    assert (r["repeat_num"], r["repeat_den"]) == (1188, 9988)
    n = d["scopes"]["network"]["last28"]
    assert (n["repeat_num"], n["repeat_den"]) == (4783, 40183)


@pytest.mark.slow
def test_no_future_leakage(tmp_path):
    """Recommendations for 24 Oct must be identical whether or not data after 24 Oct exists."""
    def run(env_cut, out):
        env = dict(os.environ)
        if env_cut:
            env["SUTRA_CUTOFF"] = env_cut
        subprocess.run([sys.executable, str(ROOT / "scripts" / "engine.py"), str(CSV), str(out), "2026-10-24"],
                       check=True, env=env, capture_output=True)
        r = json.loads(out.read_text(encoding="utf-8"))["runs"][0]
        for am in r["digest"].values():
            for i in am["issues"]:
                i.pop("follow_up", None)
        for c in r["cards"].values():
            c.pop("follow_up", None)
        r.pop("states", None) if False else None
        return r
    full = run(None, tmp_path / "full.json")
    cut = run("2026-10-24", tmp_path / "cut.json")
    assert full["digest"] == cut["digest"]
    assert full["cards"] == cut["cards"]
    assert full["flags"] == cut["flags"]
