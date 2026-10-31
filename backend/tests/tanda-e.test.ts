import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Op } from 'sequelize';
import { app, setPaymentGateway } from '../src/app.js';
import { setEmailTransport } from '../src/emailService.js';
import { createPaymentGateway } from '../src/paymentGateway.js';
import { Airport, Departure, EmailDelivery, Flight, Invoice, Payment, Passenger, Purchase, Ticket, resetDatabase, type DepartureModel } from '../src/db/index.js';

async function login(email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

async function registerPassenger(index: number) {
  const email = `sprint3-${index}@sigva.test`;
  const password = 'Prueba1234';
  const registration = await request(app).post('/api/auth/register').send({
    name: `Pasajero${index}`,
    lastName: 'Sprint3',
    document: `S3${String(index).padStart(8, '0')}`,
    email,
    password,
    birthDate: '1990-01-01'
  });
  expect(registration.status).toBe(201);
  return { email, token: await login(email, password) };
}

async function futureDeparture() {
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 5);
  const departure = await Departure.findOne({
    where: { status: 'SCHEDULED', date: { [Op.gte]: future.toISOString().slice(0, 10) } },
    order: [['date', 'ASC'], ['id', 'ASC']],
    include: [{ model: Flight, as: 'flight', where: { status: 'ACTIVE' } }]
  });
  expect(departure).not.toBeNull();
  return departure!;
}

async function confirmPurchase(token: string, departureId: number, index: number, quantity = 1) {
  const passengers = Array.from({ length: quantity }, (_, passengerIndex) => ({
    firstName: `Viajero${passengerIndex + 1}`,
    lastName: `Prueba${index}`,
    document: `DOC${String(index).padStart(6, '0')}${String(passengerIndex + 1).padStart(2, '0')}`,
    birthDate: '1990-01-01'
  }));
  const created = await request(app).post('/api/purchases').set('Authorization', `Bearer ${token}`).send({
    departureId, classCode: 'ECONOMY', quantity, passengers
  });
  expect(created.status).toBe(201);
  const payment = await request(app).post(`/api/purchases/${created.body.id}/payment`).set('Authorization', `Bearer ${token}`);
  expect(payment.status).toBe(200);
  const reference = new URL(payment.body.url).searchParams.get('reference')!;
  expect((await request(app).post(`/api/purchases/${created.body.id}/payment/sandbox-result`)
    .set('Authorization', `Bearer ${token}`).send({ reference, status: 'approved' })).status).toBe(200);
  const confirmed = await request(app).post(`/api/purchases/${created.body.id}/payment/confirm`)
    .set('Authorization', `Bearer ${token}`).send({ reference });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.status).toBe('CONFIRMED');
  return { purchaseId: created.body.id as number, reference };
}

describe('Sprint 3', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: true });
    setPaymentGateway(createPaymentGateway('local-sandbox', { clientUrl: 'http://localhost:5173' }));
    setEmailTransport(null);
  });

  afterEach(() => setEmailTransport(null));

  it('gestiona cuentas de personal e invalida sesiones al dar de baja', async () => {
    const adminToken = await login('admin@sigva.test', 'Admin123!');
    const invalid = await request(app).post('/api/admin/accounts').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nuevo', email: 'invalido', password: 'corta', role: 'employee' });
    expect(invalid.status).toBe(400);

    const created = await request(app).post('/api/admin/accounts').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Mostrador', email: 'mostrador@sigva.test', password: 'Acceso1234', role: 'employee' });
    expect(created.status).toBe(201);
    expect((await request(app).post('/api/admin/accounts').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Duplicado', email: 'mostrador@sigva.test', password: 'Acceso1234', role: 'employee' })).status).toBe(409);

    const employeeToken = await login('mostrador@sigva.test', 'Acceso1234');
    const updated = await request(app).put(`/api/admin/accounts/${created.body.account.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ name: 'Supervisor', role: 'admin' });
    expect(updated.status).toBe(200);
    expect((await request(app).get('/api/admin/accounts').set('Authorization', `Bearer ${employeeToken}`)).status).toBe(200);

    expect((await request(app).delete(`/api/admin/accounts/${created.body.account.id}`)
      .set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${employeeToken}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'mostrador@sigva.test', password: 'Acceso1234' })).status).toBe(401);
    expect((await request(app).delete('/api/admin/accounts/1').set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
    expect((await request(app).put('/api/admin/accounts/1').set('Authorization', `Bearer ${adminToken}`).send({ role: 'employee' })).status).toBe(409);
  });

  it('registra una falla de comunicación de pago sin exponer detalles ni liberar la reserva', async () => {
    const passenger = await registerPassenger(5);
    const departure = await futureDeparture();
    const created = await request(app).post('/api/purchases').set('Authorization', `Bearer ${passenger.token}`).send({
      departureId: departure.id,
      classCode: 'ECONOMY',
      quantity: 1,
      passengers: [{ firstName: 'Viajero', lastName: 'Prueba', document: 'FALLA00001', birthDate: '1990-01-01' }]
    });
    expect(created.status).toBe(201);
    setPaymentGateway({
      createPaymentSession: async () => { throw new Error('detalle de conexión interno'); },
      verifyPayment: async () => { throw new Error('detalle de conexión interno'); }
    });
    const failed = await request(app).post(`/api/purchases/${created.body.id}/payment`).set('Authorization', `Bearer ${passenger.token}`);
    expect(failed.status).toBe(502);
    expect(failed.body.message).toContain('No pudimos comunicarnos');
    expect(failed.body.message).not.toContain('detalle de conexión interno');
    expect((await Purchase.findByPk(created.body.id))?.status).toBe('RESERVED');
    expect((await Payment.findOne({ where: { purchaseId: created.body.id } }))?.status).toBe('FAILED');
  });

  it('crea pasajes y factura una vez, y registra/reintenta el email sin revertir el pago', async () => {
    setEmailTransport({ sendMail: async () => { throw new Error('SMTP no disponible'); } } as never);
    const passenger = await registerPassenger(1);
    const departure = await futureDeparture();
    const { purchaseId } = await confirmPurchase(passenger.token, departure.id, 1, 2);
    const purchase = await Purchase.findByPk(purchaseId);
    expect(purchase?.status).toBe('CONFIRMED');
    expect(await Ticket.count({ where: { purchaseId } })).toBe(2);
    expect(await Invoice.count({ where: { purchaseId } })).toBe(1);
    let delivery = await EmailDelivery.findOne({ where: { purchaseId, eventKey: `documents-${purchaseId}` } });
    expect(delivery?.deliveryStatus).toBe('FAILED');
    expect(delivery?.attempts).toBe(1);

    let attachmentCount = 0;
    setEmailTransport({ sendMail: async (message: { attachments?: unknown[] }) => {
      attachmentCount = message.attachments?.length ?? 0;
      return {};
    } } as never);
    const retried = await request(app).post(`/api/purchases/${purchaseId}/email/retry`).set('Authorization', `Bearer ${passenger.token}`);
    expect(retried.status).toBe(200);
    delivery = await EmailDelivery.findOne({ where: { purchaseId, eventKey: `documents-${purchaseId}` } });
    expect(delivery?.deliveryStatus).toBe('SENT');
    expect(delivery?.attempts).toBe(2);
    expect(attachmentCount).toBe(3);
    expect(await Invoice.count({ where: { purchaseId } })).toBe(1);

    const invoicePdf = await request(app).get(`/api/purchases/${purchaseId}/invoice.pdf`).set('Authorization', `Bearer ${passenger.token}`);
    const ticket = await Ticket.findOne({ where: { purchaseId } });
    const ticketPdf = await request(app).get(`/api/purchases/${purchaseId}/tickets/${ticket!.id}.pdf`).set('Authorization', `Bearer ${passenger.token}`);
    expect(invoicePdf.headers['content-type']).toContain('application/pdf');
    expect(ticketPdf.headers['content-type']).toContain('application/pdf');

    const singlePurchase = await confirmPurchase(passenger.token, departure.id, 7);
    expect(await Ticket.count({ where: { purchaseId: singlePurchase.purchaseId } })).toBe(1);
    expect(await Invoice.count({ where: { purchaseId: singlePurchase.purchaseId } })).toBe(1);
  });

  it('lista solo compras propias y notifica cambios/cancelaciones de salidas vendidas', async () => {
    const passenger = await registerPassenger(2);
    const otherPassenger = await registerPassenger(3);
    const departure = await futureDeparture();
    const { purchaseId } = await confirmPurchase(passenger.token, departure.id, 2);

    const ownPurchases = await request(app).get('/api/purchases').set('Authorization', `Bearer ${passenger.token}`);
    const otherPurchases = await request(app).get('/api/purchases').set('Authorization', `Bearer ${otherPassenger.token}`);
    expect(ownPurchases.body.purchases.some((purchase: { id: number }) => purchase.id === purchaseId)).toBe(true);
    expect(otherPurchases.body.purchases.some((purchase: { id: number }) => purchase.id === purchaseId)).toBe(false);
    expect((await request(app).get(`/api/purchases/${purchaseId}`).set('Authorization', `Bearer ${otherPassenger.token}`)).status).toBe(404);

    const adminToken = await login('admin@sigva.test', 'Admin123!');
    const flight = await Flight.findByPk(departure.flightId);
    const newTime = flight!.departureTime === '05:45' ? '06:15' : '05:45';
    const changed = await request(app).put(`/api/flights/${flight!.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ departureTime: newTime, confirmed: true });
    expect(changed.status).toBe(200);
    const scheduleAlert = await EmailDelivery.findOne({ where: { purchaseId, kind: 'SCHEDULE_CHANGE' } });
    expect(scheduleAlert?.deliveryStatus).toBe('SENT');
    const historyAfterChange = await request(app).get('/api/purchases').set('Authorization', `Bearer ${passenger.token}`);
    expect(historyAfterChange.body.purchases.find((purchase: { id: number }) => purchase.id === purchaseId).status).toBe('MODIFIED');

    const cancelled = await request(app).post(`/api/flights/${flight!.id}/cancel`).set('Authorization', `Bearer ${adminToken}`)
      .send({ departureDate: departure.date, confirmed: true });
    expect(cancelled.status).toBe(200);
    const cancellationAlert = await EmailDelivery.findOne({ where: { purchaseId, kind: 'CANCELLATION' } });
    expect(cancellationAlert?.deliveryStatus).toBe('SENT');
    const historyAfterCancellation = await request(app).get('/api/purchases').set('Authorization', `Bearer ${passenger.token}`);
    expect(historyAfterCancellation.body.purchases.find((purchase: { id: number }) => purchase.id === purchaseId).status).toBe('CANCELLED');
  });

  it('notifica la cancelación completa y no crea alertas para salidas sin pasajes', async () => {
    const passenger = await registerPassenger(6);
    const departure = await futureDeparture();
    const { purchaseId } = await confirmPurchase(passenger.token, departure.id, 6);
    const adminToken = await login('admin@sigva.test', 'Admin123!');
    const flight = await Flight.findByPk(departure.flightId);
    const cancelledFlight = await request(app).post(`/api/flights/${flight!.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`).send({ confirmed: true });
    expect(cancelledFlight.status).toBe(200);
    expect(await EmailDelivery.count({ where: { purchaseId, kind: 'CANCELLATION' } })).toBe(1);

    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const candidates = await Departure.findAll({ where: { status: 'SCHEDULED', date: { [Op.gte]: future.toISOString().slice(0, 10) } } });
    let unsoldDeparture: DepartureModel | null = null;
    for (const candidate of candidates) {
      if (await Ticket.count({ where: { departureId: candidate.id } }) === 0) {
        unsoldDeparture = candidate;
        break;
      }
    }
    expect(unsoldDeparture).not.toBeNull();
    const unsoldFlight = await Flight.findByPk(unsoldDeparture!.flightId);
    const beforeAlerts = await EmailDelivery.count({ where: { kind: 'CANCELLATION' } });
    const cancelledDeparture = await request(app).post(`/api/flights/${unsoldFlight!.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`).send({ departureDate: unsoldDeparture!.date, confirmed: true });
    expect(cancelledDeparture.status).toBe(200);
    expect(await EmailDelivery.count({ where: { kind: 'CANCELLATION' } })).toBe(beforeAlerts);
  });

  it('filtra ocupación por vuelo/ruta/fechas, incluye canceladas y restringe acceso', async () => {
    const passenger = await registerPassenger(4);
    const departure = await futureDeparture();
    await confirmPurchase(passenger.token, departure.id, 4);
    const flight = await Flight.findByPk(departure.flightId);
    const origin = await Airport.findByPk(flight!.originAirportId);
    const destination = await Airport.findByPk(flight!.destinationAirportId);
    await departure.update({ status: 'CANCELLED' });
    const adminToken = await login('admin@sigva.test', 'Admin123!');
    const startedAt = Date.now();
    const report = await request(app).get('/api/reports/occupancy').set('Authorization', `Bearer ${adminToken}`).query({
      flight: flight!.flightNumber, origin: origin!.iata, destination: destination!.iata, from: departure.date, to: departure.date
    });
    expect(report.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(report.body.rows).toHaveLength(2);
    const economy = report.body.rows.find((row: { classCode: string }) => row.classCode === 'ECONOMY');
    expect(economy.departureStatus).toBe('CANCELLED');
    expect(economy.soldTickets).toBeGreaterThan(0);
    expect(report.body.totals.capacity).toBeGreaterThan(0);
    expect((await request(app).get('/api/reports/occupancy').set('Authorization', `Bearer ${passenger.token}`)).status).toBe(403);
  });
});