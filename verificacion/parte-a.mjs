import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
let localEnv = '';
try {
  localEnv = await readFile(path.join(root, '.env'), 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const env = Object.fromEntries(
  localEnv
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
);
const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET no está configurado en el entorno ni en .env');

const require = createRequire(path.join(root, 'backend', 'package.json'));
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database(path.resolve(root, env.DB_PATH ?? './backend/data/sigva.sqlite'));
const api = `http://127.0.0.1:${process.env.PORT ?? env.PORT ?? '3001'}/api`;
const results = [];
const add = (id, passed, evidence) => results.push({ id, result: passed ? 'OK' : 'OBS', evidence });

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
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  const payload = text && response.headers.get('content-type')?.includes('json')
    ? JSON.parse(text)
    : text;
  return { status: response.status, body: payload };
}

async function login(email, password) {
  return request('POST', '/auth/login', { body: { email, password } });
}

async function makeAirport(token, iata) {
  const response = await request('POST', '/airports', {
    token,
    body: { iata, name: `QA ${iata}`, city: 'QA City', province: 'QA Province' }
  });
  if (response.status !== 201) throw new Error(`No se pudo crear aeropuerto de prueba ${iata}: ${response.status}`);
  return response.body.airport;
}

async function makeFlight(token, flightNumber, originAirportId, destinationAirportId) {
  const response = await request('POST', '/flights', {
    token,
    body: {
      flightNumber,
      daysOfWeek: [1],
      departureTime: '08:00',
      arrivalTime: '09:00',
      originAirportId,
      destinationAirportId,
      availableFrom: '2027-01-04',
      availableTo: '2027-01-18',
      economySeats: 10,
      firstClassSeats: 2,
      economyPrice: 100,
      firstClassPrice: 200
    }
  });
  if (response.status !== 201) throw new Error(`No se pudo crear vuelo de prueba ${flightNumber}: ${response.status}`);
  return response.body.flight;
}

function expiredToken(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId, email, role: 'admin', iat: now - 1860, exp: now - 60
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

function sensitiveDataPresent(payload) {
  return /passwordHash|password_hash|password|\$2[aby]\$\d{2}\$/.test(JSON.stringify(payload));
}

const health = await request('GET', '/health');
if (health.status !== 200) throw new Error(`API no disponible: ${health.status}`);
const adminLogin = await login('admin@sigva.test', 'Admin123!');
const employeeLogin = await login('empleado@sigva.test', 'Empleado123!');
const passengerLogin = await login('pasajero@sigva.test', 'Pasajero123!');
if (![adminLogin, employeeLogin, passengerLogin].every((result) => result.status === 200)) {
  throw new Error('No fue posible iniciar sesión con los tres usuarios del README/seed');
}
const adminToken = adminLogin.body.token;
const employeeToken = employeeLogin.body.token;
const passengerToken = passengerLogin.body.token;
const adminId = adminLogin.body.user.id;
const expired = expiredToken(adminId, 'admin@sigva.test');
const airportSeed = (await request('GET', '/airports', { token: adminToken })).body.airports;
const airportsByIata = new Map(airportSeed.map((airport) => [airport.iata, airport]));
const initialSeedCounts = await query(`
  SELECT
    (SELECT COUNT(*) FROM flights) AS flights,
    (SELECT COUNT(*) FROM airports) AS airports,
    (SELECT COUNT(*) FROM airports WHERE isActive=0) AS inactiveAirports,
    (SELECT COUNT(*) FROM departures) AS departures,
    (SELECT COUNT(*) FROM flights WHERE status='ACTIVE') AS activeFlights,
    (SELECT COUNT(*) FROM flights WHERE status='CANCELLED') AS cancelledFlights
`);

const missing = await login('no-existe@sigva.test', 'cualquiera');
const wrong = await login('admin@sigva.test', 'incorrecta');
const loginGeneric = missing.status === wrong.status && missing.body.message === wrong.body.message;
add('US-03.1', adminLogin.status === 200 && Boolean(adminToken) && loginGeneric,
  `admin=${adminLogin.status}; inexistente=${missing.status}/${missing.body.message}; clave errónea=${wrong.status}/${wrong.body.message}`);
add('US-03.3', [adminLogin, employeeLogin, passengerLogin].every((entry) => entry.body.user.role),
  `API login roles: ${adminLogin.body.user.role}, ${employeeLogin.body.user.role}, ${passengerLogin.body.user.role}; rutas/menu requieren inspección y navegador 👤`);

const logoutLogin = await login('admin@sigva.test', 'Admin123!');
const logoutToken = logoutLogin.body.token;
const logout = await request('POST', '/auth/logout', { token: logoutToken });
const afterLogout = await request('GET', '/auth/me', { token: logoutToken });
const activityLogin = await login('admin@sigva.test', 'Admin123!');
const activitySessionId = JSON.parse(Buffer.from(activityLogin.body.token.split('.')[1], 'base64url').toString()).sessionId;
const activityBefore = (await query('SELECT lastActivity FROM sessions WHERE id=?', [activitySessionId]))[0].lastActivity;
await request('GET', '/auth/me', { token: activityLogin.body.token });
const activityAfter = (await query('SELECT lastActivity FROM sessions WHERE id=?', [activitySessionId]))[0].lastActivity;
await run("UPDATE sessions SET lastActivity=datetime('now','-31 minutes') WHERE id=?", [activitySessionId]);
const inactiveSession = await request('GET', '/auth/me', { token: activityLogin.body.token });
const expiredResponse = await request('GET', '/auth/me', { token: expired });
add('US-03.5', logout.status === 200 && afterLogout.status === 401 && inactiveSession.status === 401
  && expiredResponse.status === 401 && activityBefore !== activityAfter,
  `logout=${logout.status}; mismo token después=${afterLogout.status}; inactividad de 31 min=${inactiveSession.status}; JWT vencido=${expiredResponse.status}; actividad antes/después=${activityBefore}/${activityAfter}`);

const rows = await query('SELECT id, name FROM roles ORDER BY id');
const users = await query('SELECT id, email, passwordHash, roleId FROM users ORDER BY id');
const hashesAreBcrypt = users.every((user) => /^\$2[aby]\$\d{2}\$/.test(user.passwordHash));
const unhashedNames = await query('PRAGMA table_info(users)');
const rawPasswordColumn = unhashedNames.some((column) => /^(password|passwd)$/i.test(column.name));
const hashA = await bcrypt.hash('QA-Same-Password-2026!', 10);
const hashB = await bcrypt.hash('QA-Same-Password-2026!', 10);
const samePasswordHashesUnique = hashA !== hashB;
const qaRole = rows.find((role) => role.name === 'passenger')?.id;
await run('INSERT INTO users (name,email,passwordHash,roleId,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
  ['QA salt A', 'qa-salt-a@sigva.test', hashA, qaRole]);
await run('INSERT INTO users (name,email,passwordHash,roleId,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
  ['QA salt B', 'qa-salt-b@sigva.test', hashB, qaRole]);
const sampledResponses = [adminLogin.body, await request('GET', '/auth/me', { token: adminToken }), airportSeed];
add('US-03.2', hashesAreBcrypt && samePasswordHashesUnique && !rawPasswordColumn,
  `hashes existentes bcrypt=${hashesAreBcrypt}; misma clave insertada en QA produce hashes distintos=${samePasswordHashesUnique}; columna texto plano=${rawPasswordColumn}`);
add('US-03 Extra', sampledResponses.every((payload) => !sensitiveDataPresent(payload)),
  `respuestas login/me/aeropuertos exponen hash o contraseña=${sampledResponses.some(sensitiveDataPresent)}; JWT_SECRET obtenido del entorno o .env`);

const flightsForMatrix = {
  put: await makeFlight(adminToken, 'QAMATPUT', airportsByIata.get('AEP').id, airportsByIata.get('EZE').id),
  patch: await makeFlight(adminToken, 'QAMATPAT', airportsByIata.get('AEP').id, airportsByIata.get('EZE').id),
  cancel: await makeFlight(adminToken, 'QAMATCAN', airportsByIata.get('AEP').id, airportsByIata.get('EZE').id),
  delete: await makeFlight(adminToken, 'QAMATDEL', airportsByIata.get('AEP').id, airportsByIata.get('EZE').id)
};
const matrixTokens = [
  ['sin token', undefined, 401],
  ['inválido', 'no.es.jwt', 401],
  ['vencido', expired, 401],
  ['empleado', employeeToken, 403],
  ['pasajero', passengerToken, 403]
];
async function accessMatrix(label, endpoints) {
  const reports = [];
  for (const endpoint of endpoints) {
    const actual = [];
    for (const [name, token, expected] of matrixTokens) {
      const response = await request(endpoint.method, endpoint.path, { token, body: endpoint.body });
      actual.push(`${name}:${response.status}`);
      if (response.status !== expected) reports.push(`${endpoint.label}/${name} esperado ${expected} obtenido ${response.status}`);
    }
    const admin = await request(endpoint.method, endpoint.path, { token: adminToken, body: endpoint.body });
    actual.push(`admin:${admin.status}`);
    endpoint.seen = actual.join(', ');
    if (admin.status !== endpoint.adminStatus) {
      reports.push(`${endpoint.label}/admin esperado ${endpoint.adminStatus} obtenido ${admin.status}`);
    }
    endpoint.afterAdmin?.(admin);
  }
  add(label, reports.length === 0,
    `${endpoints.map((endpoint) => `${endpoint.label}[${endpoint.adminStatus} esperado]`).join('; ')}; diferencias=${reports.length ? reports.join(', ') : 'ninguna'}`);
  console.log(`MATRIZ ${label}: ${endpoints.map((endpoint) => `${endpoint.label} ${endpoint.seen ?? ''}`).join(' | ')}`);
}

const matrixAirportGet = { method: 'GET', path: '/airports', label: 'GET /airports', adminStatus: 200 };
const matrixAirportPost = {
  method: 'POST', path: '/airports', label: 'POST /airports', adminStatus: 201,
  body: { iata: 'YQM', name: 'Matrix Post', city: 'QA', province: 'QA' }
};
const airportPutTarget = await makeAirport(adminToken, 'YQP');
const matrixAirportPut = {
  method: 'PUT', path: `/airports/${airportPutTarget.id}`, label: 'PUT /airports/:id', adminStatus: 200,
  body: { name: 'Matrix Put', city: 'QA', province: 'QA' }
};
const airportDeleteTarget = await makeAirport(adminToken, 'YQD');
const matrixAirportDelete = {
  method: 'DELETE', path: `/airports/${airportDeleteTarget.id}`, label: 'DELETE /airports/:id', adminStatus: 200
};
await accessMatrix('US-06.5 / US-03.4 Aeropuertos', [
  matrixAirportGet, matrixAirportPost, matrixAirportPut, matrixAirportDelete
]);

const flightPayload = (number) => ({
  flightNumber: number, daysOfWeek: [1], departureTime: '08:00', arrivalTime: '09:00',
  originAirportId: airportsByIata.get('AEP').id, destinationAirportId: airportsByIata.get('EZE').id,
  availableFrom: '2027-01-04', availableTo: '2027-01-18',
  economySeats: 10, firstClassSeats: 2, economyPrice: 100, firstClassPrice: 200
});
const matrixFlightGet = { method: 'GET', path: '/flights', label: 'GET /flights', adminStatus: 200 };
const matrixFlightPost = {
  method: 'POST', path: '/flights', label: 'POST /flights', adminStatus: 201,
  body: flightPayload('QAMATNEW')
};
const matrixFlightDetail = {
  method: 'GET', path: `/flights/${flightsForMatrix.put.id}`, label: 'GET /flights/:id', adminStatus: 200
};
const matrixFlightPut = {
  method: 'PUT', path: `/flights/${flightsForMatrix.put.id}`, label: 'PUT /flights/:id', adminStatus: 200,
  body: { confirmed: true }
};
const matrixFlightPatch = {
  method: 'PATCH', path: `/flights/${flightsForMatrix.patch.id}`, label: 'PATCH /flights/:id', adminStatus: 200,
  body: { confirmed: true }
};
const matrixFlightCancel = {
  method: 'POST', path: `/flights/${flightsForMatrix.cancel.id}/cancel`, label: 'POST /flights/:id/cancel', adminStatus: 200,
  body: { confirmed: true }
};
const matrixFlightDelete = {
  method: 'DELETE', path: `/flights/${flightsForMatrix.delete.id}`, label: 'DELETE /flights/:id', adminStatus: 200,
  body: { confirmed: true }
};
await accessMatrix('US-03.4 Vuelos (incluye rutas administrativas)', [
  matrixFlightGet, matrixFlightPost, matrixFlightDetail, matrixFlightPut, matrixFlightPatch,
  matrixFlightCancel, matrixFlightDelete
]);

const iataInvalidResults = [];
for (const iata of ['AB', 'ABCD', '123', 'A$C']) {
  const response = await request('POST', '/airports', {
    token: adminToken, body: { iata, name: 'Test', city: 'Test', province: 'Test' }
  });
  iataInvalidResults.push(`${iata}:${response.status}:${response.body.message}`);
}
const normalizedAirport = await makeAirport(adminToken, 'YQB');
const duplicateUpper = await request('POST', '/airports', {
  token: adminToken, body: { iata: 'YQB', name: 'Test', city: 'Test', province: 'Test' }
});
const duplicateLower = await request('POST', '/airports', {
  token: adminToken, body: { iata: 'yqb', name: 'Test', city: 'Test', province: 'Test' }
});
add('US-06.2', iataInvalidResults.every((entry) => entry.includes(':400:')) && duplicateUpper.status === 409 && duplicateLower.status === 409,
  `${iataInvalidResults.join(' | ')}; duplicado upper=${duplicateUpper.status}; lower=${duplicateLower.status} (normalizado a ${normalizedAirport.iata})`);

const validAirport = await makeAirport(adminToken, 'YQA');
const updateAirport = await request('PUT', `/airports/${validAirport.id}`, {
  token: adminToken, body: { name: 'Updated', city: 'Updated City', province: 'Updated Province' }
});
const freeAirport = await makeAirport(adminToken, 'YQC');
const freeDeactivate = await request('DELETE', `/airports/${freeAirport.id}`, { token: adminToken });
const activeFlight = await makeFlight(adminToken, 'QAACTIVE', normalizedAirport.id, airportsByIata.get('COR').id);
const activeAirportDeactivate = await request('DELETE', `/airports/${normalizedAirport.id}`, { token: adminToken });
const canceledFlight = await makeFlight(adminToken, 'QACANCEL', validAirport.id, airportSeed.find((airport) => airport.iata === 'COR').id);
const cancelFlight = await request('POST', `/flights/${canceledFlight.id}/cancel`, { token: adminToken, body: { confirmed: true } });
const canceledOnlyDeactivate = await request('DELETE', `/airports/${validAirport.id}`, { token: adminToken });
add('US-06.1', normalizedAirport.iata === 'YQB' && normalizedAirport.name && normalizedAirport.city && normalizedAirport.province,
  `POST /airports devuelve IATA, nombre, ciudad y provincia completos (${normalizedAirport.iata})`);
add('US-06.3', updateAirport.status === 200 && freeDeactivate.status === 200
  && activeAirportDeactivate.status === 400 && cancelFlight.status === 200 && canceledOnlyDeactivate.status === 200,
  `modificación=${updateAirport.status}; libre=${freeDeactivate.status}; usada vuelo activo=${activeAirportDeactivate.status}; usada solo vuelo cancelado=${canceledOnlyDeactivate.status}`);

const inactiveCreate = await request('POST', '/flights', {
  token: adminToken,
  body: { ...flightPayload('QAINACTV'), originAirportId: freeAirport.id }
});
const activeFlightForUpdate = await makeFlight(adminToken, 'QAINACTU', airportsByIata.get('AEP').id, airportsByIata.get('EZE').id);
const inactiveUpdate = await request('PUT', `/flights/${activeFlightForUpdate.id}`, {
  token: adminToken, body: { originAirportId: freeAirport.id, confirmed: true }
});
const allAirports = await request('GET', '/airports', { token: adminToken });
const activeAirports = await request('GET', '/airports?active=true', { token: adminToken });
const inactiveRemains = allAirports.body.airports.some((airport) => airport.id === freeAirport.id && !airport.isActive);
const inactiveNotOffered = !activeAirports.body.airports.some((airport) => airport.id === freeAirport.id);
add('US-06.4', inactiveRemains && inactiveNotOffered && inactiveCreate.status === 400 && inactiveUpdate.status === 400,
  `inactiva en BD/listado=${inactiveRemains}; entre activas=${!inactiveNotOffered ? 'sí' : 'no'}; POST vuelo=${inactiveCreate.status}; PUT vuelo=${inactiveUpdate.status}`);

const tableRows = await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
const tableNames = tableRows.map((row) => row.name);
const requiredTables = ['airports', 'flights', 'departures', 'classes', 'fares', 'users', 'roles', 'passengers', 'purchases', 'tickets', 'payments', 'invoices', 'flight_change_history', 'cancellations'];
const missingTables = requiredTables.filter((name) => !tableNames.includes(name));
const counts = {};
for (const table of tableNames) {
  const rowsCount = await query(`SELECT COUNT(*) AS count FROM "${table}"`);
  counts[table] = rowsCount[0].count;
}
add('US-02.1', missingTables.length === 0,
  `tablas reales=${tableNames.join(', ')}; faltantes según lista=${missingTables.join(', ') || 'ninguna'}`);

const occupancy = await query(`
  SELECT f.flightNumber, d.date, 'Economy' AS class, d.soldEconomy AS sold, f.economySeats AS capacity
  FROM flights f JOIN departures d ON d.flightId=f.id
  UNION ALL
  SELECT f.flightNumber, d.date, 'Primera' AS class, d.soldFirstClass AS sold, f.firstClassSeats AS capacity
  FROM flights f JOIN departures d ON d.flightId=f.id
  ORDER BY flightNumber, date, class
  LIMIT 4
`);
add('US-02.2', tableNames.includes('departures') && tableNames.includes('flights'),
  `consulta ocupación vuelo+clase+fecha=${JSON.stringify(occupancy)}`);

const invalidStateEvidence = [];
for (const [table, state] of [['flights', 'ACTIVE'], ['departures', 'SCHEDULED'], ['purchases', 'CONFIRMED']]) {
  await run('BEGIN');
  try {
    await run(`UPDATE "${table}" SET status='INVALID_QA' WHERE id=(SELECT id FROM "${table}" ORDER BY id LIMIT 1)`);
    invalidStateEvidence.push(`UPDATE ${table}: aceptado`);
  } catch (error) {
    invalidStateEvidence.push(`rechazo ${table}: ${error.message}`);
  } finally {
    await run('ROLLBACK');
  }
}
add('US-02.3', invalidStateEvidence.length === 3 && invalidStateEvidence.every((entry) => entry.startsWith('rechazo')),
  invalidStateEvidence.join('; '));

const expectedSeed = await query(`
  SELECT
    (SELECT COUNT(*) FROM flights) AS flights,
    (SELECT COUNT(*) FROM airports) AS airports,
    (SELECT COUNT(*) FROM airports WHERE isActive=0) AS inactiveAirports,
    (SELECT COUNT(*) FROM departures) AS departures,
    (SELECT COUNT(*) FROM flights WHERE status='ACTIVE') AS activeFlights,
    (SELECT COUNT(*) FROM flights WHERE status='CANCELLED') AS cancelledFlights
`);
add('US-02 Seed', expectedSeed[0].flights >= 100 && expectedSeed[0].inactiveAirports >= 1,
  `conteos al inicio antes de fixtures=${JSON.stringify(initialSeedCounts[0])}; después de pruebas=${JSON.stringify(expectedSeed[0])}; usuarios por rol=${JSON.stringify(rows)}`);

console.log('\nID | RESULTADO | EVIDENCIA');
for (const result of results) console.log(`${result.id} | ${result.result} | ${result.evidence}`);
console.log(`\nSQLite tablas/conteos: ${JSON.stringify(counts)}`);
db.close();
