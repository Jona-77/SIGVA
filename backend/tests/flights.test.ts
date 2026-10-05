import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { app } from '../src/app.js';
import { Airport, Cancellation, Departure, Fare, Flight, FlightChangeHistory, ensureExampleFlightDepartures, resetDatabase } from '../src/db/index.js';
import { setFlightTimeProvider, setFlightTodayProvider } from '../src/flights.js';

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
    await resetDatabase({ seedDemoFlights: false });
  });

  afterEach(() => {
    setFlightTodayProvider();
    setFlightTimeProvider();
    vi.restoreAllMocks();
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
    await resetDatabase({ seedDemoFlights: false });
  });

  describe('US-08 y US-09 modificación y cancelación', () => {
    beforeEach(async () => {
      setFlightTodayProvider(() => today);
      await resetDatabase({ seedDemoFlights: false });
    });

    afterEach(() => {
      setFlightTodayProvider();
      setFlightTimeProvider();
    });

    it('permite modificar precio y horario de un vuelo cuyo período empezó antes de hoy', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      await flight!.update({ availableFrom: '2026-09-17', availableTo: '2026-11-30' });

      const response = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ economyPrice: 13000, departureTime: '09:15', confirmed: true });

      expect(response.status).toBe(200);
      expect(response.body.flight).toMatchObject({ economyPrice: 13000, departureTime: '09:15' });
    });

    it('exige confirmed y mantiene las validaciones de fechas al modificar', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      const missingConfirmation = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ economyPrice: 15000 });
      expect(missingConfirmation.status).toBe(409);
      expect(missingConfirmation.body.requiresConfirmation).toBe(true);
      expect(Number((await Flight.findByPk(flight!.id))!.economyPrice)).toBe(12500);

      const invalid = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ availableTo: '2026-10-31', confirmed: true });
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors.availableTo).toBeTruthy();
    });

    it('rechaza capacidad menor a ventas en ambas clases y acepta el valor exacto o superior', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      const departure = await Departure.create({
        flightId: flight!.id, date: '2026-11-02', soldEconomy: 5, soldFirstClass: 2
      });
      const changeCapacity = (payload: Record<string, unknown>) => request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...payload, confirmed: true });

      const economyTooLow = await changeCapacity({ economySeats: 4 });
      expect(economyTooLow.status).toBe(400);
      expect(economyTooLow.body.conflicts).toContainEqual(expect.objectContaining({
        departureDate: departure.date,
        field: 'economySeats'
      }));

      const firstClassTooLow = await changeCapacity({ firstClassSeats: 1 });
      expect(firstClassTooLow.status).toBe(400);
      expect(firstClassTooLow.body.conflicts).toContainEqual(expect.objectContaining({
        departureDate: departure.date,
        field: 'firstClassSeats'
      }));

      expect((await changeCapacity({ economySeats: 5, firstClassSeats: 2 })).status).toBe(200);
      expect((await changeCapacity({ economySeats: 8, firstClassSeats: 4 })).status).toBe(200);
    });

    it('advierte cambios de días y período con ventas, conserva salidas pasadas y cancela las afectadas al confirmar', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      await flight!.update({ availableFrom: '2026-09-01', availableTo: '2026-11-30' });
      const past = await Departure.create({ flightId: flight!.id, date: '2026-09-28', soldEconomy: 1 });
      const monday = await Departure.create({ flightId: flight!.id, date: '2026-11-02', soldEconomy: 3 });
      const friday = await Departure.create({ flightId: flight!.id, date: '2026-11-06', soldFirstClass: 2 });
      const unsold = await Departure.create({ flightId: flight!.id, date: '2026-11-09' });
      const changes = { daysOfWeek: [2], availableTo: '2026-11-10', confirmed: true };

      const warning = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(changes);
      expect(warning.status).toBe(409);
      expect(warning.body.conflicts.map((conflict: { departureDate: string }) => conflict.departureDate))
        .toEqual(expect.arrayContaining([monday.date, friday.date]));
      expect((await Departure.findByPk(monday.id))?.status).toBe('SCHEDULED');

      const confirmed = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...changes, confirmedConflicts: true });
      expect(confirmed.status).toBe(200);
      expect((await Departure.findByPk(monday.id))?.status).toBe('CANCELLED');
      expect((await Departure.findByPk(friday.id))?.status).toBe('CANCELLED');
      expect(await Departure.findByPk(unsold.id)).toBeNull();
      expect(await Departure.findByPk(past.id)).toMatchObject({ status: 'SCHEDULED', soldEconomy: 1 });
      expect(await Cancellation.count({ where: { departureId: [monday.id, friday.id] } })).toBe(2);
    });

    it('guarda una entrada de historial por campo y normaliza los días antes de comparar', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      const sameDays = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ daysOfWeek: [5, 1], confirmed: true });
      expect(sameDays.status).toBe(200);
      expect(await FlightChangeHistory.count({ where: { flightId: flight!.id } })).toBe(0);

      const changed = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ economyPrice: 13500, departureTime: '09:00', confirmed: true });
      expect(changed.status).toBe(200);
      const detail = await request(app)
        .get(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.body.flight.history).toHaveLength(2);
      expect(detail.body.flight.history).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'economyPrice', previousValue: 12500, newValue: 13500,
          userEmail: 'admin@sigva.test', userId: expect.any(Number), changedAt: expect.any(String)
        }),
        expect.objectContaining({
          field: 'departureTime', previousValue: '08:30', newValue: '09:00',
          userEmail: 'admin@sigva.test'
        })
      ]));
    });

    it('revierte historial y vuelo si falla la escritura de una tarifa', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      vi.spyOn(Fare, 'upsert').mockRejectedValueOnce(new Error('fallo de tarifa'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await request(app)
        .put(`/api/flights/${flight!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ economyPrice: 14000, confirmed: true });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Error interno del servidor.' });
      expect(Number((await Flight.findByPk(flight!.id))!.economyPrice)).toBe(12500);
      expect(await FlightChangeHistory.count({ where: { flightId: flight!.id } })).toBe(0);
      expect(await Fare.count({ where: { flightId: flight!.id } })).toBe(0);
    });

    it('registra una cancelación puntual una sola vez y rechaza la re-cancelación sin cambiar datos', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      const departure = await Departure.create({
        flightId: flight!.id, date: '2026-11-02', soldEconomy: 2, soldFirstClass: 1
      });

      const first = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ departureDate: departure.date });
      expect(first.status).toBe(409);
      expect(first.body.affectedPassengers).toBe(3);
      const confirmed = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ departureDate: departure.date, confirmed: true });
      expect(confirmed.status).toBe(200);

      const afterFirst = await Departure.findByPk(departure.id);
      const cancellationsAfterFirst = await Cancellation.count({ where: { departureId: departure.id } });
      expect(cancellationsAfterFirst).toBe(1);
      const second = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ departureDate: departure.date, confirmed: true });

      expect(second.status).toBe(400);
      expect(await Cancellation.count({ where: { departureId: departure.id } })).toBe(cancellationsAfterFirst);
      expect(await Departure.findByPk(departure.id)).toMatchObject({
        status: 'CANCELLED',
        cancelledAt: afterFirst!.cancelledAt,
        cancelledByUserId: afterFirst!.cancelledByUserId
      });
    });

    it('cancela un vuelo completo sin borrar salidas y rechaza las re-cancelaciones', async () => {
      const token = await tokenFor();
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      const past = await Departure.create({ flightId: flight!.id, date: '2026-09-28' });
      const futureA = await Departure.create({ flightId: flight!.id, date: '2026-11-02', soldEconomy: 2 });
      const futureB = await Departure.create({ flightId: flight!.id, date: '2026-11-06', soldFirstClass: 3 });
      const alreadyCancelled = await Departure.create({
        flightId: flight!.id, date: '2026-11-09', status: 'CANCELLED', cancelledAt: '2026-09-01T00:00:00.000Z'
      });
      const warning = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(warning.status).toBe(409);
      expect(warning.body.affectedPassengers).toBe(5);

      const response = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ confirmed: true });
      expect(response.status).toBe(200);
      expect(await Flight.findByPk(flight!.id)).toMatchObject({ status: 'CANCELLED', cancelledByUserId: expect.any(Number) });
      expect(await Departure.findByPk(past.id)).toMatchObject({ status: 'SCHEDULED' });
      expect(await Departure.findByPk(futureA.id)).toMatchObject({ status: 'CANCELLED', soldEconomy: 2 });
      expect(await Departure.findByPk(futureB.id)).toMatchObject({ status: 'CANCELLED', soldFirstClass: 3 });
      const preservedCancelled = await Departure.findByPk(alreadyCancelled.id);
      expect(preservedCancelled?.status).toBe('CANCELLED');
      expect(new Date(preservedCancelled!.cancelledAt!).toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(await Cancellation.count({ where: { flightId: flight!.id } })).toBe(1);
      const cancelledFlight = await Flight.findByPk(flight!.id);

      const repeated = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ confirmed: true });
      const punctualAfterFlightCancel = await request(app)
        .post(`/api/flights/${flight!.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ departureDate: futureA.date, confirmed: true });
      expect(repeated.status).toBe(400);
      expect(punctualAfterFlightCancel.status).toBe(400);
      expect(await Cancellation.count({ where: { flightId: flight!.id } })).toBe(1);
      expect(await Flight.findByPk(flight!.id)).toMatchObject({
        cancelledAt: cancelledFlight!.cancelledAt,
        cancelledByUserId: cancelledFlight!.cancelledByUserId
      });
    });

    it('rechaza modificar y cancelar para empleados y pasajeros', async () => {
      const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
      const employee = await tokenFor('empleado@sigva.test', 'Empleado123!');
      const passenger = await tokenFor('pasajero@sigva.test', 'Pasajero123!');
      for (const token of [employee, passenger]) {
        expect((await request(app)
          .put(`/api/flights/${flight!.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ economyPrice: 13000, confirmed: true })).status).toBe(403);
        expect((await request(app)
          .post(`/api/flights/${flight!.id}/cancel`)
          .set('Authorization', `Bearer ${token}`)
          .send({ confirmed: true })).status).toBe(403);
      }
    });

    it('siembra las salidas programadas futuras de vuelos activos solo en sus días y período', async () => {
      await resetDatabase();
      const flights = await Flight.findAll({ where: { status: 'ACTIVE' }, include: [{ model: Departure, as: 'departures' }] });

      for (const flight of flights) {
        const operatingDays = new Set(flight.daysOfWeek.split(',').map(Number));
        for (const departure of flight.departures ?? []) {
          if (departure.status !== 'SCHEDULED' || departure.date < today) continue;
          const [year, month, day] = departure.date.split('-').map(Number);
          const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
          expect(departure.date >= flight.availableFrom).toBe(true);
          expect(departure.date <= flight.availableTo).toBe(true);
          expect(operatingDays.has(weekday)).toBe(true);
        }
      }
      const example = flights.find((flight) => flight.flightNumber === 'AR1450')!;
      const multiSale = flights.find((flight) => flight.flightNumber === 'AR2001')!;
      const exampleSale = await Departure.findOne({ where: { flightId: example.id, soldEconomy: 5 } });
      const multiSales = await Departure.findAll({ where: { flightId: multiSale.id, soldEconomy: 1 } });
      expect(exampleSale).not.toBeNull();
      expect(multiSales.length).toBeGreaterThan(0);
      for (const [flight, sales] of [[example, [exampleSale!]], [multiSale, multiSales]] as const) {
        const days = new Set(flight.daysOfWeek.split(',').map(Number));
        expect(sales.every((departure) => {
          const [year, month, day] = departure.date.split('-').map(Number);
          return days.has(new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7)
            && departure.date > today;
        })).toBe(true);
      }
    });
  });

  afterEach(() => {
    setFlightTodayProvider();
    setFlightTimeProvider();
  });

  it('incluye las salidas del vuelo de ejemplo desde que se siembra la base', async () => {
    const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
    await Departure.destroy({ where: { flightId: flight!.id } });
    await Departure.create({ flightId: flight!.id, date: '2026-11-01' });
    await ensureExampleFlightDepartures();
    await ensureExampleFlightDepartures();
    expect(await Departure.findOne({ where: { flightId: flight!.id, date: '2026-11-01' } })).toBeNull();

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
    const repeatedRoutes = await request(app).get('/api/flights?page=2&sortBy=route').set('Authorization', `Bearer ${token}`);
    expect(numbers.body.flights[0].flightNumber).toBe('AR1450');
    expect(departures.body.flights[0].departureTime).toBe('00:00');
    expect(routes.body.flights[0].origin.iata).toBe('AEP');
    expect(lastRoutes.body.flights.at(-1).origin.iata).toBe('COR');
    expect(lastRoutes.body.flights.map((flight: { id: number }) => flight.id))
      .toEqual(repeatedRoutes.body.flights.map((flight: { id: number }) => flight.id));
    expect(new Set([
      ...routes.body.flights.map((flight: { id: number }) => flight.id),
      ...lastRoutes.body.flights.map((flight: { id: number }) => flight.id)
    ]).size).toBe(routes.body.pagination.total);
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
