import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
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

  const result = await uploadBufferToCloudinary(Buffer.from(res.data), {
    folder: `marketplace/products/${productId}`,
    public_id: `model_${format}`,
    resource_type: 'raw',
    format,
    overwrite: true,
  });

  return result.secure_url;
}
