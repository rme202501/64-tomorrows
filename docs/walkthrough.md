# Milestone 5 walkthrough (3-4 minutes)

Screen: process book in one tab, the site (`site/`, served locally or on GitHub Pages) in another.
Each section is about 50-60 seconds. Every member should be able to give any section.

## 1. Topic and story - Henry (about 50 s)

- Weather forecasts are presented as one number ("high of 64"), but modern forecasts are really
  **many possible futures**. Google's WeatherNext 3 runs **64 versions** of every forecast.
- Our story: *one forecast is really 64 possible tomorrows*. We use the disagreement between
  them to answer everyday questions, and to show how far ahead each answer can be trusted.
- Audience: the general public first (process book, Audience option 1), with a few deeper,
  explorable views for "weather nerds" at the end.
- Show: the site hero section and the three parts: *Your day*, *How sure is the forecast?*, *Explore*.

## 2. The data - Ryan (about 60 s)

- Source: **Google WeatherNext 3**, an AI weather model. We use the free **ensemble statistics**
  bucket: for each variable, the **mean and the 10th, 25th, 50th, 75th and 90th percentiles**
  across the 64 members.
- What it contains: hourly forecasts out to 15 days on a 0.1° grid (about 11 km), covering
  temperature, dewpoint, rain, cloud cover, wind, sea-level pressure and solar radiation.
  No pressure levels (that ruled out one sketch idea).
- What we downloaded: the 7 October 12Z run, cropped to New England (40-48°N, 80-66°W), 7 days.
  We also took the same window from 10 older runs (forecast time machine) and a wide North
  Atlantic pressure field (storm tracking).
- Quirk: the data is stored as whole-globe maps, so cropping New England means downloading
  about 63 GB. Our Python pipeline (`pipeline/`) crops it and compresses it to **about 25 MB** for the browser.
- Show: `pipeline/fetch_wn3_stats.py` and `site/data/manifest.json`.

## 3. Key questions - Luke (about 50 s)

Everyday (Part 1):
1. What will the temperature be over the next two days, and how sure is that?
2. What will it feel like outside, and what can I do (run, bike, beach, picnic)?
3. What does a day of cloud cover look like?
4. Will there be freezing precipitation this week?

How sure (Part 2):
5. How fast does the uncertainty grow?
6. How many days ahead can I trust the forecast where I live?
7. What does "40% chance" actually mean?

Explore (Part 3): which way is the wind blowing, how did the forecast change run to run, where
could a storm go, and when should I leave for my trip?

## 4. Sketches we chose and why - Ryan / Henry / Luke (about 60 s)

- From 15 sketches we kept **9, 1, 10, 14 and 15**, the top of our usefulness-for-the-public ranking:
  - **#1** temperature with spread (Henry),
  - **#9** feels-like and activity map (Ryan),
  - **#10** cloud cover (Ryan),
  - **#14** freezing precipitation with ice-on-the-ground carry-over (Luke),
  - **#15** P10-P90 range over time (Luke).
- Why: each answers one decision ("can I go for a run at 3 pm?") rather than showing data for
  its own sake. This was Luke's "data is visualized to be understood, and understood to be acted on".
- New since the sketches: four views built around uncertainty:
  - the **fog map**, where uncertainty literally looks like fog,
  - the **trust horizon**,
  - **forecast roulette**, which teaches probability by spinning possible futures,
  - the **time machine**, plus a **storm cone** and **route planner** for exploration.
- Close with the open questions for the TF (see `qa_prep.md`).
