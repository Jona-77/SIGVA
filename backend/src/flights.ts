import { Router, type Request, type Response } from 'express';
import type { Order } from 'sequelize';
import { Airport, Cancellation, Class, Departure, Fare, Flight, FlightChangeHistory, sequelize, User, type FlightModel } from './db/index.js';
import { requireAuth, requireRole } from './auth.js';
import { asyncHandler } from './asyncHandler.js';

const pageSize = 20;
const weekdays = new Set([1, 2, 3, 4, 5, 6, 7]);
let todayProvider = argentinaToday;
let timeProvider = argentinaCurrentTime;

function argentinaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function argentinaCurrentTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}`;
}

export function setFlightTodayProvider(provider?: () => string) {
  todayProvider = provider ?? argentinaToday;
}

export function setFlightTimeProvider(provider?: () => string) {
  timeProvider = provider ?? argentinaCurrentTime;
}

function hasDepartureTimePassed(date: string, departureTime: string) {
  const today = todayProvider();
  return date < today || (date === today && departureTime <= timeProvider());
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function getFieldErrors(body: Record<string, unknown>, validateAvailableFrom = true) {
  const errors: Record<string, string> = {};
  const required = [
    'flightNumber',
    'daysOfWeek',
    'departureTime',
    'arrivalTime',
    'originAirportId',
    'destinationAirportId',
    'availableFrom',
    'availableTo',
    'economySeats',
    'firstClassSeats',
    'economyPrice',
    'firstClassPrice'
  ];

  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      errors[field] = 'Este campo es obligatorio.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return errors;
  }

  if (typeof body.flightNumber !== 'string' || !body.flightNumber.trim()) {
    errors.flightNumber = 'Ingrese un número de vuelo válido.';
  }
  if (!Array.isArray(body.daysOfWeek) || body.daysOfWeek.length === 0
    || body.daysOfWeek.some((day) => !Number.isInteger(day) || !weekdays.has(day))) {
    errors.daysOfWeek = 'Seleccione al menos un día válido de la semana.';
  }
  for (const field of ['departureTime', 'arrivalTime']) {
    if (typeof body[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field])) {
      errors[field] = 'Ingrese una hora válida en formato HH:MM.';
    }
  }
  for (const field of ['originAirportId', 'destinationAirportId']) {
    if (!Number.isInteger(Number(body[field])) || Number(body[field]) <= 0) {
      errors[field] = 'Seleccione un aeropuerto válido.';
    }
  }
  for (const field of ['availableFrom', 'availableTo']) {
    if (!isDateOnly(body[field])) {
      errors[field] = 'Ingrese una fecha válida.';
    }
  }
  for (const field of ['economySeats', 'firstClassSeats']) {
    if (typeof body[field] !== 'number' || !Number.isInteger(body[field]) || body[field] < 0) {
      errors[field] = 'Ingrese una cantidad entera igual o mayor que cero.';
    }
  }
  for (const field of ['economyPrice', 'firstClassPrice']) {
    if (typeof body[field] !== 'number' || !Number.isFinite(body[field]) || body[field] < 0) {
      errors[field] = 'Ingrese un precio igual o mayor que cero.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return errors;
  }

  if (Number(body.economySeats) + Number(body.firstClassSeats) <= 0) {
    errors.economySeats = 'La capacidad total debe ser mayor que cero.';
    errors.firstClassSeats = 'La capacidad total debe ser mayor que cero.';
  }
  if (Number(body.economySeats) > 0 && Number(body.economyPrice) <= 0) {
    errors.economyPrice = 'El precio debe ser mayor que cero si la clase tiene asientos.';
  }
  if (Number(body.firstClassSeats) > 0 && Number(body.firstClassPrice) <= 0) {
    errors.firstClassPrice = 'El precio debe ser mayor que cero si la clase tiene asientos.';
  }
  if (Number(body.originAirportId) === Number(body.destinationAirportId)) {
    errors.destinationAirportId = 'El origen y el destino deben ser distintos.';
  }
  if (validateAvailableFrom && String(body.availableFrom) < todayProvider()) {
    errors.availableFrom = 'La fecha desde no puede ser anterior al día actual.';
  }
  if (String(body.availableTo) < String(body.availableFrom)) {
    errors.availableTo = 'La fecha hasta debe ser igual o posterior a la fecha desde.';
  }
  return errors;
}

function enumerateDepartureDates(from: string, to: string, days: number[]) {
  const result: string[] = [];
  const allowedDays = new Set(days);
  const [startYear, startMonth, startDay] = from.split('-').map(Number);
  const [endYear, endMonth, endDay] = to.split('-').map(Number);
  const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = Date.UTC(endYear, endMonth - 1, endDay);

  while (current.getTime() <= end) {
    const weekday = current.getUTCDay() || 7;
    if (allowedDays.has(weekday)) {
      result.push(current.toISOString().slice(0, 10));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

function sortOrder(sortBy: unknown, direction: unknown): Order {
  const order = direction === 'desc' ? 'DESC' : 'ASC';
  if (sortBy === 'route') {
    return [[{ model: Airport, as: 'origin' }, 'iata', order], [{ model: Airport, as: 'destination' }, 'iata', order], ['id', order]];
  }
  if (sortBy === 'departure') {
    return [['departureTime', order], ['id', order]];
  }
  return [['flightNumber', order], ['id', order]];
}

function isPositiveInteger(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function normalizeFlightDays(days: unknown) {
  if (!Array.isArray(days)) {
    return [] as number[];
  }
  return [...new Set(days.map((day) => Number(day)).filter((day) => Number.isInteger(day) && weekdays.has(day)))].sort((a, b) => a - b);
}

function parseHistoryValue(value: string | null) {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function serializeFlight(flight: FlightModel, history: Array<Record<string, unknown>> = []) {
  const departures = (flight.departures ?? []).map((departure) => ({
    id: departure.id,
    date: departure.date,
    status: departure.status,
    departureTimePassed: hasDepartureTimePassed(departure.date, flight.departureTime),
    soldEconomy: departure.soldEconomy,
    availableEconomy: Math.max(0, flight.economySeats - departure.soldEconomy),
    soldFirstClass: departure.soldFirstClass,
    availableFirstClass: Math.max(0, flight.firstClassSeats - departure.soldFirstClass)
  }));

  return {
    ...flight.toJSON(),
    arrivalsNextDay: flight.arrivalTime <= flight.departureTime,
    departures,
    history
  };
}

async function loadFlightDetail(flightId: number) {
  const flight = await Flight.findByPk(flightId, {
    include: [
      { model: Airport, as: 'origin' },
      { model: Airport, as: 'destination' },
      { model: Departure, as: 'departures', order: [['date', 'ASC']] }
    ]
  });

  if (!flight) {
    return null;
  }

  const changes = await FlightChangeHistory.findAll({
    where: { flightId },
    order: [['changedAt', 'ASC'], ['id', 'ASC']]
  });
  const users = await User.findAll({
    where: { id: [...new Set(changes.map((change) => Number(change.get('userId'))))] }
  });
  const usersById = new Map(users.map((user) => [user.id, user.email]));
  const history = changes.map((change) => ({
    id: change.id,
    changedAt: change.changedAt,
    userId: change.userId,
    userEmail: usersById.get(Number(change.userId)) ?? '',
    field: change.field,
    previousValue: parseHistoryValue(change.previousValue ?? null),
    newValue: parseHistoryValue(change.newValue ?? null)
  }));
  return serializeFlight(flight, history);
}

async function updateFlightHandler(req: Request, res: Response) {
  const flight = await Flight.findByPk(Number(req.params.id), { include: [{ model: Departure, as: 'departures' }] });
  if (!flight) {
    return res.status(404).json({ message: 'Vuelo no encontrado.' });
  }
  if (flight.status !== 'ACTIVE') {
    return res.status(400).json({ message: 'Solo se pueden modificar vuelos activos.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  if (body.confirmed !== true) {
    return res.status(409).json({
      message: 'Confirme la modificación del vuelo.',
      requiresConfirmation: true,
      conflicts: []
    });
  }
  const values = {
    departureTime: body.departureTime ?? flight.departureTime,
    arrivalTime: body.arrivalTime ?? flight.arrivalTime,
    originAirportId: body.originAirportId !== undefined ? Number(body.originAirportId) : flight.originAirportId,
    destinationAirportId: body.destinationAirportId !== undefined ? Number(body.destinationAirportId) : flight.destinationAirportId,
    availableFrom: body.availableFrom ?? flight.availableFrom,
    availableTo: body.availableTo ?? flight.availableTo,
    daysOfWeek: body.daysOfWeek ?? flight.daysOfWeek.split(',').map(Number),
    economySeats: body.economySeats !== undefined ? Number(body.economySeats) : flight.economySeats,
    firstClassSeats: body.firstClassSeats !== undefined ? Number(body.firstClassSeats) : flight.firstClassSeats,
    economyPrice: body.economyPrice !== undefined ? Number(body.economyPrice) : flight.economyPrice,
    firstClassPrice: body.firstClassPrice !== undefined ? Number(body.firstClassPrice) : flight.firstClassPrice
  };

  const errors = getFieldErrors({
    ...values,
    flightNumber: flight.flightNumber,
    daysOfWeek: values.daysOfWeek
  }, String(values.availableFrom) !== flight.availableFrom);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors });
  }

  const [origin, destination] = await Promise.all([
    Airport.findByPk(Number(values.originAirportId)),
    Airport.findByPk(Number(values.destinationAirportId))
  ]);
  if (!origin?.isActive || !destination?.isActive) {
    return res.status(400).json({ message: 'Los aeropuertos deben estar activos.' });
  }

  const normalizedDays = normalizeFlightDays(values.daysOfWeek);
  const newDates = enumerateDepartureDates(String(values.availableFrom), String(values.availableTo), normalizedDays);
  const allFutureDepartures = (await Departure.findAll({ where: { flightId: flight.id } }))
    .filter((departure) => !hasDepartureTimePassed(departure.date, flight.departureTime) && departure.status !== 'CANCELLED');

  const capacityConflicts: Array<Record<string, unknown>> = [];
  const scheduleConflicts: Array<Record<string, unknown>> = [];
  for (const departure of allFutureDepartures) {
    if (values.economySeats < departure.soldEconomy) {
      capacityConflicts.push({ departureDate: departure.date, field: 'economySeats', soldEconomy: departure.soldEconomy, requestedSeats: values.economySeats });
    }
    if (values.firstClassSeats < departure.soldFirstClass) {
      capacityConflicts.push({ departureDate: departure.date, field: 'firstClassSeats', soldFirstClass: departure.soldFirstClass, requestedSeats: values.firstClassSeats });
    }
    if (!newDates.includes(departure.date) && (departure.soldEconomy > 0 || departure.soldFirstClass > 0)) {
      scheduleConflicts.push({ departureDate: departure.date, field: 'schedule', reason: 'La salida deja de corresponder al vuelo y tiene pasajes vendidos.' });
    }
  }

  if (capacityConflicts.length > 0) {
    return res.status(400).json({
      message: 'La capacidad no puede ser menor que los pasajes vendidos.',
      conflicts: capacityConflicts
    });
  }
  if (scheduleConflicts.length > 0 && body.confirmedConflicts !== true) {
    return res.status(409).json({
      message: 'Existen salidas futuras con pasajes vendidos que requieren confirmación.',
      requiresConfirmation: true,
      conflicts: scheduleConflicts
    });
  }

  const previousValues = {
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    originAirportId: flight.originAirportId,
    destinationAirportId: flight.destinationAirportId,
    availableFrom: flight.availableFrom,
    availableTo: flight.availableTo,
    daysOfWeek: normalizeFlightDays(flight.daysOfWeek.split(',')).join(','),
    economySeats: flight.economySeats,
    firstClassSeats: flight.firstClassSeats,
    economyPrice: flight.economyPrice,
    firstClassPrice: flight.firstClassPrice
  };

  const newValues = {
    ...values,
    daysOfWeek: normalizedDays.join(',')
  };
  const updatedFields = Object.keys(previousValues).filter((key) =>
    String((previousValues as Record<string, unknown>)[key]) !== String((newValues as Record<string, unknown>)[key])
  );
  const newSet = new Set(newDates);
  const futureDates = Array.from(newSet).filter((date) => !hasDepartureTimePassed(date, String(values.departureTime)));
  await sequelize.transaction(async (transaction) => {
    const changedAt = new Date();
    for (const field of updatedFields) {
      const previousValue = (previousValues as Record<string, unknown>)[field];
      const newValue = (newValues as Record<string, unknown>)[field];
      await FlightChangeHistory.create({
        flightId: flight.id,
        changedAt,
        userId: req.user!.id,
        field,
        previousValue: JSON.stringify(previousValue),
        newValue: JSON.stringify(newValue)
      }, { transaction });
    }

    await flight.update({
      departureTime: String(values.departureTime),
      arrivalTime: String(values.arrivalTime),
      originAirportId: Number(values.originAirportId),
      destinationAirportId: Number(values.destinationAirportId),
      availableFrom: String(values.availableFrom),
      availableTo: String(values.availableTo),
      daysOfWeek: normalizedDays.join(','),
      economySeats: Number(values.economySeats),
      firstClassSeats: Number(values.firstClassSeats),
      economyPrice: Number(values.economyPrice),
      firstClassPrice: Number(values.firstClassPrice)
    }, { transaction });

    const fareClasses = await Class.findAll({ transaction });
    for (const fareClass of fareClasses) {
      const isEconomy = fareClass.get('code') === 'ECONOMY';
      await Fare.upsert({
        flightId: flight.id,
        classId: fareClass.id,
        price: isEconomy ? Number(values.economyPrice) : Number(values.firstClassPrice),
        capacity: isEconomy ? Number(values.economySeats) : Number(values.firstClassSeats)
      }, { transaction });
    }

    const existingDepartures = await Departure.findAll({ where: { flightId: flight.id }, transaction });
    for (const departure of existingDepartures) {
      if (newSet.has(departure.date) || hasDepartureTimePassed(departure.date, flight.departureTime)) continue;
      const soldCount = departure.soldEconomy + departure.soldFirstClass;
      if (soldCount > 0) {
        departure.status = 'CANCELLED';
        departure.cancelledAt = changedAt.toISOString();
        departure.cancelledByUserId = req.user!.id;
        await departure.save({ transaction });
        await Cancellation.create({ departureId: departure.id, cancelledAt: changedAt, userId: req.user!.id }, { transaction });
      } else {
        await departure.destroy({ transaction });
      }
    }

    for (const date of futureDates) {
      const exists = existingDepartures.some((departure) => departure.date === date);
      if (!exists) {
        await Departure.create({ flightId: flight.id, date, status: 'SCHEDULED' }, { transaction });
      }
    }
  });

  const detail = await loadFlightDetail(flight.id);
  return res.json({
    message: 'Vuelo actualizado correctamente.',
    requiresConfirmation: false,
    flight: detail,
    updatedFields
  });
}

async function cancelFlightHandler(req: Request, res: Response) {
  const flight = await Flight.findByPk(Number(req.params.id), { include: [{ model: Departure, as: 'departures' }] });
  if (!flight) {
    return res.status(404).json({ message: 'Vuelo no encontrado.' });
  }
  if (flight.status !== 'ACTIVE') {
    return res.status(400).json({ message: 'El vuelo ya está cancelado.' });
  }

  const departureDate = typeof req.body?.departureDate === 'string' ? req.body.departureDate : undefined;
  const confirmed = req.body?.confirmed === true;

  if (departureDate) {
    const departure = await Departure.findOne({ where: { flightId: flight.id, date: departureDate } });
    if (!departure) {
      return res.status(404).json({ message: 'Salida no encontrada.' });
    }
    if (departure.status === 'CANCELLED') {
      return res.status(400).json({ message: 'La salida ya está cancelada.' });
    }
    if (hasDepartureTimePassed(departure.date, flight.departureTime)) {
      return res.status(400).json({ message: 'No es posible cancelar salidas cuya fecha ya pasó.' });
    }
    const affected = departure.soldEconomy + departure.soldFirstClass;
    if (!confirmed) {
      return res.status(409).json({
        message: 'Confirme la cancelación de la salida.',
        requiresConfirmation: true,
        affectedPassengers: affected,
        departureDate: departure.date
      });
    }
    await sequelize.transaction(async (transaction) => {
      const cancelledAt = new Date();
      departure.status = 'CANCELLED';
      departure.cancelledAt = cancelledAt.toISOString();
      departure.cancelledByUserId = req.user!.id;
      await departure.save({ transaction });
      await Cancellation.create({
        departureId: departure.id,
        cancelledAt,
        userId: req.user!.id
      }, { transaction });
    });
    return res.json({
      message: 'Salida cancelada correctamente.',
      flight: await loadFlightDetail(flight.id),
      affectedPassengers: affected
    });
  }

  const futureDepartures = (flight.departures ?? [])
    .filter((departure) => !hasDepartureTimePassed(departure.date, flight.departureTime) && departure.status !== 'CANCELLED');
  const affectedPassengers = futureDepartures.reduce((total, departure) => total + departure.soldEconomy + departure.soldFirstClass, 0);
  if (!confirmed) {
    return res.status(409).json({
      message: 'Confirme la cancelación del vuelo.',
      requiresConfirmation: true,
      affectedPassengers,
      totalDepartures: futureDepartures.length
    });
  }

  await sequelize.transaction(async (transaction) => {
    const cancelledAt = new Date();
    for (const departure of futureDepartures) {
      departure.status = 'CANCELLED';
      departure.cancelledAt = cancelledAt.toISOString();
      departure.cancelledByUserId = req.user!.id;
      await departure.save({ transaction });
    }
    flight.status = 'CANCELLED';
    flight.cancelledAt = cancelledAt.toISOString();
    flight.cancelledByUserId = req.user!.id;
    await flight.save({ transaction });
    await Cancellation.create({ flightId: flight.id, cancelledAt, userId: req.user!.id }, { transaction });
  });
  return res.json({
    message: 'Vuelo cancelado correctamente.',
    flight: await loadFlightDetail(flight.id),
    affectedPassengers
  });
}

export const flightsRouter = Router();
flightsRouter.use(requireAuth, requireRole('admin'));

flightsRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const errors = getFieldErrors(body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors });
  }

  const flightNumber = String(body.flightNumber).trim().toUpperCase();
  const duplicate = await Flight.findOne({ where: { flightNumber } });
  if (duplicate) {
    return res.status(409).json({
      message: 'Ya existe un vuelo con ese número.',
      errors: { flightNumber: 'El número de vuelo ya está registrado.' }
    });
  }

  const [origin, destination] = await Promise.all([
    Airport.findByPk(Number(body.originAirportId)),
    Airport.findByPk(Number(body.destinationAirportId))
  ]);
  const airportErrors: Record<string, string> = {};
  if (!origin?.isActive) {
    airportErrors.originAirportId = 'Seleccione un aeropuerto de origen activo.';
  }
  if (!destination?.isActive) {
    airportErrors.destinationAirportId = 'Seleccione un aeropuerto de destino activo.';
  }
  if (Object.keys(airportErrors).length > 0) {
    return res.status(400).json({ message: 'Revise los campos indicados.', errors: airportErrors });
  }

  const days = [...new Set((body.daysOfWeek as number[]).map(Number))].sort((a, b) => a - b);
  const dates = enumerateDepartureDates(String(body.availableFrom), String(body.availableTo), days)
    .filter((date) => !hasDepartureTimePassed(date, String(body.departureTime)));
  const flight = await Flight.sequelize!.transaction(async (transaction) => {
    const created = await Flight.create({
      flightNumber,
      daysOfWeek: days.join(','),
      departureTime: String(body.departureTime),
      arrivalTime: String(body.arrivalTime),
      originAirportId: Number(body.originAirportId),
      destinationAirportId: Number(body.destinationAirportId),
      availableFrom: String(body.availableFrom),
      availableTo: String(body.availableTo),
      economySeats: Number(body.economySeats),
      firstClassSeats: Number(body.firstClassSeats),
      economyPrice: Number(body.economyPrice),
      firstClassPrice: Number(body.firstClassPrice),
      status: 'ACTIVE'
    }, { transaction });
    const classes = await Class.findAll({ transaction });
    await Fare.bulkCreate(classes.map((fareClass) => ({
      flightId: created.id,
      classId: fareClass.id,
      price: fareClass.get('code') === 'ECONOMY' ? Number(body.economyPrice) : Number(body.firstClassPrice),
      capacity: fareClass.get('code') === 'ECONOMY' ? Number(body.economySeats) : Number(body.firstClassSeats)
    })), { transaction });
    if (dates.length > 0) {
      await Departure.bulkCreate(dates.map((date) => ({ flightId: created.id, date })), { transaction });
    }
    return created;
  });

  const result = await loadFlightDetail(flight.id);
  return res.status(201).json({
    flight: result,
    arrivalsNextDay: String(body.arrivalTime) <= String(body.departureTime),
    departuresGenerated: dates.length
  });
}));

flightsRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = isPositiveInteger(req.query.page) ? Number(req.query.page) : 1;
  const where: Record<string, unknown> = {};
  if (req.query.status === 'ACTIVE' || req.query.status === 'CANCELLED') {
    where.status = req.query.status;
  }
  for (const field of ['originAirportId', 'destinationAirportId'] as const) {
    if (isPositiveInteger(req.query[field])) {
      where[field] = Number(req.query[field]);
    }
  }

  const { count, rows } = await Flight.findAndCountAll({
    where,
    include: [
      { model: Airport, as: 'origin', attributes: ['id', 'iata', 'city'] },
      { model: Airport, as: 'destination', attributes: ['id', 'iata', 'city'] }
    ],
    order: sortOrder(req.query.sortBy, req.query.direction),
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true
  });

  return res.json({
    flights: rows.map((flight) => ({
      ...flight.toJSON(),
      arrivalsNextDay: flight.arrivalTime <= flight.departureTime
    })),
    pagination: {
      page,
      pageSize,
      total: count,
      totalPages: Math.ceil(count / pageSize)
    }
  });
}));

flightsRouter.put('/:id', asyncHandler(updateFlightHandler));
flightsRouter.patch('/:id', asyncHandler(updateFlightHandler));
flightsRouter.post('/:id/cancel', asyncHandler(cancelFlightHandler));
flightsRouter.delete('/:id', asyncHandler(cancelFlightHandler));

flightsRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!isPositiveInteger(req.params.id)) {
    return res.status(404).json({ message: 'Vuelo no encontrado.' });
  }
  const flight = await Flight.findByPk(Number(req.params.id), {
    include: [
      { model: Airport, as: 'origin' },
      { model: Airport, as: 'destination' },
      { model: Departure, as: 'departures', order: [['date', 'ASC']] }
    ]
  });
  if (!flight) {
    return res.status(404).json({ message: 'Vuelo no encontrado.' });
  }

  return res.json({ flight: await loadFlightDetail(flight.id) });
}));
