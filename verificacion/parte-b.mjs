import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const envText = await readFile(path.join(root, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET no está configurado.');

const require = createRequire(path.join(root, 'backend', 'package.json'));
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.resolve(root, env.DB_PATH ?? './backend/data/sigva.sqlite'));
const api = `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? '3001'}/api`;
const results = [];
const add = (id, ok, evidence) => results.push({ id, result: ok ? 'OK' : 'OBS', evidence });

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function request(method, route, { token, body } = {}) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let payload = text;
  if (text && response.headers.get('content-type')?.includes('json')) {
    payload = JSON.parse(text);
  }
  return { status: response.status, body: payload };
}

function expiredToken(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId, email, role: 'admin', iat: now - 1860, exp: now - 60, sessionId: 'qa-expired'
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

function daysForDate(value) {
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function datesInRange(from, to, days) {
  const dates = [];
  const date = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (date <= end) {
    const value = date.toISOString().slice(0, 10);
    if (days.includes(daysForDate(value))) dates.push(value);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function difference(left, right) {
  return left.filter((value) => !right.includes(value));
}

async function counts() {
  return (await query(`
    SELECT
      (SELECT COUNT(*) FROM flights) AS flights,
      (SELECT COUNT(*) FROM departures) AS departures,
      (SELECT COUNT(*) FROM fares) AS fares,
      (SELECT COUNT(*) FROM flight_change_history) AS history
  `))[0];
}

function responseErrors(response) {
  return JSON.stringify(response.body?.errors ?? response.body?.message ?? response.body);
}

function hasFieldReason(response, field) {
  const errors = response.body?.errors;
  return Boolean(errors && typeof errors[field] === 'string' && errors[field].length > 0);
}

function flightPayload(number, overrides = {}) {
  return {
    flightNumber: number,
    daysOfWeek: [1, 5],
    departureTime: '08:00',
    arrivalTime: '09:00',
    originAirportId: originId,
    destinationAirportId: destinationId,
    availableFrom: '2026-11-01',
    availableTo: '2026-11-30',
    economySeats: 20,
    firstClassSeats: 4,
    economyPrice: 100,
    firstClassPrice: 250,
    ...overrides
  };
}

async function createFlight(number, overrides = {}) {
  const response = await request('POST', '/flights', {
    token: adminToken,
    body: flightPayload(number, overrides)
  });
  if (response.status !== 201) {
    throw new Error(`POST /flights ${number}: HTTP ${response.status} ${responseErrors(response)}`);
  }
  return response.body.flight;
}

async function unusedIata(prefix) {
  for (let index = 0; index < 26; index += 1) {
    const candidate = `${prefix}${String.fromCharCode(65 + index)}`;
    if ((await query('SELECT id FROM airports WHERE iata=?', [candidate])).length === 0) return candidate;
  }
  throw new Error(`No hay código IATA libre con prefijo ${prefix}.`);
}

async function capture(id, test) {
  try {
    const evidence = await test();
    const ok = evidence && evidence.ok === true;
    add(id, ok, evidence?.detail ?? String(evidence));
  } catch (error) {
    add(id, false, `excepción del verificador: ${error.message}`);
  }
}

async function invalidCreate(label, body, field) {
  const before = await counts();
  const response = await request('POST', '/flights', { token: adminToken, body });
  const after = await counts();
  const noRows = Object.keys(before).every((key) => before[key] === after[key]);
  const fieldReason = hasFieldReason(response, field);
  return {
    ok: response.status >= 400 && response.status < 500 && noRows && fieldReason,
    detail: `${label}: HTTP ${response.status}, errors=${responseErrors(response)}, filas sin cambios=${noRows}`
  };
}

async function matrixFlightAccess() {
  const matrixFlight = await createFlight(`QAM${Date.now().toString().slice(-6)}`);
  const putFlight = await createFlight(`QAP${Date.now().toString().slice(-6)}`);
  const patchFlight = await createFlight(`QAT${Date.now().toString().slice(-6)}`);
  const cancelFlight = await createFlight(`QAC${Date.now().toString().slice(-6)}`);
  const deleteFlight = await createFlight(`QAD${Date.now().toString().slice(-6)}`);
  const expired = expiredToken(adminId, adminEmail);
  const credentials = [
    ['sin token', undefined, 401],
    ['inválido', 'token-invalido', 401],
    ['vencido', expired, 401],
    ['empleado', employeeToken, 403],
    ['pasajero', passengerToken, 403]
  ];
  const endpoints = [
    { label: 'GET lista', method: 'GET', path: '/flights', expectedAdmin: 200 },
    { label: 'POST alta', method: 'POST', path: '/flights', expectedAdmin: 201, body: flightPayload(`QAN${Date.now().toString().slice(-6)}`) },
    { label: 'GET detalle', method: 'GET', path: `/flights/${matrixFlight.id}`, expectedAdmin: 200 },
    { label: 'PUT', method: 'PUT', path: `/flights/${putFlight.id}`, expectedAdmin: 200, body: { confirmed: true } },
    { label: 'PATCH', method: 'PATCH', path: `/flights/${patchFlight.id}`, expectedAdmin: 200, body: { confirmed: true } },
    { label: 'POST cancel', method: 'POST', path: `/flights/${cancelFlight.id}/cancel`, expectedAdmin: 200, body: { confirmed: true } },
    { label: 'DELETE cancel', method: 'DELETE', path: `/flights/${deleteFlight.id}`, expectedAdmin: 200, body: { confirmed: true } }
  ];
  const failures = [];
  const rows = [];
  for (const endpoint of endpoints) {
    const cells = [];
    for (const [name, token, expected] of credentials) {
      const response = await request(endpoint.method, endpoint.path, { token, body: endpoint.body });
      cells.push(`${name}=${response.status}`);
      if (response.status !== expected) {
        failures.push(`${endpoint.label}/${name}: esperado ${expected}, obtenido ${response.status}`);
      }
    }
    const admin = await request(endpoint.method, endpoint.path, { token: adminToken, body: endpoint.body });
    cells.push(`admin=${admin.status}`);
    if (admin.status !== endpoint.expectedAdmin) {
      failures.push(`${endpoint.label}/admin: esperado ${endpoint.expectedAdmin}, obtenido ${admin.status}`);
    }
    rows.push(`${endpoint.label}: ${cells.join('/')}`);
  }
  return { ok: failures.length === 0, detail: `${rows.join(' | ')}; diferencias=${failures.join('; ') || 'ninguna'}` };
}

const health = await request('GET', '/health');
const adminLogin = await request('POST', '/auth/login', { body: { email: 'admin@sigva.test', password: 'Admin123!' } });
const employeeLogin = await request('POST', '/auth/login', { body: { email: 'empleado@sigva.test', password: 'Empleado123!' } });
const passengerLogin = await request('POST', '/auth/login', { body: { email: 'pasajero@sigva.test', password: 'Pasajero123!' } });
if (health.status !== 200 || adminLogin.status !== 200 || employeeLogin.status !== 200 || passengerLogin.status !== 200) {
  throw new Error('API no disponible o las credenciales del README no iniciaron sesión.');
}
const adminToken = adminLogin.body.token;
const employeeToken = employeeLogin.body.token;
const passengerToken = passengerLogin.body.token;
const adminId = adminLogin.body.user.id;
const adminEmail = adminLogin.body.user.email;
const airports = await query('SELECT id, iata FROM airports WHERE isActive=1 ORDER BY id');
if (airports.length < 2) throw new Error('El seed no proporciona dos aeropuertos activos.');
const originId = airports[0].id;
const destinationId = airports[1].id;
const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).formatToParts(new Date()).map(({ type, value }) => [type, value]));
const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
const currentArgentinaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Argentina/Buenos_Aires',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
}).format(new Date());
const seedCount = await counts();

await capture('US-07.1', async () => {
  const created = await createFlight(`QAV${Date.now().toString().slice(-6)}`);
  return {
    ok: created.status === 'ACTIVE' && created.daysOfWeek === '1,5'
      && created.economySeats === 20 && Number(created.firstClassPrice) === 250
      && created.originAirportId === originId && created.destinationAirportId === destinationId,
    detail: `POST /flights HTTP 201; Activo=${created.status}; campos completos; vuelo ${created.flightNumber}`
  };
});

await capture('US-07.2', async () => {
  const base = flightPayload(`QAMISS${Date.now().toString().slice(-5)}`);
  const required = [
    'flightNumber', 'daysOfWeek', 'departureTime', 'arrivalTime', 'originAirportId',
    'destinationAirportId', 'availableFrom', 'availableTo', 'economySeats', 'firstClassSeats',
    'economyPrice', 'firstClassPrice'
  ];
  const misses = [];
  for (const field of required) {
    const body = { ...base };
    delete body[field];
    const result = await invalidCreate(`faltante ${field}`, body, field);
    if (!result.ok) misses.push(result.detail);
  }
  const sameAirport = await invalidCreate('origen=destino', { ...base, destinationAirportId: originId }, 'destinationAirportId');
  const noDays = await invalidCreate('sin días', { ...base, daysOfWeek: [] }, 'daysOfWeek');
  const reversedPeriod = await invalidCreate('hasta<desde', { ...base, availableTo: '2026-10-31' }, 'availableTo');
  const pastFrom = await invalidCreate('desde anterior a hoy', {
    ...base, availableFrom: '2026-10-02', availableTo: '2026-11-30'
  }, 'availableFrom');
  const noSeats = await invalidCreate('capacidad total cero', {
    ...base, economySeats: 0, firstClassSeats: 0
  }, 'economySeats');
  const economyZero = await invalidCreate('Economy precio 0 con asientos', { ...base, economyPrice: 0 }, 'economyPrice');
  const economyNegative = await invalidCreate('Economy precio negativo', { ...base, economyPrice: -1 }, 'economyPrice');
  const firstZero = await invalidCreate('Primera precio 0 con asientos', { ...base, firstClassPrice: 0 }, 'firstClassPrice');
  const firstNegative = await invalidCreate('Primera precio negativo', { ...base, firstClassPrice: -1 }, 'firstClassPrice');
  const all = [sameAirport, noDays, reversedPeriod, pastFrom, noSeats, economyZero, economyNegative, firstZero, firstNegative];
  if (misses.length || all.some((entry) => !entry.ok)) {
    return { ok: false, detail: [...misses, ...all.filter((entry) => !entry.ok).map((entry) => entry.detail)].join(' | ') };
  }
  return { ok: true, detail: `12/12 obligatorios y 9 validaciones de negocio: 4xx, errores por campo/motivo y conteos sin cambios` };
});

await capture('US-07.3', async () => {
  const overnight = await createFlight(`QAN${Date.now().toString().slice(-6)}`, {
    departureTime: '23:00', arrivalTime: '01:00'
  });
  const equal = await createFlight(`QAE${Date.now().toString().slice(-6)}`, {
    departureTime: '10:00', arrivalTime: '10:00'
  });
  const daytime = await createFlight(`QAD${Date.now().toString().slice(-6)}`, {
    departureTime: '10:00', arrivalTime: '11:00'
  });
  return {
    ok: overnight.arrivalsNextDay === true && equal.arrivalsNextDay === true && daytime.arrivalsNextDay === false,
    detail: `23:00→01:00=${overnight.arrivalsNextDay}; 10:00→10:00=${equal.arrivalsNextDay}; 10:00→11:00=${daytime.arrivalsNextDay}`
  };
});

await capture('US-07.4', async () => {
  const base = flightPayload(`QAINV${Date.now().toString().slice(-5)}`);
  const invalid = [];
  for (const [label, body, field] of [
    ['hora inválida', { ...base, departureTime: '25:61' }, 'departureTime'],
    ['31/02 desde', { ...base, availableFrom: '2026-02-31' }, 'availableFrom'],
    ['31/02 hasta', { ...base, availableTo: '2026-02-31' }, 'availableTo']
  ]) {
    const result = await invalidCreate(label, body, field);
    if (!result.ok) invalid.push(result.detail);
  }
  const duplicateNumber = `QADUP${Date.now().toString().slice(-5)}`;
  await createFlight(duplicateNumber);
  const before = await counts();
  const duplicate = await request('POST', '/flights', {
    token: adminToken, body: flightPayload(duplicateNumber)
  });
  const after = await counts();
  const unchanged = Object.keys(before).every((key) => before[key] === after[key]);
  const duplicateExplained = duplicate.status === 409 && hasFieldReason(duplicate, 'flightNumber') && unchanged;
  if (invalid.length || !duplicateExplained) {
    return { ok: false, detail: `${invalid.join(' | ')}; número duplicado HTTP ${duplicate.status}, errors=${responseErrors(duplicate)}, filas sin cambios=${unchanged}` };
  }
  return { ok: true, detail: `hora + dos fechas 31/02 + número duplicado: errores 4xx campo/motivo; sin filas nuevas` };
});

await capture('US-07.5', async () => {
  const flight = await createFlight(`QANOV${Date.now().toString().slice(-5)}`, {
    daysOfWeek: [1, 5], availableFrom: '2026-11-01', availableTo: '2026-11-30'
  });
  const fromEdge = await createFlight(`QAEG${Date.now().toString().slice(-5)}`, {
    daysOfWeek: [1, 5], availableFrom: '2026-11-02', availableTo: '2026-11-30'
  });
  const exact = ['2026-11-02', '2026-11-06', '2026-11-09', '2026-11-13', '2026-11-16',
    '2026-11-20', '2026-11-23', '2026-11-27', '2026-11-30'];
  const actualRows = await query('SELECT date,status FROM departures WHERE flightId=? ORDER BY date', [flight.id]);
  const actual = actualRows.map((row) => row.date);
  const edgeRows = await query('SELECT date FROM departures WHERE flightId=? ORDER BY date', [fromEdge.id]);
  const duplicateRows = await query('SELECT flightId,date,COUNT(*) AS n FROM departures GROUP BY flightId,date HAVING n>1');
  return {
    ok: flight.status === 'ACTIVE' && actualRows.length === 9
      && JSON.stringify(actual) === JSON.stringify(exact)
      && JSON.stringify(edgeRows.map((row) => row.date)) === JSON.stringify(exact)
      && actualRows.every((row) => row.status === 'SCHEDULED')
      && duplicateRows.length === 0,
    detail: `Activo=${flight.status}; 01/11–30/11 fechas=${actual.join(',')}; borde desde 02/11 y hasta 30/11 incluidas=${JSON.stringify(edgeRows.map((row) => row.date)) === JSON.stringify(exact)}; Programadas=${actualRows.every((row) => row.status === 'SCHEDULED')}; duplicados=${duplicateRows.length}`
  };
});

await capture('US-07.6 / US-09.6', matrixFlightAccess);

const capacitySeed = (await query('SELECT * FROM flights WHERE flightNumber=?', ['AR1450']))[0];
const seedEconomySale = (await query(`
  SELECT d.id,d.date,d.soldEconomy,d.soldFirstClass
  FROM departures d
  WHERE d.flightId=? AND d.date>=? AND d.soldEconomy>0
  ORDER BY d.date LIMIT 1
`, [capacitySeed.id, today]))[0];

await capture('US-08.1', async () => {
  const before = (await query('SELECT flightNumber,departureTime FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const noConfirm = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { departureTime: '12:34' }
  });
  const unchanged = (await query('SELECT flightNumber,departureTime FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const changed = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { confirmed: true, flightNumber: 'QA-NUMBER-MUST-STAY', departureTime: '08:31' }
  });
  const after = (await query('SELECT flightNumber,departureTime FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const cancelled = (await query("SELECT id FROM flights WHERE status='CANCELLED' ORDER BY id LIMIT 1"))[0];
  const cancelledEdit = await request('PUT', `/flights/${cancelled.id}`, {
    token: adminToken, body: { confirmed: true, economyPrice: 111 }
  });
  const editableRoute = await createFlight(`QAR${Date.now().toString().slice(-6)}`);
  const routeEdit = await request('PUT', `/flights/${editableRoute.id}`, {
    token: adminToken,
    body: { confirmed: true, originAirportId: destinationId, destinationAirportId: originId }
  });
  const editedRoute = (await query('SELECT originAirportId,destinationAirportId FROM flights WHERE id=?', [editableRoute.id]))[0];
  return {
    ok: noConfirm.status === 409 && unchanged.departureTime === before.departureTime
      && changed.status === 200 && after.flightNumber === before.flightNumber
      && after.departureTime === '08:31' && cancelledEdit.status === 400
      && routeEdit.status === 200 && editedRoute.originAirportId === destinationId
      && editedRoute.destinationAirportId === originId,
    detail: `sin confirmar=${noConfirm.status}, horario preservado=${unchanged.departureTime}; confirmar=${changed.status}, número ${after.flightNumber} inmutable; ruta editable=${routeEdit.status}; edición cancelado=${cancelledEdit.status}`
  };
});

await capture('US-08.2', async () => {
  const checks = [
    ['sin días', { daysOfWeek: [] }, 'daysOfWeek'],
    ['origen=destino', { originAirportId: originId, destinationAirportId: originId }, 'destinationAirportId'],
    ['desde imposible', { availableFrom: '2026-02-31' }, 'availableFrom'],
    ['hora inválida', { departureTime: '26:00' }, 'departureTime'],
    ['hasta antes', { availableTo: '2026-10-31', availableFrom: '2026-11-01' }, 'availableTo'],
    ['desde pasada', { availableFrom: '2026-10-02' }, 'availableFrom'],
    ['capacidad cero', { economySeats: 0, firstClassSeats: 0 }, 'economySeats'],
    ['precio cero con asientos', { economyPrice: 0 }, 'economyPrice']
  ];
  const failures = [];
  for (const [label, patch, field] of checks) {
    const before = (await query('SELECT * FROM flights WHERE id=?', [capacitySeed.id]))[0];
    const response = await request('PUT', `/flights/${capacitySeed.id}`, {
      token: adminToken, body: { ...patch, confirmed: true }
    });
    const after = (await query('SELECT * FROM flights WHERE id=?', [capacitySeed.id]))[0];
    const stable = Object.keys(before).every((key) => before[key] === after[key]);
    if (response.status < 400 || response.status >= 500 || !hasFieldReason(response, field) || !stable) {
      failures.push(`${label}: HTTP ${response.status}, ${responseErrors(response)}, sin cambios=${stable}`);
    }
  }
  return { ok: failures.length === 0, detail: failures.join(' | ') || `${checks.length} validaciones principales repetidas por PUT: error por campo y sin persistencia` };
});

await capture('US-08.3', async () => {
  const past = (await query(`
    SELECT id,date,status,soldEconomy,soldFirstClass FROM departures
    WHERE flightId=? AND date<? ORDER BY date LIMIT 1
  `, [capacitySeed.id, today]))[0];
  const future = (await query(`
    SELECT id,date,status,soldEconomy,soldFirstClass FROM departures
    WHERE flightId=? AND date>=? AND status='SCHEDULED' ORDER BY date LIMIT 1
  `, [capacitySeed.id, today]))[0];
  const pastBefore = { ...past };
  const response = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: {
      confirmed: true, departureTime: '08:32', economyPrice: Number(capacitySeed.economyPrice) + 5
    }
  });
  const pastAfter = (await query('SELECT id,date,status,soldEconomy,soldFirstClass FROM departures WHERE id=?', [past.id]))[0];
  const updated = (await query('SELECT departureTime,economyPrice FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const fare = (await query(`
    SELECT price,capacity FROM fares f JOIN classes c ON c.id=f.classId
    WHERE f.flightId=? AND c.code='ECONOMY'
  `, [capacitySeed.id]))[0];
  return {
    ok: response.status === 200 && JSON.stringify(pastAfter) === JSON.stringify(pastBefore)
      && updated.departureTime === '08:32'
      && Number(updated.economyPrice) === Number(capacitySeed.economyPrice) + 5
      && Number(fare.price) === Number(updated.economyPrice)
      && (!future || future.status === 'SCHEDULED'),
    detail: `PUT=${response.status}; salida pasada ${past.date} igual=${JSON.stringify(pastAfter) === JSON.stringify(pastBefore)}; tarifa ${fare.price}; salida futura ${future?.date ?? 'ninguna'} preservada`
  };
});

await capture('US-08.4', async () => {
  if (!seedEconomySale) return { ok: false, detail: 'No se encontró salida seed futura Economy vendida.' };
  const departureId = seedEconomySale.id;
  const economyCount = Number((await query(`
    SELECT COUNT(*) AS n FROM tickets t JOIN classes c ON c.id=t.classId
    WHERE t.departureId=? AND c.code='ECONOMY'
  `, [departureId]))[0].n);
  const firstClass = (await query("SELECT id FROM classes WHERE code='FIRST'"))[0];
  const passenger = (await query('SELECT id FROM passengers ORDER BY id LIMIT 1'))[0];
  const purchase = await run(`
    INSERT INTO purchases (passengerId,status,total,createdAt,updatedAt) VALUES (?,?,?,?,?)
  `, [passenger.id, 'CONFIRMED', 500, new Date().toISOString(), new Date().toISOString()]);
  await run('UPDATE departures SET soldFirstClass=2 WHERE id=?', [departureId]);
  await run('INSERT INTO tickets (purchaseId,departureId,classId,price,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
    [purchase.lastID, departureId, firstClass.id, 250, new Date().toISOString(), new Date().toISOString()]);
  await run('INSERT INTO tickets (purchaseId,departureId,classId,price,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
    [purchase.lastID, departureId, firstClass.id, 250, new Date().toISOString(), new Date().toISOString()]);
  const before = (await query('SELECT economySeats,firstClassSeats FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const belowEconomy = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { confirmed: true, economySeats: economyCount - 1 }
  });
  const belowFirst = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { confirmed: true, firstClassSeats: 1 }
  });
  const exactEconomy = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { confirmed: true, economySeats: economyCount }
  });
  const exactFirst = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { confirmed: true, firstClassSeats: 2 }
  });
  const increase = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: { confirmed: true, economySeats: economyCount + 1, firstClassSeats: 3 }
  });
  const restore = await request('PUT', `/flights/${capacitySeed.id}`, {
    token: adminToken, body: {
      confirmed: true, economySeats: before.economySeats, firstClassSeats: before.firstClassSeats
    }
  });
  const hasConflict = (result, field) => result.status === 400
    && (result.body.conflicts ?? []).some((conflict) => conflict.departureDate === seedEconomySale.date && conflict.field === field);
  return {
    ok: economyCount === seedEconomySale.soldEconomy
      && hasConflict(belowEconomy, 'economySeats') && hasConflict(belowFirst, 'firstClassSeats')
      && exactEconomy.status === 200 && exactFirst.status === 200
      && increase.status === 200 && restore.status === 200,
    detail: `${seedEconomySale.date}: BD Economy=${economyCount}/Primera=2; bajo N-1 Economy=${belowEconomy.status} conflicto=${hasConflict(belowEconomy, 'economySeats')}; Primera=${belowFirst.status} conflicto=${hasConflict(belowFirst, 'firstClassSeats')}; exacto/subir/restaurar=${exactEconomy.status}/${exactFirst.status}/${increase.status}/${restore.status}`
  };
});

await capture('US-08.5', async () => {
  const multi = (await query('SELECT * FROM flights WHERE flightNumber=?', ['AR2001']))[0];
  const sold = await query(`
    SELECT id,date,soldEconomy,soldFirstClass FROM departures
    WHERE flightId=? AND date>=? AND (soldEconomy>0 OR soldFirstClass>0) ORDER BY date
  `, [multi.id, today]);
  if (sold.length < 2) return { ok: false, detail: `AR2001 salidas futuras vendidas=${sold.length}, se requieren varias.` };
  const latest = sold[sold.length - 1].date;
  const excludedWeekday = daysForDate(latest);
  const newDays = multi.daysOfWeek.split(',').map(Number).filter((day) => day !== excludedWeekday);
  const toDate = isoDate(new Date(new Date(`${latest}T00:00:00Z`).getTime() - 86400000));
  const newDates = datesInRange(multi.availableFrom, toDate, newDays);
  const conflictedDates = sold.filter((departure) => !newDates.includes(departure.date)).map((departure) => departure.date);
  const before = await query('SELECT id,date,status,soldEconomy,soldFirstClass FROM departures WHERE flightId=? ORDER BY date', [multi.id]);
  const beforeTickets = Number((await query(`
    SELECT COUNT(*) AS n FROM tickets t JOIN departures d ON d.id=t.departureId WHERE d.flightId=?
  `, [multi.id]))[0].n);
  const warning = await request('PUT', `/flights/${multi.id}`, {
    token: adminToken, body: { confirmed: true, daysOfWeek: newDays, availableTo: toDate }
  });
  const afterWarning = await query('SELECT id,date,status,soldEconomy,soldFirstClass FROM departures WHERE flightId=? ORDER BY date', [multi.id]);
  const noChange = JSON.stringify(before) === JSON.stringify(afterWarning);
  const warnedDates = (warning.body.conflicts ?? []).map((conflict) => conflict.departureDate).sort();
  const confirmed = await request('PUT', `/flights/${multi.id}`, {
    token: adminToken, body: {
      confirmed: true, confirmedConflicts: true, daysOfWeek: newDays, availableTo: toDate
    }
  });
  const after = await query('SELECT id,date,status,soldEconomy,soldFirstClass FROM departures WHERE flightId=? ORDER BY date', [multi.id]);
  const ticketsAfter = Number((await query(`
    SELECT COUNT(*) AS n FROM tickets t JOIN departures d ON d.id=t.departureId WHERE d.flightId=?
  `, [multi.id]))[0].n);
  const cancelledSales = after.filter((departure) => conflictedDates.includes(departure.date));
  const unsoldRemoved = before.filter((departure) => departure.date > toDate
    && departure.soldEconomy === 0 && departure.soldFirstClass === 0)
    .every((departure) => !after.some((row) => row.id === departure.id));
  const originalEnd = multi.availableTo;
  const addDay = excludedWeekday;
  const restorePeriod = await request('PUT', `/flights/${multi.id}`, {
    token: adminToken, body: {
      confirmed: true, daysOfWeek: [...new Set([...newDays, addDay])].sort((a, b) => a - b),
      availableTo: originalEnd
    }
  });
  const full = datesInRange(multi.availableFrom, originalEnd, [...new Set([...newDays, addDay])].sort((a, b) => a - b));
  const addedDates = difference(full, after.map((departure) => departure.date))
    .filter((date) => date >= today && daysForDate(date) === addDay);
  const generatedAdded = await query(`
    SELECT date,status FROM departures WHERE flightId=? AND date IN (${addedDates.length ? addedDates.map(() => '?').join(',') : "''"})
  `, [multi.id, ...addedDates]);
  const ok = warning.status === 409 && noChange
    && JSON.stringify(warnedDates) === JSON.stringify([...conflictedDates].sort())
    && confirmed.status === 200 && cancelledSales.length === conflictedDates.length
    && cancelledSales.every((row) => row.status === 'CANCELLED')
    && ticketsAfter === beforeTickets && unsoldRemoved
    && restorePeriod.status === 200
    && generatedAdded.some((row) => row.status === 'SCHEDULED');
  return {
    ok,
    detail: `AR2001 ventas=${sold.map((row) => row.date).join(',')}; advertencia=${warning.status} fechas=${warnedDates.join(',')} sin cambios=${noChange}; confirmar=${confirmed.status}; ventas preservadas=${ticketsAfter}/${beforeTickets}; ventas canceladas=${cancelledSales.length}; sin ventas eliminadas=${unsoldRemoved}; re-agregar día=${restorePeriod.status}, nuevas=${generatedAdded.map((row) => `${row.date}:${row.status}`).join(',')}`
  };
});

await capture('US-08.6', async () => {
  const detail = await request('GET', `/flights/${capacitySeed.id}`, { token: adminToken });
  const history = detail.body.flight.history;
  const validHistory = history.length > 0 && history.every((entry) =>
    entry.changedAt && entry.userId && entry.userEmail && entry.field
    && entry.previousValue !== undefined && entry.previousValue !== null
    && entry.newValue !== undefined && entry.newValue !== null);
  const changed = history.filter((entry) => ['departureTime', 'economyPrice', 'economySeats', 'firstClassSeats'].includes(entry.field));
  const direct = await query(`
    SELECT field,previousValue,newValue,userId,changedAt FROM flight_change_history WHERE flightId=?
  `, [capacitySeed.id]);
  return {
    ok: detail.status === 200 && validHistory && changed.length >= 4
      && direct.length === history.length,
    detail: `GET detalle=${detail.status}; historial detalle=${history.length}, SQL=${direct.length}; fecha/usuario/valor anterior/nuevo completos=${validHistory}; campos= ${[...new Set(changed.map((entry) => entry.field))].join(',')}`
  };
});

const saleTickets = seedEconomySale ? await query(`
  SELECT c.code,COUNT(*) AS n FROM tickets t
  JOIN classes c ON c.id=t.classId
  JOIN purchases p ON p.id=t.purchaseId
  WHERE t.departureId=? AND p.status='CONFIRMED' GROUP BY c.code
`, [seedEconomySale.id]) : [];
const saleTicketTotal = saleTickets.reduce((sum, row) => sum + Number(row.n), 0);

await capture('US-09.1 / US-09.2 / US-09.3 / US-09.4', async () => {
  if (!seedEconomySale) return { ok: false, detail: 'No hay salida futura seed vendida.' };
  const beforeCounts = await counts();
  const beforeFlight = (await query('SELECT * FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const beforeDepartures = await query('SELECT id,date,status,soldEconomy,soldFirstClass,cancelledAt,cancelledByUserId FROM departures WHERE flightId=? ORDER BY date', [capacitySeed.id]);
  const noConfirm = await request('POST', `/flights/${capacitySeed.id}/cancel`, {
    token: adminToken, body: { departureDate: seedEconomySale.date }
  });
  const afterNoConfirm = (await query('SELECT status,cancelledAt,cancelledByUserId FROM departures WHERE id=?', [seedEconomySale.id]))[0];
  const pointConfirm = await request('POST', `/flights/${capacitySeed.id}/cancel`, {
    token: adminToken, body: { departureDate: seedEconomySale.date, confirmed: true }
  });
  const pointDetail = await request('GET', `/flights/${capacitySeed.id}`, { token: adminToken });
  const pointList = await request('GET', `/flights?status=ACTIVE&originAirportId=${capacitySeed.originAirportId}`, {
    token: adminToken
  });
  const afterPoint = (await query('SELECT status,cancelledAt,cancelledByUserId FROM departures WHERE id=?', [seedEconomySale.id]))[0];
  const rowsAfter = await counts();
  const flightAfter = (await query('SELECT status,cancelledAt,cancelledByUserId FROM flights WHERE id=?', [capacitySeed.id]))[0];
  const canceledDetail = pointDetail.body.flight.departures.find((row) => row.date === seedEconomySale.date);
  const listedFlight = pointList.body.flights.find((row) => row.id === capacitySeed.id);
  const cancelRecord = (await query('SELECT cancelledAt,userId FROM cancellations WHERE departureId=? ORDER BY id DESC LIMIT 1', [seedEconomySale.id]))[0];
  const unchangedCounts = Object.keys(beforeCounts).every((key) => beforeCounts[key] === rowsAfter[key]);
  const past = (await query(`
    SELECT id,date,status FROM departures WHERE flightId=? AND date<? AND status='SCHEDULED' ORDER BY date LIMIT 1
  `, [capacitySeed.id, today]))[0];
  const pastCancel = past ? await request('POST', `/flights/${capacitySeed.id}/cancel`, {
    token: adminToken, body: { departureDate: past.date, confirmed: true }
  }) : { status: 404 };
  const secondCancel = await request('POST', `/flights/${capacitySeed.id}/cancel`, {
    token: adminToken, body: { departureDate: seedEconomySale.date, confirmed: true }
  });
  return {
    ok: noConfirm.status === 409 && afterNoConfirm.status === 'SCHEDULED'
      && pointConfirm.status === 200 && pointConfirm.body.affectedPassengers === saleTicketTotal
      && canceledDetail?.status === 'CANCELLED' && listedFlight?.status === 'ACTIVE'
      && afterPoint.cancelledAt && afterPoint.cancelledByUserId === adminId
      && cancelRecord?.cancelledAt && cancelRecord.userId === adminId && unchangedCounts
      && flightAfter.status === beforeFlight.status
      && beforeDepartures.length === (await query('SELECT id FROM departures WHERE flightId=?', [capacitySeed.id])).length
      && (!past || pastCancel.status === 400)
      && secondCancel.status === 400,
    detail: `puntual sin confirmación=${noConfirm.status} y no cambia=${afterNoConfirm.status}; confirmada=${pointConfirm.status}, aviso=${pointConfirm.body.affectedPassengers}, tickets BD=${saleTicketTotal}; estado lista/detalle=${listedFlight?.status}/${canceledDetail?.status}; cancelación fecha/usuario=${Boolean(cancelRecord?.cancelledAt)}/${cancelRecord?.userId}; filas preservadas=${unchangedCounts}; pasada=${pastCancel.status}; repetida=${secondCancel.status}`
  };
});

await capture('US-09.1 / US-09.2 / US-09.3 / US-09.4 (vuelo completo)', async () => {
  const demoAirport1 = await request('POST', '/airports', {
    token: adminToken, body: {
      iata: await unusedIata('QX'), name: 'QA Origen', city: 'QA', province: 'QA'
    }
  });
  const demoAirport2 = await request('POST', '/airports', {
    token: adminToken, body: {
      iata: await unusedIata('QY'), name: 'QA Destino', city: 'QA', province: 'QA'
    }
  });
  if (demoAirport1.status !== 201 || demoAirport2.status !== 201) {
    throw new Error(`alta de aeropuertos del flujo: ${demoAirport1.status}/${demoAirport2.status}`);
  }
  const flowFlight = await createFlight(`QAF${Date.now().toString().slice(-6)}`, {
    originAirportId: demoAirport1.body.airport.id,
    destinationAirportId: demoAirport2.body.airport.id,
    availableFrom: '2026-11-02', availableTo: '2026-11-30'
  });
  const detailBefore = await request('GET', `/flights/${flowFlight.id}`, { token: adminToken });
  const listBefore = await request('GET', `/flights?status=ACTIVE&originAirportId=${demoAirport1.body.airport.id}`, { token: adminToken });
  const edit = await request('PUT', `/flights/${flowFlight.id}`, {
    token: adminToken,
    body: { confirmed: true, departureTime: '12:10', economyPrice: 120, daysOfWeek: [1, 3] }
  });
  const detailAfter = await request('GET', `/flights/${flowFlight.id}`, { token: adminToken });
  const selected = detailAfter.body.flight.departures.find((departure) => departure.status === 'SCHEDULED');
  const beforeCount = await counts();
  const pointWarning = selected ? await request('POST', `/flights/${flowFlight.id}/cancel`, {
    token: adminToken, body: { departureDate: selected.date }
  }) : { status: 404, body: {} };
  const pointCancel = selected ? await request('POST', `/flights/${flowFlight.id}/cancel`, {
    token: adminToken, body: { departureDate: selected.date, confirmed: true }
  }) : { status: 404, body: {} };
  const pointStatesBefore = new Map(detailAfter.body.flight.departures.map((departure) => [departure.date, departure.status]));
  const pointStatesAfter = new Map((pointCancel.body.flight?.departures ?? []).map((departure) => [departure.date, departure.status]));
  const pointOnlyChangedTarget = Boolean(selected) && pointStatesAfter.get(selected.date) === 'CANCELLED'
    && [...pointStatesBefore].every(([date, status]) => date === selected.date || pointStatesAfter.get(date) === status)
    && pointCancel.body.flight?.status === 'ACTIVE';
  const oldCancellation = selected ? (await query(`
    SELECT cancelledAt,cancelledByUserId FROM departures WHERE flightId=? AND date=?
  `, [flowFlight.id, selected.date]))[0] : {};
  const fullWarning = await request('POST', `/flights/${flowFlight.id}/cancel`, { token: adminToken, body: {} });
  const fullCancel = await request('POST', `/flights/${flowFlight.id}/cancel`, {
    token: adminToken, body: { confirmed: true }
  });
  const finalDetail = await request('GET', `/flights/${flowFlight.id}`, { token: adminToken });
  const finalList = await request('GET', `/flights?status=CANCELLED&originAirportId=${demoAirport1.body.airport.id}`, {
    token: adminToken
  });
  const afterCount = await counts();
  const finalRows = await query('SELECT status,cancelledAt,cancelledByUserId FROM departures WHERE flightId=?', [flowFlight.id]);
  const oldDeparture = finalDetail.body.flight.departures.find((departure) => departure.date === selected?.date);
  const oldAgain = selected ? (await query(`
    SELECT cancelledAt,cancelledByUserId FROM departures WHERE flightId=? AND date=?
  `, [flowFlight.id, selected.date]))[0] : {};
  const otherFutureScheduled = finalRows.filter((row) => row.status === 'SCHEDULED').length;
  const listedCancelledFlight = finalList.body.flights.find((flight) => flight.id === flowFlight.id);
  const countsPreserved = Object.keys(beforeCount).every((key) => beforeCount[key] === afterCount[key]);
  const editHistory = detailAfter.body.flight.history.some((entry) =>
    ['departureTime', 'economyPrice', 'daysOfWeek'].includes(entry.field));
  const ok = flowFlight.status === 'ACTIVE' && detailBefore.status === 200 && listBefore.status === 200
    && edit.status === 200 && detailAfter.body.flight.departureTime === '12:10'
    && editHistory && pointWarning.status === 409 && pointCancel.status === 200
    && pointOnlyChangedTarget
    && fullWarning.status === 409 && fullWarning.body.affectedPassengers === 0
    && fullCancel.status === 200 && finalDetail.body.flight.status === 'CANCELLED'
    && listedCancelledFlight?.status === 'CANCELLED'
    && oldDeparture?.status === 'CANCELLED'
    && oldAgain.cancelledAt === oldCancellation.cancelledAt
    && oldAgain.cancelledByUserId === oldCancellation.cancelledByUserId
    && otherFutureScheduled === 0 && countsPreserved
    && finalRows.every((row) => row.status !== 'CANCELLED' || (row.cancelledAt && row.cancelledByUserId === adminId));
  return {
    ok,
    detail: `flujo API: aeropuertos=${demoAirport1.status}/${demoAirport2.status}; alta ${flowFlight.flightNumber}=${flowFlight.status}, salidas=${flowFlight.departures.length}; consulta lista/detalle=${listBefore.status}/${detailBefore.status}; modificación=${edit.status}, historial=${editHistory}; puntual=${pointWarning.status}/${pointCancel.status}, estado vuelo/otras salidas intactos=${pointOnlyChangedTarget}; cancelación total=${fullWarning.status}/${fullCancel.status}, lista/detalle=${listedCancelledFlight?.status}/${finalDetail.body.flight.status}, aviso 0; filas preservadas=${countsPreserved}; otras futuras Programadas=${otherFutureScheduled}; cancelación previa conservada=${oldAgain.cancelledAt === oldCancellation.cancelledAt}`
  };
});

async function sqlOrderedFlights({ status, origin, destination, sortBy, direction = 'asc' } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('f.status=?'); params.push(status); }
  if (origin) { where.push('f.originAirportId=?'); params.push(origin); }
  if (destination) { where.push('f.destinationAirportId=?'); params.push(destination); }
  const order = sortBy === 'route'
    ? `oa.iata ${direction.toUpperCase()}, da.iata ${direction.toUpperCase()}, f.id ${direction.toUpperCase()}`
    : sortBy === 'departure'
      ? `f.departureTime ${direction.toUpperCase()}, f.id ${direction.toUpperCase()}`
      : `f.flightNumber ${direction.toUpperCase()}, f.id ${direction.toUpperCase()}`;
  return query(`
    SELECT f.id,f.flightNumber,f.status,f.departureTime,f.arrivalTime,f.daysOfWeek,
      f.availableFrom,f.availableTo,f.originAirportId,f.destinationAirportId,
      oa.iata AS originIata,da.iata AS destinationIata
    FROM flights f JOIN airports oa ON oa.id=f.originAirportId
    JOIN airports da ON da.id=f.destinationAirportId
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${order}
  `, params);
}

await capture('US-10.1 / US-10.2', async () => {
  const failures = [];
  const routeFilters = [
    [{ status: 'ACTIVE' }, '?status=ACTIVE'],
    [{ status: 'CANCELLED' }, '?status=CANCELLED'],
    [{ origin: originId }, `?originAirportId=${originId}`],
    [{ destination: destinationId }, `?destinationAirportId=${destinationId}`],
    [{ status: 'ACTIVE', origin: originId }, `?status=ACTIVE&originAirportId=${originId}`],
    [{ status: 'CANCELLED', destination: destinationId }, `?status=CANCELLED&destinationAirportId=${destinationId}`],
    [{ origin: originId, destination: destinationId }, `?originAirportId=${originId}&destinationAirportId=${destinationId}`],
    [{ status: 'ACTIVE', origin: originId, destination: destinationId },
      `?status=ACTIVE&originAirportId=${originId}&destinationAirportId=${destinationId}`]
  ];
  for (const [filter, params] of routeFilters) {
    const response = await request('GET', `/flights${params}`, { token: adminToken });
    const expected = await sqlOrderedFlights(filter);
    const firstIds = expected.slice(0, 20).map((row) => row.id);
    const returnedIds = response.body.flights.map((row) => row.id);
    if (response.status !== 200 || response.body.pagination.total !== expected.length
      || JSON.stringify(returnedIds) !== JSON.stringify(firstIds)) {
      failures.push(`${params}: API total=${response.body.pagination?.total}, SQL=${expected.length}, ids comparan=${JSON.stringify(returnedIds) === JSON.stringify(firstIds)}`);
    }
  }
  const listed = await request('GET', '/flights?page=1', { token: adminToken });
  const meta = listed.body.pagination;
  const lastPage = await request('GET', `/flights?page=${meta.totalPages}`, { token: adminToken });
  const beyond = await request('GET', `/flights?page=${meta.totalPages + 1}`, { token: adminToken });
  const requiredFields = ['flightNumber', 'origin', 'destination', 'departureTime', 'arrivalTime',
    'daysOfWeek', 'availableFrom', 'availableTo', 'status', 'arrivalsNextDay'];
  const complete = listed.body.flights.every((flight) => requiredFields.every((field) => flight[field] !== undefined));
  const pagesOk = meta.pageSize === 20 && listed.body.flights.length <= 20
    && meta.totalPages === Math.ceil(meta.total / 20)
    && lastPage.body.flights.length === Math.min(20, meta.total - 20 * (meta.totalPages - 1))
    && beyond.body.flights.length === 0 && beyond.body.pagination.total === meta.total;
  for (const sortBy of ['flightNumber', 'route', 'departure']) {
    for (const direction of ['asc', 'desc']) {
      const response = await request('GET', `/flights?sortBy=${sortBy}&direction=${direction}`, { token: adminToken });
      const expected = await sqlOrderedFlights({ sortBy, direction });
      const apiIds = response.body.flights.map((row) => row.id);
      if (JSON.stringify(apiIds) !== JSON.stringify(expected.slice(0, 20).map((row) => row.id))) {
        failures.push(`orden ${sortBy}/${direction} difiere de SQL`);
      }
      const secondPage = await request('GET', `/flights?sortBy=${sortBy}&direction=${direction}&page=2`, { token: adminToken });
      const expectedSecond = expected.slice(20, 40).map((row) => row.id);
      const actualSecond = secondPage.body.flights.map((row) => row.id);
      if (apiIds.some((id) => actualSecond.includes(id))
        || JSON.stringify(actualSecond) !== JSON.stringify(expectedSecond)) {
        failures.push(`orden ${sortBy}/${direction} página 2 inestable/difiere de SQL`);
      }
    }
  }
  const evidence = `página size=${meta.pageSize}, total=${meta.total}, páginas=${meta.totalPages}, última=${lastPage.body.flights.length}, fuera=${beyond.body.flights.length}, campos=${complete}; filtros contrastados=${routeFilters.length}; ordenes 3x2; diferencias=${failures.join('; ') || 'ninguna'}`;
  return { ok: pagesOk && complete && failures.length === 0, detail: evidence };
});

await capture('US-10.3', async () => {
  const detail = await request('GET', `/flights/${capacitySeed.id}`, { token: adminToken });
  const flight = detail.body.flight;
  const availabilityFailures = [];
  for (const departure of flight.departures.slice(0, 3)) {
    const dbDeparture = (await query('SELECT soldEconomy,soldFirstClass FROM departures WHERE id=?', [departure.id]))[0];
    const econExpected = Math.max(0, Number(flight.economySeats) - dbDeparture.soldEconomy);
    const firstExpected = Math.max(0, Number(flight.firstClassSeats) - dbDeparture.soldFirstClass);
    if (departure.availableEconomy !== econExpected || departure.availableFirstClass !== firstExpected
      || departure.soldEconomy !== dbDeparture.soldEconomy || departure.soldFirstClass !== dbDeparture.soldFirstClass) {
      availabilityFailures.push(departure.date);
    }
  }
  const keys = ['flightNumber', 'origin', 'destination', 'departureTime', 'arrivalTime', 'daysOfWeek',
    'availableFrom', 'availableTo', 'economySeats', 'firstClassSeats', 'economyPrice',
    'firstClassPrice', 'status', 'departures', 'history', 'arrivalsNextDay'];
  const complete = detail.status === 200 && keys.every((key) => flight[key] !== undefined);
  return {
    ok: complete && availabilityFailures.length === 0 && flight.departures.length >= 3,
    detail: `GET detalle=${detail.status}; campos=${complete}; salidas comparadas=${Math.min(3, flight.departures.length)}; disponibles contrastados con SQL=${availabilityFailures.length ? `difieren ${availabilityFailures.join(',')}` : 'coinciden'}`
  };
});

await capture('US-10.4', async () => {
  const source = await readFile(path.join(root, 'frontend', 'src', 'Flights.tsx'), 'utf8');
  const activeGate = source.includes("flight.status === 'ACTIVE'") && source.includes("editing && flight.status === 'ACTIVE'");
  const active = await createFlight(`QAU${Date.now().toString().slice(-6)}`);
  const detail = await request('GET', `/flights/${active.id}`, { token: adminToken });
  const cancel = await request('POST', `/flights/${active.id}/cancel`, {
    token: adminToken, body: { confirmed: true }
  });
  const canceledEdit = await request('PUT', `/flights/${active.id}`, {
    token: adminToken, body: { confirmed: true }
  });
  const canceledSource = source.includes("flight.status === 'ACTIVE'");
  return {
    ok: activeGate && detail.status === 200 && cancel.status === 200 && canceledEdit.status === 400 && canceledSource,
    detail: `API vuelo activo detalle=${detail.status}; al cancelar=${cancel.status}; editar cancelado=${canceledEdit.status}; controles UI condicionados por ACTIVE=${activeGate}; visual 👤`
  };
});

await capture('US-10.5', async () => {
  const totalFlights = Number((await query('SELECT COUNT(*) AS n FROM flights'))[0].n);
  const measure = async (suffix) => {
    const elapsed = [];
    for (let index = 0; index < 10; index += 1) {
      const start = performance.now();
      const response = await request('GET', `/flights${suffix}`, { token: adminToken });
      elapsed.push(performance.now() - start);
      if (response.status !== 200) {
        throw new Error(`listado ${suffix || 'sin filtros'} status=${response.status}, total=${response.body.pagination?.total}`);
      }
    }
    elapsed.sort((a, b) => a - b);
    return { median: (elapsed[4] + elapsed[5]) / 2, maximum: elapsed[9] };
  };
  const plain = await measure('');
  const filtered = await measure(`?status=ACTIVE&originAirportId=${originId}`);
  const indexes = await query('PRAGMA index_list(flights)');
  return {
    ok: totalFlights >= 100 && plain.maximum < 2000 && filtered.maximum < 2000,
    detail: `${totalFlights} vuelos; 10 peticiones secuenciales por caso con performance.now() cliente HTTP; sin filtros mediana=${plain.median.toFixed(1)}ms max=${plain.maximum.toFixed(1)}ms; estado+origen mediana=${filtered.median.toFixed(1)}ms max=${filtered.maximum.toFixed(1)}ms; índices flights=${indexes.map((row) => row.name).join(',')}`
  };
});

await capture('INVARIANTES BD / ALCANCE', async () => {
  const overCapacity = await query(`
    SELECT COUNT(*) AS n FROM departures d JOIN flights f ON f.id=d.flightId
    WHERE d.soldEconomy>f.economySeats OR d.soldFirstClass>f.firstClassSeats
  `);
  const canceledScheduled = await query(`
    SELECT COUNT(*) AS n FROM departures d JOIN flights f ON f.id=d.flightId
    WHERE f.status='CANCELLED' AND d.status='SCHEDULED' AND d.date>=?
  `, [today]);
  const active = await query("SELECT * FROM flights WHERE status='ACTIVE'");
  const scheduleErrors = [];
  for (const flight of active) {
    const days = flight.daysOfWeek.split(',').map(Number);
    const expected = datesInRange(flight.availableFrom, flight.availableTo, days)
      .filter((date) => date > today || (date === today && flight.departureTime > currentArgentinaTime));
    const rows = await query(`
      SELECT date,status FROM departures WHERE flightId=? AND date>=?
      ORDER BY date
    `, [flight.id, today]);
    const futureRows = rows.filter((row) => row.date > today
      || (row.date === today && flight.departureTime > currentArgentinaTime));
    const scheduled = futureRows.filter((row) => row.status === 'SCHEDULED').map((row) => row.date);
    const cancelledExpected = futureRows.filter((row) => row.status === 'CANCELLED').map((row) => row.date);
    const expectedScheduled = expected.filter((date) => !cancelledExpected.includes(date));
    if (JSON.stringify(scheduled) !== JSON.stringify(expectedScheduled)) {
      scheduleErrors.push(flight.flightNumber);
    }
  }
  const orphanDepartures = await query(`
    SELECT COUNT(*) AS n FROM departures d LEFT JOIN flights f ON f.id=d.flightId WHERE f.id IS NULL
  `);
  const orphanTickets = await query(`
    SELECT COUNT(*) AS n FROM tickets t LEFT JOIN departures d ON d.id=t.departureId WHERE d.id IS NULL
  `);
  const duplicateDepartures = await query(`
    SELECT COUNT(*) AS n FROM (
      SELECT flightId,date FROM departures GROUP BY flightId,date HAVING COUNT(*)>1
    )
  `);
  const missingCancelData = await query(`
    SELECT
      (SELECT COUNT(*) FROM cancellations WHERE cancelledAt IS NULL OR userId IS NULL) +
      (SELECT COUNT(*) FROM flights WHERE status='CANCELLED' AND (cancelledAt IS NULL OR cancelledByUserId IS NULL)) +
      (SELECT COUNT(*) FROM departures WHERE status='CANCELLED' AND (cancelledAt IS NULL OR cancelledByUserId IS NULL)) AS n
  `);
  const missingHistory = await query(`
    SELECT COUNT(*) AS n FROM flight_change_history
    WHERE userId IS NULL OR previousValue IS NULL OR newValue IS NULL OR previousValue='' OR newValue=''
  `);
  const ticketOverCapacity = await query(`
    SELECT COUNT(*) AS n FROM (
      SELECT d.id,c.code,COUNT(*) AS sold,
        CASE c.code WHEN 'ECONOMY' THEN f.economySeats ELSE f.firstClassSeats END AS capacity
      FROM tickets t JOIN departures d ON d.id=t.departureId
      JOIN flights f ON f.id=d.flightId JOIN classes c ON c.id=t.classId
      GROUP BY d.id,c.code HAVING sold>capacity
    )
  `);
  const absentRoutes = [];
  for (const route of ['/purchases', '/payments', '/passengers/search', '/reports', '/notifications', '/counter', '/mobile']) {
    const response = await request('GET', route, { token: adminToken });
    if (response.status !== 404) absentRoutes.push(`${route}:${response.status}`);
  }
  const detail = `ventas>capacidad=${overCapacity[0].n}/${ticketOverCapacity[0].n}; vuelo cancelado con futuras programadas=${canceledScheduled[0].n}; fechas activas divergentes=${scheduleErrors.length}${scheduleErrors.length ? `(${scheduleErrors.join(',')})` : ''}; huérfanas salidas/pasajes=${orphanDepartures[0].n}/${orphanTickets[0].n}; duplicadas=${duplicateDepartures[0].n}; cancelaciones incompletas=${missingCancelData[0].n}; historial incompleto=${missingHistory[0].n}; endpoints fuera de alcance no-404=${absentRoutes.join(',') || 'ninguno'}`;
  return {
    ok: overCapacity[0].n === 0 && ticketOverCapacity[0].n === 0 && canceledScheduled[0].n === 0
      && scheduleErrors.length === 0 && orphanDepartures[0].n === 0 && orphanTickets[0].n === 0
      && duplicateDepartures[0].n === 0 && missingCancelData[0].n === 0 && missingHistory[0].n === 0
      && absentRoutes.length === 0,
    detail
  };
});

await capture('SEED / INTEGRACIÓN API', async () => {
  const seed = await query(`
    SELECT
      (SELECT COUNT(*) FROM flights) AS flights,
      (SELECT COUNT(*) FROM flights WHERE status='ACTIVE') AS active,
      (SELECT COUNT(*) FROM flights WHERE status='CANCELLED') AS cancelled,
      (SELECT COUNT(*) FROM departures WHERE date<?) AS pastDepartures,
      (SELECT COUNT(*) FROM tickets) AS tickets,
      (SELECT COUNT(*) FROM flight_change_history) AS history
  `, [today]);
  const nightFlights = await query("SELECT COUNT(*) AS n FROM flights WHERE arrivalTime<=departureTime");
  const seedEvidence = `seed inicial=${seedCount.flights} vuelos; tras pruebas actuales=${seed[0].flights} (${seed[0].active} activos/${seed[0].cancelled} cancelados), salidas pasadas=${seed[0].pastDepartures}, tickets=${seed[0].tickets}, vuelos nocturnos=${nightFlights[0].n}, historial=${seed[0].history}`;
  return {
    ok: seedCount.flights >= 100 && seed[0].active > 0 && seed[0].cancelled > 0
      && seed[0].pastDepartures > 0 && seed[0].tickets > 0 && nightFlights[0].n > 0,
    detail: seedEvidence
  };
});

const table = ['ID | Resultado | Evidencia'];
for (const result of results) table.push(`${result.id} | ${result.result} | ${result.evidence}`);
console.log(table.join('\n'));
const passed = results.filter((result) => result.result === 'OK').length;
console.log(`RESUMEN Parte B: ${passed}/${results.length} OK; ${results.length - passed} con observaciones.`);
await new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
