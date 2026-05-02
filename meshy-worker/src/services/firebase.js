import admin from 'firebase-admin';
import { config } from '../config/index.js';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: config.FIREBASE_PROJECT_ID,
    storageBucket: config.FIREBASE_STORAGE_BUCKET,
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export const firebaseAdmin = {
  auth: admin.auth(),
  messaging: admin.messaging(),
};
export const FieldValue = admin.firestore.FieldValue;
