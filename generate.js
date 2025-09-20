const admin = require("firebase-admin");
const { faker } = require("@faker-js/faker");

// Load your Firebase credentials
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function generateReports(count = 10000) {
  console.log(`🚀 Generating ${count} fake reports...`);

  const BATCH_LIMIT = 500; // Firestore max batch size
  let batch = db.batch();
  let counter = 0;

  for (let i = 0; i < count; i++) {
    const docRef = db.collection("familyReports").doc();

    const report = {
      reporterName: faker.person.fullName(),
      reporterPhone: faker.phone.number(),
      name: faker.person.fullName(),
      age: faker.number.int({ min: 1, max: 100 }),
      gender: faker.helpers.arrayElement(["Male", "Female", "Other"]),
      lastSeen: faker.location.city(),
      status: faker.helpers.arrayElement(["Missing", "Found", "Pending"]),
      bloodGroup: faker.helpers.arrayElement(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]),
      photoUrl: faker.image.avatar(),
      createdAt: admin.firestore.Timestamp.now(),
    };

    batch.set(docRef, report);
    counter++;

    // Commit every BATCH_LIMIT documents
    if (counter % BATCH_LIMIT === 0) {
      await batch.commit();
      console.log(`✅ Inserted ${counter} reports so far...`);
      batch = db.batch(); // start a new batch
    }
  }

  // Commit any remaining docs
  if (counter % BATCH_LIMIT !== 0) {
    await batch.commit();
  }

  console.log(`🎉 Successfully inserted ${counter} reports!`);
}

// Run
generateReports(10000).then(() => process.exit());
