"""Narrow terminal dashboard for fetch_wn3_stats.py (reads its log)."""

import os
import re
import shutil
import subprocess
import sys
import time

LOG = sys.argv[1]
PAT = re.compile(r"(\S+) (\d+)/(\d+) chunks \((\d+)%\) eta (\d+) min")
CHUNK_MB = 21


def bar(frac, width):
    n = int(round(frac * width))
    return "█" * n + "░" * (width - n)


def main():
    t0 = time.time()
    last_pct = None
    while True:
        cols, rows = shutil.get_terminal_size()
        lines = open(LOG).read().splitlines() if os.path.exists(LOG) else []
        prog = [m for m in map(PAT.search, lines) if m]
        wrote = [l for l in lines if l.startswith("wrote")]
        errs = [l for l in lines if "Error" in l or "Traceback" in l]
        out = ["WeatherNext 3 stats fetch", "-" * min(cols, 40)]
        if prog:
            run, done, total, pct, eta = prog[-1].groups()
            done, total = int(done), int(total)
            out += [
                f"run   {run}",
                f"chunk {done}/{total}  ({pct}%)",
                f"data  ~{done * CHUNK_MB / 1000:.1f} / {total * CHUNK_MB / 1000:.1f} GB",
                f"eta   {eta} min   elapsed {(time.time() - t0) / 60:.0f} min",
                bar(done / total, max(cols - 2, 10)),
            ]
            if pct != last_pct:
                subprocess.run(["herdr-job", "progress", f"{pct}% eta {eta}m"],
                               capture_output=True)
                last_pct = pct
        else:
            out.append("starting...")
        out += [""] + wrote[-5:] + errs[-3:]
        out = [l[:cols] for l in out][:rows - 1]
        sys.stdout.write("\033[H\033[J" + "\n".join(out) + "\n")
        sys.stdout.flush()
        time.sleep(3)


if __name__ == "__main__":
    main()
