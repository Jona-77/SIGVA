import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Op } from 'sequelize';
import { app, setPaymentGateway } from '../src/app.js';
import { createPaymentGateway } from '../src/paymentGateway.js';
import { Airport, Class, Departure, Flight, Payment, Purchase, Ticket, resetDatabase } from '../src/db/index.js';

async function registerAndLogin(index: number) {
  const email = `pago${index}@sigva.test`;
  const registration = await request(app).post('/api/auth/register').send({
    name: `Pasajero${index}`,
    lastName: 'Prueba',
    document: `PG${String(index).padStart(8, '0')}`,
    email,
    password: 'Clave1234',
    birthDate: '1990-01-01'
  });
  expect(registration.status).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Clave1234' });
  expect(login.status).toBe(200);
  return login.body.token as string;
}

async function nextDeparture() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  const departure = await Departure.findOne({
    where: {
      status: 'SCHEDULED',
      soldEconomy: 0,
      soldFirstClass: 0,
      date: { [Op.gte]: date.toISOString().slice(0, 10) }
    },
    order: [['date', 'ASC'], ['id', 'ASC']],
    include: [{ model: Flight, as: 'flight', where: { status: 'ACTIVE' } }]
  });
  expect(departure).not.toBeNull();
  const flight = await Flight.findByPk(departure!.flightId);
  const origin = await Airport.findByPk(flight!.originAirportId);
  const destination = await Airport.findByPk(flight!.destinationAirportId);
  return { departure: departure!, flight: flight!, origin: origin!, destination: destination! };
}

async function createReservation(token: string, departureId: number, documentSuffix: string) {
  return request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send({
    departureId,
    classCode: 'ECONOMY',
    quantity: 2,
    passengers: [1, 2].map((index) => ({
      firstName: `Persona${index}`,
      lastName: 'Pasajera',
      document: `${documentSuffix}${String(index).padStart(6, '0')}`,
      birthDate: '1995-02-12'
    }))
  });
}

async function startPayment(token: string, purchaseId: number) {
  const response = await request(app)
    .post(`/api/purchases/${purchaseId}/payment`)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  return new URL(response.body.url).searchParams.get('reference')!;
}

async function chooseLocalResult(token: string, purchaseId: number, reference: string, status: 'approved' | 'rejected') {
  return request(app)
    .post(`/api/purchases/${purchaseId}/payment/sandbox-result`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reference, status });
}

async function confirmPayment(token: string, purchaseId: number, reference: string) {
  return request(app)
    .post(`/api/purchases/${purchaseId}/payment/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reference });
}

describe('US-17 pago y registro de transacciones', () => {
  let localGateway: ReturnType<typeof createPaymentGateway>;

  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: true });
    localGateway = createPaymentGateway('local-sandbox', { clientUrl: 'http://localhost:5173' });
    setPaymentGateway(localGateway);
  });

  it('siembra cada compra confirmada con la cantidad real de tickets emitidos', async () => {
    const confirmedPurchases = await Purchase.findAll({
      where: { status: 'CONFIRMED' },
      attributes: ['id', 'quantity']
    });
    let ticketCount = 0;
    let confirmedQuantity = 0;

    for (const purchase of confirmedPurchases) {
      const purchaseTicketCount = await Ticket.count({ where: { purchaseId: purchase.id } });
      expect(Number(purchase.quantity)).toBe(purchaseTicketCount);
      ticketCount += purchaseTicketCount;
      confirmedQuantity += Number(purchase.quantity);
    }

    expect(ticketCount).toBe(confirmedQuantity);
  });

  it('aprueba, vende, registra todos los datos y emite un pasaje por pasajero una sola vez', async () => {
    const token = await registerAndLogin(1);
    const { departure } = await nextDeparture();
    const created = await createReservation(token, departure.id, 'AA');
    expect(created.status).toBe(201);
    const reference = await startPayment(token, created.body.id);
    expect((await chooseLocalResult(token, created.body.id, reference, 'approved')).status).toBe(200);

    const confirmed = await confirmPayment(token, created.body.id, reference);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.tickets).toHaveLength(2);
    expect(confirmed.body.tickets.every((ticket: { ticketCode: string }) => /^SIGVA-[A-Z0-9]{6}$/.test(ticket.ticketCode))).toBe(true);

    const payment = await Payment.findOne({ where: { reference } });
    const purchase = await Purchase.findByPk(created.body.id);
    const currentDeparture = await Departure.findByPk(departure.id);
    const economy = await Class.findOne({ where: { code: 'ECONOMY' } });
    expect(payment).toMatchObject({
      purchaseId: created.body.id,
      payerPassengerId: purchase?.passengerId,
      departureId: departure.id,
      classId: economy?.id,
      quantity: 2,
      amount: created.body.total,
      reference,
      status: 'APPROVED'
    });
    expect(payment?.paidAt).toBeTruthy();
    expect(purchase?.status).toBe('CONFIRMED');
    expect(currentDeparture?.soldEconomy).toBe(2);
    expect(await Ticket.count({ where: { purchaseId: created.body.id } })).toBe(2);

    const repeated = await confirmPayment(token, created.body.id, reference);
    expect(repeated.status).toBe(200);
    expect(await Ticket.count({ where: { purchaseId: created.body.id } })).toBe(2);
    expect((await Departure.findByPk(departure.id))?.soldEconomy).toBe(2);
  });

  it('registra un rechazo, libera la reserva y conserva el motivo', async () => {
    const token = await registerAndLogin(2);
    const { departure } = await nextDeparture();
    const created = await createReservation(token, departure.id, 'BB');
    const reference = await startPayment(token, created.body.id);
    await chooseLocalResult(token, created.body.id, reference, 'rejected');

    const rejected = await confirmPayment(token, created.body.id, reference);
    const purchase = await Purchase.findByPk(created.body.id);
    expect(rejected.body.status).toBe('REJECTED');
    expect(purchase?.status).toBe('REJECTED');
    expect(purchase?.releaseReason).toBe('PAGO_RECHAZADO');
    expect((await Payment.findOne({ where: { reference } }))?.status).toBe('REJECTED');
    const quote = await request(app).post('/api/purchases/quote').set('Authorization', `Bearer ${token}`).send({
      departureId: departure.id,
      classCode: 'ECONOMY',
      quantity: 2
    });
    expect(quote.status).toBe(200);
  });

  it('registra una aprobación tardía sin vender asientos ni emitir pasajes', async () => {
    const token = await registerAndLogin(3);
    const { departure } = await nextDeparture();
    const created = await createReservation(token, departure.id, 'CC');
    const reference = await startPayment(token, created.body.id);
    await chooseLocalResult(token, created.body.id, reference, 'approved');
    const soldBefore = (await Departure.findByPk(departure.id))?.soldEconomy;
    await Purchase.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: created.body.id } });

    const late = await confirmPayment(token, created.body.id, reference);
    const purchase = await Purchase.findByPk(created.body.id);
    const payment = await Payment.findOne({ where: { reference } });
    expect(late.status).toBe(409);
    expect(late.body.status).toBe('APPROVED_OUT_OF_TIME');
    expect(purchase?.status).toBe('EXPIRED');
    expect(payment?.status).toBe('APPROVED_OUT_OF_TIME');
    expect(await Ticket.count({ where: { purchaseId: created.body.id } })).toBe(0);
    expect((await Departure.findByPk(departure.id))?.soldEconomy).toBe(soldBefore);
  });

  it('reconsulta un pago pendiente y registra una aprobación recibida después del vencimiento', async () => {
    const token = await registerAndLogin(7);
    const { departure } = await nextDeparture();
    const created = await createReservation(token, departure.id, 'FF');
    const reference = await startPayment(token, created.body.id);
    localGateway.setSandboxResult?.(reference, created.body.id, 'pending');
    expect((await confirmPayment(token, created.body.id, reference)).status).toBe(202);

    await Purchase.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: created.body.id } });
    const stillPending = await confirmPayment(token, created.body.id, reference);
    expect(stillPending.status).toBe(409);
    expect((await Purchase.findByPk(created.body.id))?.status).toBe('EXPIRED');
    localGateway.setSandboxResult?.(reference, created.body.id, 'approved');
    const late = await confirmPayment(token, created.body.id, reference);

    expect(late.status).toBe(409);
    expect(late.body.status).toBe('APPROVED_OUT_OF_TIME');
    expect((await Payment.findOne({ where: { reference } }))?.status).toBe('APPROVED_OUT_OF_TIME');
    expect(await Ticket.count({ where: { purchaseId: created.body.id } })).toBe(0);
  });

  it('rechaza pagar una reserva vencida y consultar una compra ajena', async () => {
    const ownerToken = await registerAndLogin(4);
    const otherToken = await registerAndLogin(5);
    const { departure } = await nextDeparture();
    const created = await createReservation(ownerToken, departure.id, 'DD');
    const foreign = await request(app)
      .post(`/api/purchases/${created.body.id}/payment`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(foreign.status).toBe(404);

    const reference = await startPayment(ownerToken, created.body.id);
    await Purchase.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: created.body.id } });
    const expired = await request(app)
      .post(`/api/purchases/${created.body.id}/payment`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(expired.status).toBe(409);
    const foreignConfirm = await confirmPayment(otherToken, created.body.id, reference);
    expect(foreignConfirm.status).toBe(404);
  });

  it('completa el flujo registro, búsqueda, cotización, reserva, pago y pasajes', async () => {
    const token = await registerAndLogin(6);
    const { departure, origin, destination } = await nextDeparture();
    const search = await request(app).get('/api/search/flights').query({
      origin: origin.iata,
      destination: destination.iata,
      date: departure.date
    });
    expect(search.status).toBe(200);
    const searchResult = search.body.results.find((flight: { id: number }) => flight.id === departure.id);
    expect(searchResult).toBeTruthy();
    const economyBefore = searchResult.classes.find((item: { code: string }) => item.code === 'ECONOMY').available;

    const quote = await request(app)
      .post('/api/purchases/quote')
      .set('Authorization', `Bearer ${token}`)
      .send({ departureId: departure.id, classCode: 'ECONOMY', quantity: 2 });
    expect(quote.status).toBe(200);
    const created = await createReservation(token, departure.id, 'EE');
    expect(created.status).toBe(201);
    const reference = await startPayment(token, created.body.id);
    await chooseLocalResult(token, created.body.id, reference, 'approved');
    const confirmed = await confirmPayment(token, created.body.id, reference);
    expect(confirmed.body.tickets).toHaveLength(2);

    const detail = await request(app).get(`/api/purchases/${created.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('CONFIRMED');
    expect(detail.body.flight.flightNumber).toBeTruthy();
    expect(detail.body.tickets).toHaveLength(2);
    expect(detail.body.tickets.every((ticket: { ticketCode: string }) => ticket.ticketCode)).toBe(true);
    const searchAfter = await request(app).get('/api/search/flights').query({
      origin: origin.iata,
      destination: destination.iata,
      date: departure.date
    });
    const afterResult = searchAfter.body.results.find((flight: { id: number }) => flight.id === departure.id);
    expect(afterResult.classes.find((item: { code: string }) => item.code === 'ECONOMY').available).toBe(economyBefore - 2);
    const after = await request(app).post('/api/purchases/quote').set('Authorization', `Bearer ${token}`).send({
      departureId: departure.id,
      classCode: 'ECONOMY',
      quantity: Number(quote.body.available ?? 1)
    });
    expect(after.status).toBe(200);
  });
});