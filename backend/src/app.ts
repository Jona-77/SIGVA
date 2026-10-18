import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { Airport, Class, Departure, Flight, Passenger, Role, Session, User, ensureExampleFlightDepartures, ensureStateConstraints, sequelize, seedDatabase } from './db/index.js';
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

  const passengerProfile = await Passenger.findOne({ where: { userId: user.id } });
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role?.name ?? 'passenger',
      firstName: passengerProfile?.firstName ?? user.name,
      lastName: passengerProfile?.lastName ?? '',
      document: passengerProfile?.documentNumber ?? '',
      birthDate: passengerProfile?.birthDate ?? null
    }
  });
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const errors: Record<string, string> = {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const document = typeof body.document === 'string' ? body.document.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const birthDate = typeof body.birthDate === 'string' ? body.birthDate : null;

  if (!name) errors.name = 'El nombre es obligatorio.';
  if (!lastName) errors.lastName = 'El apellido es obligatorio.';
  if (!document || !/^[A-Za-z0-9]{6,15}$/.test(document)) errors.document = 'El documento debe tener entre 6 y 15 caracteres alfanuméricos.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Debe ingresar un email válido.';
  if (!password || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) errors.password = 'La contraseña debe tener al menos 8 caracteres, una letra y un número.';
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) errors.birthDate = 'La fecha de nacimiento debe tener formato YYYY-MM-DD.';

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors });
  }

  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    return res.status(409).json({
      message: 'Ya existe una cuenta con ese email.',
      errors: { email: 'El email ya está registrado.' }
    });
  }

  const passengerRole = await Role.findOne({ where: { name: 'passenger' } });
  if (!passengerRole) {
    return res.status(500).json({ message: 'No se pudo inicializar el rol de pasajero.' });
  }

  const createdUser = await sequelize.transaction(async (transaction) => {
    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      roleId: passengerRole.id
    }, { transaction });

    const passenger = await Passenger.create({
      userId: user.id,
      firstName: name,
      lastName,
      documentType: 'DNI',
      documentNumber: document,
      birthDate: birthDate || null,
      email
    }, { transaction });

    return { user, passenger };
  });

  return res.status(201).json({
    user: {
      id: createdUser.user.id,
      email: createdUser.user.email,
      name: createdUser.user.name,
      role: 'passenger'
    },
    passenger: {
      id: createdUser.passenger.id,
      firstName: createdUser.passenger.firstName,
      lastName: createdUser.passenger.lastName,
      document: createdUser.passenger.documentNumber,
      birthDate: createdUser.passenger.birthDate
    }
  });
}));

function formatDateInArgentina(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatTimeInArgentina(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}`;
}

function hasDepartureTimePassed(date: string, departureTime: string) {
  const today = formatDateInArgentina(new Date());
  const timeNow = formatTimeInArgentina(new Date());
  return date < today || (date === today && departureTime <= timeNow);
}

function getAvailability(flight: { economySeats: number; firstClassSeats: number }, departure: { soldEconomy: number; soldFirstClass: number }) {
  return {
    ECONOMY: Math.max(0, Number(flight.economySeats) - Number(departure.soldEconomy)),
    FIRST: Math.max(0, Number(flight.firstClassSeats) - Number(departure.soldFirstClass))
  };
}

app.get('/api/public/airports', asyncHandler(async (_req, res) => {
  const airports = await Airport.findAll({ where: { isActive: true }, order: [['iata', 'ASC']] });
  return res.json({ airports });
}));

app.get('/api/search/flights', asyncHandler(async (req, res) => {
  const errors: Record<string, string> = {};
  const origin = typeof req.query.origin === 'string' ? req.query.origin.trim().toUpperCase() : '';
  const destination = typeof req.query.destination === 'string' ? req.query.destination.trim().toUpperCase() : '';
  const date = typeof req.query.date === 'string' ? req.query.date : '';

  if (!origin) errors.origin = 'El origen es obligatorio.';
  if (!destination) errors.destination = 'El destino es obligatorio.';
  if (!date) errors.date = 'La fecha es obligatoria.';
  if (origin && destination && origin === destination) errors.destination = 'El origen y el destino deben ser distintos.';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'La fecha debe tener formato YYYY-MM-DD.';

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors });
  }

  const originAirport = await Airport.findOne({ where: { iata: origin, isActive: true } });
  const destinationAirport = await Airport.findOne({ where: { iata: destination, isActive: true } });
  if (!originAirport || !destinationAirport) {
    if (!originAirport) errors.origin = 'El origen no existe o no está activo.';
    if (!destinationAirport) errors.destination = 'El destino no existe o no está activo.';
  }
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors });
  }

  const dateValue = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dateValue.getTime())) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors: { date: 'La fecha debe ser válida.' } });
  }
  if (dateValue.getTime() < new Date(`${formatDateInArgentina(new Date())}T00:00:00Z`).getTime()) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors: { date: 'La fecha no puede ser anterior al día actual.' } });
  }

  const flights = await Flight.findAll({
    where: {
      status: 'ACTIVE',
      originAirportId: originAirport!.id,
      destinationAirportId: destinationAirport!.id,
      availableFrom: { [Op.lte]: date },
      availableTo: { [Op.gte]: date }
    },
    include: [
      { model: Airport, as: 'origin' },
      { model: Airport, as: 'destination' },
      { model: Departure, as: 'departures', where: { date, status: 'SCHEDULED' }, required: true }
    ],
    order: [['departureTime', 'ASC'], ['id', 'ASC']]
  });

  const results = flights
    .filter((flight) => !hasDepartureTimePassed(date, flight.departureTime))
    .map((flight) => {
      const departure = flight.departures?.find((item) => item.date === date && item.status === 'SCHEDULED');
      if (!departure) return null;
      const availability = getAvailability(flight, departure);
      if (availability.ECONOMY <= 0 && availability.FIRST <= 0) return null;

      const departureDate = new Date(`${date}T${flight.departureTime}:00`);
      const arrivalDate = new Date(`${date}T${flight.arrivalTime}:00`);
      if (flight.arrivalTime <= flight.departureTime) {
        arrivalDate.setUTCDate(arrivalDate.getUTCDate() + 1);
      }
      const durationMinutes = Math.max(0, Math.round((arrivalDate.getTime() - departureDate.getTime()) / 60000));
      const durationHours = Math.floor(durationMinutes / 60);
      const durationMinutesRest = durationMinutes % 60;

      return {
        id: departure.id,
        flightNumber: flight.flightNumber,
        origin: flight.origin?.iata ?? originAirport!.iata,
        destination: flight.destination?.iata ?? destinationAirport!.iata,
        departure: `${date}T${flight.departureTime}:00`,
        arrival: `${arrivalDate.toISOString().slice(0, 10)}T${flight.arrivalTime}:00`,
        duration: `${durationHours} h ${String(durationMinutesRest).padStart(2, '0')} min`,
        classes: [
          { code: 'ECONOMY', name: 'Economy', price: Number(flight.economyPrice), available: availability.ECONOMY, soldOut: availability.ECONOMY === 0 },
          { code: 'FIRST', name: 'Primera', price: Number(flight.firstClassPrice), available: availability.FIRST, soldOut: availability.FIRST === 0 }
        ]
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (results.length === 0) {
    return res.json({ message: 'No se encontraron vuelos para la búsqueda.', results: [] });
  }

  return res.json({ results });
}));

app.post('/api/purchases/quote', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const departureId = Number(req.body?.departureId);
  const classCode = String(req.body?.classCode ?? '').toUpperCase();
  const quantity = Number(req.body?.quantity);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9) {
    return res.status(400).json({ message: 'La cantidad debe ser un entero entre 1 y 9.', errors: { quantity: 'La cantidad debe ser un entero entre 1 y 9.' } });
  }
  if (!departureId || !classCode) {
    return res.status(400).json({ message: 'Faltan datos de la selección.', errors: { departureId: 'La salida es obligatoria.', classCode: 'La clase es obligatoria.' } });
  }

  const departure = await Departure.findByPk(departureId);
  if (!departure || departure.status !== 'SCHEDULED') {
    return res.status(404).json({ message: 'La salida indicada no existe o no está disponible.' });
  }

  const flight = await Flight.findByPk(departure.flightId);
  if (!flight || flight.status !== 'ACTIVE') {
    return res.status(409).json({ message: 'La salida no está disponible para reserva.' });
  }
  if (hasDepartureTimePassed(departure.date, flight.departureTime)) {
    return res.status(409).json({ message: 'La salida ya pasó y no puede reservarse.' });
  }

  const availability = getAvailability(flight, departure);
  const validClassCodes = new Set(['ECONOMY', 'FIRST']);
  if (!validClassCodes.has(classCode)) {
    return res.status(400).json({ message: 'La clase seleccionada es inválida.', errors: { classCode: 'La clase debe ser ECONOMY o FIRST.' } });
  }

  const available = availability[classCode as keyof typeof availability] ?? 0;
  if (quantity > available) {
    return res.status(409).json({ message: `Solo hay ${available} asientos disponibles en esa clase.`, available, errors: { quantity: `Solo hay ${available} asientos disponibles.` } });
  }

  const unitPrice = classCode === 'FIRST' ? Number(flight.firstClassPrice) : Number(flight.economyPrice);
  return res.json({ departureId, classCode, quantity, unitPrice, total: unitPrice * quantity });
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
  app.listen(config.port);
}
