import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { Airport, Class, Departure, Flight, FlightChangeHistory, Passenger, Payment, Purchase, Role, Session, Ticket, User, ensureExampleFlightDepartures, ensureStateConstraints, sequelize, seedDatabase } from './db/index.js';
import { config } from './config.js';
import { createPaymentGateway, type PaymentGateway } from './paymentGateway.js';
import { requireAuth, requireRole } from './auth.js';
import { flightsRouter } from './flights.js';
import { asyncHandler } from './asyncHandler.js';
import { createInvoicePdf, createTicketPdf, ensurePurchaseInvoice } from './documents.js';
import { getPurchaseDocumentEmail, getPurchaseEmailDeliveries, retryPurchaseEmails, sendPurchaseDocuments } from './emailService.js';

export { requireAuth, requireRole } from './auth.js';

export const app = express();

let paymentGateway = createPaymentGateway(config.paymentGateway, {
  accessToken: config.mpAccessToken,
  clientUrl: config.clientUrl
});

export function setPaymentGateway(gateway: PaymentGateway) {
  paymentGateway = gateway;
}

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

  if (!user.isActive) {
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

async function getAvailability(
  flight: { economySeats: number; firstClassSeats: number },
  departure: { id: number; soldEconomy: number; soldFirstClass: number },
  transaction?: Transaction
) {
  const activeReservations = await Purchase.findAll({
    where: {
      departureId: departure.id,
      status: 'RESERVED',
      expiresAt: { [Op.gt]: new Date() }
    },
    attributes: ['classId', 'quantity'],
    transaction
  });
  const classCodes = await Class.findAll({ attributes: ['id', 'code'], transaction });
  const codesById = new Map(classCodes.map((item) => [item.id, item.code]));
  const reserved = activeReservations.reduce((totals, purchase) => {
    const classCode = codesById.get(Number(purchase.classId));
    if (classCode === 'ECONOMY' || classCode === 'FIRST') {
      totals[classCode] += Number(purchase.quantity);
    }
    return totals;
  }, { ECONOMY: 0, FIRST: 0 });

  return {
    ECONOMY: Math.max(0, Number(flight.economySeats) - Number(departure.soldEconomy) - reserved.ECONOMY),
    FIRST: Math.max(0, Number(flight.firstClassSeats) - Number(departure.soldFirstClass) - reserved.FIRST)
  };
}

async function releaseReservation(purchaseId: number, reason: 'EXPIRADA' | 'CANCELADA_POR_USUARIO' | 'PAGO_RECHAZADO', providedTransaction?: Transaction) {
  const transaction = providedTransaction ?? await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE });
  const purchase = await Purchase.findByPk(purchaseId, { transaction });
  if (!purchase || purchase.status !== 'RESERVED') {
    if (!providedTransaction) await transaction.commit();
    return false;
  }

  purchase.status = 'EXPIRED';
  purchase.releaseReason = reason;
  await purchase.save({ transaction });

  if (!providedTransaction) await transaction.commit();
  return true;
}

async function expireReservations() {
  const now = new Date();
  const expiredPurchases = await Purchase.findAll({
    where: { status: 'RESERVED', expiresAt: { [Op.lte]: now } },
    attributes: ['id']
  });

  for (const purchase of expiredPurchases) {
    await releaseReservation(purchase.id, 'EXPIRADA');
  }
}

const departureLocks = new Map<number, Promise<void>>();

async function withDepartureLock<T>(departureId: number, operation: () => Promise<T>): Promise<T> {
  const previous = departureLocks.get(departureId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  departureLocks.set(departureId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (departureLocks.get(departureId) === current) departureLocks.delete(departureId);
  }
}

app.get('/api/public/airports', asyncHandler(async (_req, res) => {
  const airports = await Airport.findAll({ where: { isActive: true }, order: [['iata', 'ASC']] });
  return res.json({ airports });
}));

app.get('/api/search/flights', asyncHandler(async (req, res) => {
  await expireReservations();

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

  const results = (await Promise.all(flights
    .filter((flight) => !hasDepartureTimePassed(date, flight.departureTime))
    .map(async (flight) => {
      const departure = flight.departures?.find((item) => item.date === date && item.status === 'SCHEDULED');
      if (!departure) return null;
      const availability = await getAvailability(flight, departure);
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
    })))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (results.length === 0) {
    return res.json({ message: 'No se encontraron vuelos para la búsqueda.', results: [] });
  }

  return res.json({ results });
}));

app.post('/api/purchases', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  await expireReservations();

  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const departureId = Number(body.departureId);
  const classCode = typeof body.classCode === 'string' ? body.classCode.trim().toUpperCase() : '';
  const quantity = Number(body.quantity);
  const passengers = Array.isArray(body.passengers) ? body.passengers : [];
  const errors: Record<string, string> = {};

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9) {
    errors.quantity = 'La cantidad debe ser un entero entre 1 y 9.';
  }
  if (!Number.isFinite(departureId) || departureId <= 0) {
    errors.departureId = 'La salida es obligatoria.';
  }
  if (!['ECONOMY', 'FIRST'].includes(classCode)) {
    errors.classCode = 'La clase debe ser ECONOMY o FIRST.';
  }
  if (passengers.length !== quantity) {
    errors.passengers = 'La cantidad de pasajeros debe coincidir con la cantidad solicitada.';
  }

  const normalizedPassengers: Array<{ firstName: string; lastName: string; document: string; birthDate: string | null }> = [];
  const seenDocuments = new Set<string>();

  for (let index = 0; index < passengers.length; index += 1) {
    const passenger = passengers[index] && typeof passengers[index] === 'object' ? passengers[index] as Record<string, unknown> : {};
    const firstName = typeof passenger.firstName === 'string' ? passenger.firstName.trim() : '';
    const lastName = typeof passenger.lastName === 'string' ? passenger.lastName.trim() : '';
    const document = typeof passenger.document === 'string' ? passenger.document.trim() : '';
    const birthDate = typeof passenger.birthDate === 'string' ? passenger.birthDate : null;

    if (!firstName) errors[`passengers.${index}.firstName`] = 'El nombre es obligatorio.';
    if (!lastName) errors[`passengers.${index}.lastName`] = 'El apellido es obligatorio.';
    if (!document || !/^[A-Za-z0-9]{6,15}$/.test(document)) {
      errors[`passengers.${index}.document`] = 'El documento debe tener entre 6 y 15 caracteres alfanuméricos.';
    } else if (seenDocuments.has(document)) {
      errors[`passengers.${index}.document`] = 'El documento no puede repetirse dentro de la compra.';
    }
    if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      errors[`passengers.${index}.birthDate`] = 'La fecha de nacimiento es obligatoria y debe tener formato YYYY-MM-DD.';
    }

    const birthDateValue = birthDate ? new Date(`${birthDate}T00:00:00Z`) : null;
    if (birthDateValue && (Number.isNaN(birthDateValue.getTime()) || birthDateValue.toISOString().slice(0, 10) !== birthDate)) {
      errors[`passengers.${index}.birthDate`] = 'La fecha de nacimiento debe ser válida.';
    }
    if (birthDateValue && birthDateValue > new Date()) {
      errors[`passengers.${index}.birthDate`] = 'La fecha de nacimiento no puede ser futura.';
    }
    const oldestAllowedDate = new Date();
    oldestAllowedDate.setUTCFullYear(oldestAllowedDate.getUTCFullYear() - 120);
    if (birthDateValue && birthDateValue < oldestAllowedDate) {
      errors[`passengers.${index}.birthDate`] = 'La fecha de nacimiento no puede ser anterior a 120 años.';
    }

    if (document) {
      seenDocuments.add(document);
    }

    normalizedPassengers.push({ firstName, lastName, document, birthDate: birthDate || null });
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ message: 'Revise los datos de los pasajeros.', errors });
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

  const validClassCodes = new Set(['ECONOMY', 'FIRST']);
  if (!validClassCodes.has(classCode)) {
    return res.status(400).json({ message: 'La clase seleccionada es inválida.', errors: { classCode: 'La clase debe ser ECONOMY o FIRST.' } });
  }

  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!accountPassenger) {
    return res.status(400).json({ message: 'No se encontró el perfil del pasajero titular.' });
  }

  const outcome = await withDepartureLock(departureId, () => sequelize.transaction(
    { type: Transaction.TYPES.IMMEDIATE },
    async (transaction) => {
      const activeDeparture = await Departure.findByPk(departureId, { transaction });
      if (!activeDeparture || activeDeparture.status !== 'SCHEDULED') {
        return { error: 'La salida indicada no existe o no está disponible.' };
      }

      const activeFlight = await Flight.findByPk(activeDeparture.flightId, { transaction });
      if (!activeFlight || activeFlight.status !== 'ACTIVE' || hasDepartureTimePassed(activeDeparture.date, activeFlight.departureTime)) {
        return { error: 'La salida no está disponible para reserva.' };
      }

      const activeReservations = await Purchase.findAll({
        where: { passengerId: accountPassenger.id, status: 'RESERVED', expiresAt: { [Op.gt]: new Date() } },
        attributes: ['id', 'departureId', 'classId', 'quantity'],
        transaction
      });
      const classEntry = await Class.findOne({ where: { code: classCode }, transaction });
      if (!classEntry) {
        throw new Error('CLASS_NOT_FOUND');
      }

      const liveAvailability = await getAvailability(activeFlight, activeDeparture, transaction);
      const ownReservationQuantity = activeReservations
        .filter((reservation) => Number(reservation.departureId) === departureId && Number(reservation.classId) === classEntry.id)
        .reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
      const liveAvailable = (liveAvailability[classCode as keyof typeof liveAvailability] ?? 0) + ownReservationQuantity;
      if (quantity > liveAvailable) {
        return { available: liveAvailable };
      }

      for (const reservation of activeReservations) {
        await releaseReservation(reservation.id, 'CANCELADA_POR_USUARIO', transaction);
      }

      const unitPrice = classCode === 'FIRST' ? Number(activeFlight.firstClassPrice) : Number(activeFlight.economyPrice);
      const purchase = await Purchase.create({
        passengerId: accountPassenger.id,
        status: 'RESERVED',
        total: unitPrice * quantity,
        departureId: activeDeparture.id,
        classId: classEntry.id,
        quantity,
        expiresAt: new Date(Date.now() + config.reservationMinutes * 60_000),
        releaseReason: null,
        passengerData: JSON.stringify(normalizedPassengers)
      }, { transaction });

      return { id: purchase.id, status: purchase.status, total: Number(purchase.total), expiresAt: purchase.expiresAt };
    }
  ));

  if ('available' in outcome) {
    return res.status(409).json({
      message: `Solo hay ${outcome.available} asientos disponibles en esa clase.`,
      available: outcome.available,
      errors: { quantity: `Solo hay ${outcome.available} asientos disponibles.` }
    });
  }
  if ('error' in outcome) {
    return res.status(409).json({ message: outcome.error });
  }
  return res.status(201).json(outcome);
}));

app.post('/api/purchases/:id/payment', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchase = await Purchase.findByPk(Number(req.params.id));
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!purchase || !accountPassenger || purchase.passengerId !== accountPassenger.id) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }
  if (purchase.status !== 'RESERVED' || !purchase.expiresAt || purchase.expiresAt.getTime() <= Date.now()) {
    if (purchase.status === 'RESERVED') await releaseReservation(purchase.id, 'EXPIRADA');
    return res.status(409).json({ message: 'La reserva venció o ya no está disponible para pagar.' });
  }

  const departureId = Number(purchase.departureId ?? 0);
  const classId = Number(purchase.classId ?? 0);
  if (!Number.isInteger(departureId) || departureId <= 0 || !Number.isInteger(classId) || classId <= 0) {
    return res.status(409).json({ message: 'La reserva no contiene una salida o clase válida para pagar.' });
  }

  const departure = await Departure.findByPk(departureId);
  const flight = departure ? await Flight.findByPk(departure.flightId) : null;
  const origin = flight ? await Airport.findByPk(flight.originAirportId) : null;
  const destination = flight ? await Airport.findByPk(flight.destinationAirportId) : null;
  const fareClass = await Class.findByPk(classId);
  const className = fareClass?.name;
  if (!departure || departure.status !== 'SCHEDULED' || !flight || flight.status !== 'ACTIVE'
    || hasDepartureTimePassed(departure.date, flight.departureTime) || !className || !origin || !destination) {
    return res.status(409).json({ message: 'La salida ya no está disponible para pagar.' });
  }

  let session: { url: string; reference?: string };
  try {
    session = await paymentGateway.createPaymentSession({
      id: purchase.id,
      total: Number(purchase.total),
      quantity: Number(purchase.quantity),
      flightNumber: flight.flightNumber,
      departureDate: departure.date,
      origin: origin.iata,
      destination: destination.iata,
      className
    });
  } catch {
    await Payment.create({
      purchaseId: purchase.id,
      payerPassengerId: accountPassenger.id,
      departureId,
      classId,
      quantity: Number(purchase.quantity),
      amount: Number(purchase.total),
      reference: null,
      status: 'FAILED',
      paidAt: null
    });
    return res.status(502).json({ message: 'No pudimos comunicarnos con la pasarela de pago. Puede reintentarlo mientras la reserva siga vigente.' });
  }
  if (session.reference) {
    await Payment.findOrCreate({
      where: { reference: session.reference },
      defaults: {
        purchaseId: purchase.id,
        payerPassengerId: accountPassenger.id,
        departureId,
        classId,
        quantity: Number(purchase.quantity),
        amount: Number(purchase.total),
        reference: session.reference,
        status: 'PENDING',
        paidAt: null
      }
    });
  }
  return res.json({ url: session.url, gateway: config.paymentGateway, reference: session.reference });
}));

app.post('/api/purchases/:id/payment/sandbox-result', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchase = await Purchase.findByPk(Number(req.params.id));
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  const reference = typeof req.body?.reference === 'string' ? req.body.reference : '';
  const status = req.body?.status;
  if (!purchase || !accountPassenger || purchase.passengerId !== accountPassenger.id) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }
  if (purchase.status !== 'RESERVED' || !purchase.expiresAt || purchase.expiresAt.getTime() <= Date.now()) {
    return res.status(409).json({ message: 'La reserva venció o ya no está disponible para pagar.' });
  }
  if (!reference || (status !== 'approved' && status !== 'rejected') || !paymentGateway.setSandboxResult) {
    return res.status(400).json({ message: 'El resultado solo está disponible en el sandbox local.' });
  }
  try {
    paymentGateway.setSandboxResult(reference, purchase.id, status);
  } catch {
    return res.status(400).json({ message: 'La referencia de pago local no es válida para esta compra.' });
  }
  return res.json({ reference });
}));

app.post('/api/purchases/:id/payment/confirm', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchaseId = Number(req.params.id);
  const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
  if (!reference) return res.status(400).json({ message: 'La referencia de pago es obligatoria.' });

  const purchase = await Purchase.findByPk(purchaseId);
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!purchase || !accountPassenger || purchase.passengerId !== accountPassenger.id) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }

  const recordedPayment = await Payment.findOne({ where: { reference } });
  if (recordedPayment) {
    if (Number(recordedPayment.purchaseId) !== purchase.id) {
      return res.status(409).json({ message: 'La referencia ya pertenece a otro pago.' });
    }
    if (recordedPayment.status === 'APPROVED') {
      const documentEmail = await sendPurchaseDocuments(purchaseId);
      return res.json({
        status: purchase.status,
        total: Number(purchase.total),
        tickets: await Ticket.findAll({ where: { purchaseId } }),
        emailDelivery: documentEmail ? { status: documentEmail.deliveryStatus, attempts: documentEmail.attempts } : null
      });
    }
    if (recordedPayment.status === 'REJECTED') {
      return res.json({ status: 'REJECTED', message: 'El pago fue rechazado. Puede reintentarlo mientras la reserva siga vigente.' });
    }
    if (recordedPayment.status === 'FAILED') {
      return res.status(502).json({ status: 'FAILED', message: 'No pudimos comunicarnos con la pasarela de pago. Puede iniciar otro intento mientras la reserva siga vigente.' });
    }
    if (recordedPayment.status === 'APPROVED_OUT_OF_TIME') {
      return res.status(409).json({ status: recordedPayment.status, message: 'El pago fue aprobado fuera del plazo. No se emitieron pasajes; el reembolso requiere gestión manual.' });
    }
  } else if (purchase.status !== 'RESERVED'
    && !(purchase.status === 'EXPIRED' && purchase.releaseReason === 'EXPIRADA')) {
    return res.status(409).json({ message: 'La reserva venció o ya no está disponible para pagar.' });
  }

  let verified;
  try {
    verified = await paymentGateway.verifyPayment(reference);
  } catch {
    const failedPayment = recordedPayment ?? await Payment.create({
      purchaseId: purchase.id,
      payerPassengerId: accountPassenger.id,
      departureId: Number(purchase.departureId),
      classId: Number(purchase.classId),
      quantity: Number(purchase.quantity),
      amount: Number(purchase.total),
      reference,
      status: 'PENDING',
      paidAt: null
    });
    failedPayment.status = 'FAILED';
    await failedPayment.save();
    return res.status(502).json({ status: 'FAILED', message: 'No pudimos comunicarnos con la pasarela de pago. Puede iniciar otro intento mientras la reserva siga vigente.' });
  }
  if (verified.externalReference !== String(purchase.id) || verified.reference !== reference
    || Math.abs(verified.amount - Number(purchase.total)) > 0.01) {
    return res.status(400).json({ message: 'El pago verificado no coincide con esta compra o su importe.' });
  }

  const departureId = Number(purchase.departureId);
  const outcome = await withDepartureLock(departureId, () => sequelize.transaction(
    { type: Transaction.TYPES.IMMEDIATE },
    async (transaction) => {
      const currentPurchase = await Purchase.findByPk(purchaseId, { transaction });
      if (!currentPurchase) return { kind: 'missing' as const };

      let payment = await Payment.findOne({ where: { reference }, transaction });
      if (payment && Number(payment.purchaseId) !== currentPurchase.id) return { kind: 'reference-conflict' as const };
      if (payment && payment.status !== 'PENDING') {
        return { kind: 'recorded' as const, status: payment.status, purchaseStatus: currentPurchase.status };
      }
      if (currentPurchase.status === 'CONFIRMED') return { kind: 'already-confirmed' as const };
      if (verified.status === 'pending') {
        const reservationExpired = currentPurchase.status !== 'RESERVED' || !currentPurchase.expiresAt
          || currentPurchase.expiresAt.getTime() <= Date.now();
        if (reservationExpired && currentPurchase.status === 'RESERVED') {
          currentPurchase.status = 'EXPIRED';
          currentPurchase.releaseReason = 'EXPIRADA';
          await currentPurchase.save({ transaction });
        }
        if (!payment) {
          payment = await Payment.create({
            purchaseId: currentPurchase.id,
            payerPassengerId: accountPassenger.id,
            departureId,
            classId: Number(currentPurchase.classId),
            quantity: Number(currentPurchase.quantity),
            amount: Number(currentPurchase.total),
            reference,
            status: 'PENDING',
            paidAt: null
          }, { transaction });
        }
        return { kind: reservationExpired ? 'pending-expired' as const : 'pending' as const };
      }

      const paidAt = verified.paidAt ?? new Date();
      const persistPayment = async (status: string) => {
        if (payment) {
          payment.status = status;
          payment.paidAt = paidAt;
          await payment.save({ transaction });
        } else {
          await Payment.create({
            purchaseId: currentPurchase.id,
            payerPassengerId: accountPassenger.id,
            departureId,
            classId: Number(currentPurchase.classId),
            quantity: Number(currentPurchase.quantity),
            amount: Number(currentPurchase.total),
            reference,
            status,
            paidAt
          }, { transaction });
        }
      };

      if (verified.status === 'rejected') {
        await persistPayment('REJECTED');
        return { kind: 'rejected' as const };
      }

      if (currentPurchase.status !== 'RESERVED' || !currentPurchase.expiresAt
        || currentPurchase.expiresAt.getTime() <= Date.now()) {
        await persistPayment('APPROVED_OUT_OF_TIME');
        if (currentPurchase.status === 'RESERVED') {
          currentPurchase.status = 'EXPIRED';
          currentPurchase.releaseReason = 'EXPIRADA';
          await currentPurchase.save({ transaction });
        }
        return { kind: 'late' as const };
      }

      const activeDeparture = await Departure.findByPk(departureId, { transaction });
      const activeFlight = activeDeparture ? await Flight.findByPk(activeDeparture.flightId, { transaction }) : null;
      const classCode = await Class.findByPk(Number(currentPurchase.classId ?? 0) || -1, { transaction });
      if (!activeDeparture || activeDeparture.status !== 'SCHEDULED' || !activeFlight || activeFlight.status !== 'ACTIVE'
        || hasDepartureTimePassed(activeDeparture.date, activeFlight.departureTime) || !classCode) {
        await persistPayment('APPROVED_OUT_OF_TIME');
        currentPurchase.status = 'EXPIRED';
        currentPurchase.releaseReason = 'EXPIRADA';
        await currentPurchase.save({ transaction });
        return { kind: 'unavailable' as const };
      }

      const isEconomy = classCode.code === 'ECONOMY';
      const capacity = Number(isEconomy ? activeFlight.economySeats : activeFlight.firstClassSeats);
      const sold = Number(isEconomy ? activeDeparture.soldEconomy : activeDeparture.soldFirstClass);
      const otherReservations = await Purchase.sum('quantity', {
        where: {
          departureId,
          classId: classCode.id,
          status: 'RESERVED',
          expiresAt: { [Op.gt]: new Date() },
          id: { [Op.ne]: currentPurchase.id }
        },
        transaction
      });
      const quantity = Number(currentPurchase.quantity);
      if (sold + Number(otherReservations ?? 0) + quantity > capacity) {
        await persistPayment('APPROVED_OUT_OF_TIME');
        currentPurchase.status = 'EXPIRED';
        currentPurchase.releaseReason = 'EXPIRADA';
        await currentPurchase.save({ transaction });
        return { kind: 'unavailable' as const };
      }

      await persistPayment('APPROVED');
      if (isEconomy) activeDeparture.soldEconomy += quantity;
      else activeDeparture.soldFirstClass += quantity;
      await activeDeparture.save({ transaction });
      currentPurchase.status = 'CONFIRMED';
      currentPurchase.releaseReason = null;
      await currentPurchase.save({ transaction });

      const passengerData = typeof currentPurchase.passengerData === 'string'
        ? JSON.parse(currentPurchase.passengerData) as Array<{ firstName: string; lastName: string; document: string }>
        : [];
      const unitPrice = Number(currentPurchase.total) / quantity;
      const issuedTickets = await Ticket.bulkCreate(Array.from({ length: quantity }, () => ({
        purchaseId: currentPurchase.id,
        departureId,
        classId: classCode.id,
        price: unitPrice,
        ticketCode: `SIGVA-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
      })), { transaction });
      const tickets = issuedTickets.map((ticket, index) => ({
        id: ticket.id,
        ticketCode: ticket.ticketCode,
        passenger: passengerData[index] ?? null
      }));
      await ensurePurchaseInvoice(currentPurchase.id, transaction);
      return { kind: 'confirmed' as const, tickets, total: Number(currentPurchase.total) };
    }
  ));

  let documentEmail = null;
  if (outcome.kind === 'confirmed' || outcome.kind === 'already-confirmed'
    || (outcome.kind === 'recorded' && outcome.status === 'APPROVED')) {
    documentEmail = await sendPurchaseDocuments(purchaseId);
  }

  if (outcome.kind === 'missing') return res.status(404).json({ message: 'La compra no existe.' });
  if (outcome.kind === 'reference-conflict') return res.status(409).json({ message: 'La referencia ya pertenece a otro pago.' });
  if (outcome.kind === 'pending') return res.status(202).json({ status: 'PENDING', message: 'El pago sigue pendiente.' });
  if (outcome.kind === 'pending-expired') return res.status(409).json({ status: 'PENDING', message: 'La reserva venció; el pago continúa pendiente y no se emitieron pasajes.' });
  if (outcome.kind === 'late') return res.status(409).json({ status: 'APPROVED_OUT_OF_TIME', message: 'El pago fue aprobado después del vencimiento. No se emitieron pasajes; el reembolso requiere gestión manual.' });
  if (outcome.kind === 'unavailable') return res.status(409).json({ status: 'APPROVED_OUT_OF_TIME', message: 'La salida dejó de estar disponible. No se emitieron pasajes; el pago requiere gestión manual.' });
  if (outcome.kind === 'rejected') return res.json({ status: 'REJECTED', message: 'El pago fue rechazado. Puede reintentarlo mientras la reserva siga vigente.' });
  if (outcome.kind === 'recorded') {
    if (outcome.status === 'APPROVED') {
      const tickets = await Ticket.findAll({ where: { purchaseId } });
      return res.json({
        status: outcome.purchaseStatus,
        total: Number(purchase.total),
        tickets,
        emailDelivery: documentEmail ? { status: documentEmail.deliveryStatus, attempts: documentEmail.attempts } : null
      });
    }
    return res.json({ status: outcome.status, message: 'Este resultado de pago ya había sido registrado.' });
  }
  if (outcome.kind === 'already-confirmed') return res.status(409).json({ message: 'La compra ya fue confirmada con otra referencia de pago.' });
  return res.json({
    status: 'CONFIRMED',
    total: outcome.total,
    tickets: outcome.tickets,
    emailDelivery: documentEmail ? { status: documentEmail.deliveryStatus, attempts: documentEmail.attempts } : null
  });
}));

app.post('/api/purchases/:id/email/retry', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchase = await Purchase.findByPk(Number(req.params.id));
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!purchase || !accountPassenger || purchase.passengerId !== accountPassenger.id) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }
  const deliveries = await retryPurchaseEmails(purchase.id);
  return res.json({ deliveries });
}));

app.get('/api/purchases/:id/tickets/:ticketId.pdf', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchase = await Purchase.findByPk(Number(req.params.id));
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!purchase || !accountPassenger || purchase.passengerId !== accountPassenger.id || purchase.status !== 'CONFIRMED') {
    return res.status(404).json({ message: 'El pasaje no existe.' });
  }
  const pdf = await createTicketPdf(purchase.id, Number(req.params.ticketId));
  if (!pdf) return res.status(404).json({ message: 'El pasaje no existe.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="pasaje-${req.params.ticketId}.pdf"`);
  return res.send(pdf);
}));

app.get('/api/purchases/:id/invoice.pdf', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchase = await Purchase.findByPk(Number(req.params.id));
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!purchase || !accountPassenger || purchase.passengerId !== accountPassenger.id || purchase.status !== 'CONFIRMED') {
    return res.status(404).json({ message: 'La factura no existe.' });
  }
  const pdf = await createInvoicePdf(purchase.id);
  if (!pdf) return res.status(404).json({ message: 'La factura no existe.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="factura-${purchase.id}.pdf"`);
  return res.send(pdf);
}));

app.get('/api/purchases', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  await expireReservations();
  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!accountPassenger) return res.json({ purchases: [] });
  const purchases = await Purchase.findAll({ where: { passengerId: accountPassenger.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']] });
  const result = [];
  for (const purchase of purchases) {
    const purchaseCreatedAt = new Date(purchase.get('createdAt') as Date);
    const ticket = await Ticket.findOne({ where: { purchaseId: purchase.id }, order: [['id', 'ASC']] });
    const departureId = Number(ticket?.departureId ?? purchase.departureId ?? 0);
    const departure = departureId ? await Departure.findByPk(departureId) : null;
    const flight = departure ? await Flight.findByPk(departure.flightId) : null;
    const origin = flight ? await Airport.findByPk(flight.originAirportId) : null;
    const destination = flight ? await Airport.findByPk(flight.destinationAirportId) : null;
    const fareClass = ticket ? await Class.findByPk(Number(ticket.classId))
      : purchase.classId ? await Class.findByPk(Number(purchase.classId)) : null;
    let status = purchase.status;
    if (purchase.status === 'CONFIRMED' && (departure?.status === 'CANCELLED' || flight?.status === 'CANCELLED')) {
      status = 'CANCELLED';
    } else if (purchase.status === 'CONFIRMED' && flight && await FlightChangeHistory.findOne({
      where: { flightId: flight.id, changedAt: { [Op.gte]: purchaseCreatedAt } }
    })) {
      status = 'MODIFIED';
    }
    result.push({
      id: purchase.id,
      purchasedAt: purchaseCreatedAt,
      flightNumber: flight?.flightNumber ?? '',
      origin: origin?.iata ?? '',
      destination: destination?.iata ?? '',
      departureDate: departure?.date ?? '',
      className: fareClass?.name ?? '',
      quantity: Number(purchase.quantity),
      total: Number(purchase.total),
      status
    });
  }
  return res.json({ purchases: result });
}));

app.get('/api/purchases/:id', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  await expireReservations();
  const purchaseId = Number(req.params.id);
  const purchase = await Purchase.findByPk(purchaseId);
  if (!purchase) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }

  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!accountPassenger || purchase.passengerId !== accountPassenger.id) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }

  const tickets = purchase.status === 'CONFIRMED'
    ? await Ticket.findAll({ where: { purchaseId: purchase.id } })
    : [];
  const passengerData = typeof purchase.passengerData === 'string' ? JSON.parse(purchase.passengerData) : [];
  const firstTicket = tickets[0];
  const purchaseDepartureId = firstTicket?.departureId ?? purchase.departureId;
  const purchaseClassId = firstTicket?.classId ?? purchase.classId;
  const departure = purchaseDepartureId ? await Departure.findByPk(purchaseDepartureId) : null;
  const flight = departure ? await Flight.findByPk(departure.flightId) : null;
  const origin = flight ? await Airport.findByPk(flight.originAirportId) : null;
  const destination = flight ? await Airport.findByPk(flight.destinationAirportId) : null;
  const fareClass = purchaseClassId ? await Class.findByPk(purchaseClassId) : null;
  const emailDelivery = await getPurchaseDocumentEmail(purchase.id);
  const purchaseCreatedAt = new Date(purchase.get('createdAt') as Date);
  let tripStatus = purchase.status;
  if (purchase.status === 'CONFIRMED' && (departure?.status === 'CANCELLED' || flight?.status === 'CANCELLED')) {
    tripStatus = 'CANCELLED';
  } else if (purchase.status === 'CONFIRMED' && flight && await FlightChangeHistory.findOne({
    where: { flightId: flight.id, changedAt: { [Op.gte]: purchaseCreatedAt } }
  })) {
    tripStatus = 'MODIFIED';
  }

  return res.json({
    id: purchase.id,
    status: purchase.status,
    total: Number(purchase.total),
    expiresAt: purchase.expiresAt,
    emailDelivery,
    emailDeliveries: await getPurchaseEmailDeliveries(purchase.id),
    tripStatus,
    releaseReason: purchase.releaseReason,
    departureId: firstTicket ? firstTicket.departureId : purchase.departureId ?? null,
    flight: departure && flight && origin && destination ? {
      flightNumber: flight.flightNumber,
      origin: origin.iata,
      destination: destination.iata,
      date: departure.date,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      arrivalNextDay: flight.arrivalTime <= flight.departureTime,
      className: fareClass?.name ?? '',
      status: departure.status
    } : null,
    passengers: passengerData,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      ticketCode: ticket.ticketCode,
      departureId: ticket.departureId,
      classId: ticket.classId,
      price: Number(ticket.price)
    }))
  });
}));

app.post('/api/purchases/:id/cancel', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  const purchaseId = Number(req.params.id);
  const purchase = await Purchase.findByPk(purchaseId);
  if (!purchase) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }

  const accountPassenger = await Passenger.findOne({ where: { userId: req.user!.id } });
  if (!accountPassenger || purchase.passengerId !== accountPassenger.id) {
    return res.status(404).json({ message: 'La compra no existe.' });
  }
  if (purchase.status !== 'RESERVED') {
    return res.status(409).json({ message: 'Solo se pueden cancelar reservas activas.' });
  }

  await releaseReservation(purchase.id, 'CANCELADA_POR_USUARIO');
  return res.json({ message: 'La reserva se canceló correctamente.', status: 'EXPIRED' });
}));

app.post('/api/purchases/quote', requireAuth, requireRole('passenger'), asyncHandler(async (req, res) => {
  await expireReservations();

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

  const availability = await getAvailability(flight, departure);
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

app.get('/api/admin/accounts', requireAuth, requireRole('admin'), asyncHandler(async (_req, res) => {
  const accounts = await User.findAll({
    include: [{ model: Role, as: 'role', where: { name: { [Op.in]: ['employee', 'admin'] } } }],
    order: [['name', 'ASC'], ['id', 'ASC']]
  });
  return res.json({ accounts: accounts.map((account) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role?.name,
    isActive: account.isActive
  })) });
}));

app.post('/api/admin/accounts', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const roleName = req.body?.role;
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'El nombre es obligatorio.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Debe ingresar un email válido.';
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) errors.password = 'La contraseña debe tener al menos 8 caracteres, una letra y un número.';
  if (roleName !== 'employee' && roleName !== 'admin') errors.role = 'Seleccione empleado de mostrador o administrador.';
  if (Object.keys(errors).length > 0) return res.status(400).json({ message: 'Revise los campos indicados.', errors });
  if (await User.findOne({ where: { email } })) return res.status(409).json({ message: 'Ya existe una cuenta con ese email.', errors: { email: 'El email ya está registrado.' } });

  const role = await Role.findOne({ where: { name: roleName } });
  if (!role) return res.status(500).json({ message: 'No se encontró el rol solicitado.' });
  const account = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), roleId: role.id });
  return res.status(201).json({ account: { id: account.id, name: account.name, email: account.email, role: roleName, isActive: account.isActive } });
}));

app.put('/api/admin/accounts/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  if (req.body?.name !== undefined && (typeof req.body.name !== 'string' || !req.body.name.trim())) {
    return res.status(400).json({ message: 'El nombre es obligatorio.', errors: { name: 'El nombre es obligatorio.' } });
  }
  if (req.body?.role !== undefined && req.body.role !== 'employee' && req.body.role !== 'admin') {
    return res.status(400).json({ message: 'Seleccione empleado de mostrador o administrador.', errors: { role: 'Seleccione un rol válido.' } });
  }
  const outcome = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const account = await User.findByPk(Number(req.params.id), {
      include: [{ model: Role, as: 'role' }], transaction
    });
    if (!account || !['admin', 'employee'].includes(account.role?.name ?? '')) return { error: 'missing' as const };
    const roleName = req.body?.role ?? account.role?.name;
    const role = await Role.findOne({ where: { name: roleName }, transaction });
    if (!role) return { error: 'role' as const };
    if (account.isActive && account.role?.name === 'admin' && roleName !== 'admin') {
      const activeAdmins = await User.count({
        where: { isActive: true },
        include: [{ model: Role, as: 'role', where: { name: 'admin' } }],
        transaction
      });
      if (activeAdmins <= 1) return { error: 'last-admin' as const };
    }
    const name = req.body?.name === undefined ? account.name : req.body.name.trim();
    await account.update({ name, roleId: role.id }, { transaction });
    return { account: { id: account.id, name, email: account.email, role: roleName, isActive: account.isActive } };
  });
  if (outcome.error === 'missing') return res.status(404).json({ message: 'La cuenta no existe.' });
  if (outcome.error === 'last-admin') return res.status(409).json({ message: 'Debe quedar al menos un administrador activo.' });
  if (outcome.error === 'role') return res.status(500).json({ message: 'No se encontró el rol solicitado.' });
  return res.json({ account: outcome.account });
}));

app.delete('/api/admin/accounts/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const outcome = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const account = await User.findByPk(Number(req.params.id), {
      include: [{ model: Role, as: 'role' }], transaction
    });
    if (!account || !['admin', 'employee'].includes(account.role?.name ?? '')) return { error: 'missing' as const };
    if (account.id === req.user!.id) return { error: 'self' as const };
    if (account.isActive && account.role?.name === 'admin') {
      const activeAdmins = await User.count({
        where: { isActive: true },
        include: [{ model: Role, as: 'role', where: { name: 'admin' } }],
        transaction
      });
      if (activeAdmins <= 1) return { error: 'last-admin' as const };
    }
    await account.update({ isActive: false }, { transaction });
    await Session.update({ revoked: true }, { where: { userId: account.id }, transaction });
    return { account: { id: account.id, isActive: false } };
  });
  if (outcome.error === 'missing') return res.status(404).json({ message: 'La cuenta no existe.' });
  if (outcome.error === 'self') return res.status(409).json({ message: 'No puede darse de baja a sí mismo.' });
  if (outcome.error === 'last-admin') return res.status(409).json({ message: 'Debe quedar al menos un administrador activo.' });
  return res.json({ message: 'La cuenta fue dada de baja.', account: outcome.account });
}));

app.get('/api/reports/occupancy', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const filters: string[] = [];
  const replacements: Record<string, string> = {};
  const flightNumber = typeof req.query.flight === 'string' ? req.query.flight.trim().toUpperCase() : '';
  const origin = typeof req.query.origin === 'string' ? req.query.origin.trim().toUpperCase() : '';
  const destination = typeof req.query.destination === 'string' ? req.query.destination.trim().toUpperCase() : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const requestedPage = Number.parseInt(typeof req.query.page === 'string' ? req.query.page : '', 10);
  const requestedPageSize = Number.parseInt(typeof req.query.pageSize === 'string' ? req.query.pageSize : '', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 100) : 50;
  const offset = (page - 1) * pageSize;
  if (flightNumber) { filters.push('f.flightNumber = :flightNumber'); replacements.flightNumber = flightNumber; }
  if (origin) { filters.push('origin.iata = :origin'); replacements.origin = origin; }
  if (destination) { filters.push('destination.iata = :destination'); replacements.destination = destination; }
  if (from) { filters.push('d.date >= :from'); replacements.from = from; }
  if (to) { filters.push('d.date <= :to'); replacements.to = to; }

  type OccupancyRow = {
    departureId: number;
    departureDate: string;
    departureStatus: string;
    flightNumber: string;
    origin: string;
    destination: string;
    classCode: string;
    className: string;
    capacity: number;
    soldTickets: number;
    totalRows: number;
    totalCapacity: number;
    totalSoldTickets: number;
  };
  const rows = await sequelize.query<OccupancyRow>(`
    WITH report_rows AS (
      SELECT d.id AS departureId, d.date AS departureDate, d.status AS departureStatus,
        f.flightNumber AS flightNumber, origin.iata AS origin, destination.iata AS destination,
        classes.code AS classCode, classes.name AS className,
        CASE WHEN classes.code = 'ECONOMY' THEN f.economySeats ELSE f.firstClassSeats END AS capacity,
        COUNT(t.id) AS soldTickets
      FROM departures d
      JOIN flights f ON f.id = d.flightId
      JOIN airports origin ON origin.id = f.originAirportId
      JOIN airports destination ON destination.id = f.destinationAirportId
      CROSS JOIN classes
      LEFT JOIN tickets t ON t.departureId = d.id AND t.classId = classes.id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      GROUP BY d.id, classes.id
    ), report_with_totals AS (
      SELECT report_rows.*, COUNT(*) OVER() AS totalRows,
        SUM(capacity) OVER() AS totalCapacity, SUM(soldTickets) OVER() AS totalSoldTickets
      FROM report_rows
    )
    SELECT * FROM report_with_totals
    ORDER BY departureDate, flightNumber, classCode
    LIMIT :pageSize OFFSET :offset
  `, { replacements: { ...replacements, pageSize, offset }, type: QueryTypes.SELECT });
  const report = rows.map((row) => {
    const capacity = Number(row.capacity);
    const soldTickets = Number(row.soldTickets);
    return { ...row, capacity, soldTickets, occupancy: capacity > 0 ? soldTickets / capacity * 100 : 0 };
  });
  const totalRows = Number(rows[0]?.totalRows ?? 0);
  const totals = {
    capacity: Number(rows[0]?.totalCapacity ?? 0),
    soldTickets: Number(rows[0]?.totalSoldTickets ?? 0)
  };
  return res.json({
    rows: report,
    totals: { ...totals, occupancy: totals.capacity > 0 ? totals.soldTickets / totals.capacity * 100 : 0 },
    pagination: { page, pageSize, totalRows }
  });
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

let reservationSweepInterval: NodeJS.Timeout | null = null;

export function startReservationSweep() {
  if (reservationSweepInterval || process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return;
  }

  reservationSweepInterval = setInterval(() => {
    void expireReservations();
  }, 30_000);
  reservationSweepInterval.unref?.();
}

export async function startServer() {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET es obligatorio.');
  }
  await syncDatabase();
  startReservationSweep();
  app.listen(config.port);
}
