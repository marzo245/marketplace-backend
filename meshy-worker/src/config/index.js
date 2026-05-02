import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  MESHY_API_KEY: z.string().min(10),
  MESHY_BASE_URL: z.string().url().default('https://api.meshy.ai/openapi/v1'),
  MESHY_WEBHOOK_SECRET: z.string().min(16),

  FIREBASE_PROJECT_ID: z.string(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  PUBLIC_BASE_URL: z.string().url(),

  MAX_CREDITS_PER_MONTH: z.coerce.number().default(200),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
