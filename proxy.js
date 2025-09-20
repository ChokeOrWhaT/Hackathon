// proxy.js (Node + Express)
import express from "express";
import fetch from "node-fetch"; // or use native fetch in newer Node
import cors from "cors";

const app = express();
app.use(cors());

const API_KEY = process.env.OWM_KEY; // set via environment variable

app.get("/weather", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "q required" });

  try {
    const curr = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(q)}&appid=${API_KEY}&units=metric`);
    const currJson = await curr.json();

    const fc = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(q)}&appid=${API_KEY}&units=metric`);
    const fcJson = await fc.json();

    res.json({ current: currJson, forecast: fcJson });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fetch failed" });
  }
});

app.listen(5000, () => console.log("Proxy listening on port 5000"));
