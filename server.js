const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { db } = require("./firebase");
const announcementRoutes = require("./routes/announcementRoutes")(db);

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Serve all frontend HTML files
app.use(express.static(path.join(__dirname, "../frontend")));

// 🔹 Serve all public-announcement HTML files
app.use(express.static(path.join(__dirname, "../public-announcement")));

// 🔹 API routes
app.use("/api/announcements", announcementRoutes);

// (Optional) Default route → always show Main Dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/Main Dashboard.html"));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
