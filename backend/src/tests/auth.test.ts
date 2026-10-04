import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { Airport, Flight, Session, User, resetDatabase } from '../db/index.js';
import { config } from '../config.js';

async function getToken(email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  return response.body.token as string;
}

describe('US-03 autenticación', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responde un error genérico si un handler asíncrono falla', async () => {
    vi.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('detalle interno secreto'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request(app).post('/api/auth/login').send({
      email: 'admin@sigva.test',
      password: 'Admin123!'
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Error interno del servidor.' });
    expect(JSON.stringify(response.body)).not.toContain('detalle interno secreto');
  });

  it('login correcto devuelve token y usuario', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'admin@sigva.test',
      password: 'Admin123!'
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user.email).toBe('admin@sigva.test');
    expect(response.body.user.role).toBe('admin');
  });

  it('login incorrecto devuelve mensaje genérico', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'admin@sigva.test',
      password: 'incorrecta'
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('credenciales');
  });

  it('email inexistente devuelve exactamente la misma respuesta que una contraseña errónea', async () => {
    const [missing, incorrect] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'inexistente@sigva.test', password: 'cualquiera' }),
      request(app).post('/api/auth/login').send({ email: 'admin@sigva.test', password: 'incorrecta' })
    ]);
    expect(missing.status).toBe(incorrect.status);
    expect(missing.body).toEqual(incorrect.body);
  });

  it('requiere sesión válida', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('permite acceso para rol autorizado y rechaza para rol no autorizado', async () => {
    const adminToken = await getToken('admin@sigva.test', 'Admin123!');
    const employeeToken = await getToken('empleado@sigva.test', 'Empleado123!');

    const adminResponse = await request(app).get('/api/airports').set('Authorization', `Bearer ${adminToken}`);
    expect(adminResponse.status).toBe(200);

    const employeeResponse = await request(app).get('/api/airports').set('Authorization', `Bearer ${employeeToken}`);
    expect(employeeResponse.status).toBe(403);
  });

  it('logout responde correctamente', async () => {
    const token = await getToken('admin@sigva.test', 'Admin123!');
    const response = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const reusedToken = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(reusedToken.status).toBe(401);
  });
  it('vence por inactividad y renueva la última actividad cuando hay uso válido', async () => {
    expect(config.sessionTimeoutMinutes).toBe(Number(process.env.SESSION_TIMEOUT_MINUTES));
    const token = await getToken('admin@sigva.test', 'Admin123!');
    const sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sessionId as string;
    const session = await Session.findByPk(sessionId);
    expect(session).not.toBeNull();

    const previousTimeout = config.sessionTimeoutMinutes;
    config.sessionTimeoutMinutes = 0.01;
    try {
      const activityBefore = new Date(Date.now() - 500);
      await session!.update({ lastActivity: activityBefore });
      const validResponse = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(validResponse.status).toBe(200);
      const renewed = await Session.findByPk(sessionId);
      expect(new Date(renewed!.get('lastActivity') as Date).getTime()).toBeGreaterThan(activityBefore.getTime());

      await renewed!.update({ lastActivity: new Date(Date.now() - 1000) });
      const expiredResponse = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(expiredResponse.status).toBe(401);
    } finally {
      config.sessionTimeoutMinutes = previousTimeout;
    }
  });

  it('aplica 401/403 por grupo de rutas', async () => {
    const passengerToken = await getToken('pasajero@sigva.test', 'Pasajero123!');
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/airports')).status).toBe(401);
    expect((await request(app).get('/api/flights')).status).toBe(401);
    expect((await request(app).get('/api/airports').set('Authorization', `Bearer ${passengerToken}`)).status).toBe(403);
    expect((await request(app).get('/api/flights').set('Authorization', `Bearer ${passengerToken}`)).status).toBe(403);
  });
});

describe('US-06 aeropuertos', () => {
  beforeEach(async () => {
    await resetDatabase({ seedDemoFlights: false });
  });

  it('crea y lista aeropuertos del administrador', async () => {
    const adminToken = await getToken('admin@sigva.test', 'Admin123!');

    const created = await request(app)
      .post('/api/airports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ iata: 'BUE', name: 'Ezeiza Aeropuerto', city: 'Buenos Aires', province: 'Buenos Aires' });

    expect(created.status).toBe(201);
    expect(created.body.airport.iata).toBe('BUE');

    const listing = await request(app).get('/api/airports').set('Authorization', `Bearer ${adminToken}`);
    expect(listing.status).toBe(200);
    expect(listing.body.airports.some((airport: { iata: string }) => airport.iata === 'BUE')).toBe(true);
  });

  it('rechaza IATA inválido y duplicado', async () => {
    const adminToken = await getToken('admin@sigva.test', 'Admin123!');

    const invalid = await request(app)
      .post('/api/airports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ iata: 'BU', name: 'Prueba', city: 'Córdoba', province: 'Córdoba' });

    expect(invalid.status).toBe(400);

    const duplicate = await request(app)
      .post('/api/airports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ iata: 'AEP', name: 'Repetido', city: 'Córdoba', province: 'Córdoba' });

    expect(duplicate.status).toBe(409);
  });

  it('actualiza y desactiva aeropuerto válido', async () => {
    const adminToken = await getToken('admin@sigva.test', 'Admin123!');

    const created = await request(app)
      .post('/api/airports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ iata: 'BUE', name: 'Ezeiza', city: 'Buenos Aires', province: 'Buenos Aires' });

    const updated = await request(app)
      .put(`/api/airports/${created.body.airport.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ iata: 'BUE', name: 'Ezeiza Nuevo', city: 'Buenos Aires', province: 'Buenos Aires' });

    expect(updated.status).toBe(200);
    expect(updated.body.airport.name).toBe('Ezeiza Nuevo');

    const removed = await request(app).delete(`/api/airports/${created.body.airport.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body.airport.isActive).toBe(false);
  });

  it.each(['name', 'city', 'province'])('rechaza modificar un aeropuerto con %s vacío', async (field) => {
    const token = await getToken('admin@sigva.test', 'Admin123!');
    const airport = await Airport.findOne({ where: { iata: 'AEP' } });
    const payload: Record<string, string> = {
      iata: 'AEP',
      name: 'Aeroparque Jorge Newbery',
      city: 'Buenos Aires',
      province: 'Buenos Aires'
    };
    payload[field] = '  ';

    const response = await request(app)
      .put(`/api/airports/${airport!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.errors[field]).toBeTruthy();
    expect((await Airport.findByPk(airport!.id))?.get(field)).not.toBe('');
  });

  it('rechaza desactivar aeropuerto usado por vuelo activo', async () => {
    const adminToken = await getToken('admin@sigva.test', 'Admin123!');
    await request(app)
      .post('/api/airports')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ iata: 'BUE', name: 'Unico', city: 'Buenos Aires', province: 'Buenos Aires' });

    const origin = await Airport.findOne({ where: { iata: 'AEP' } });
    const target = await Airport.findOne({ where: { iata: 'BUE' } });

    await Flight.create({
      flightNumber: 'AR2024',
      daysOfWeek: '1,2',
      departureTime: '10:00',
      arrivalTime: '11:30',
      originAirportId: origin!.id,
      destinationAirportId: target!.id,
      availableFrom: '2026-11-01',
      availableTo: '2026-11-30',
      economySeats: 100,
      firstClassSeats: 10,
      economyPrice: 2500,
      firstClassPrice: 7000,
      status: 'ACTIVE'
    });

    const result = await request(app).delete(`/api/airports/${target!.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('desactivar');
  });
});
