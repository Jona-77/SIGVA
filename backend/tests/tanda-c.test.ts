import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Op } from 'sequelize';
import { app } from '../src/app.js';
import { Airport, Class, Departure, Flight, Purchase, resetDatabase } from '../src/db/index.js';

async function loginAs(email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  return response;
}

async function getNextDeparture() {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
  const date = tomorrow.toISOString().slice(0, 10);

  const departure = await Departure.findOne({
    where: {
      status: 'SCHEDULED',
      soldEconomy: 0,
      soldFirstClass: 0,
      date: { [Op.gte]: date }
    },
    order: [['date', 'ASC']],
    include: [{ model: Flight, as: 'flight' }]
  });

  expect(departure).not.toBeNull();
  const flight = await Flight.findByPk(departure!.flightId);
  const origin = await Airport.findByPk(flight!.originAirportId);
  const destination = await Airport.findByPk(flight!.destinationAirportId);

  return { departure, flight, origin, destination };
}

function passengersFor(quantity: number, prefix: string) {
  return Array.from({ length: quantity }, (_, index) => ({
    firstName: `Pasajero${index + 1}`,
    lastName: prefix,
    document: `${prefix.replace(/[^A-Za-z0-9]/g, '').slice(0, 5)}${String(index + 1).padStart(6, '0')}`,
    birthDate: '1995-02-12'
  }));
}

async function registerAndLogin(index: number) {
  const email = `concurrente${index}@example.com`;
  const register = await request(app).post('/api/auth/register').send({
    name: `Pasajero${index}`,
    lastName: 'Concurrente',
    document: `CC${String(index).padStart(8, '0')}`,
    email,
    password: 'Clave1234',
    birthDate: '1990-01-01'
  });
  expect(register.status).toBe(201);
  const login = await loginAs(email, 'Clave1234');
  expect(login.status).toBe(200);
  return login.body.token as string;
}

async function reserve(token: string, departureId: number, classCode: string, quantity: number, prefix: string) {
  return request(app)
    .post('/api/purchases')
    .set('Authorization', `Bearer ${token}`)
    .send({ departureId, classCode, quantity, passengers: passengersFor(quantity, prefix) });
}

describe('US-14 y US-15 reserva temporal', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: true });
  });

  it('crea una reserva válida y permite verla y cancelarla', async () => {
    const login = await loginAs('pasajero@sigva.test', 'Pasajero123!');
    expect(login.status).toBe(200);

    const { departure } = await getNextDeparture();
    const payload = {
      departureId: departure!.id,
      classCode: 'ECONOMY',
      quantity: 2,
      passengers: [
        { firstName: 'Ana', lastName: 'García', document: 'AB123456', birthDate: '1995-02-12' },
        { firstName: 'Luis', lastName: 'García', document: 'CD123456', birthDate: '2010-03-10' }
      ]
    };

    const create = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send(payload);

    expect(create.status).toBe(201);
    expect(create.body.total).toBeGreaterThan(0);
    expect(create.body.expiresAt).toBeTruthy();

    const detail = await request(app)
      .get(`/api/purchases/${create.body.id}`)
      .set('Authorization', `Bearer ${login.body.token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.passengers).toHaveLength(2);
    expect(detail.body.tickets).toEqual([]);

    const cancel = await request(app)
      .post(`/api/purchases/${create.body.id}/cancel`)
      .set('Authorization', `Bearer ${login.body.token}`);

    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('EXPIRED');
    const cancelled = await Purchase.findByPk(create.body.id);
    expect(cancelled?.releaseReason).toBe('CANCELADA_POR_USUARIO');
    const classAfterCancel = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ departureId: departure!.id, classCode: 'ECONOMY', quantity: 2 });
    expect(classAfterCancel.status).toBe(200);
  });

  it('rechaza documentos repetidos, cantidades inconsistentes y compras ajenas', async () => {
    const login = await loginAs('pasajero@sigva.test', 'Pasajero123!');
    const { departure } = await getNextDeparture();

    const duplicate = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        departureId: departure!.id,
        classCode: 'ECONOMY',
        quantity: 2,
        passengers: [
          { firstName: 'Ana', lastName: 'García', document: 'AB123456', birthDate: '1995-02-12' },
          { firstName: 'Luis', lastName: 'García', document: 'AB123456', birthDate: '2010-03-10' }
        ]
      });

    expect(duplicate.status).toBe(400);
    expect(duplicate.body.errors['passengers.1.document']).toContain('repetirse');

    const mismatch = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        departureId: departure!.id,
        classCode: 'ECONOMY',
        quantity: 2,
        passengers: [
          { firstName: 'Ana', lastName: 'García', document: 'AB123456', birthDate: '1995-02-12' }
        ]
      });

    expect(mismatch.status).toBe(400);
    expect(mismatch.body.errors.passengers).toContain('coincidir');

    const adminLogin = await loginAs('admin@sigva.test', 'Admin123!');
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({
        departureId: departure!.id,
        classCode: 'ECONOMY',
        quantity: 1,
        passengers: [{ firstName: 'Admin', lastName: 'Root', document: 'ZZ999999', birthDate: '1980-01-01' }]
      });

    expect(purchase.status).toBe(403);

    const validPurchase = await reserve(login.body.token, departure!.id, 'ECONOMY', 1, 'owner');
    expect(validPurchase.status).toBe(201);
    const foreignToken = await registerAndLogin(50);
    const foreignRead = await request(app)
      .get(`/api/purchases/${validPurchase.body.id}`)
      .set('Authorization', `Bearer ${foreignToken}`);
    expect(foreignRead.status).toBe(404);
  });

  it('valida campos y fechas por pasajero y admite una compra con tres pasajeros', async () => {
    const login = await loginAs('pasajero@sigva.test', 'Pasajero123!');
    const { departure } = await getNextDeparture();
    const missingFields = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        departureId: departure!.id,
        classCode: 'ECONOMY',
        quantity: 1,
        passengers: [{ firstName: 'Sin', lastName: 'Nacimiento', document: 'AB123456' }]
      });
    const invalidPassenger = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        departureId: departure!.id,
        classCode: 'ECONOMY',
        quantity: 1,
        passengers: [{ firstName: '', lastName: '', document: '12-34', birthDate: '2999-01-01' }]
      });
    expect(invalidPassenger.status).toBe(400);
    expect(invalidPassenger.body.errors['passengers.0.firstName']).toBeTruthy();
    expect(invalidPassenger.body.errors['passengers.0.lastName']).toBeTruthy();
    expect(invalidPassenger.body.errors['passengers.0.document']).toBeTruthy();
    expect(invalidPassenger.body.errors['passengers.0.birthDate']).toContain('futura');
    expect(missingFields.status).toBe(400);
    expect(missingFields.body.errors['passengers.0.birthDate']).toContain('obligatoria');

    const threePassengers = await reserve(login.body.token, departure!.id, 'ECONOMY', 3, 'three');
    expect(threePassengers.status).toBe(201);
    const detail = await request(app)
      .get(`/api/purchases/${threePassengers.body.id}`)
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(detail.body.passengers).toHaveLength(3);
  });

  it('exige sesión de pasajero para reservar', async () => {
    const { departure } = await getNextDeparture();

    const noSession = await request(app).post('/api/purchases').send({
      departureId: departure!.id,
      classCode: 'ECONOMY',
      quantity: 1,
      passengers: [{ firstName: 'Ana', lastName: 'García', document: 'AB123456', birthDate: '1995-02-12' }]
    });

    expect(noSession.status).toBe(401);

    const adminLogin = await loginAs('admin@sigva.test', 'Admin123!');
    const forbidden = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({
        departureId: departure!.id,
        classCode: 'ECONOMY',
        quantity: 1,
        passengers: [{ firstName: 'Ana', lastName: 'García', document: 'AB123456', birthDate: '1995-02-12' }]
      });

    expect(forbidden.status).toBe(403);
  });

  it('serializa reservas concurrentes por salida y clase sin superar la capacidad', async () => {
    const { departure, flight, origin, destination } = await getNextDeparture();
    await flight!.update({ economySeats: 3, firstClassSeats: 3 });

    const tokens: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      tokens.push(await registerAndLogin(index + 1));
    }
    const economyAttempts = await Promise.all([2, 2, 2].map((quantity, index) =>
      reserve(tokens[index], departure!.id, 'ECONOMY', quantity, `eco${index}`)
    ));
    const firstAttempts = await Promise.all([2, 2, 2].map((quantity, index) =>
      reserve(tokens[index + 3], departure!.id, 'FIRST', quantity, `first${index}`)
    ));

    for (const [attempts, capacity, classCode] of [
      [economyAttempts, 3, 'ECONOMY'],
      [firstAttempts, 3, 'FIRST']
    ] as const) {
      const successful = attempts.filter((response) => response.status === 201);
      const exceeded = attempts.filter((response) => response.status === 409);
      expect(attempts.every((response) => response.status === 201 || response.status === 409)).toBe(true);
      expect(successful.length).toBeGreaterThan(0);
      expect(exceeded.length).toBeGreaterThan(0);
      const classEntry = await Class.findOne({ where: { code: classCode } });
      const reservedSeats = await Purchase.sum('quantity', {
        where: { departureId: departure!.id, classId: classEntry!.id, status: 'RESERVED' }
      });
      expect(Number(reservedSeats)).toBeGreaterThan(0);
      expect(Number(reservedSeats)).toBeLessThanOrEqual(capacity);
    }

    const search = await request(app).get('/api/search/flights').query({
      origin: origin!.iata,
      destination: destination!.iata,
      date: departure!.date
    });
    expect(search.status).toBe(200);
    const result = search.body.results.find((flightResult: { id: number }) => flightResult.id === departure!.id);
    expect(result).toBeTruthy();
    expect(result.classes.find((item: { code: string }) => item.code === 'ECONOMY').available).toBe(1);

    const quote = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${tokens[2]}`)
      .send({ departureId: departure!.id, classCode: 'ECONOMY', quantity: 2 });
    expect(quote.status).toBe(409);
  });

  it('vence reservas expiradas y libera disponibilidad para volver a buscar y cotizar', async () => {
    const { departure, origin, destination } = await getNextDeparture();
    const login = await loginAs('pasajero@sigva.test', 'Pasajero123!');
    const searchBefore = await request(app).get('/api/search/flights').query({
      origin: origin!.iata,
      destination: destination!.iata,
      date: departure!.date
    });
    const beforeResult = searchBefore.body.results.find((flightResult: { id: number }) => flightResult.id === departure!.id);
    const beforeAvailable = beforeResult.classes.find((item: { code: string }) => item.code === 'ECONOMY').available;

    const created = await reserve(login.body.token, departure!.id, 'ECONOMY', 2, 'expire');
    expect(created.status).toBe(201);
    const searchReserved = await request(app).get('/api/search/flights').query({
      origin: origin!.iata,
      destination: destination!.iata,
      date: departure!.date
    });
    const reservedResult = searchReserved.body.results.find((flightResult: { id: number }) => flightResult.id === departure!.id);
    expect(reservedResult.classes.find((item: { code: string }) => item.code === 'ECONOMY').available).toBe(beforeAvailable - 2);

    await Purchase.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: created.body.id } });
    const searchExpired = await request(app).get('/api/search/flights').query({
      origin: origin!.iata,
      destination: destination!.iata,
      date: departure!.date
    });
    const expiredResult = searchExpired.body.results.find((flightResult: { id: number }) => flightResult.id === departure!.id);
    expect(expiredResult.classes.find((item: { code: string }) => item.code === 'ECONOMY').available).toBe(beforeAvailable);
    expect((await Purchase.findByPk(created.body.id))?.status).toBe('EXPIRED');

    const quote = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ departureId: departure!.id, classCode: 'ECONOMY', quantity: 2 });
    expect(quote.status).toBe(200);
  });

  it('libera la reserva anterior del pasajero al crear una segunda reserva', async () => {
    const { departure } = await getNextDeparture();
    const login = await loginAs('pasajero@sigva.test', 'Pasajero123!');
    const first = await reserve(login.body.token, departure!.id, 'ECONOMY', 2, 'first');
    expect(first.status).toBe(201);
    const second = await reserve(login.body.token, departure!.id, 'ECONOMY', 1, 'second');
    expect(second.status).toBe(201);

    const firstPurchase = await Purchase.findByPk(first.body.id);
    const secondPurchase = await Purchase.findByPk(second.body.id);
    expect(firstPurchase?.status).toBe('EXPIRED');
    expect(firstPurchase?.releaseReason).toBe('CANCELADA_POR_USUARIO');
    expect(secondPurchase?.status).toBe('RESERVED');
    expect(await Purchase.sum('quantity', {
      where: { departureId: departure!.id, status: 'RESERVED' }
    })).toBe(1);
  });
});
