import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

export const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const modelQueue = new Queue('3d-generation', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const queueEvents = new QueueEvents('3d-generation', { connection });
