import { db, firebaseAdmin, FieldValue } from './firebase.js';
import { logger } from '../utils/logger.js';

export async function notifyModelReady({ sellerId, productId, title }) {
  const userSnap = await db.collection('users').doc(sellerId).get();
  const tokens = userSnap.data()?.fcmTokens ?? [];

  if (!tokens.length) {
    logger.info({ sellerId, productId }, 'No hay tokens FCM registrados para notificar');
    return { sent: 0, invalidTokens: [] };
  }

  const response = await firebaseAdmin.messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: 'Tu modelo 3D ya está listo',
      body: `El producto "${title}" ya fue publicado con vista AR.`,
    },
    data: {
      type: 'model_ready',
      productId,
      sellerId,
    },
  });

  const invalidTokens = [];
  response.responses.forEach((item, index) => {
    if (!item.success) {
      const code = item.error?.code ?? '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        invalidTokens.push(tokens[index]);
      }
    }
  });

  if (invalidTokens.length) {
    await db.collection('users').doc(sellerId).set(
      {
        fcmTokens: FieldValue.arrayRemove(...invalidTokens),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  logger.info({ sellerId, productId, successCount: response.successCount }, 'Notificación FCM enviada');
  return { sent: response.successCount, invalidTokens };
}

