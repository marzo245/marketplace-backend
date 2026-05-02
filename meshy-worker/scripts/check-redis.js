import 'dotenv/config';
import IORedis from 'ioredis';

const url = process.env.REDIS_URL;
if (!url) {
  console.error('REDIS_URL no definida en .env');
  process.exit(1);
}

console.log('Conectando a:', url.replace(/:[^:@]+@/, ':***@'));

const redis = new IORedis(url, {
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
});

redis.on('error', (err) => {
  console.error('Error Redis:', err.message);
});

try {
  const pong = await redis.ping();
  console.log('PING ->', pong);

  await redis.set('marketplace:test', 'ok', 'EX', 30);
  const val = await redis.get('marketplace:test');
  console.log('SET/GET test ->', val);

  console.log('OK: Upstash funciona.');
} catch (err) {
  console.error('Falló:', err.message);
  process.exit(1);
} finally {
  await redis.quit();
}
