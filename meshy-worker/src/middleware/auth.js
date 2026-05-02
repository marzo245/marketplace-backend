import { firebaseAdmin } from '../services/firebase.js';

export async function verifyFirebaseToken(req, res, next) {
  const header = req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: 'unauthorized', message: 'Token faltante' });
  }

  try {
    req.user = await firebaseAdmin.auth.verifyIdToken(match[1]);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'unauthorized', message: 'Token inválido' });
  }
}

