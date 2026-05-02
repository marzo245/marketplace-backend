import express from 'express';
import pinoHttp from 'pino-http';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import productsRouter from './routes/products.js';
import webhooksRouter from './routes/webhooks.js';

const app = express();

app.use(pinoHttp({ logger }));

app.use('/webhooks', express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}), webhooksRouter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => res.json({ ok: true, version: '1.0.0' }));

app.use('/api/v1', productsRouter);

app.use((err, _req, res, _next) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'internal_error', message: err.message });
});

app.listen(config.PORT, () => {
  logger.info(`API corriendo en puerto ${config.PORT}`);
});
