import { Router } from 'express';
import crypto from 'node:crypto';
import { db, FieldValue } from '../services/firebase.js';
import { finalizeSuccessfulModel, markModelFailed } from '../services/model-sync.js';
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

function verifyWebhookRequest(req) {
  const rawBody = req.rawBody;
  const signature = req.header('x-meshy-signature');
  const secretKey = req.header('x-meshy-api-webhook-secret-key');

  if (signature) {
    return verifySignature(rawBody, signature);
  }

  if (secretKey) {
    return secretKey === config.MESHY_WEBHOOK_SECRET;
  }

  return false;
}

router.post('/meshy', async (req, res, next) => {
  try {
    if (!verifyWebhookRequest(req)) {
      logger.warn({
        hasSignature: Boolean(req.header('x-meshy-signature')),
        hasSecretKeyHeader: Boolean(req.header('x-meshy-api-webhook-secret-key')),
      }, 'Webhook de Meshy con firma invalida');
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
      await finalizeSuccessfulModel({
        productRef,
        productId,
        productData,
        glbUrl: event.model_urls?.glb,
        usdzUrl: event.model_urls?.usdz,
        thumbnailUrl: event.thumbnail_url,
      });
    } else if (status === 'FAILED') {
      await markModelFailed({
        productRef,
        error: event.task_error?.message ?? 'meshy_generation_failed',
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
