import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db, FieldValue } from '../services/firebase.js';
import { uploadPhoto } from '../services/storage.js';
import { modelQueue } from '../services/queue.js';
import { getUsage } from '../services/credits.js';
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
      status: 'draft',
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
      status: data.model3d?.status ?? 'unknown',
      progress: data.model3d?.progress ?? 0,
      glbUrl: data.model3d?.glbUrl,
      usdzUrl: data.model3d?.usdzUrl,
      error: data.model3d?.error,
    });
  } catch (err) {
    next(err);
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

export default router;
