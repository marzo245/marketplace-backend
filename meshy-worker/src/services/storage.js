import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import { bucket } from './firebase.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
  secure: true,
});

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

function getModelContentType(format) {
  if (format === 'glb') return 'model/gltf-binary';
  if (format === 'usdz') return 'model/vnd.usdz+zip';
  return 'application/octet-stream';
}

export async function uploadPhoto({ buffer, productId, index }) {
  const result = await uploadBufferToCloudinary(buffer, {
    folder: `marketplace/products/${productId}/photos`,
    public_id: `photo_${index}`,
    resource_type: 'image',
    overwrite: true,
  });
  return result.secure_url;
}

export async function downloadAndStoreModel({ url, productId, format }) {
  logger.info({ productId, format }, 'Downloading model from Meshy CDN');

  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  const buffer = Buffer.from(res.data);
  const objectPath = `marketplace/products/${productId}/model.${format}`;
  const downloadToken = crypto.randomUUID();
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: getModelContentType(format),
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    validation: false,
  });

  logger.info({ productId, format, bytes: buffer.length, objectPath }, 'Model stored in Firebase Storage');

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}
