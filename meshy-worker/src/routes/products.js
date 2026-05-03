import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db, FieldValue } from '../services/firebase.js';
import { uploadPhoto } from '../services/storage.js';
import { modelQueue } from '../services/queue.js';
import { getUsage } from '../services/credits.js';
import { getTask } from '../services/meshy.js';
import { finalizeSuccessfulModel, markModelFailed } from '../services/model-sync.js';
import { logger } from '../utils/logger.js';
import { verifyFirebaseToken } from '../middleware/auth.js';

const router = Router();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
  storage: multer.memoryStorage(),
});

const createSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  price: z.coerce.number().positive(),
  category: z.string(),
});

router.post('/products/create', verifyFirebaseToken, upload.array('photos', 4), async (req, res, next) => {
  const t0 = Date.now();
  try {
    logger.info({ uid: req.user.uid, files: req.files?.length }, '[create] step 1: auth+multer ok');

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
    }

    const photos = req.files ?? [];
    if (photos.length < 2) {
      return res.status(400).json({
        error: 'not_enough_photos',
        message: 'Sube al menos 2 fotos desde angulos distintos',
      });
    }

    const productRef = db.collection('products').doc();
    const productId = productRef.id;
    logger.info({ productId, photoCount: photos.length, totalBytes: photos.reduce((s, p) => s + p.size, 0) }, '[create] step 2: starting cloudinary uploads');

    const tCloud = Date.now();
    const photoUrls = await Promise.all(
      photos.map(async (photo, i) => {
        const ti = Date.now();
        const url = await uploadPhoto({
          buffer: photo.buffer,
          contentType: photo.mimetype,
          productId,
          index: i,
        });
        logger.info({ productId, index: i, ms: Date.now() - ti, bytes: photo.size }, '[create] cloudinary photo done');
        return url;
      })
    );
    logger.info({ productId, ms: Date.now() - tCloud }, '[create] step 3: all cloudinary uploads done');

    const tFs = Date.now();
    await productRef.set({
      ...parsed.data,
      sellerId: req.user.uid,
      sellerName: req.user.name ?? req.user.email ?? 'Vendedor',
      photos: photoUrls,
      status: 'published',
      model3d: {
        status: 'queued',
        queuedAt: FieldValue.serverTimestamp(),
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info({ productId, ms: Date.now() - tFs }, '[create] step 4: firestore write done');

    const tQ = Date.now();
    const job = await modelQueue.add('generate', {
      productId,
      sellerId: req.user.uid,
      imageUrls: photoUrls.slice(0, 4),
    }, { jobId: productId });
    logger.info({ productId, jobId: job.id, ms: Date.now() - tQ, totalMs: Date.now() - t0 }, '[create] step 5: job encolado, respondiendo');

    return res.status(202).json({
      productId,
      jobId: job.id,
      status: 'queued',
      productStatus: 'published',
      estimatedMinutes: 3,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id/status', async (req, res, next) => {
  try {
    const snap = await db.collection('products').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });

    const data = snap.data();
    return res.json({
      productId: req.params.id,
      productStatus: data.status ?? 'unknown',
      status: data.model3d?.status ?? 'unknown',
      progress: data.model3d?.progress ?? 0,
      glbUrl: data.model3d?.glbUrl,
      usdzUrl: data.model3d?.usdzUrl,
      error: data.model3d?.error,
      errorDetail: data.model3d?.errorDetail,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/debug/meshy/:productId', async (req, res) => {
  try {
    const snap = await db.collection('products').doc(req.params.productId).get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });
    const data = snap.data();
    const taskId = data.model3d?.meshyTaskId;
    if (!taskId) {
      return res.json({ productId: req.params.productId, error: 'no_meshy_task_id', model3d: data.model3d });
    }

    const task = await getTask(taskId, 'multi-image-to-3d');
    return res.json({
      productId: req.params.productId,
      taskId,
      firestoreStatus: data.model3d?.status,
      firestoreError: data.model3d?.error,
      firestoreErrorDetail: data.model3d?.errorDetail,
      meshyStatus: task.status,
      meshyProgress: task.progress,
      meshyError: task.task_error,
      meshyModelUrls: task.model_urls,
      meshyCreatedAt: task.created_at,
      meshyFinishedAt: task.finished_at,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'debug_failed',
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    });
  }
});

router.get('/admin/usage', verifyFirebaseToken, async (req, res, next) => {
  try {
    if (req.user.admin !== true) {
      return res.status(403).json({ error: 'forbidden', message: 'No autorizado' });
    }

    const usage = await getUsage();
    res.json(usage);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/products/:id/reconcile-model', verifyFirebaseToken, async (req, res, next) => {
  try {
    if (req.user.admin !== true) {
      return res.status(403).json({ error: 'forbidden', message: 'No autorizado' });
    }

    const productRef = db.collection('products').doc(req.params.id);
    const snap = await productRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'not_found', message: 'Producto no encontrado' });
    }

    const productData = snap.data();
    const taskId = productData.model3d?.meshyTaskId;
    if (!taskId) {
      return res.status(400).json({ error: 'missing_task_id', message: 'El producto no tiene meshyTaskId' });
    }

    const task = await getTask(taskId, 'multi-image-to-3d');
    const taskStatus = task.status ?? 'unknown';

    if (taskStatus === 'SUCCEEDED') {
      await finalizeSuccessfulModel({
        productRef,
        productId: snap.id,
        productData,
        glbUrl: task.model_urls?.glb,
        usdzUrl: task.model_urls?.usdz,
        thumbnailUrl: task.thumbnail_url,
      });

      return res.json({
        ok: true,
        productId: snap.id,
        taskId,
        firestoreStatus: 'ready',
        meshyStatus: taskStatus,
      });
    }

    if (taskStatus === 'FAILED') {
      const error = task.task_error?.message ?? 'meshy_generation_failed';
      await markModelFailed({ productRef, error });

      return res.json({
        ok: true,
        productId: snap.id,
        taskId,
        firestoreStatus: 'failed',
        meshyStatus: taskStatus,
        error,
      });
    }

    await productRef.update({
      'model3d.status': 'processing',
      'model3d.progress': task.progress ?? productData.model3d?.progress ?? 0,
      'model3d.lastMeshyCheckAt': FieldValue.serverTimestamp(),
    });

    return res.json({
      ok: true,
      productId: snap.id,
      taskId,
      firestoreStatus: 'processing',
      meshyStatus: taskStatus,
      meshyProgress: task.progress ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
