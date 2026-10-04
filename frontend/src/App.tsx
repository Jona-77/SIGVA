import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
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
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.message || 'Error de solicitud';
    throw new Error(message);
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
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = await apiRequest<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      onLogin(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación');
    }
  }

  return (
    <div className="auth-card">
      <h1>SIGVA</h1>
      <p>Acceso al sistema</p>
      <form onSubmit={handleSubmit} className="stack">
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button type="submit">Ingresar</button>
      </form>
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
            <button type="button" className="logout" onClick={handleLogout}>Cerrar sesión</button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />} />
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
