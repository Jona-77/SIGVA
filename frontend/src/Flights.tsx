import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

type Airport = {
  id: number;
  iata: string;
  name: string;
  city: string;
  province?: string;
};

type FlightSummary = {
  id: number;
  flightNumber: string;
  daysOfWeek: string;
  departureTime: string;
  arrivalTime: string;
  originAirportId: number;
  destinationAirportId: number;
  availableFrom: string;
  availableTo: string;
  economySeats: number;
  firstClassSeats: number;
  economyPrice: number;
  firstClassPrice: number;
  status: 'ACTIVE' | 'CANCELLED';
  arrivalsNextDay: boolean;
  origin: Airport;
  destination: Airport;
};

type FlightDetail = FlightSummary & {
  departures: Array<{
    id: number;
    date: string;
    status: string;
    departureTimePassed: boolean;
    soldEconomy: number;
    availableEconomy: number;
    soldFirstClass: number;
    availableFirstClass: number;
  }>;
  history: Array<{
    id: string;
    changedAt: string;
    userId: number;
    userEmail: string;
    field: string;
    previousValue: unknown;
    newValue: unknown;
  }>;
};

type ApiError = Error & {
  fields?: Record<string, string>;
  requiresConfirmation?: boolean;
  conflicts?: Array<{
    departureDate: string;
    field?: string;
    soldEconomy?: number;
    soldFirstClass?: number;
    requestedSeats?: number;
    reason?: string;
  }>;
  affectedPassengers?: number;
  totalDepartures?: number;
};

function formatDepartureDate(departureDate: string) {
  const [year, month, day] = departureDate.split('-');
  return year && month && day ? `${day}/${month}/${year}` : departureDate;
}

async function flightsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('sigva-token');
  const response = await fetch(`http://localhost:3001${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || 'Error de solicitud') as ApiError;
    error.fields = body.errors;
    error.requiresConfirmation = body.requiresConfirmation;
    error.conflicts = body.conflicts;
    error.affectedPassengers = body.affectedPassengers;
    error.totalDepartures = body.totalDepartures;
    throw error;
  }
  return body as T;
}

const weekDays = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' }
];

function flightStatus(status: FlightSummary['status']) {
  return status === 'ACTIVE' ? 'Activo' : 'Cancelado';
}

function FlightList() {
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [sortBy, setSortBy] = useState('number');
  const [direction, setDirection] = useState('asc');
  const [error, setError] = useState('');

  useEffect(() => {
    void flightsRequest<{ airports: Airport[] }>('/api/airports')
      .then((data) => setAirports(data.airports))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los aeropuertos.'));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), sortBy, direction });
    if (status) query.set('status', status);
    if (origin) query.set('originAirportId', origin);
    if (destination) query.set('destinationAirportId', destination);
    void flightsRequest<{ flights: FlightSummary[]; pagination: { totalPages: number } }>(`/api/flights?${query}`)
      .then((data) => {
        setFlights(data.flights);
        setTotalPages(Math.max(1, data.pagination.totalPages));
        setError('');
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los vuelos.'));
  }, [page, status, origin, destination, sortBy, direction]);

  function resetPage(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h1>Vuelos</h1>
          <p>Listado y consulta de vuelos programados.</p>
        </div>
        <Link className="button-link" to="/flights/new">Crear vuelo</Link>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="flight-filters">
        <label>Estado
          <select value={status} onChange={(event) => resetPage(() => setStatus(event.target.value))}>
            <option value="">Todos</option>
            <option value="ACTIVE">Activo</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </label>
        <label>Origen
          <select value={origin} onChange={(event) => resetPage(() => setOrigin(event.target.value))}>
            <option value="">Todos</option>
            {airports.map((airport) => <option key={airport.id} value={airport.id}>{airport.iata} — {airport.city}</option>)}
          </select>
        </label>
        <label>Destino
          <select value={destination} onChange={(event) => resetPage(() => setDestination(event.target.value))}>
            <option value="">Todos</option>
            {airports.map((airport) => <option key={airport.id} value={airport.id}>{airport.iata} — {airport.city}</option>)}
          </select>
        </label>
        <label>Ordenar por
          <select value={sortBy} onChange={(event) => resetPage(() => setSortBy(event.target.value))}>
            <option value="number">Número de vuelo</option>
            <option value="route">Ruta</option>
            <option value="departure">Horario de partida</option>
          </select>
        </label>
        <label>Sentido
          <select value={direction} onChange={(event) => resetPage(() => setDirection(event.target.value))}>
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            <th>Número</th><th>Origen</th><th>Destino</th><th>Partida</th><th>Llegada</th>
            <th>Días</th><th>Período</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {flights.map((flight) => (
              <tr key={flight.id}>
                <td><Link to={`/flights/${flight.id}`}>{flight.flightNumber}</Link></td>
                <td>{flight.origin?.iata}</td>
                <td>{flight.destination?.iata}</td>
                <td>{flight.departureTime}</td>
                <td>{flight.arrivalTime}{flight.arrivalsNextDay ? ' +1' : ''}</td>
                <td>{flight.daysOfWeek.split(',').map((day) => weekDays.find((item) => item.value === Number(day))?.label.slice(0, 3)).join(', ')}</td>
                <td>{flight.availableFrom} — {flight.availableTo}</td>
                <td>{flightStatus(flight.status)}</td>
              </tr>
            ))}
            {flights.length === 0 && <tr><td colSpan={8}>No hay vuelos para los filtros seleccionados.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Anterior</button>
        <span>Página {page} de {totalPages}</span>
        <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Siguiente</button>
      </div>
    </section>
  );
}

const initialForm = {
  flightNumber: '',
  departureTime: '',
  arrivalTime: '',
  originAirportId: '',
  destinationAirportId: '',
  availableFrom: '',
  availableTo: '',
  economySeats: '',
  firstClassSeats: '',
  economyPrice: '',
  firstClassPrice: ''
};

function FlightCreate() {
  const navigate = useNavigate();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [form, setForm] = useState(initialForm);
  const [days, setDays] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    void flightsRequest<{ airports: Airport[] }>('/api/airports?active=true')
      .then((data) => setAirports(data.airports))
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'No se pudieron cargar los aeropuertos activos.'));
  }, []);

  const update = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  function fieldError(field: string) {
    return errors[field] ? <span className="field-error" role="alert">{errors[field]}</span> : null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    try {
      const response = await flightsRequest<{ flight: FlightSummary }>('/api/flights', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          daysOfWeek: days,
          originAirportId: Number(form.originAirportId),
          destinationAirportId: Number(form.destinationAirportId),
          economySeats: Number(form.economySeats),
          firstClassSeats: Number(form.firstClassSeats),
          economyPrice: Number(form.economyPrice),
          firstClassPrice: Number(form.firstClassPrice)
        })
      });
      navigate(`/flights/${response.flight.id}`);
    } catch (reason) {
      const error = reason as ApiError;
      setMessage(error.message || 'No se pudo crear el vuelo.');
      setErrors(error.fields ?? {});
    }
  }

  const overnight = Boolean(form.departureTime && form.arrivalTime && form.arrivalTime <= form.departureTime);

  return (
    <section className="panel">
      <h1>Crear vuelo</h1>
      <form className="flight-form" onSubmit={submit}>
        <label>Número de vuelo
          <input required value={form.flightNumber} onChange={(event) => update('flightNumber', event.target.value)} aria-invalid={Boolean(errors.flightNumber)} />
          {fieldError('flightNumber')}
        </label>
        <fieldset className="weekday-options">
          <legend>Días de operación</legend>
          <div className="checkbox-grid">
            {weekDays.map((day) => (
              <label className="checkbox-label" key={day.value}>
                <input
                  type="checkbox"
                  checked={days.includes(day.value)}
                  onChange={(event) => {
                    setDays((current) => event.target.checked ? [...current, day.value].sort() : current.filter((value) => value !== day.value));
                    setErrors((current) => ({ ...current, daysOfWeek: '' }));
                  }}
                />
                {day.label}
              </label>
            ))}
          </div>
          {fieldError('daysOfWeek')}
        </fieldset>
        <div className="row">
          <label>Hora de partida
            <input type="time" required value={form.departureTime} onChange={(event) => update('departureTime', event.target.value)} aria-invalid={Boolean(errors.departureTime)} />
            {fieldError('departureTime')}
          </label>
          <label>Hora de llegada{overnight ? ' (+1 día)' : ''}
            <input type="time" required value={form.arrivalTime} onChange={(event) => update('arrivalTime', event.target.value)} aria-invalid={Boolean(errors.arrivalTime)} />
            {fieldError('arrivalTime')}
          </label>
        </div>
        <div className="row">
          <label>Origen
            <select required value={form.originAirportId} onChange={(event) => update('originAirportId', event.target.value)} aria-invalid={Boolean(errors.originAirportId)}>
              <option value="">Seleccione un aeropuerto activo</option>
              {airports.map((airport) => <option value={airport.id} key={airport.id}>{airport.iata} — {airport.city}</option>)}
            </select>
            {fieldError('originAirportId')}
          </label>
          <label>Destino
            <select required value={form.destinationAirportId} onChange={(event) => update('destinationAirportId', event.target.value)} aria-invalid={Boolean(errors.destinationAirportId)}>
              <option value="">Seleccione un aeropuerto activo</option>
              {airports.map((airport) => <option value={airport.id} key={airport.id}>{airport.iata} — {airport.city}</option>)}
            </select>
            {fieldError('destinationAirportId')}
          </label>
        </div>
        <div className="row">
          <label>Fecha desde
            <input type="date" required value={form.availableFrom} onChange={(event) => update('availableFrom', event.target.value)} aria-invalid={Boolean(errors.availableFrom)} />
            {fieldError('availableFrom')}
          </label>
          <label>Fecha hasta
            <input type="date" required value={form.availableTo} onChange={(event) => update('availableTo', event.target.value)} aria-invalid={Boolean(errors.availableTo)} />
            {fieldError('availableTo')}
          </label>
        </div>
        <div className="row">
          <label>Asientos Economy
            <input type="number" min="0" step="1" required value={form.economySeats} onChange={(event) => update('economySeats', event.target.value)} aria-invalid={Boolean(errors.economySeats)} />
            {fieldError('economySeats')}
          </label>
          <label>Precio Economy
            <input type="number" min="0" step="0.01" required value={form.economyPrice} onChange={(event) => update('economyPrice', event.target.value)} aria-invalid={Boolean(errors.economyPrice)} />
            {fieldError('economyPrice')}
          </label>
        </div>
        <div className="row">
          <label>Asientos Primera
            <input type="number" min="0" step="1" required value={form.firstClassSeats} onChange={(event) => update('firstClassSeats', event.target.value)} aria-invalid={Boolean(errors.firstClassSeats)} />
            {fieldError('firstClassSeats')}
          </label>
          <label>Precio Primera
            <input type="number" min="0" step="0.01" required value={form.firstClassPrice} onChange={(event) => update('firstClassPrice', event.target.value)} aria-invalid={Boolean(errors.firstClassPrice)} />
            {fieldError('firstClassPrice')}
          </label>
        </div>
        {message && <div className={Object.keys(errors).length ? 'error-box' : 'info-box'} role="alert">{message}</div>}
        <div className="form-actions">
          <button type="submit">Guardar vuelo</button>
          <Link to="/flights">Cancelar</Link>
        </div>
      </form>
    </section>
  );
}

function FlightEdit({ flight, onUpdated, onCancel }: {
  flight: FlightDetail;
  onUpdated: (updated: FlightDetail) => void;
  onCancel: () => void;
}) {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [form, setForm] = useState({
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    originAirportId: String(flight.originAirportId),
    destinationAirportId: String(flight.destinationAirportId),
    availableFrom: flight.availableFrom,
    availableTo: flight.availableTo,
    economySeats: String(flight.economySeats),
    firstClassSeats: String(flight.firstClassSeats),
    economyPrice: String(flight.economyPrice),
    firstClassPrice: String(flight.firstClassPrice)
  });
  const [days, setDays] = useState(flight.daysOfWeek.split(',').map(Number));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<ApiError['conflicts']>([]);

  useEffect(() => {
    void flightsRequest<{ airports: Airport[] }>('/api/airports?active=true')
      .then((data) => setAirports(data.airports))
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'No se pudieron cargar los aeropuertos activos.'));
  }, []);

  const update = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
    setConflicts([]);
  };

  function fieldError(field: string) {
    return errors[field] ? <span className="field-error" role="alert">{errors[field]}</span> : null;
  }

  async function save(confirmed: boolean, confirmedConflicts = false) {
    return flightsRequest<{ flight: FlightDetail }>('/api/flights/' + flight.id, {
      method: 'PUT',
      body: JSON.stringify({
        ...form,
        daysOfWeek: days,
        originAirportId: Number(form.originAirportId),
        destinationAirportId: Number(form.destinationAirportId),
        economySeats: Number(form.economySeats),
        firstClassSeats: Number(form.firstClassSeats),
        economyPrice: Number(form.economyPrice),
        firstClassPrice: Number(form.firstClassPrice),
        confirmed,
        confirmedConflicts
      })
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    setConflicts([]);
    const approved = window.confirm('¿Confirma guardar los cambios realizados en este vuelo?');
    if (!approved) return;

    try {
      const response = await save(true);
      onUpdated(response.flight);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.requiresConfirmation) {
        const conflicts = error.conflicts ?? [];
        const dates = [...new Set(conflicts.map((conflict) => conflict.departureDate))];
        const detail = dates.length ? `\nSalidas afectadas: ${dates.join(', ')}` : '';
        const confirmConflicts = window.confirm(`${error.message}${detail}\nSi confirma, las salidas afectadas con pasajes vendidos serán canceladas. ¿Desea continuar?`);
        if (!confirmConflicts) return;
        try {
          const response = await save(true, true);
          onUpdated(response.flight);
        } catch (retryReason) {
          const retryError = retryReason as ApiError;
          setMessage(retryError.message || 'No se pudo modificar el vuelo.');
          setErrors(retryError.fields ?? {});
          setConflicts(retryError.conflicts ?? []);
        }
        return;
      }
      setMessage(error.message || 'No se pudo modificar el vuelo.');
      setErrors(error.fields ?? {});
      setConflicts(error.conflicts ?? []);
    }
  }

  const overnight = Boolean(form.departureTime && form.arrivalTime && form.arrivalTime <= form.departureTime);

  return (
    <section className="panel">
      <h2>Modificar vuelo {flight.flightNumber}</h2>
      <form className="flight-form" onSubmit={submit}>
        <fieldset className="weekday-options">
          <legend>Días de operación</legend>
          <div className="checkbox-grid">
            {weekDays.map((day) => (
              <label className="checkbox-label" key={day.value}>
                <input
                  type="checkbox"
                  checked={days.includes(day.value)}
                  onChange={(event) => {
                    setDays((current) => event.target.checked
                      ? [...current, day.value].sort()
                      : current.filter((value) => value !== day.value));
                    setConflicts([]);
                  }}
                />
                {day.label}
              </label>
            ))}
          </div>
          {fieldError('daysOfWeek')}
        </fieldset>
        <div className="row">
          <label>Hora de partida
            <input type="time" required value={form.departureTime} onChange={(event) => update('departureTime', event.target.value)} aria-invalid={Boolean(errors.departureTime)} />
            {fieldError('departureTime')}
          </label>
          <label>Hora de llegada{overnight ? ' (+1 día)' : ''}
            <input type="time" required value={form.arrivalTime} onChange={(event) => update('arrivalTime', event.target.value)} aria-invalid={Boolean(errors.arrivalTime)} />
            {fieldError('arrivalTime')}
          </label>
        </div>
        <div className="row">
          <label>Origen
            <select required value={form.originAirportId} onChange={(event) => update('originAirportId', event.target.value)} aria-invalid={Boolean(errors.originAirportId)}>
              <option value="">Seleccione un aeropuerto activo</option>
              {airports.map((airport) => <option value={airport.id} key={airport.id}>{airport.iata} — {airport.city}</option>)}
            </select>
            {fieldError('originAirportId')}
          </label>
          <label>Destino
            <select required value={form.destinationAirportId} onChange={(event) => update('destinationAirportId', event.target.value)} aria-invalid={Boolean(errors.destinationAirportId)}>
              <option value="">Seleccione un aeropuerto activo</option>
              {airports.map((airport) => <option value={airport.id} key={airport.id}>{airport.iata} — {airport.city}</option>)}
            </select>
            {fieldError('destinationAirportId')}
          </label>
        </div>
        <div className="row">
          <label>Fecha desde
            <input type="date" required value={form.availableFrom} onChange={(event) => update('availableFrom', event.target.value)} aria-invalid={Boolean(errors.availableFrom)} />
            {fieldError('availableFrom')}
          </label>
          <label>Fecha hasta
            <input type="date" required value={form.availableTo} onChange={(event) => update('availableTo', event.target.value)} aria-invalid={Boolean(errors.availableTo)} />
            {fieldError('availableTo')}
          </label>
        </div>
        <div className="row">
          <label>Asientos Economy
            <input type="number" min="0" step="1" required value={form.economySeats} onChange={(event) => update('economySeats', event.target.value)} aria-invalid={Boolean(errors.economySeats)} />
            {fieldError('economySeats')}
          </label>
          <label>Precio Economy
            <input type="number" min="0" step="0.01" required value={form.economyPrice} onChange={(event) => update('economyPrice', event.target.value)} aria-invalid={Boolean(errors.economyPrice)} />
            {fieldError('economyPrice')}
          </label>
        </div>
        <div className="row">
          <label>Asientos Primera
            <input type="number" min="0" step="1" required value={form.firstClassSeats} onChange={(event) => update('firstClassSeats', event.target.value)} aria-invalid={Boolean(errors.firstClassSeats)} />
            {fieldError('firstClassSeats')}
          </label>
          <label>Precio Primera
            <input type="number" min="0" step="0.01" required value={form.firstClassPrice} onChange={(event) => update('firstClassPrice', event.target.value)} aria-invalid={Boolean(errors.firstClassPrice)} />
            {fieldError('firstClassPrice')}
          </label>
        </div>
        {message && <div className="error-box" role="alert">{message}</div>}
        {conflicts?.some((conflict) => conflict.field === 'economySeats' || conflict.field === 'firstClassSeats') && (
          <ul className="field-error" aria-label="Salidas con conflictos de capacidad">
            {conflicts.filter((conflict) => conflict.field === 'economySeats' || conflict.field === 'firstClassSeats').map((conflict, index) => {
              const className = conflict.field === 'economySeats' ? 'Economy' : 'Primera clase';
              const sold = conflict.field === 'economySeats' ? conflict.soldEconomy : conflict.soldFirstClass;
              return (
                <li key={`${conflict.departureDate}-${conflict.field}-${index}`}>
                  {formatDepartureDate(conflict.departureDate)}: {sold} {className} vendidos, capacidad pedida {conflict.requestedSeats}
                </li>
              );
            })}
          </ul>
        )}
        <div className="form-actions">
          <button type="submit">Guardar cambios</button>
          <button type="button" onClick={onCancel}>Cancelar edición</button>
        </div>
      </form>
    </section>
  );
}

function FlightDetails() {
  const { id } = useParams();
  const [flight, setFlight] = useState<FlightDetail | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [cancellationMessage, setCancellationMessage] = useState('');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    void flightsRequest<{ flight: FlightDetail }>(`/api/flights/${id}`)
      .then((data) => setFlight(data.flight))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'No se pudo cargar el vuelo.'));
  }, [id]);

  if (error) return <div className="error-box" role="alert">{error}</div>;
  if (!flight) return <div className="panel">Cargando vuelo…</div>;
  const currentFlight = flight;

  async function cancel(departureDate?: string) {
    setCancellationMessage('');
    setCancelling(true);
    const path = `/api/flights/${currentFlight.id}/cancel`;
    const body = departureDate ? { departureDate } : {};

    try {
      const response = await flightsRequest<{ flight: FlightDetail }>(path, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setFlight(response.flight);
      setCancellationMessage(departureDate ? 'La salida se canceló correctamente.' : 'El vuelo y sus salidas futuras se cancelaron correctamente.');
    } catch (reason) {
      const apiError = reason as ApiError;
      if (!apiError.requiresConfirmation) {
        setCancellationMessage(apiError.message || 'No se pudo cancelar.');
        return;
      }

      const affected = apiError.affectedPassengers ?? 0;
      const passengersText = `${affected} ${affected === 1 ? 'pasaje vendido afectado' : 'pasajes vendidos afectados'}`;
      const confirmationText = departureDate
        ? `¿Confirma cancelar la salida del ${departureDate}? Se verán afectados ${passengersText}.`
        : `¿Confirma cancelar el vuelo y sus ${apiError.totalDepartures ?? 0} salidas futuras? Se verán afectados ${passengersText}.`;
      if (!window.confirm(confirmationText)) return;

      try {
        const response = await flightsRequest<{ flight: FlightDetail }>(path, {
          method: 'POST',
          body: JSON.stringify({ ...body, confirmed: true })
        });
        setFlight(response.flight);
        setEditing(false);
        setCancellationMessage(departureDate ? 'La salida se canceló correctamente.' : 'El vuelo y sus salidas futuras se cancelaron correctamente.');
      } catch (confirmationReason) {
        const confirmationError = confirmationReason as ApiError;
        setCancellationMessage(confirmationError.message || 'No se pudo completar la cancelación.');
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div><h1>Vuelo {flight.flightNumber}</h1><p>{flightStatus(flight.status)}</p></div>
        <Link to="/flights">Volver al listado</Link>
      </div>
      <dl className="flight-data">
        <div><dt>Origen</dt><dd>{flight.origin.iata} — {flight.origin.city}</dd></div>
        <div><dt>Destino</dt><dd>{flight.destination.iata} — {flight.destination.city}</dd></div>
        <div><dt>Partida</dt><dd>{flight.departureTime}</dd></div>
        <div><dt>Llegada</dt><dd>{flight.arrivalTime}{flight.arrivalsNextDay ? ' +1 día' : ''}</dd></div>
        <div><dt>Días</dt><dd>{flight.daysOfWeek.split(',').map((day) => weekDays.find((item) => item.value === Number(day))?.label).join(', ')}</dd></div>
        <div><dt>Período</dt><dd>{flight.availableFrom} — {flight.availableTo}</dd></div>
        <div><dt>Estado</dt><dd>{flightStatus(flight.status)}</dd></div>
        <div><dt>Economy</dt><dd>{flight.economySeats} asientos — ${Number(flight.economyPrice).toFixed(2)}</dd></div>
        <div><dt>Primera</dt><dd>{flight.firstClassSeats} asientos — ${Number(flight.firstClassPrice).toFixed(2)}</dd></div>
      </dl>
      {flight.status === 'ACTIVE' && (
        <div className="form-actions">
          <button type="button" onClick={() => setEditing((current) => !current)}>{editing ? 'Cerrar edición' : 'Modificar'}</button>
          <button type="button" className="danger-button" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? 'Cancelando…' : 'Cancelar vuelo'}
          </button>
        </div>
      )}
      {cancellationMessage && <div className="info-box" role="status">{cancellationMessage}</div>}
      {editing && flight.status === 'ACTIVE' && (
        <FlightEdit
          flight={flight}
          onUpdated={(updated) => {
            setFlight(updated);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      <h2>Salidas y disponibilidad</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Estado</th><th>Economy vendidos</th><th>Economy disponibles</th><th>Primera vendidos</th><th>Primera disponibles</th>{flight.status === 'ACTIVE' && <th>Acción</th>}</tr></thead>
          <tbody>
            {flight.departures.map((departure) => (
              <tr key={departure.id}>
                <td>{departure.date}</td><td>{departure.status === 'CANCELLED' ? 'Cancelada' : departure.departureTimePassed ? 'Hora de salida pasada' : 'Programada'}</td>
                <td>{departure.soldEconomy}</td><td>{departure.availableEconomy}</td>
                <td>{departure.soldFirstClass}</td><td>{departure.availableFirstClass}</td>
                {flight.status === 'ACTIVE' && (
                  <td>
                    {departure.status !== 'CANCELLED' && !departure.departureTimePassed && (
                      <button type="button" className="danger-button" onClick={() => void cancel(departure.date)} disabled={cancelling}>
                        Cancelar salida
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {flight.departures.length === 0 && <tr><td colSpan={flight.status === 'ACTIVE' ? 7 : 6}>El vuelo no tiene salidas generadas.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Historial de cambios</h2>
      {flight.history.length === 0 && <p>No hay cambios registrados.</p>}
      {flight.history.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Campo</th><th>Valor anterior</th><th>Valor nuevo</th></tr></thead>
            <tbody>
              {flight.history.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.changedAt).toLocaleString('es-AR')}</td>
                  <td>{entry.userEmail}</td>
                  <td>{entry.field}</td>
                  <td>{String(entry.previousValue)}</td>
                  <td>{String(entry.newValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function FlightsPage({ view }: { view: 'list' | 'create' | 'detail' }) {
  if (view === 'create') return <FlightCreate />;
  if (view === 'detail') return <FlightDetails />;
  return <FlightList />;
}
