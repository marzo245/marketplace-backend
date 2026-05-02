import admin from 'firebase-admin';
import { config } from '../config/index.js';

function parseServiceAccount(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {}

  const escaped = raw
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  try {
    return JSON.parse(escaped);
  } catch (_) {}

  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

function buildCredential() {
  if (config.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = parseServiceAccount(config.FIREBASE_SERVICE_ACCOUNT_JSON);
    return admin.credential.cert(parsed);
  }
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: buildCredential(),
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
