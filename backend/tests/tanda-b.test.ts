import request from 'supertest';
import { Op } from 'sequelize';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { Airport, Departure, Flight, resetDatabase } from '../src/db/index.js';

async function loginAs(email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  return response;
}

async function getSearchTarget() {
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setUTCDate(today.getUTCDate() + 2);
  const targetDate = futureDate.toISOString().slice(0, 10);

  const departure = await Departure.findOne({
    where: {
      status: 'SCHEDULED',
      date: { [Op.gte]: targetDate }
    },
    order: [['date', 'ASC']],
    include: [{ model: Flight, as: 'flight' }]
  });
  expect(departure).not.toBeNull();
  const flight = await Flight.findByPk(departure!.flightId);
  expect(flight).not.toBeNull();
  const origin = await Airport.findByPk(flight!.originAirportId);
  const destination = await Airport.findByPk(flight!.destinationAirportId);
  return {
    origin: origin!.iata,
    destination: destination!.iata,
    date: departure!.date,
    departureId: departure!.id,
    classCode: 'ECONOMY',
    quantity: 1,
    token: '',
    flight
  };
}

describe('US-04 registro de pasajeros', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: true });
  });

  it('registra un pasajero válido y permite iniciar sesión de inmediato', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Ana',
      lastName: 'García',
      document: 'AB123456',
      email: 'ana.garcia@example.com',
      password: 'Clave1234',
      birthDate: '1995-02-12'
    });

    expect(register.status).toBe(201);
    expect(register.body.user.role).toBe('passenger');
    expect(register.body.user.email).toBe('ana.garcia@example.com');

    const login = await loginAs('ana.garcia@example.com', 'Clave1234');
    expect(login.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.document).toBe('AB123456');
  });

  it('rechaza email duplicado, formato inválido y contraseña débil', async () => {
    const duplicate = await request(app).post('/api/auth/register').send({
      name: 'Juan',
      lastName: 'Pérez',
      document: 'ABC12345',
      email: 'pasajero@sigva.test',
      password: 'Pasajero123!'
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.errors.email).toBe('El email ya está registrado.');

    const invalidDocument = await request(app).post('/api/auth/register').send({
      name: 'Juan',
      lastName: 'Pérez',
      document: '12-34',
      email: 'juan.documento@example.com',
      password: 'Clave1234'
    });
    expect(invalidDocument.status).toBe(400);
    expect(invalidDocument.body.errors.document).toBe('El documento debe tener entre 6 y 15 caracteres alfanuméricos.');

    const invalidEmail = await request(app).post('/api/auth/register').send({
      name: 'Juan',
      lastName: 'Pérez',
      document: 'ABC12345',
      email: 'no-email',
      password: 'Clave1234'
    });
    expect(invalidEmail.status).toBe(400);
    expect(invalidEmail.body.errors.email).toBe('Debe ingresar un email válido.');

    const weakPassword = await request(app).post('/api/auth/register').send({
      name: 'Juan',
      lastName: 'Pérez',
      document: 'ABC12345',
      email: 'juan.nuevo@example.com',
      password: 'abcdefg'
    });
    expect(weakPassword.status).toBe(400);
    expect(weakPassword.body.errors.password).toBe('La contraseña debe tener al menos 8 caracteres, una letra y un número.');
  });
});

describe('US-11 búsqueda de vuelos', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: true });
  });

  it('devuelve resultados válidos para una búsqueda pública y un caso sin resultados', async () => {
    const target = await getSearchTarget();
    const results = await request(app).get('/api/search/flights').query({
      origin: target.origin,
      destination: target.destination,
      date: target.date
    });

    expect(results.status).toBe(200);
    expect(results.body.results.length).toBeGreaterThan(0);
    expect(results.body.results[0].classes.some((item: { soldOut: boolean }) => !item.soldOut)).toBe(true);

    const empty = await request(app).get('/api/search/flights').query({
      origin: target.origin,
      destination: target.destination,
      date: '2099-12-31'
    });
    expect(empty.status).toBe(200);
    expect(empty.body.results).toEqual([]);
    expect(empty.body.message).toContain('No se encontraron');
  });

  it('devuelve la fecha de llegada correcta para vuelos nocturnos y diurnos', async () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 2);
    const departureDate = date.toISOString().slice(0, 10);
    const nextDate = new Date(`${departureDate}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const arrivalDate = nextDate.toISOString().slice(0, 10);
    const results = await request(app).get('/api/search/flights').query({
      origin: 'BHI',
      destination: 'FTE',
      date: departureDate
    });

    expect(results.status).toBe(200);
    expect(results.body.results.find((flight: { flightNumber: string }) => flight.flightNumber === 'AR2009').arrival)
      .toBe(`${arrivalDate}T01:15:00`);
    expect(results.body.results.find((flight: { flightNumber: string }) => flight.flightNumber === 'AR2020').arrival)
      .toBe(`${departureDate}T14:15:00`);
  });

  it('rechaza parámetros inválidos y realiza la validación pública sin sesión', async () => {
    const invalid = await request(app).get('/api/search/flights').query({ origin: 'AEP', destination: 'AEP', date: '2020-01-01' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors.destination).toBeTruthy();

    const missing = await request(app).get('/api/search/flights').query({ origin: 'AEP' });
    expect(missing.status).toBe(400);
    expect(missing.body.errors.date).toBeTruthy();

    const result = await request(app).get('/api/search/flights').query({ origin: 'AEP', destination: 'EZE', date: '2099-01-05' });
    expect(result.status).toBe(200);
    expect(result.body.results).toEqual([]);
  });
});

describe('US-13 selección de vuelo, clase y cantidad', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: true });
  });

  it('calcula el total, rechaza cantidades fuera de rango y exige sesión', async () => {
    const target = await getSearchTarget();
    const adminLogin = await loginAs('admin@sigva.test', 'Admin123!');
    const passengerLogin = await loginAs('pasajero@sigva.test', 'Pasajero123!');

    const quote = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${passengerLogin.body.token}`)
      .send({ departureId: target.departureId, classCode: 'ECONOMY', quantity: 2 });
    expect(quote.status).toBe(200);
    expect(quote.body.total).toBe(Number(quote.body.unitPrice) * 2);

    const tooMany = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${passengerLogin.body.token}`)
      .send({ departureId: target.departureId, classCode: 'ECONOMY', quantity: 10 });
    expect(tooMany.status).toBe(400);

    const notLogged = await request(app).post('/api/purchases/quote').send({
      departureId: target.departureId,
      classCode: 'ECONOMY',
      quantity: 1
    });
    expect(notLogged.status).toBe(401);

    const forbidden = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({ departureId: target.departureId, classCode: 'ECONOMY', quantity: 1 });
    expect(forbidden.status).toBe(403);
  });
});
