import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { app } from '../app.js';
import { Airport, Departure, Flight, ensureExampleFlightDepartures, resetDatabase } from '../db/index.js';
import { setFlightTimeProvider, setFlightTodayProvider } from '../flights.js';

const today = '2026-10-01';

async function tokenFor(email = 'admin@sigva.test', password = 'Admin123!') {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  return response.body.token as string;
}

async function activeAirports() {
  const origin = await Airport.findOne({ where: { iata: 'AEP' } });
  const destination = await Airport.findOne({ where: { iata: 'EZE' } });
  return { origin: origin!, destination: destination! };
}

function flightPayload(originAirportId: number, destinationAirportId: number, overrides: Record<string, unknown> = {}) {
  return {
    flightNumber: 'AR7000',
    daysOfWeek: [1, 5],
    departureTime: '08:30',
    arrivalTime: '09:45',
    originAirportId,
    destinationAirportId,
    availableFrom: '2026-11-01',
    availableTo: '2026-11-30',
    economySeats: 180,
    firstClassSeats: 20,
    economyPrice: 12500,
    firstClassPrice: 34500,
    ...overrides
  };
}

async function insertFlights(count: number) {
  const { origin, destination } = await activeAirports();
  await Flight.bulkCreate(Array.from({ length: count }, (_, index) => ({
    flightNumber: `ZX${String(index).padStart(4, '0')}`,
    daysOfWeek: '1,5',
    departureTime: `${String(index % 24).padStart(2, '0')}:00`,
    arrivalTime: '13:00',
    originAirportId: origin.id,
    destinationAirportId: destination.id,
    availableFrom: '2026-11-01',
    availableTo: '2026-11-30',
    economySeats: 100,
    firstClassSeats: 10,
    economyPrice: 1000,
    firstClassPrice: 5000,
    status: index % 2 ? 'ACTIVE' : 'CANCELLED'
  })));
}

describe('US-07 crear vuelos', () => {
  beforeEach(async () => {
    setFlightTodayProvider(() => today);
    await resetDatabase();
  });

  afterEach(() => {
    setFlightTodayProvider();
    setFlightTimeProvider();
  });

  it('crea un vuelo activo y genera nueve salidas para lunes y viernes de noviembre de 2026', async () => {
    const token = await tokenFor();
    const { origin, destination } = await activeAirports();
    const response = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id));

    expect(response.status).toBe(201);
    expect(response.body.flight.status).toBe('ACTIVE');
    expect(response.body.departuresGenerated).toBe(9);
    expect(await Departure.count({ where: { flightId: response.body.flight.id } })).toBe(9);
  });

  it('informa llegada al día siguiente cuando la hora de llegada no es posterior a la partida', async () => {
    const token = await tokenFor();
    const { origin, destination } = await activeAirports();
    const response = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, {
        flightNumber: 'AR7001',
        daysOfWeek: [1],
        departureTime: '23:30',
        arrivalTime: '01:15'
      }));

    expect(response.status).toBe(201);
    expect(response.body.arrivalsNextDay).toBe(true);
    const listing = await request(app).get('/api/flights').set('Authorization', `Bearer ${token}`);
    expect(listing.body.flights.find((flight: { flightNumber: string }) => flight.flightNumber === 'AR7001').arrivalsNextDay).toBe(true);
    const detail = await request(app).get(`/api/flights/${response.body.flight.id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.flight.arrivalsNextDay).toBe(true);
  });

  it('no genera salidas de hoy cuya hora de partida ya pasó', async () => {
    setFlightTodayProvider(() => '2026-11-02');
    setFlightTimeProvider(() => '14:00');
    const token = await tokenFor();
    const { origin, destination } = await activeAirports();
    const response = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, {
        flightNumber: 'AR7003',
        daysOfWeek: [1],
        availableFrom: '2026-11-02',
        availableTo: '2026-11-02',
        departureTime: '13:59'
      }));

    expect(response.status).toBe(201);
    expect(response.body.departuresGenerated).toBe(0);
    expect(response.body.flight.departures).toHaveLength(0);
  });

  it('señala campos obligatorios incompletos sin guardar', async () => {
    const token = await tokenFor();
    const response = await request(app).post('/api/flights').set('Authorization', `Bearer ${token}`).send({});
    expect(response.status).toBe(400);
    expect(response.body.errors.flightNumber).toBeTruthy();
    expect(await Flight.count()).toBe(1);
  });

  it.each([
    ['daysOfWeek', { daysOfWeek: [] }],
    ['destinationAirportId', { destinationAirportId: 1 }],
    ['availableFrom', { availableFrom: '2026-09-30' }],
    ['availableTo', { availableTo: '2026-10-31' }],
    ['economySeats', { economySeats: -1 }],
    ['departureTime', { departureTime: '25:00' }]
  ])('rechaza la validación de %s', async (field, overrides) => {
    const token = await tokenFor();
    const { origin, destination } = await activeAirports();
    const payload = flightPayload(origin.id, destination.id, overrides);
    if (field === 'destinationAirportId') payload.destinationAirportId = origin.id;
    const response = await request(app).post('/api/flights').set('Authorization', `Bearer ${token}`).send(payload);
    expect(response.status).toBe(400);
    expect(response.body.errors[field]).toBeTruthy();
  });

  it('rechaza el número duplicado, capacidad total nula y tarifa nula en una clase con asientos', async () => {
    const token = await tokenFor();
    const { origin, destination } = await activeAirports();
    const duplicate = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, { flightNumber: 'ar1450' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.errors.flightNumber).toBeTruthy();

    const noCapacity = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, { economySeats: 0, firstClassSeats: 0 }));
    expect(noCapacity.body.errors.economySeats).toContain('capacidad');

    const noPrice = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, { economyPrice: 0 }));
    expect(noPrice.body.errors.economyPrice).toContain('mayor que cero');

    const noFirstClassPrice = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, { firstClassPrice: 0 }));
    expect(noFirstClassPrice.body.errors.firstClassPrice).toContain('mayor que cero');
  });

  it('rechaza aeropuertos inactivos y accesos de otros roles', async () => {
    const adminToken = await tokenFor();
    const employeeToken = await tokenFor('empleado@sigva.test', 'Empleado123!');
    const { origin } = await activeAirports();
    const inactive = await Airport.findOne({ where: { iata: 'USH' } });
    const invalidAirport = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(flightPayload(origin.id, inactive!.id));
    expect(invalidAirport.status).toBe(400);
    expect(invalidAirport.body.errors.destinationAirportId).toBeTruthy();

    const forbidden = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send(flightPayload(origin.id, inactive!.id));
    expect(forbidden.status).toBe(403);
  });
});

describe('US-10 listado y consulta de vuelos', () => {
  beforeEach(async () => {
    setFlightTodayProvider(() => today);
    await resetDatabase();
  });

  afterEach(() => {
    setFlightTodayProvider();
    setFlightTimeProvider();
  });

  it('incluye las salidas del vuelo de ejemplo desde que se siembra la base', async () => {
    const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
    await Departure.destroy({ where: { flightId: flight!.id } });
    await ensureExampleFlightDepartures();
    await ensureExampleFlightDepartures();

    const token = await tokenFor();
    const response = await request(app)
      .get(`/api/flights/${flight!.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.flight.departures).toHaveLength(9);
  });

  it('pagina de a veinte y filtra por estado, origen y destino', async () => {
    const token = await tokenFor();
    await insertFlights(24);
    const first = await request(app).get('/api/flights?page=1').set('Authorization', `Bearer ${token}`);
    const second = await request(app).get('/api/flights?page=2').set('Authorization', `Bearer ${token}`);
    expect(first.body.flights).toHaveLength(20);
    expect(first.body.pagination.total).toBe(25);
    expect(second.body.flights).toHaveLength(5);

    const { origin, destination } = await activeAirports();
    const filtered = await request(app)
      .get(`/api/flights?status=ACTIVE&originAirportId=${origin.id}&destinationAirportId=${destination.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.body.flights.every((flight: { status: string; originAirportId: number; destinationAirportId: number }) =>
      flight.status === 'ACTIVE' && flight.originAirportId === origin.id && flight.destinationAirportId === destination.id
    )).toBe(true);
    expect(filtered.body.flights.length).toBeGreaterThan(0);
  });

  it('ordena por número, ruta y horario de partida', async () => {
    const token = await tokenFor();
    await insertFlights(24);
    const cordoba = await Airport.findOne({ where: { iata: 'COR' } });
    const mendoza = await Airport.findOne({ where: { iata: 'MDZ' } });
    await Flight.create({
      flightNumber: 'QX6000',
      daysOfWeek: '1',
      departureTime: '04:00',
      arrivalTime: '05:00',
      originAirportId: cordoba!.id,
      destinationAirportId: mendoza!.id,
      availableFrom: '2026-11-01',
      availableTo: '2026-11-30',
      economySeats: 100,
      firstClassSeats: 10,
      economyPrice: 1000,
      firstClassPrice: 5000,
      status: 'ACTIVE'
    });
    const numbers = await request(app).get('/api/flights?sortBy=number').set('Authorization', `Bearer ${token}`);
    const departures = await request(app).get('/api/flights?sortBy=departure').set('Authorization', `Bearer ${token}`);
    const routes = await request(app).get('/api/flights?sortBy=route').set('Authorization', `Bearer ${token}`);
    const lastRoutes = await request(app).get('/api/flights?page=2&sortBy=route').set('Authorization', `Bearer ${token}`);
    expect(numbers.body.flights[0].flightNumber).toBe('AR1450');
    expect(departures.body.flights[0].departureTime).toBe('00:00');
    expect(routes.body.flights[0].origin.iata).toBe('AEP');
    expect(lastRoutes.body.flights.at(-1).origin.iata).toBe('COR');
  });

  it('muestra el detalle completo y disponibilidad por clase', async () => {
    const token = await tokenFor();
    const { origin, destination } = await activeAirports();
    const created = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send(flightPayload(origin.id, destination.id, { flightNumber: 'AR7002' }));
    const departure = await Departure.findOne({ where: { flightId: created.body.flight.id } });
    await departure!.update({ soldEconomy: 12, soldFirstClass: 2 });

    const detail = await request(app)
      .get(`/api/flights/${created.body.flight.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.flight.departures[0]).toMatchObject({
      soldEconomy: 12,
      availableEconomy: 168,
      soldFirstClass: 2,
      availableFirstClass: 18
    });
    expect(detail.body.flight.history).toEqual([]);
  });

  it('considera pasada una salida de hoy cuando ya llegó su hora de partida', async () => {
    const token = await tokenFor();
    const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
    const departure = await Departure.create({ flightId: flight!.id, date: today });

    setFlightTimeProvider(() => '08:29');
    const beforeDeparture = await request(app)
      .post(`/api/flights/${flight!.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ departureDate: today });
    expect(beforeDeparture.status).toBe(409);
    expect(beforeDeparture.body.requiresConfirmation).toBe(true);

    setFlightTimeProvider(() => '08:30');
    const afterDeparture = await request(app)
      .post(`/api/flights/${flight!.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ departureDate: today, confirmed: true });
    expect(afterDeparture.status).toBe(400);
    expect((await Departure.findByPk(departure.id))?.status).toBe('SCHEDULED');
  });

  it('responde el listado de al menos cien vuelos en menos de dos segundos', async () => {
    const token = await tokenFor();
    await insertFlights(100);
    const startedAt = performance.now();
    const response = await request(app).get('/api/flights').set('Authorization', `Bearer ${token}`);
    const elapsedMs = performance.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(101);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('rechaza el listado y el detalle para roles sin permisos', async () => {
    const token = await tokenFor('empleado@sigva.test', 'Empleado123!');
    const list = await request(app).get('/api/flights').set('Authorization', `Bearer ${token}`);
    const detail = await request(app).get('/api/flights/1').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
  });
});
