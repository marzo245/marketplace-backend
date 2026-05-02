import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const meshy = axios.create({
  baseURL: config.MESHY_BASE_URL,
  headers: {
    Authorization: `Bearer ${config.MESHY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

meshy.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const data = err.response?.data;
    logger.error({ status, data, url: err.config?.url }, 'Meshy API error');

    if (status === 402) throw new MeshyCreditError('No hay creditos disponibles en Meshy');
    if (status === 429) throw new MeshyRateLimitError('Rate limit alcanzado, reintenta mas tarde');
    if (status === 422) throw new MeshyValidationError(data?.message ?? 'Imagenes invalidas');
    throw err;
  }
);

export class MeshyCreditError extends Error {}
export class MeshyRateLimitError extends Error {}
export class MeshyValidationError extends Error {}

export async function createMultiImageTask({ imageUrls, webhookUrl, productId }) {
  if (imageUrls.length < 1 || imageUrls.length > 4) {
    throw new Error('Meshy multi-image acepta entre 1 y 4 imagenes');
  }

  const body = {
    image_urls: imageUrls,
    ai_model: 'latest',
    should_remesh: true,
    should_texture: true,
    enable_pbr: true,
    target_polycount: 30000,
    target_formats: ['glb', 'usdz'],
    auto_size: true,
    origin_at: 'bottom',
    webhook_url: webhookUrl,
    webhook_secret: config.MESHY_WEBHOOK_SECRET,
  };

  logger.info({ productId, imageCount: imageUrls.length }, 'Creating Meshy multi-image task');

  const { data } = await meshy.post('/multi-image-to-3d', body);
  return data.result;
}

export async function createPreviewTask({ imageUrl, productId }) {
  const body = {
    image_url: imageUrl,
    ai_model: 'latest',
    should_remesh: false,
    should_texture: false,
    target_polycount: 10000,
    target_formats: ['glb'],
  };

  logger.info({ productId }, 'Creating Meshy preview (low-cost) task');

  const { data } = await meshy.post('/image-to-3d', body);
  return data.result;
}

export async function getTask(taskId, type = 'multi-image-to-3d') {
  const { data } = await meshy.get(`/${type}/${taskId}`);
  return data;
}

export async function getRemainingCredits() {
  try {
    const { data } = await meshy.get('/users/me');
    return data.credits ?? null;
  } catch (err) {
    logger.warn('No se pudieron consultar creditos');
    return null;
  }
}
