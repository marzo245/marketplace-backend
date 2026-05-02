import { db, FieldValue } from './firebase.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function reserveCredits(creditsNeeded, sellerId) {
  const monthKey = currentMonthKey();
  const ref = db.collection('usage').doc(monthKey);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? (snap.data().credits ?? 0) : 0;
    const remaining = config.MAX_CREDITS_PER_MONTH - used;

    if (remaining < creditsNeeded) {
      logger.warn({ used, remaining, creditsNeeded, sellerId }, 'Creditos insuficientes este mes');
      return { ok: false, remaining };
    }

    tx.set(ref, {
      credits: FieldValue.increment(creditsNeeded),
      lastUpdate: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true, remaining: remaining - creditsNeeded };
  });
}

export async function refundCredits(creditsToRefund) {
  const monthKey = currentMonthKey();
  await db.collection('usage').doc(monthKey).set({
    credits: FieldValue.increment(-creditsToRefund),
  }, { merge: true });
}

export async function getUsage() {
  const snap = await db.collection('usage').doc(currentMonthKey()).get();
  const used = snap.exists ? (snap.data().credits ?? 0) : 0;
  return { used, remaining: config.MAX_CREDITS_PER_MONTH - used };
}
