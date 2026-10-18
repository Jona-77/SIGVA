import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { FlightsPage } from './Flights.js';

type User = {
  id: number;
  email: string;
  role: 'admin' | 'employee' | 'passenger';
  name: string;
};

type AuthResponse = {
  token: string;
  user: User;
};

type FieldErrors = Record<string, string>;

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly fields: FieldErrors) {
    super(message);
    this.name = 'ApiError';
  }
}

type SearchResult = {
  id: number;
  flightNumber: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  duration: string;
  classes: Array<{ code: string; name: string; price: number; available: number; soldOut: boolean }>;
};

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('sigva-token');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as { message?: string; errors?: FieldErrors };
    throw new ApiError(errorBody.message || 'Error de solicitud', response.status, errorBody.errors ?? {});
  }

  return response.json() as Promise<T>;
}

function ProtectedRoute({ allowedRole, children }: { allowedRole?: User['role']; children: JSX.Element }) {
  const token = localStorage.getItem('sigva-token');
  const user = JSON.parse(localStorage.getItem('sigva-user') || 'null') as User | null;

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole && user.role !== allowedRole) {
    return <Navigate to="/forbidden" replace />;
  }

  return children;
}

function LoginPage({ onLogin }: { onLogin: (payload: AuthResponse) => void }) {
  const [email, setEmail] = useState('admin@sigva.test');
  const [password, setPassword] = useState('Admin123!');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');

  function updateField(field: 'email' | 'password', value: string) {
    if (field === 'email') setEmail(value);
    else setPassword(value);
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setMessage('');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const payload = await apiRequest<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      onLogin(payload);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(err.message);
      } else {
        setMessage(err instanceof Error ? err.message : 'Error de autenticación');
      }
    }
  }

  return (
    <div className="auth-card">
      <h1>SIGVA</h1>
      <p>Acceso al sistema</p>
      <form onSubmit={handleSubmit} className="stack">
        <label>
          Email
          <input value={email} onChange={(e) => updateField('email', e.target.value)} aria-invalid={Boolean(errors.email)} />
          {errors.email && <span className="field-error" role="alert">{errors.email}</span>}
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => updateField('password', e.target.value)} aria-invalid={Boolean(errors.password)} />
          {errors.password && <span className="field-error" role="alert">{errors.password}</span>}
        </label>
        {message && Object.keys(errors).length === 0 && <div className="error-box" role="alert">{message}</div>}
        <button type="submit">Ingresar</button>
      </form>
      <p>
        <Link to="/registro">Crear cuenta de pasajero</Link>
      </p>
    </div>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', lastName: '', document: '', email: '', password: '', birthDate: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setMessage('');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      navigate('/login');
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else if (error instanceof Error) {
        setMessage(error.message);
      }
    }
  }

  return (
    <div className="auth-card">
      <h1>Registro de pasajero</h1>
      <form onSubmit={handleSubmit} className="stack">
        <label>Nombre<input value={form.name} onChange={(e) => updateField('name', e.target.value)} aria-invalid={Boolean(errors.name)} />{errors.name && <span className="field-error" role="alert">{errors.name}</span>}</label>
        <label>Apellido<input value={form.lastName} onChange={(e) => updateField('lastName', e.target.value)} aria-invalid={Boolean(errors.lastName)} />{errors.lastName && <span className="field-error" role="alert">{errors.lastName}</span>}</label>
        <label>Documento<input value={form.document} onChange={(e) => updateField('document', e.target.value)} aria-invalid={Boolean(errors.document)} /><span className="field-hint">6 a 15 caracteres alfanuméricos</span>{errors.document && <span className="field-error" role="alert">{errors.document}</span>}</label>
        <label>Email<input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} aria-invalid={Boolean(errors.email)} />{errors.email && <span className="field-error" role="alert">{errors.email}</span>}</label>
        <label>Contraseña<input type="password" value={form.password} onChange={(e) => updateField('password', e.target.value)} aria-invalid={Boolean(errors.password)} /><span className="field-hint">Mínimo 8 caracteres, con al menos una letra y un número</span>{errors.password && <span className="field-error" role="alert">{errors.password}</span>}</label>
        <label>Fecha de nacimiento (opcional)<input type="date" value={form.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} aria-invalid={Boolean(errors.birthDate)} />{errors.birthDate && <span className="field-error" role="alert">{errors.birthDate}</span>}</label>
        {message && Object.keys(errors).length === 0 && <div className="error-box" role="alert">{message}</div>}
        <button type="submit">Registrarme</button>
      </form>
    </div>
  );
}

function SearchFlightsPage() {
  const navigate = useNavigate();
  const [airports, setAirports] = useState<Array<{ iata: string; name: string }>>([]);
  const [origin, setOrigin] = useState('AEP');
  const [destination, setDestination] = useState('EZE');
  const [date, setDate] = useState('2026-11-05');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState('');
  const [selectedFlight, setSelectedFlight] = useState<SearchResult | null>(null);
  const [classCode, setClassCode] = useState('ECONOMY');
  const [quantity, setQuantity] = useState('1');
  const [quoteErrors, setQuoteErrors] = useState<FieldErrors>({});
  const [quoteMessage, setQuoteMessage] = useState('');
  const [quoteTotal, setQuoteTotal] = useState<number | null>(null);

  useEffect(() => {
    void apiRequest<{ airports: Array<{ iata: string; name: string }> }>('/api/public/airports')
      .then((data) => setAirports(data.airports))
      .catch(() => setAirports([]));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const data = await apiRequest<{ results?: SearchResult[]; message?: string }>('/api/search/flights?origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(destination) + '&date=' + encodeURIComponent(date));
      if ((data.results ?? []).length === 0) {
        setResults([]);
        setSelectedFlight(null);
        setMessage(data.message ?? 'No se encontraron vuelos para la búsqueda.');
        return;
      }
      setResults(data.results ?? []);
      setSelectedFlight(null);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setErrors(apiError?.fields ?? {});
      setMessage(error instanceof Error ? error.message : 'No se pudo realizar la búsqueda');
      setResults([]);
    }
  }

  function selectFlight(result: SearchResult) {
    const user = JSON.parse(localStorage.getItem('sigva-user') || 'null') as User | null;
    if (!localStorage.getItem('sigva-token') || user?.role !== 'passenger') {
      navigate('/login', { state: { fromSearch: true, departureId: result.id } });
      return;
    }
    setSelectedFlight(result);
    setClassCode(result.classes.find((item) => !item.soldOut)?.code ?? 'ECONOMY');
    setQuantity('1');
    setQuoteErrors({});
    setQuoteMessage('');
    setQuoteTotal(null);
  }

  async function requestQuote(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedFlight) return;
    setQuoteErrors({});
    setQuoteMessage('');
    setQuoteTotal(null);
    try {
      const quote = await apiRequest<{ total: number }>('/api/purchases/quote', {
        method: 'POST',
        body: JSON.stringify({ departureId: selectedFlight.id, classCode, quantity: Number(quantity) })
      });
      setQuoteTotal(quote.total);
    } catch (error) {
      if (error instanceof ApiError) {
        setQuoteErrors(error.fields);
        setQuoteMessage(error.message);
      } else {
        setQuoteMessage(error instanceof Error ? error.message : 'No se pudo cotizar la selección.');
      }
    }
  }

  return (
    <div className="panel">
      <h2>Búsqueda de vuelos</h2>
      <form onSubmit={handleSubmit} className="stack">
        <div className="row">
          <label>Origen<select value={origin} onChange={(e) => { setOrigin(e.target.value); setErrors((current) => ({ ...current, origin: '' })); setMessage(''); }} aria-invalid={Boolean(errors.origin)}>{airports.map((airport) => <option key={airport.iata} value={airport.iata}>{airport.iata} - {airport.name}</option>)}</select>{errors.origin && <span className="field-error" role="alert">{errors.origin}</span>}</label>
          <label>Destino<select value={destination} onChange={(e) => { setDestination(e.target.value); setErrors((current) => ({ ...current, destination: '' })); setMessage(''); }} aria-invalid={Boolean(errors.destination)}>{airports.map((airport) => <option key={airport.iata + '-dest'} value={airport.iata}>{airport.iata} - {airport.name}</option>)}</select>{errors.destination && <span className="field-error" role="alert">{errors.destination}</span>}</label>
        </div>
        <label>Fecha<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErrors((current) => ({ ...current, date: '' })); setMessage(''); }} aria-invalid={Boolean(errors.date)} />{errors.date && <span className="field-error" role="alert">{errors.date}</span>}</label>
        <button type="submit">Buscar vuelos</button>
      </form>
      {message && <div className={Object.keys(errors).some((field) => errors[field]) ? 'error-box' : 'info-box'} role="alert">{message}</div>}
      {results.length > 0 && (
        <div className="stack">
          {results.map((result) => (
            <div key={result.id} className="panel">
              <h3>{result.flightNumber}</h3>
              <p>{result.origin} → {result.destination} · {result.departure.slice(0, 10)} · {result.duration}</p>
              <p>Salida: {result.departure.slice(11, 16)} · Llegada: {result.arrival.slice(11, 16)}</p>
              <ul>
                {result.classes.map((cls) => (
                  <li key={cls.code}>{cls.name}: ${cls.price} {cls.soldOut ? 'Agotada' : `(${cls.available} libres)`}</li>
                ))}
              </ul>
              <button type="button" onClick={() => selectFlight(result)}>Seleccionar</button>
              {selectedFlight?.id === result.id && (
                <form className="stack selection-form" onSubmit={requestQuote}>
                  <label>
                    Clase
                    <select
                      value={classCode}
                      onChange={(event) => {
                        setClassCode(event.target.value);
                        setQuoteErrors((current) => {
                          const next = { ...current };
                          delete next.classCode;
                          return next;
                        });
                        setQuoteMessage('');
                      }}
                      aria-invalid={Boolean(quoteErrors.classCode)}
                    >
                      {result.classes.filter((item) => !item.soldOut).map((item) => <option key={item.code} value={item.code}>{item.name} · ${item.price}</option>)}
                    </select>
                    {quoteErrors.classCode && <span className="field-error" role="alert">{quoteErrors.classCode}</span>}
                  </label>
                  <label>
                    Cantidad
                    <input
                      type="number"
                      min="1"
                      max="9"
                      value={quantity}
                      onChange={(event) => {
                        setQuantity(event.target.value);
                        setQuoteErrors((current) => {
                          const next = { ...current };
                          delete next.quantity;
                          return next;
                        });
                        setQuoteMessage('');
                      }}
                      aria-invalid={Boolean(quoteErrors.quantity)}
                    />
                    {quoteErrors.quantity && <span className="field-error" role="alert">{quoteErrors.quantity}</span>}
                  </label>
                  {quoteMessage && !Object.values(quoteErrors).some(Boolean) && <div className="error-box" role="alert">{quoteMessage}</div>}
                  {quoteTotal !== null && <div className="info-box" role="status">Total cotizado: ${quoteTotal}</div>}
                  <button type="submit">Cotizar selección</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AirportManagement() {
  const [airports, setAirports] = useState<Array<{ id: number; iata: string; name: string; city: string; province: string; isActive: boolean }>>([]);
  const [form, setForm] = useState({ id: 0, iata: '', name: '', city: '', province: '' });
  const [feedback, setFeedback] = useState('');

  async function loadAirports() {
    const data = await apiRequest<{ airports: typeof airports }>('/api/airports');
    setAirports(data.airports);
  }

  useEffect(() => {
    void loadAirports();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (form.id) {
        await apiRequest(`/api/airports/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify({ iata: form.iata, name: form.name, city: form.city, province: form.province })
        });
      } else {
        await apiRequest('/api/airports', {
          method: 'POST',
          body: JSON.stringify({ iata: form.iata, name: form.name, city: form.city, province: form.province })
        });
      }
      setForm({ id: 0, iata: '', name: '', city: '', province: '' });
      setFeedback('Aeropuerto guardado correctamente.');
      await loadAirports();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo guardar');
    }
  }

  async function deactivate(id: number) {
    try {
      await apiRequest(`/api/airports/${id}`, {
        method: 'DELETE'
      });
      setFeedback('Aeropuerto desactivado.');
      await loadAirports();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo desactivar');
    }
  }

  return (
    <div className="panel">
      <h2>Gestión de aeropuertos</h2>
      <form onSubmit={submit} className="stack">
        <div className="row">
          <label>
            IATA
            <input value={form.iata} onChange={(e) => setForm({ ...form, iata: e.target.value.toUpperCase() })} />
          </label>
          <label>
            Nombre
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <label>
            Ciudad
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </label>
          <label>
            Provincia
            <input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
          </label>
        </div>
        <button type="submit">Guardar</button>
      </form>
      {feedback && <div className="info-box">{feedback}</div>}
      <table>
        <thead>
          <tr>
            <th>IATA</th>
            <th>Nombre</th>
            <th>Ciudad</th>
            <th>Provincia</th>
            <th>Estado</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {airports.map((airport) => (
            <tr key={airport.id}>
              <td>{airport.iata}</td>
              <td>{airport.name}</td>
              <td>{airport.city}</td>
              <td>{airport.province}</td>
              <td>{airport.isActive ? 'Activo' : 'Inactivo'}</td>
              <td>
                <button type="button" onClick={() => setForm({ id: airport.id, iata: airport.iata, name: airport.name, city: airport.city, province: airport.province })}>Editar</button>
                <button type="button" onClick={() => void deactivate(airport.id)} disabled={!airport.isActive}>Desactivar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleHome({ user }: { user: User }) {
  if (user.role === 'admin') {
    return <AirportManagement />;
  }

  return (
    <div className="panel">
      <h2>Disponible próximamente</h2>
      <p>La funcionalidad para {user.role === 'employee' ? 'empleados de mostrador' : 'pasajeros'} se habilitará en la siguiente iteración.</p>
    </div>
  );
}

function ForbiddenPage() {
  return (
    <div className="panel">
      <h2>Acceso denegado</h2>
      <p>No tiene permisos para acceder a esta vista.</p>
    </div>
  );
}

function AppShell() {
  const [user, setUser] = useState<User | null>(() => JSON.parse(localStorage.getItem('sigva-user') || 'null'));
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('sigva-token'));

  useEffect(() => {
    if (user) {
      localStorage.setItem('sigva-user', JSON.stringify(user));
    } else {
      localStorage.removeItem('sigva-user');
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('sigva-token', token);
    } else {
      localStorage.removeItem('sigva-token');
    }
  }, [token]);

  const handleLogin = (payload: AuthResponse) => {
    setUser(payload.user);
    setToken(payload.token);
    window.location.href = '/';
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    window.location.href = '/login';
  };

  return (
    <div className="app-shell">
      <nav className="topbar">
        <div className="brand">SIGVA</div>
        {user ? (
          <>
            <Link to="/">Inicio</Link>
            {user.role === 'admin' && (
              <>
                <Link to="/flights">Vuelos</Link>
                <Link to="/airports">Aeropuertos</Link>
              </>
            )}
            {user.role === 'passenger' && <Link to="/buscar">Buscar vuelos</Link>}
            <button type="button" className="logout" onClick={handleLogout}>Cerrar sesión</button>
          </>
        ) : (
          <>
            <Link to="/login">Login</Link>
            <Link to="/buscar">Buscar vuelos</Link>
          </>
        )}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />} />
          <Route path="/registro" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
          <Route path="/buscar" element={<SearchFlightsPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route
            path="/"
            element={
              user ? (
                <ProtectedRoute allowedRole={user.role}>
                  <RoleHome user={user} />
                </ProtectedRoute>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/airports"
            element={
              <ProtectedRoute allowedRole="admin">
                <AirportManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flights"
            element={
              <ProtectedRoute allowedRole="admin">
                <FlightsPage view="list" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flights/new"
            element={
              <ProtectedRoute allowedRole="admin">
                <FlightsPage view="create" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flights/:id"
            element={
              <ProtectedRoute allowedRole="admin">
                <FlightsPage view="detail" />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
