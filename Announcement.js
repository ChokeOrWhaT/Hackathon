// models/Announcement.js
const db = require("../firebase");

const announcementCollection = db.collection("announcements");

module.exports = announcementCollection;
