import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from obspy.clients.fdsn import Client as FDSNClient
from obspy import UTCDateTime
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from waitress import serve


# -----------------------------
# Original Predictor Class
# -----------------------------
class OriginalEarthquakePredictor:
    def __init__(self, csv_file=None, min_magnitude=3.0, lat_center=0.0, lon_center=0.0, radius_km=500, time_window_days=30):
        self.min_magnitude = min_magnitude
        self.lat_center = lat_center
        self.lon_center = lon_center
        self.radius_km = radius_km
        self.time_window_days = time_window_days
        self.csv_file = csv_file
        self.fdsn_client = FDSNClient("IRIS")
        self.a_value, self.b_value, self.event_rate = 0, 0, 0
        self.load_and_fit_data()

    def haversine(self, lat1, lon1, lat2, lon2):
        R = 6371
        lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = np.sin(dlat / 2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2)**2
        c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
        return R * c

    def load_and_fit_data(self):
        df = pd.DataFrame(columns=['time', 'mag', 'latitude', 'longitude', 'datetime'])

        if self.csv_file and os.path.exists(self.csv_file):
            try:
                df_csv = pd.read_csv(self.csv_file, usecols=['time', 'mag', 'latitude', 'longitude'])
                df_csv['datetime'] = pd.to_datetime(df_csv['time'], utc=True).dt.tz_localize(None)
                df_csv = df_csv[df_csv['mag'] >= self.min_magnitude].dropna()
                df = pd.concat([df, df_csv], ignore_index=True)
                print(f"Loaded {len(df_csv)} events from CSV.")
            except (FileNotFoundError, KeyError):
                print(f"Error: File '{self.csv_file}' not found or invalid format.")

        try:
            endtime = UTCDateTime.now()
            starttime = endtime - (self.time_window_days * 86400)
            catalog = self.fdsn_client.get_events(
                starttime=starttime,
                endtime=endtime,
                minmagnitude=self.min_magnitude,
                latitude=self.lat_center,
                longitude=self.lon_center,
                maxradius=self.radius_km / 111.32
            )
            data = [
                {"time": event.origins[0].time.datetime.replace(tzinfo=None),
                 "mag": event.magnitudes[0].mag,
                 "latitude": event.origins[0].latitude,
                 "longitude": event.origins[0].longitude}
                for event in catalog if event.magnitudes and event.origins
            ]
            df_rt = pd.DataFrame(data)
            df_rt['datetime'] = pd.to_datetime(df_rt['time'])
            df = pd.concat([df, df_rt], ignore_index=True)
            print(f"Loaded {len(df_rt)} events from IRIS real-time data.")
        except Exception as e:
            print(f"Error fetching IRIS data: {e}")

        df = df.drop_duplicates(subset=['time', 'latitude', 'longitude', 'mag'])
        if not df.empty:
            df['distance'] = self.haversine(self.lat_center, self.lon_center, df['latitude'], df['longitude'])
            df = df[df['distance'] <= self.radius_km]

        if df.empty:
            print("No events found within the specified region.")
            self.a_value, self.b_value, self.event_rate = 0, 0, 0
            return

        time_span_years = (df['datetime'].max() - df['datetime'].min()).days / 365.25
        if time_span_years == 0:
            time_span_years = self.time_window_days / 365.25
        magnitudes = df['mag'].values

        mag_bins = np.arange(self.min_magnitude, magnitudes.max() + 0.1, 0.1)
        hist, bin_edges = np.histogram(magnitudes, bins=mag_bins, density=False)
        cumulative_counts = np.cumsum(hist[::-1])[::-1] / time_span_years
        valid = cumulative_counts > 0
        mag_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
        mag_centers = mag_centers[valid]
        log_counts = np.log10(cumulative_counts[valid])

        def gr_law(m, a, b):
            return a - b * m

        try:
            popt, _ = curve_fit(gr_law, mag_centers, log_counts, p0=[3.0, 1.0])
            self.a_value, self.b_value = popt
            self.event_rate = 10 ** (self.a_value - self.b_value * self.min_magnitude)
        except RuntimeError:
            print("Curve fitting failed. Using default a=3.0, b=1.0.")
            self.a_value, self.b_value = 3.0, 1.0
            self.event_rate = 0
        print(f"Fitted: a={self.a_value:.2f}, b={self.b_value:.2f}")

    def predict_probability(self, magnitude, time_window_days=365):
        if self.event_rate == 0:
            return 0.0
        rate = 10 ** (self.a_value - self.b_value * magnitude)
        annual_prob = 1 - np.exp(-rate)
        if annual_prob >= 1:
            annual_prob = 0.9999
        daily_rate = -np.log(1 - annual_prob) / 365
        return 1 - np.exp(-daily_rate * time_window_days)

# -----------------------------
# Flask App
# -----------------------------
app = Flask(__name__)
CORS(app)

# Endpoint for prediction
@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()
    lat = data.get('lat')
    lon = data.get('lon')
    radius = data.get('radius', 500)
    magnitude = data.get('magnitude', 5.5)
    time_window = data.get('timeWindow', 30)

    if lat is None or lon is None:
        return jsonify({'error': 'Missing lat or lon'}), 400

    try:
        predictor = OriginalEarthquakePredictor(
            csv_file="earthquakes_2023_global.csv",
            min_magnitude=3.0,
            lat_center=lat,
            lon_center=lon,
            radius_km=radius,
            time_window_days=time_window
        )

        probability = predictor.predict_probability(magnitude, time_window) * 100
        return jsonify({'success': True, 'probability': round(probability, 2)})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    print("🚀 Starting Advanced Earthquake Prediction API with Waitress...")
    serve(app, host="0.0.0.0", port=8000)