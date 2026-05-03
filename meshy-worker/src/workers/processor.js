import { Worker } from 'bullmq';
import { connection } from '../services/queue.js';
import { createMultiImageTask, MeshyCreditError, MeshyRateLimitError, MeshyValidationError } from '../services/meshy.js';
import { reserveCredits, refundCredits } from '../services/credits.js';
import { db, FieldValue } from '../services/firebase.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const CREDITS_PER_MULTI_IMAGE = 10;

const worker = new Worker('3d-generation', async (job) => {
  const { productId, sellerId, imageUrls } = job.data;
  const productRef = db.collection('products').doc(productId);

  logger.info({ productId, sellerId, jobId: job.id }, 'Procesando job de generacion 3D');

  const reservation = await reserveCredits(CREDITS_PER_MULTI_IMAGE, sellerId);
  if (!reservation.ok) {
    await productRef.update({
      'model3d.status': 'failed',
      'model3d.error': 'insufficient_credits',
      'model3d.failedAt': FieldValue.serverTimestamp(),
    });
    throw new Error(`Sin creditos: quedan ${reservation.remaining}`);
  }

  try {
    const webhookUrl = `${config.PUBLIC_BASE_URL}/webhooks/meshy`;
    const taskId = await createMultiImageTask({ imageUrls, webhookUrl, productId });

    await productRef.update({
      'model3d.status': 'processing',
      'model3d.meshyTaskId': taskId,
      'model3d.startedAt': FieldValue.serverTimestamp(),
      'model3d.creditsUsed': CREDITS_PER_MULTI_IMAGE,
    });

    logger.info({ productId, taskId }, 'Tarea Meshy creada, esperando webhook');

    return { taskId, status: 'pending_webhook' };
  } catch (err) {
    await refundCredits(CREDITS_PER_MULTI_IMAGE);

    let errorCode = 'unknown';
    if (err instanceof MeshyCreditError) errorCode = 'meshy_out_of_credits';
    else if (err instanceof MeshyRateLimitError) errorCode = 'rate_limited';
    else if (err instanceof MeshyValidationError) errorCode = 'invalid_images';

    logger.error({
      productId,
      sellerId,
      jobId: job.id,
      errorCode,
      err: err.message,
      stack: err.stack,
    }, 'Error procesando job de generacion 3D');

    await productRef.update({
      'model3d.status': 'failed',
      'model3d.error': errorCode,
      'model3d.errorDetail': err.message,
      'model3d.failedAt': FieldValue.serverTimestamp(),
    });

    if (errorCode === 'rate_limited') throw err;
    return { status: 'failed', errorCode };
  }
}, {
  connection,
  concurrency: 2,
  limiter: { max: 10, duration: 60_000 },
});

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'Job completado');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Job fallido');
});

logger.info('Worker de generacion 3D iniciado');
