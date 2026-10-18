import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const repoRoot = process.cwd().endsWith('backend') ? path.resolve(process.cwd(), '..') : process.cwd();
const dbPathFromEnv = process.env.DB_PATH ?? './backend/data/sigva.sqlite';
const jwtSecret = process.env.JWT_SECRET;

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: jwtSecret ?? '',
  sessionTimeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES ?? 30),
  reservationMinutes: Number(process.env.RESERVATION_MINUTES ?? 10),
  paymentGateway: process.env.PAYMENT_GATEWAY ?? (process.env.MP_ACCESS_TOKEN ? 'mercadopago' : 'local-sandbox'),
  mpAccessToken: process.env.MP_ACCESS_TOKEN ?? '',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  dbPath: path.resolve(repoRoot, dbPathFromEnv)
};

if (!Number.isFinite(config.sessionTimeoutMinutes) || config.sessionTimeoutMinutes <= 0) {
  throw new Error('SESSION_TIMEOUT_MINUTES debe ser un número mayor que cero.');
}
if (!Number.isFinite(config.reservationMinutes) || config.reservationMinutes <= 0) {
  throw new Error('RESERVATION_MINUTES debe ser un número mayor que cero.');
}
if (!['mercadopago', 'local-sandbox'].includes(config.paymentGateway)) {
  throw new Error('PAYMENT_GATEWAY debe ser mercadopago o local-sandbox.');
}
if (config.paymentGateway === 'mercadopago' && !config.mpAccessToken) {
  throw new Error('MP_ACCESS_TOKEN es obligatorio para PAYMENT_GATEWAY=mercadopago.');
}
