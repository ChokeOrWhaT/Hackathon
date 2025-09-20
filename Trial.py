# earthquake_services.py
"""
Earthquake service (complete, patched)

Features:
- Polls NCS (India) JSON feed and USGS GeoJSON feed periodically
- Persists deduplicated events to a local CSV
- Loads catalog safely (fixed datetime handling)
- Estimates Mc (max-curvature), b-value (MLE), bootstrap CI
- Simple declustering for background rate estimation
- ETAS-like short-term multiplier (pragmatic)
- Flask API with /predict and /status
- Background poller and model recompute thread

NOTES:
- This is a prototype. Treat outputs as experimental probabilistic estimates.
- Tune parameters (poll interval, MIN_MAG_FOR_STORAGE, ETAS params) for your needs.
"""

import os
import time
import threading
import csv
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
import requests
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from waitress import serve

# -------------------------
# Config
# -------------------------
CSV_FILE = "live_catalog.csv"
POLL_INTERVAL = 300  # seconds
NCS_1DAY_URL = "https://seismo.gov.in/sites/default/files/eqjson.json"
NCS_7DAY_URL = "https://seismo.gov.in/sites/default/files/eqjson7days.json"
USGS_FEEDS = [
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
]
MIN_MAG_FOR_STORAGE = 2.5
DEFAULT_TIME_WINDOW_YEARS = 5.0
BOOTSTRAP_SAMPLES = 500  # lower for speed; increase for better CI

# ETAS-like multiplier params (pragmatic)
ETAS_PARAMS = {"K": 0.05, "alpha": 1.0, "p": 1.0, "c": 0.01, "Mref": 4.0}

# -------------------------
# Utilities
# -------------------------
def now_utc():
    return datetime.now(timezone.utc)

def haversine_km(lat1, lon1, lat2, lon2):
    # returns distance in km
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2.0) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2.0) ** 2
    c = 2 * asin(sqrt(a))
    return R * c

def ensure_csv():
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["id", "time_iso", "mag", "lat", "lon", "depth_km", "place", "src"])

# -------------------------
# Parsers for feeds
# -------------------------
def parse_ncs_json(j):
    events = []
    for feat in j.get("features", []):
        try:
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [None, None, None])
            props = feat.get("properties", {})
            # NCS properties can give "time" (epoch ms) or ISO "time"
            t = props.get("time") or props.get("originTime") or props.get("origin_time") or props.get("time_iso")
            if isinstance(t, (int, float)):
                t_iso = datetime.fromtimestamp(t / 1000.0, tz=timezone.utc).isoformat()
            else:
                # try parse string; let pandas handle it later too
                t_iso = t
            mag = props.get("mag") or props.get("magnitude")
            place = props.get("place") or props.get("region") or ""
            events.append({
                "id": props.get("id") or f"ncs_{t_iso}_{coords[1]}_{coords[0]}",
                "time_iso": t_iso,
                "mag": mag,
                "lat": coords[1],
                "lon": coords[0],
                "depth_km": coords[2] if len(coords) > 2 else None,
                "place": place,
                "src": "NCS"
            })
        except Exception:
            continue
    return events

def parse_usgs_geojson(j):
    events = []
    for feat in j.get("features", []):
        try:
            eid = feat.get("id")
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [None, None, None])
            t_ms = props.get("time")
            if t_ms is None:
                continue
            t_iso = datetime.fromtimestamp(t_ms / 1000.0, tz=timezone.utc).isoformat()
            mag = props.get("mag")
            place = props.get("place", "")
            events.append({
                "id": eid,
                "time_iso": t_iso,
                "mag": mag,
                "lat": coords[1],
                "lon": coords[0],
                "depth_km": coords[2] if len(coords) > 2 else None,
                "place": place,
                "src": "USGS"
            })
        except Exception:
            continue
    return events

import pandas as pd
import numpy as np

# CSV file path
CSV_FILE = "your_file.csv"

# -------------------------------
# 1️⃣ Read CSV with explicit datetime parsing
# -------------------------------
def parse_time_iso(x):
    # ISO format example: "2025-09-19T12:34:56Z"
    try:
        return pd.to_datetime(x, format="%Y-%m-%dT%H:%M:%SZ", errors="coerce", utc=True)
    except Exception:
        return pd.NaT

df = pd.read_csv(
    CSV_FILE,
    dtype={"id": str},
    parse_dates=["time_iso"],
    date_parser=parse_time_iso
)

# -------------------------------
# 2️⃣ Convert 'datetime' column explicitly
# -------------------------------
def parse_datetime_col(x):
    # Standard format example: "2025-09-19 12:34:56"
    try:
        return pd.to_datetime(x, format="%Y-%m-%d %H:%M:%S", errors="coerce", utc=True)
    except Exception:
        return pd.NaT

df["datetime"] = pd.to_datetime(df["datetime"].astype(str), format="%Y-%m-%d %H:%M:%S", errors="coerce", utc=True)

# -------------------------------
# 3️⃣ Example preprocessing (keep your previous logic)
# -------------------------------
# Fill missing IDs with a placeholder
df["id"].fillna("unknown", inplace=True)

# Handle missing datetime values
df["datetime"].fillna(pd.Timestamp.now(tz='UTC'), inplace=True)

# Example: create a new column for day of week
df["day_of_week"] = df["datetime"].dt.day_name()

# -------------------------------
# 4️⃣ Example filtering / checks (keep your previous logic)
# -------------------------------
# Remove rows with invalid time_iso
df = df.dropna(subset=["time_iso"])

# Example: filter rows for a particular condition
high_magnitude = df[df["magnitude"] > 5.0] if "magnitude" in df.columns else df

# -------------------------------
# 5️⃣ Example output / preview
# -------------------------------
print("Data preview:")
print(df.head())

print("\nHigh magnitude events:")
print(high_magnitude.head())


# -------------------------
# Fetch & persist
# -------------------------
def _append_events(events, existing_ids):
    new_count = 0
    with open(CSV_FILE, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        for ev in events:
            if ev["id"] in existing_ids:
                continue
            if ev["mag"] is None:
                continue
            try:
                magf = float(ev["mag"])
            except Exception:
                continue
            if magf < MIN_MAG_FOR_STORAGE:
                continue
            # time_iso might be string or datetime; write iso string
            t = ev["time_iso"]
            if isinstance(t, datetime):
                t_iso = t.astimezone(timezone.utc).isoformat()
            else:
                t_iso = t
            w.writerow([ev["id"], t_iso, ev["mag"], ev["lat"], ev["lon"], ev["depth_km"], ev["place"], ev.get("src", "")])
            existing_ids.add(ev["id"])
            new_count += 1
    return new_count

def fetch_and_persist():
    ensure_csv()
    # read existing ids
    existing = set()
    with open(CSV_FILE, "r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if row:
                existing.add(row[0])

    new_total = 0
    # Fetch NCS (1-day)
    try:
        r = requests.get(NCS_1DAY_URL, timeout=15)
        r.raise_for_status()
        ncs = r.json()
        events = parse_ncs_json(ncs)
        new_total += _append_events(events, existing)
    except Exception as e:
        # try 7-day fallback
        try:
            r = requests.get(NCS_7DAY_URL, timeout=15)
            r.raise_for_status()
            ncs = r.json()
            events = parse_ncs_json(ncs)
            new_total += _append_events(events, existing)
        except Exception:
            pass

    # Fetch USGS feeds
    for url in USGS_FEEDS:
        try:
            r = requests.get(url, timeout=15)
            r.raise_for_status()
            usgs = r.json()
            events = parse_usgs_geojson(usgs)
            new_total += _append_events(events, existing)
        except Exception:
            continue

    if new_total:
        print(f"[{now_utc().isoformat()}] Persisted {new_total} new events")
    return new_total

def poller_loop():
    while True:
        try:
            fetch_and_persist()
        except Exception as e:
            print("Poller error:", e)
        time.sleep(POLL_INTERVAL)

# -------------------------
# Catalog loader (patched)
# -------------------------
def load_catalog():
    ensure_csv()
    try:
        df = pd.read_csv(CSV_FILE, parse_dates=["time_iso"], dtype={"id": str})
    except Exception:
        # fallback: read without parse and coerce later
        df = pd.read_csv(CSV_FILE, dtype={"id": str})

    if df.empty:
        return df

    # rename time_iso to datetime
    if "time_iso" in df.columns:
        df = df.rename(columns={"time_iso": "datetime"})
    else:
        # in case file has different schema
        if "datetime" not in df.columns:
            raise RuntimeError("CSV missing datetime/time_iso column")

    # convert to datetime (timezone-aware UTC). errors -> NaT
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce", utc=True)

    # drop rows where datetime parsing failed
    df = df.dropna(subset=["datetime"])

    # keep numeric columns numeric
    for c in ["mag", "lat", "lon", "depth_km"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # drop rows missing essential fields
    df = df.dropna(subset=["mag", "lat", "lon", "datetime"])

    # sort and dedupe by id (keep last)
    if "id" in df.columns:
        df = df.sort_values("datetime").drop_duplicates(subset=["id"], keep="last")
    df = df.sort_values("datetime").reset_index(drop=True)
    return df

# -------------------------
# Statistical utilities
# -------------------------
def estimate_Mc_maxcurvature(mags, binwidth=0.1):
    if len(mags) == 0:
        return None
    bins = np.arange(np.floor(mags.min()), np.ceil(mags.max()) + binwidth, binwidth)
    hist, edges = np.histogram(mags, bins=bins)
    if hist.size == 0:
        return None
    idx_max = np.argmax(hist)
    Mc = edges[idx_max]
    return round(float(Mc), 2)

def b_value_MLE(mags, Mc, dM=0.1):
    mags_cut = mags[mags >= Mc]
    n = len(mags_cut)
    if n < 5:
        return None
    mean_mag = mags_cut.mean()
    b = np.log10(np.e) / (mean_mag - Mc + dM / 2.0)
    sigma_b = (2.30 * b ** 2) / np.sqrt(n)
    return float(b), float(sigma_b), int(n)

def bootstrap_b_ci(mags, Mc, n_boot=BOOTSTRAP_SAMPLES, seed=0):
    mags_cut = mags[mags >= Mc]
    n = len(mags_cut)
    if n < 10:
        return None
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(n_boot):
        sample = rng.choice(mags_cut, size=n, replace=True)
        mean_mag = sample.mean()
        dM = 0.1
        b = np.log10(np.e) / (mean_mag - Mc + dM / 2.0)
        bs.append(b)
    bs = np.array(bs)
    return float(np.percentile(bs, 2.5)), float(np.percentile(bs, 50)), float(np.percentile(bs, 97.5))

# -------------------------
# Simple decluster
# -------------------------
def simple_decluster(df):
    if df.empty:
        return df
    df = df.sort_values("datetime").reset_index(drop=True)
    keep_idx = []
    removed = np.zeros(len(df), dtype=bool)
    for i, row in df.iterrows():
        if removed[i]:
            continue
        keep_idx.append(i)
        t0 = row["datetime"]
        mag = row["mag"]
        tw_days = 7 * (1.0 if mag < 5.0 else 2.0 * (mag - 4.0))
        dk_km = 50 * (1.0 if mag < 5.0 else 2.0 * (mag - 4.0))
        j = i + 1
        while j < len(df):
            if removed[j]:
                j += 1
                continue
            if df.at[j, "datetime"] > t0 + timedelta(days=tw_days):
                break
            d = haversine_km(row["lat"], row["lon"], df.at[j, "lat"], df.at[j, "lon"])
            if d <= dk_km and df.at[j, "mag"] <= mag:
                removed[j] = True
            j += 1
    return df.loc[keep_idx].reset_index(drop=True)

# -------------------------
# ETAS-like multiplier
# -------------------------
def etas_multiplier(at_time, triggers, params=ETAS_PARAMS):
    if not triggers:
        return 1.0
    total = 0.0
    for ev in triggers:
        dt_days = max((at_time - ev["time"]).total_seconds() / 86400.0, 0.0)
        total += params["K"] * 10 ** (params["alpha"] * (ev["mag"] - params["Mref"])) * (dt_days + params["c"]) ** (-params["p"])
    return 1.0 + total

# -------------------------
# Model class
# -------------------------
class EarthquakeModel:
    def __init__(self):
        self.last_update = None
        self.b = None
        self.b_sigma = None
        self.b_ci = None
        self.Mc = None
        self.N = 0
        self.a = None
        self.catalog_span_years = None
        self.triggers = []
        # initial compute
        self.recompute()

    def recompute(self, use_years=DEFAULT_TIME_WINDOW_YEARS):
        df = load_catalog()
        if df.empty:
            self._reset()
            return

        # restrict to recent years for fitting but keep full for triggers
        endtime = df["datetime"].max()
        starttime = endtime - pd.Timedelta(days=int(use_years * 365.25))
        df_fit = df[(df["datetime"] >= starttime) & (df["datetime"] <= endtime)].copy()
        if df_fit.empty:
            df_fit = df.copy()
        mags = df_fit["mag"].dropna().astype(float).values
        if len(mags) == 0:
            self._reset()
            return

        Mc = estimate_Mc_maxcurvature(mags)
        if Mc is None:
            Mc = float(np.min(mags))
        self.Mc = Mc

        # decluster for background estimation
        df_fit_sorted = df_fit.sort_values("datetime").reset_index(drop=True)
        df_decl = simple_decluster(df_fit_sorted)
        mags_decl = df_decl["mag"].dropna().astype(float).values

        mags_for_b = mags_decl[mags_decl >= Mc]
        if len(mags_for_b) < 5:
            mags_for_b = np.array(mags[mags >= Mc])

        b_result = b_value_MLE(mags_for_b, Mc) if len(mags_for_b) > 0 else None
        if b_result is None:
            self._reset()
            return

        b, sigma_b, n = b_result
        self.b = b
        self.b_sigma = sigma_b
        self.N = n

        # a-value from number of events >= Mc over period (use declustered counts)
        N_for_a = int(np.sum(mags_decl >= Mc))
        years = (df_fit["datetime"].max() - df_fit["datetime"].min()).days / 365.25
        if years <= 0:
            years = use_years
        self.catalog_span_years = years
        self.a = np.log10(N_for_a / years) + self.b * Mc if N_for_a > 0 else None
        self.b_ci = bootstrap_b_ci(np.array(mags_for_b), Mc) if len(mags_for_b) >= 10 else None
        self.last_update = now_utc()

        # triggers: recent large events from last 30 days
        recent_window = df[df["datetime"] >= df["datetime"].max() - pd.Timedelta(days=30)]
        triggers = []
        for _, r in recent_window.iterrows():
            mag = float(r["mag"])
            if mag >= ETAS_PARAMS["Mref"]:
                triggers.append({"time": r["datetime"].to_pydatetime(), "mag": mag})
        self.triggers = triggers

    def _reset(self):
        self.last_update = now_utc()
        self.b = None
        self.b_sigma = None
        self.b_ci = None
        self.Mc = None
        self.N = 0
        self.a = None
        self.catalog_span_years = 0
        self.triggers = []

    def predict_probability(self, lat, lon, M0=5.5, time_window_days=30, radius_km=500, use_etas=True):
        df = load_catalog()
        if df.empty or self.a is None or self.b is None:
            return {"probability": 0.0, "reason": "no_data_or_model_unfit"}

        # spatial filter
        df_local = df.copy()
        df_local["dist_km"] = df_local.apply(lambda r: haversine_km(lat, lon, r["lat"], r["lon"]), axis=1)
        df_local = df_local[df_local["dist_km"] <= radius_km]
        if df_local.empty:
            a_reg, b_reg = self.a, self.b
        else:
            mags_local = df_local["mag"].dropna().astype(float).values
            Mc_local = estimate_Mc_maxcurvature(mags_local) or self.Mc
            b_local_res = b_value_MLE(mags_local[mags_local >= Mc_local], Mc_local) if len(mags_local) >= 5 else None
            if b_local_res:
                b_local, _, n_local = b_local_res
                a_local = np.log10(np.sum(mags_local >= Mc_local) / self.catalog_span_years) + b_local * Mc_local
                a_reg, b_reg = a_local, b_local
            else:
                a_reg, b_reg = self.a, self.b

        if a_reg is None or b_reg is None:
            return {"probability": 0.0, "reason": "no_ab"}

        R_yr = 10 ** (a_reg - b_reg * M0)

        multiplier = 1.0
        if use_etas and self.triggers:
            multiplier = etas_multiplier(now_utc(), self.triggers, ETAS_PARAMS)
            R_yr *= multiplier

        T = float(time_window_days)
        prob = 1.0 - np.exp(-R_yr * (T / 365.25))
        return {
            "probability": float(prob),
            "probability_pct": float(prob * 100.0),
            "R_yr": float(R_yr),
            "multiplier": float(multiplier),
            "a": float(a_reg) if a_reg is not None else None,
            "b": float(b_reg) if b_reg is not None else None,
            "Mc": float(self.Mc) if self.Mc is not None else None,
            "N": int(self.N),
            "last_update": self.last_update.isoformat() if self.last_update else None
        }

# -------------------------
# Flask API
# -------------------------
app = Flask(__name__)
CORS(app)
model = EarthquakeModel()

@app.route("/predict", methods=["POST"])
def predict_route():
    data = request.get_json(force=True)
    lat = data.get("lat")
    lon = data.get("lon")
    M0 = data.get("magnitude", 5.5)
    time_window = data.get("timeWindowDays", 30)
    radius = data.get("radiusKm", 500)
    if lat is None or lon is None:
        return jsonify({"error": "missing lat/lon"}), 400
    try:
        # light recompute to pick up recent data; in heavy systems do periodic recompute only
        model.recompute()
        res = model.predict_probability(lat, lon, M0=M0, time_window_days=time_window, radius_km=radius)
        return jsonify({"success": True, "result": res})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/status", methods=["GET"])
def status_route():
    model.recompute()
    return jsonify({
        "last_update": model.last_update.isoformat() if model.last_update else None,
        "a": model.a,
        "b": model.b,
        "b_sigma": model.b_sigma,
        "b_ci": model.b_ci,
        "Mc": model.Mc,
        "N": model.N,
        "catalog_span_years": model.catalog_span_years,
        "recent_triggers": model.triggers
    })

# -------------------------
# Background poller + recompute
# -------------------------
def background_worker():
    print("Starting poller thread (fetching NCS + USGS every {}s)".format(POLL_INTERVAL))
    # initial fetch & compute
    try:
        fetch_and_persist()
    except Exception as e:
        print("Initial fetch error:", e)
    try:
        model.recompute()
    except Exception as e:
        print("Initial model recompute error:", e)

    poll_thread = threading.Thread(target=poller_loop, daemon=True)
    poll_thread.start()

    # periodic recompute loop to pick up new data quickly
    while True:
        try:
            model.recompute()
        except Exception as e:
            print("Model recompute error:", e)
        time.sleep(60)

if __name__ == "__main__":
    ensure_csv()
    bg = threading.Thread(target=background_worker, daemon=True)
    bg.start()
    print("🚀 Starting Earthquake Services API on http://0.0.0.0:8000")
    serve(app, host="0.0.0.0", port=8000)
