const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { getStorage, ref, uploadBytes, getDownloadURL } = require("firebase-admin/storage");
const multer = require("multer");

module.exports = (db) => {
  const router = express.Router();
  const announcementsCollection = db.collection("announcements");
  const storage = getStorage().bucket();
  const upload = multer({ storage: multer.memoryStorage() });

  // Image Upload Route
  router.post("/upload", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image provided" });
      }
      const fileName = `announcements/${Date.now()}_${req.file.originalname}`;
      const fileRef = storage.file(fileName);
      await fileRef.save(req.file.buffer, { contentType: req.file.mimetype });
      const imageUrl = await getDownloadURL(fileRef);
      res.json({ imageUrl });
    } catch (error) {
      console.error("Error uploading image:", error);
      res.status(500).json({ error: "Failed to upload image" });
    }
  });

  // GET all announcements
  router.get("/", async (req, res) => {
    try {
      const snapshot = await announcementsCollection.orderBy("createdAt", "desc").get();
      const announcements = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        let createdAtString = null;
        if (data.createdAt) {
          if (typeof data.createdAt.toDate === "function") {
            createdAtString = data.createdAt.toDate().toISOString();
          } else {
            createdAtString = new Date(data.createdAt).toISOString();
          }
        }

        announcements.push({
          id: doc.id,
          title: data.title,
          message: data.message,
          category: data.category || "info",
          severity: data.severity || "low",
          reporterType: data.reporterType || "unknown",
          location: data.location || null,
          imageUrl: data.imageUrl || null,
          createdAt: createdAtString
        });
      });

      res.json(announcements);
    } catch (error) {
      console.error("Error fetching announcements:", error);
      res.status(500).json({ error: "Failed to fetch announcements" });
    }
  });

  // POST new announcement
  router.post("/", async (req, res) => {
    try {
      const { title, message, category, severity, reporterType, location, imageUrl } = req.body;
      if (!title || !message) {
        return res.status(400).json({ error: "Title and message are required" });
      }

      const newAnnouncement = {
        title,
        message,
        category: category || "info",
        severity: severity || "low",
        reporterType: reporterType || "unknown",
        location: location || null,
        imageUrl: imageUrl || null,
        createdAt: FieldValue.serverTimestamp()
      };

      await announcementsCollection.add(newAnnouncement);
      res.status(201).json({ success: true, message: "Announcement added" });
    } catch (error) {
      console.error("Error adding announcement:", error);
      res.status(500).json({ error: "Failed to add announcement" });
    }
  });

  return router;
};