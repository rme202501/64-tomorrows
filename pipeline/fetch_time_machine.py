"""Fetch older WeatherNext 3 runs that forecast the same future window.

For the "forecast time machine" view: each of the N runs before ANCHOR_RUN
is cropped to the valid times ANCHOR+VALID_START_H .. ANCHOR+VALID_END_H, so
the site can show how the forecast for one moment changed run by run.

Usage: python pipeline/fetch_time_machine.py 20261007_12hr_01_preds --n 10
"""

import argparse
import datetime as dt

import fetch_wn3_stats as f

VARIABLES = {
    "temperature_2m": ["mean", "p10", "p90"],
    "total_precipitation_1hr": ["mean", "p90"],
    "mean_sea_level_pressure": ["mean"],
}
VALID_START_H = 24
VALID_END_H = 96
STEP_H = 3
OUT_DIR = "data/wn3/time_machine"


def run_time(name):
    return dt.datetime.strptime(name[:11], "%Y%m%d_%H")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("anchor_run")
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()

    anchor = run_time(args.anchor_run)
    for back in range(0, args.n + 1):
        init = anchor - dt.timedelta(hours=6 * back)
        name = f"{init:%Y%m%d_%H}hr_01_preds"
        leads = [h + 6 * back for h in range(VALID_START_H, VALID_END_H + 1, STEP_H)]
        f.fetch_run(name, VARIABLES, args.workers, leads=leads, out_dir=OUT_DIR)


if __name__ == "__main__":
    main()
