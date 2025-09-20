const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "your-project-id.appspot.com" // Replace with your Firebase Storage bucket
  });
}

const db = admin.firestore();
const storage = admin.storage();

module.exports = { db, storage };