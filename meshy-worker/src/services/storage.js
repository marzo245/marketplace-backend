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

function hasSupabaseStorage() {
  return Boolean(
    config.SUPABASE_URL &&
    config.SUPABASE_SECRET_KEY &&
    config.SUPABASE_STORAGE_BUCKET
  );
}

async function uploadModelToSupabase({ buffer, productId, format }) {
  const objectPath = `marketplace/products/${productId}/model.${format}`;
  const encodedPath = objectPath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const baseUrl = config.SUPABASE_URL.replace(/\/$/, '');
  const uploadUrl = `${baseUrl}/storage/v1/object/${config.SUPABASE_STORAGE_BUCKET}/${encodedPath}`;
  const publicUrl = `${baseUrl}/storage/v1/object/public/${config.SUPABASE_STORAGE_BUCKET}/${encodedPath}`;

  await axios.post(uploadUrl, buffer, {
    headers: {
      Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
      apikey: config.SUPABASE_SECRET_KEY,
      'Content-Type': getModelContentType(format),
      'x-upsert': 'true',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000,
  });

  logger.info(
    { productId, format, bytes: buffer.length, objectPath, bucket: config.SUPABASE_STORAGE_BUCKET },
    'Model stored in Supabase Storage'
  );

  return publicUrl;
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

  if (hasSupabaseStorage()) {
    return uploadModelToSupabase({ buffer, productId, format });
  }

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
