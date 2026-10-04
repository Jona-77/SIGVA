import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { Airport, Flight, Role, Session, User, ensureExampleFlightDepartures, ensureStateConstraints, sequelize, seedDatabase } from './db/index.js';
import { config } from './config.js';
import { requireAuth, requireRole } from './auth.js';
import { flightsRouter } from './flights.js';
import { asyncHandler } from './asyncHandler.js';

export { requireAuth, requireRole } from './auth.js';

export const app = express();

app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json());

export async function syncDatabase() {
  await sequelize.authenticate();
  await sequelize.sync();
  await ensureStateConstraints();
  const count = await Role.count();
  if (count === 0) {
    await seedDatabase();
  }
  await ensureExampleFlightDepartures();
}

async function loadUserById(id: number) {
  const user = await User.findByPk(id, { include: [{ model: Role, as: 'role' }] });
  return user;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'SIGVA backend activo' });
});

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({ message: 'Email y contraseña son obligatorios.' });
  }

  const user = await User.findOne({
    where: { email },
    include: [{ model: Role, as: 'role' }]
  });

  if (!user) {
    return res.status(401).json({ message: 'Las credenciales ingresadas no son válidas.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Las credenciales ingresadas no son válidas.' });
  }

  const roleName = user.role?.name ?? 'passenger';
  const sessionId = randomUUID();
  await Session.create({ id: sessionId, userId: user.id, lastActivity: new Date(), revoked: false });
  const token = jwt.sign({ userId: user.id, email: user.email, role: roleName, sessionId }, config.jwtSecret);

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: roleName
    }
  });
}));

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await loadUserById(req.user!.id);
  if (!user) {
    return res.status(401).json({ message: 'Sesión no válida o expirada.' });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role?.name ?? 'passenger'
    }
  });
}));

app.post('/api/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  await Session.update({ revoked: true }, { where: { id: req.user!.sessionId } });
  res.json({ ok: true, message: 'Sesión cerrada correctamente.' });
}));

app.get('/api/airports', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const activeParam = req.query.active;
  const where = activeParam === undefined ? {} : { isActive: activeParam === 'true' };

  const airports = await Airport.findAll({
    where,
    order: [['iata', 'ASC']]
  });

  return res.json({ airports });
}));

app.post('/api/airports', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { iata, name, city, province } = req.body ?? {};

  if (!iata || !name || !city || !province) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
  }

  const normalizedIata = String(iata).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedIata)) {
    return res.status(400).json({ message: 'El código IATA debe tener exactamente 3 letras.' });
  }

  const existing = await Airport.findOne({ where: { iata: normalizedIata } });
  if (existing) {
    return res.status(409).json({ message: 'Ya existe un aeropuerto con ese código IATA.' });
  }

  const airport = await Airport.create({
    iata: normalizedIata,
    name: String(name).trim(),
    city: String(city).trim(),
    province: String(province).trim(),
    isActive: true
  });

  return res.status(201).json({ airport });
}));

app.put('/api/airports/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const airport = await Airport.findByPk(Number(req.params.id));
  if (!airport) {
    return res.status(404).json({ message: 'Aeropuerto no encontrado.' });
  }

  const { iata, name, city, province } = req.body ?? {};
  const normalizedIata = String(iata ?? airport.iata).trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedIata)) {
    return res.status(400).json({ message: 'El código IATA debe tener exactamente 3 letras.' });
  }

  const duplicate = await Airport.findOne({
    where: {
      iata: normalizedIata,
      id: { [Op.ne]: airport.id }
    }
  });

  if (duplicate) {
    return res.status(409).json({ message: 'Ya existe otro aeropuerto con ese código IATA.' });
  }

  const fieldErrors: Record<string, string> = {};
  if (typeof name !== 'string' || !name.trim()) fieldErrors.name = 'El nombre es obligatorio.';
  if (typeof city !== 'string' || !city.trim()) fieldErrors.city = 'La ciudad es obligatoria.';
  if (typeof province !== 'string' || !province.trim()) fieldErrors.province = 'La provincia es obligatoria.';
  if (Object.keys(fieldErrors).length > 0) {
    return res.status(400).json({ message: 'Nombre, ciudad y provincia son obligatorios.', errors: fieldErrors });
  }

  airport.iata = normalizedIata;
  airport.name = name.trim();
  airport.city = city.trim();
  airport.province = province.trim();
  await airport.save();

  return res.json({ airport });
}));

app.delete('/api/airports/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const airport = await Airport.findByPk(Number(req.params.id));
  if (!airport) {
    return res.status(404).json({ message: 'Aeropuerto no encontrado.' });
  }

  const inUse = await Flight.findOne({
    where: {
      status: 'ACTIVE',
      [Op.or]: [{ originAirportId: airport.id }, { destinationAirportId: airport.id }]
    }
  });

  if (inUse) {
    return res.status(400).json({ message: 'No se puede desactivar un aeropuerto que es origen o destino de un vuelo activo.' });
  }

  airport.isActive = false;
  await airport.save();

  return res.json({ airport, message: 'Aeropuerto desactivado correctamente.' });
}));

app.use('/api/flights', flightsRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error inesperado en la API:', error);
  return res.status(500).json({ message: 'Error interno del servidor.' });
});

export async function startServer() {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET es obligatorio.');
  }
  await syncDatabase();
  app.listen(config.port, () => {
    // Intentionally left blank for startup logs.
  });
}
