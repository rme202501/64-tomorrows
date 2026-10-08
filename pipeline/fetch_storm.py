"""Fetch sea-level pressure statistics over a wide domain for the storm cone.

Lows that affect New England form well outside the main box, so this pulls
mean / p10 / p90 MSLP over eastern North America and the western Atlantic,
6-hourly out to 7 days.

Usage: python pipeline/fetch_storm.py 20261007_12hr_01_preds
"""

import sys

import fetch_wn3_stats as f

f.LAT_MIN, f.LAT_MAX = 25.0, 60.0
f.LON_MIN, f.LON_MAX = -100.0, -45.0

if __name__ == "__main__":
    f.fetch_run(sys.argv[1], {"mean_sea_level_pressure": ["mean", "p10", "p90"]}, 12,
                leads=list(range(6, 169, 6)), out_dir="data/wn3/storm")
