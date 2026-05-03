import { FieldValue } from './firebase.js';
import { downloadAndStoreModel } from './storage.js';
import { notifyModelReady } from './notifications.js';
import { logger } from '../utils/logger.js';

export async function finalizeSuccessfulModel({
  productRef,
  productId,
  productData,
  glbUrl,
  usdzUrl,
  thumbnailUrl,
}) {
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
      logger.error({ productId, err: notificationError.message }, 'No se pudo enviar la notificacion FCM');
    }
  }

  logger.info({ productId }, 'Modelo 3D listo y publicado');
}

export async function markModelFailed({ productRef, error }) {
  await productRef.update({
    'model3d.status': 'failed',
    'model3d.error': error ?? 'meshy_generation_failed',
    'model3d.failedAt': FieldValue.serverTimestamp(),
  });
}
