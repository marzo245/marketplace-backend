import { Router } from 'express';
import crypto from 'node:crypto';
import { db, FieldValue } from '../services/firebase.js';
import { downloadAndStoreModel } from '../services/storage.js';
import { notifyModelReady } from '../services/notifications.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', config.MESHY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    );
  } catch {
    return false;
  }
}

router.post('/meshy', async (req, res, next) => {
  try {
    const rawBody = req.rawBody;
    const signature = req.header('x-meshy-signature');

    if (!verifySignature(rawBody, signature)) {
      logger.warn('Webhook de Meshy con firma invalida');
      return res.status(401).json({ error: 'invalid_signature' });
    }

    const event = req.body;
    const taskId = event.id;
    const status = event.status;

    logger.info({ taskId, status }, 'Webhook de Meshy recibido');

    const query = await db.collection('products')
      .where('model3d.meshyTaskId', '==', taskId)
      .limit(1)
      .get();

    if (query.empty) {
      logger.warn({ taskId }, 'No se encontro producto para este taskId');
      return res.status(200).json({ ok: true, ignored: true });
    }

    const productRef = query.docs[0].ref;
    const productId = productRef.id;
    const productData = query.docs[0].data();

    if (status === 'SUCCEEDED') {
      const glbUrl = event.model_urls?.glb;
      const usdzUrl = event.model_urls?.usdz;
      const thumbnailUrl = event.thumbnail_url;

      const stored = {};
      if (glbUrl) stored.glbUrl = await downloadAndStoreModel({ url: glbUrl, productId, format: 'glb' });
      if (usdzUrl) stored.usdzUrl = await downloadAndStoreModel({ url: usdzUrl, productId, format: 'usdz' });

      await productRef.update({
        'model3d.status': 'ready',
        'model3d.glbUrl': stored.glbUrl ?? null,
        'model3d.usdzUrl': stored.usdzUrl ?? null,
        'model3d.thumbnailUrl': thumbnailUrl ?? null,
        'model3d.completedAt': FieldValue.serverTimestamp(),
        'status': 'published',
      });

      if (!productData.model3d?.notifiedAt) {
        try {
          await notifyModelReady({
            sellerId: productData.sellerId,
            productId,
            title: productData.title ?? 'Tu producto',
          });

          await productRef.update({
            'model3d.notifiedAt': FieldValue.serverTimestamp(),
          });
        } catch (notificationError) {
          logger.error({ productId, err: notificationError.message }, 'No se pudo enviar la notificación FCM');
        }
      }

      logger.info({ productId }, 'Modelo 3D listo y publicado');
    } else if (status === 'FAILED') {
      await productRef.update({
        'model3d.status': 'failed',
        'model3d.error': event.task_error?.message ?? 'meshy_generation_failed',
        'model3d.failedAt': FieldValue.serverTimestamp(),
      });
    } else if (status === 'IN_PROGRESS') {
      await productRef.update({
        'model3d.progress': event.progress ?? 0,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
