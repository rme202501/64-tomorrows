# 64 Tomorrows: WeatherNext 3 forecast uncertainty

Google WeatherNext 3 makes 64 forecasts for the same hours. This repo turns the spread between them into a
scrollytelling website for New England, plus the pipeline that produces its data.

Live site: https://rme202501.github.io/64-tomorrows/ · Source: `site/` · Data pipeline: `pipeline/`

## Assignment map (Prototype V1)

| Requirement | Where to find it |
| --- | --- |
| Team members | Henry Mattoni, Ryan Eto, Luke Tan. Listed in `docs/prototype/prototype_v1.html` (section 1) and in the process book. |
| Complete data pipeline (scraping and cleaning on real data) | `pipeline/` (`fetch_wn3_stats.py`, `fetch_time_machine.py`, `fetch_storm.py`, `build_web_data.py`, `build_extras.py`). Outputs: `site/data/` (`manifest.json`, `points.json`, `fields/*.bin`, `storm.json`, `time_machine.json`). See "Data pipeline and site" below. |
| Two functional D3 visualizations (data loading + rendering) | (1) Hook: `site/js/views/scrollyHook.js`. (2) Growth: `site/js/views/scrollyGrowth.js`. Both load data through `site/js/data.js` and draw with `site/js/chart.js`. |
| Additional visualization drafts (2–3, not yet built) | `docs/prototype/make_draft_figures.py` generates `draft_a_daily_rhythm.png` and `draft_b_jumps.png`. Draft C (`draft_c_caveat_strip.png`) is built as `site/js/views/scrollyCaveat.js`. |
| Website structure | `site/index.html` (page order and copy), `site/js/main.js` (lazy-loads each view), `site/css/style.css` (layout). |
| Clear storytelling | Step text in `site/index.html`; narrative in `docs/prototype/prototype_v1.html` section 2. |
| Novel view design | `site/js/views/scrollyHook.js` (one app-style number on the fan of 64 forecasts). Design and interaction notes in `docs/prototype/prototype_v1.html` sections 4a and 8. |
| Updated process book (incl. prototype documentation) | `docs/prototype/prototype_v1.html` and `.pdf` (new prototype pages). The full combined process book is in the submission zip. |
| Dashboards (Milestone 6) | `site/dashboards/` (`uncertainty/`, `planner/`). |

Shared helpers for scroll steps: `site/js/scrolly.js`. Classic views kept under "More views": `site/js/views/`.

## Run the site

```bash
python3 -m http.server 8731 --directory site
# open http://localhost:8731/
```

Pages deploys `site/` on every push to `main` (`.github/workflows/pages.yml`).

Draft figures (uses the real data in `site/data/`):

```bash
python3 docs/prototype/make_draft_figures.py
```

## Data pipeline and site (real WeatherNext 3 data)

Real Google WeatherNext 3 ensemble statistics (mean, p10-p90 of 64 members) for New England,
visualized as a D3 site in `site/`.

## Data pipeline

Requires `gcloud auth application-default login`. Only the free statistics bucket is used.

```bash
pip install -r requirements.txt
python3 pipeline/fetch_wn3_stats.py                      # latest 6-hourly run, ~63 GB streamed, ~80 MB kept
python3 pipeline/fetch_time_machine.py <run> --n 10      # same window from 10 older runs
python3 pipeline/fetch_storm.py <run>                    # wide-domain sea-level pressure
python3 pipeline/build_web_data.py data/wn3/<run>.nc     # -> site/data/ (~20 MB)
python3 pipeline/build_extras.py <run>                   # -> time machine + storm data
```

Downloads are resumable: cropped chunks are cached under `data/wn3/.cache/` until a run completes.

### Run the site (WN3 data)

```bash
python3 -m http.server --directory site 8731
```

Check-prep docs: `docs/walkthrough.md`, `docs/qa_prep.md`, `docs/process_book_m5.md`.


## Storyline

The site is a scrollytelling page that follows the Milestone 7 storyboard in four acts. Each act is a sticky chart
with step cards; scrolling changes what the chart shows:

* **Hook**: `scrollyHook`, one app-style number, then the fan of 64 forecasts it came from.
* **Rising insights**: `scrollyGrowth`, how the gap grows with lead time, place, the Tue 13 jump, and wind.
* **Main message**: `scrollyCaveat`, day-by-day spread against the 7 °F trust limit.
* **Solution**: `scrollyHorizon`, each town's trust horizon.

The shared step logic is in `site/js/scrolly.js`. Edit the copy in `site/index.html`. Classic views sit under Explore.

Draft designs are generated from the real data by `python3 docs/prototype/make_draft_figures.py`. The write-up is
`docs/prototype/prototype_v1.html`.
