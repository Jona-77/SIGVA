import bcrypt from 'bcryptjs';
import { DataTypes, Model, Sequelize, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { config } from '../config.js';

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: config.dbPath,
  logging: false,
  define: {
    timestamps: true,
    underscored: false
  }
});

export interface RoleAttributes {
  id: number;
  name: string;
}

export type RoleCreationAttributes = InferCreationAttributes<RoleModel>;

export class RoleModel extends Model<InferAttributes<RoleModel>, InferCreationAttributes<RoleModel>> {
  declare id: CreationOptional<number>;
  declare name: string;
}

export const Role = sequelize.define<RoleModel>('Role', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
}, {
  tableName: 'roles'
});

export interface UserAttributes {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  roleId: number;
  isActive: boolean;
}

export type UserCreationAttributes = InferCreationAttributes<UserModel>;

export class UserModel extends Model<InferAttributes<UserModel>, InferCreationAttributes<UserModel>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare roleId: number;
  declare isActive: CreationOptional<boolean>;
  declare role?: RoleModel;
}

export const User = sequelize.define<UserModel>('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  roleId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Role,
      key: 'id'
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'users'
});

export const Session = sequelize.define('Session', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: User, key: 'id' }
  },
  lastActivity: { type: DataTypes.DATE, allowNull: false },
  revoked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, { tableName: 'sessions', updatedAt: false });

export interface AirportAttributes {
  id: number;
  iata: string;
  name: string;
  city: string;
  province: string;
  isActive: boolean;
}

export type AirportCreationAttributes = InferCreationAttributes<AirportModel>;

export class AirportModel extends Model<InferAttributes<AirportModel>, InferCreationAttributes<AirportModel>> {
  declare id: CreationOptional<number>;
  declare iata: string;
  declare name: string;
  declare city: string;
  declare province: string;
  declare isActive: CreationOptional<boolean>;
}

export const Airport = sequelize.define<AirportModel>('Airport', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  iata: {
    type: DataTypes.STRING(3),
    allowNull: false,
    unique: true,
    validate: {
      is: /^[A-Z]{3}$/i
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  city: {
    type: DataTypes.STRING,
    allowNull: false
  },
  province: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'airports'
});

export interface FlightAttributes {
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
  status: string;
}

export type FlightCreationAttributes = InferCreationAttributes<FlightModel>;

export class FlightModel extends Model<InferAttributes<FlightModel>, InferCreationAttributes<FlightModel>> {
  declare id: CreationOptional<number>;
  declare flightNumber: string;
  declare daysOfWeek: string;
  declare departureTime: string;
  declare arrivalTime: string;
  declare originAirportId: number;
  declare destinationAirportId: number;
  declare availableFrom: string;
  declare availableTo: string;
  declare economySeats: number;
  declare firstClassSeats: number;
  declare economyPrice: number;
  declare firstClassPrice: number;
  declare status: string;
  declare cancelledAt?: string | null;
  declare cancelledByUserId?: number | null;
  declare origin?: AirportModel;
  declare destination?: AirportModel;
  declare departures?: DepartureModel[];
}

export const Flight = sequelize.define<FlightModel>('Flight', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  flightNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  daysOfWeek: {
    type: DataTypes.STRING,
    allowNull: false
  },
  departureTime: {
    type: DataTypes.STRING,
    allowNull: false
  },
  arrivalTime: {
    type: DataTypes.STRING,
    allowNull: false
  },
  originAirportId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  destinationAirportId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  availableFrom: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  availableTo: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  economySeats: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  firstClassSeats: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  economyPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  firstClassPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'ACTIVE'
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  cancelledByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: User, key: 'id' }
  },
}, {
  tableName: 'flights',
  indexes: [
    { fields: ['status'] },
    { fields: ['originAirportId', 'destinationAirportId'] },
    { fields: ['departureTime'] },
    { fields: ['status', 'originAirportId', 'destinationAirportId'] }
  ]
});

export class DepartureModel extends Model<InferAttributes<DepartureModel>, InferCreationAttributes<DepartureModel>> {
  declare id: CreationOptional<number>;
  declare flightId: number;
  declare date: string;
  declare status: CreationOptional<string>;
  declare soldEconomy: CreationOptional<number>;
  declare soldFirstClass: CreationOptional<number>;
  declare cancelledAt?: string | null;
  declare cancelledByUserId?: number | null;
}

export const Departure = sequelize.define<DepartureModel>('Departure', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  flightId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: Flight, key: 'id' }
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('SCHEDULED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'SCHEDULED'
  },
  soldEconomy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  soldFirstClass: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  cancelledByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: User, key: 'id' }
  }
}, {
  tableName: 'departures',
  indexes: [
    { unique: true, fields: ['flightId', 'date'] },
    { fields: ['date', 'status'] }
  ]
});

export class IdModel extends Model<InferAttributes<IdModel>, InferCreationAttributes<IdModel>> {
  declare id: CreationOptional<number>;
  declare userId?: number | null;
  declare firstName?: string;
  declare lastName?: string;
  declare documentType?: string;
  declare documentNumber?: string;
  declare email?: string;
  declare code?: string;
  declare name?: string;
  declare flightId?: number;
  declare classId?: number;
  declare price?: number;
  declare capacity?: number;
  declare purchaseId?: number;
  declare departureId?: number;
  declare status?: string;
  declare amount?: number;
  declare paidAt?: Date | null;
  declare number?: string;
  declare total?: number;
  declare issuedAt?: Date;
  declare changedAt?: Date;
  declare field?: string;
  declare previousValue?: string | null;
  declare newValue?: string | null;
  declare cancelledAt?: Date;
}

export class PurchaseModel extends Model<InferAttributes<PurchaseModel>, InferCreationAttributes<PurchaseModel>> {
  declare id: CreationOptional<number>;
  declare passengerId: number;
  declare status: string;
  declare total: number;
}

export const Passenger = sequelize.define<IdModel>('Passenger', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: true, unique: true, references: { model: User, key: 'id' } },
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: { type: DataTypes.STRING, allowNull: false },
  documentType: { type: DataTypes.STRING, allowNull: false },
  documentNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'passengers' });

export const Class = sequelize.define<IdModel>('Class', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'classes' });

export const Fare = sequelize.define<IdModel>('Fare', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  flightId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Flight, key: 'id' } },
  classId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Class, key: 'id' } },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'fares', timestamps: true, indexes: [{ unique: true, fields: ['flightId', 'classId'] }] });

export const Purchase = sequelize.define<PurchaseModel>('Purchase', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  passengerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Passenger, key: 'id' } },
  status: {
    type: DataTypes.ENUM('RESERVED', 'CONFIRMED', 'EXPIRED', 'REJECTED'),
    allowNull: false,
    defaultValue: 'RESERVED',
    validate: { isIn: [['RESERVED', 'CONFIRMED', 'EXPIRED', 'REJECTED']] }
  },
  total: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 }
}, { tableName: 'purchases' });

export const Ticket = sequelize.define<IdModel>('Ticket', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  purchaseId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Purchase, key: 'id' } },
  departureId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Departure, key: 'id' } },
  classId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Class, key: 'id' } },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false }
}, { tableName: 'tickets' });

export const Payment = sequelize.define<IdModel>('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  purchaseId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Purchase, key: 'id' } },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PENDING' },
  paidAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'payments' });

export const Invoice = sequelize.define<IdModel>('Invoice', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  purchaseId: { type: DataTypes.INTEGER, allowNull: false, unique: true, references: { model: Purchase, key: 'id' } },
  number: { type: DataTypes.STRING, allowNull: false, unique: true },
  total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  issuedAt: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'invoices' });

export const FlightChangeHistory = sequelize.define<IdModel>('FlightChangeHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  flightId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Flight, key: 'id' } },
  changedAt: { type: DataTypes.DATE, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: 'id' } },
  field: { type: DataTypes.STRING, allowNull: false },
  previousValue: { type: DataTypes.TEXT, allowNull: true },
  newValue: { type: DataTypes.TEXT, allowNull: true }
}, { tableName: 'flight_change_history' });

export const Cancellation = sequelize.define<IdModel>('Cancellation', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  flightId: { type: DataTypes.INTEGER, allowNull: true, references: { model: Flight, key: 'id' } },
  departureId: { type: DataTypes.INTEGER, allowNull: true, references: { model: Departure, key: 'id' } },
  cancelledAt: { type: DataTypes.DATE, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: 'id' } }
}, {
  tableName: 'cancellations',
  validate: { hasFlightOrDeparture(this: { flightId?: number | null; departureId?: number | null }) {
    if (!this.flightId && !this.departureId) throw new Error('La cancelación requiere vuelo o salida.');
  } }
});

Flight.belongsToMany(Class, { through: Fare, foreignKey: 'flightId', otherKey: 'classId' });
User.hasMany(Session, { foreignKey: 'userId', as: 'sessions' });
Session.belongsTo(User, { foreignKey: 'userId' });

User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Flight.belongsTo(Airport, { foreignKey: 'originAirportId', as: 'origin' });
Flight.belongsTo(Airport, { foreignKey: 'destinationAirportId', as: 'destination' });
Flight.hasMany(Departure, { foreignKey: 'flightId', as: 'departures' });
Departure.belongsTo(Flight, { foreignKey: 'flightId', as: 'flight' });

function seedDepartureDates(from: string, to: string, daysOfWeek: number[]) {
  const dates: string[] = [];
  const allowedDays = new Set(daysOfWeek);
  const [startYear, startMonth, startDay] = from.split('-').map(Number);
  const [endYear, endMonth, endDay] = to.split('-').map(Number);
  const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = Date.UTC(endYear, endMonth - 1, endDay);

  while (current.getTime() <= end) {
    const weekday = current.getUTCDay() || 7;
    if (allowedDays.has(weekday)) {
      dates.push(current.toISOString().slice(0, 10));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export async function ensureExampleFlightDepartures() {
  const flight = await Flight.findOne({ where: { flightNumber: 'AR1450' } });
  if (!flight) {
    return;
  }

  const dates = seedDepartureDates(flight.availableFrom, flight.availableTo, flight.daysOfWeek.split(',').map(Number));
  const desiredDates = new Set(dates);
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const todayFields = Object.fromEntries(todayParts.map(({ type, value }) => [type, value]));
  const today = `${todayFields.year}-${todayFields.month}-${todayFields.day}`;
  const existing = await Departure.findAll({
    where: { flightId: flight.id },
    attributes: ['id', 'date', 'status', 'soldEconomy', 'soldFirstClass']
  });
  const todayDepartures = existing.filter((departure) => departure.date >= today
    && departure.status === 'SCHEDULED'
    && !desiredDates.has(departure.date));
  for (const departure of todayDepartures) {
    if (departure.soldEconomy + departure.soldFirstClass > 0) {
      await departure.update({ status: 'CANCELLED', cancelledAt: new Date().toISOString() });
    } else {
      await departure.destroy();
    }
  }
  const existingDates = new Set(existing
    .filter((departure) => !todayDepartures.includes(departure) || departure.status === 'CANCELLED')
    .map((departure) => departure.date));
  const missingDates = dates.filter((date) => !existingDates.has(date));
  if (missingDates.length > 0) {
    await Departure.bulkCreate(missingDates.map((date) => ({ flightId: flight.id, date })));
  }
}

export async function ensureStateConstraints() {
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS flights_status_insert
    BEFORE INSERT ON flights
    WHEN NEW.status NOT IN ('ACTIVE', 'CANCELLED')
    BEGIN SELECT RAISE(ABORT, 'Estado de vuelo no permitido'); END;
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS flights_status_update
    BEFORE UPDATE OF status ON flights
    WHEN NEW.status NOT IN ('ACTIVE', 'CANCELLED')
    BEGIN SELECT RAISE(ABORT, 'Estado de vuelo no permitido'); END;
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS departures_status_insert
    BEFORE INSERT ON departures
    WHEN NEW.status NOT IN ('SCHEDULED', 'CANCELLED')
    BEGIN SELECT RAISE(ABORT, 'Estado de salida no permitido'); END;
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS departures_status_update
    BEFORE UPDATE OF status ON departures
    WHEN NEW.status NOT IN ('SCHEDULED', 'CANCELLED')
    BEGIN SELECT RAISE(ABORT, 'Estado de salida no permitido'); END;
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS purchases_status_insert
    BEFORE INSERT ON purchases
    WHEN NEW.status NOT IN ('RESERVED', 'CONFIRMED', 'EXPIRED', 'REJECTED')
    BEGIN SELECT RAISE(ABORT, 'Estado de compra no permitido'); END;
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS purchases_status_update
    BEFORE UPDATE OF status ON purchases
    WHEN NEW.status NOT IN ('RESERVED', 'CONFIRMED', 'EXPIRED', 'REJECTED')
    BEGIN SELECT RAISE(ABORT, 'Estado de compra no permitido'); END;
  `);
}

export async function seedDatabase(options: { seedDemoFlights?: boolean } = {}) {
  await sequelize.sync({ force: true });
  await ensureStateConstraints();

  const [adminRole, employeeRole, passengerRole] = await Role.bulkCreate([
    { name: 'admin' },
    { name: 'employee' },
    { name: 'passenger' }
  ]);

  const admin = await User.create({
    name: 'Administrador',
    email: 'admin@sigva.test',
    passwordHash: await bcrypt.hash('Admin123!', 10),
    roleId: adminRole.id
  });

  await User.create({
    name: 'Empleado',
    email: 'empleado@sigva.test',
    passwordHash: await bcrypt.hash('Empleado123!', 10),
    roleId: employeeRole.id
  });

  const passengerUser = await User.create({
    name: 'Pasajero',
    email: 'pasajero@sigva.test',
    passwordHash: await bcrypt.hash('Pasajero123!', 10),
    roleId: passengerRole.id
  });

  await Airport.bulkCreate([
    { iata: 'AEP', name: 'Aeroparque Jorge Newbery', city: 'Buenos Aires', province: 'Buenos Aires', isActive: true },
    { iata: 'EZE', name: 'Ministro Pistarini', city: 'Ezeiza', province: 'Buenos Aires', isActive: true },
    { iata: 'COR', name: 'Ingeniero Aeronáutico Ambrosini', city: 'Córdoba', province: 'Córdoba', isActive: true },
    { iata: 'MDZ', name: 'El Plumerillo', city: 'Mendoza', province: 'Mendoza', isActive: true },
    { iata: 'ROS', name: 'Islas Malvinas', city: 'Rosario', province: 'Santa Fe', isActive: true },
    { iata: 'SLA', name: 'Martin Miguel de Güemes', city: 'Salta', province: 'Salta', isActive: true },
    { iata: 'TUC', name: 'Teniente General Benjamín Matienzo', city: 'San Miguel de Tucumán', province: 'Tucumán', isActive: true },
    { iata: 'NQN', name: 'Presidente Perón', city: 'Neuquén', province: 'Neuquén', isActive: true },
    { iata: 'BRC', name: 'San Carlos de Bariloche', city: 'San Carlos de Bariloche', province: 'Río Negro', isActive: true },
    { iata: 'BHI', name: 'Bahia Blanca', city: 'Bahía Blanca', province: 'Buenos Aires', isActive: true },
    { iata: 'FTE', name: 'El Calafate', city: 'El Calafate', province: 'Santa Cruz', isActive: true },
    { iata: 'USH', name: 'Ushuaia', city: 'Ushuaia', province: 'Tierra del Fuego', isActive: false }
  ]);

  const passenger = await Passenger.create({
    userId: passengerUser.id,
    firstName: 'Pasajero',
    lastName: 'Demo',
    documentType: 'DNI',
    documentNumber: '40000001',
    email: passengerUser.email
  });
  const [economy, firstClass] = await Class.bulkCreate([
    { code: 'ECONOMY', name: 'Economy' },
    { code: 'FIRST', name: 'Primera' }
  ]);

  const airports = await Airport.findAll({ order: [['id', 'ASC']] });
  if (options.seedDemoFlights === false) {
    await Flight.create({
      flightNumber: 'AR1450', daysOfWeek: '1,5', departureTime: '08:30', arrivalTime: '09:45',
      originAirportId: airports[0].id, destinationAirportId: airports[1].id,
      availableFrom: '2026-11-01', availableTo: '2026-11-30', economySeats: 180, firstClassSeats: 20,
      economyPrice: 12500, firstClassPrice: 34500, status: 'ACTIVE'
    });
    return;
  }
  const now = new Date();
  const dateOffset = (offset: number) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    return date.toISOString().slice(0, 10);
  };
  const from = dateOffset(-14);
  const to = dateOffset(35);
  const generatedFlights: FlightModel[] = [];
  for (let index = 0; index < 110; index += 1) {
    const origin = airports[index % (airports.length - 1)];
    const destination = airports[(index + 1) % (airports.length - 1)];
    const nightFlight = index % 9 === 0;
    const flight = await Flight.create({
      flightNumber: index === 0 ? 'AR1450' : `AR${String(2000 + index).padStart(4, '0')}`,
      daysOfWeek: index === 0 ? '1,5' : '1,2,3,4,5,6,7',
      departureTime: nightFlight ? '23:30' : `${String(6 + index % 15).padStart(2, '0')}:30`,
      arrivalTime: nightFlight ? '01:15' : `${String(8 + index % 14).padStart(2, '0')}:15`,
      originAirportId: origin.id,
      destinationAirportId: destination.id,
      availableFrom: from,
      availableTo: to,
      economySeats: 180,
      firstClassSeats: 20,
      economyPrice: 12500 + index * 10,
      firstClassPrice: 34500 + index * 10,
      status: index >= 100 ? 'CANCELLED' : 'ACTIVE',
      cancelledAt: index >= 100 ? new Date().toISOString() : null,
      cancelledByUserId: index >= 100 ? admin.id : null
    });
    generatedFlights.push(flight);
  }
  await Fare.bulkCreate(generatedFlights.flatMap((flight) => [
    { flightId: flight.id, classId: economy.id, price: flight.economyPrice, capacity: flight.economySeats },
    { flightId: flight.id, classId: firstClass.id, price: flight.firstClassPrice, capacity: flight.firstClassSeats }
  ]));

  const departureRows = generatedFlights.flatMap((flight) => seedDepartureDates(
    flight.availableFrom,
    flight.availableTo,
    flight.daysOfWeek.split(',').map(Number)
  ).map((date) => ({
    flightId: flight.id,
    date,
    status: flight.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED'
  })));
  await Departure.bulkCreate(departureRows);
  const soldFlight = generatedFlights[0];
  const multiSaleFlight = generatedFlights[1];
  const soldFutureDates = seedDepartureDates(from, to, soldFlight.daysOfWeek.split(',').map(Number))
    .filter((date) => date >= dateOffset(1));
  const multiSaleFutureDates = seedDepartureDates(from, to, multiSaleFlight.daysOfWeek.split(',').map(Number))
    .filter((date) => date >= dateOffset(1));
  const futureDate = soldFutureDates[0];
  const otherFutureDates = multiSaleFutureDates.slice(0, 3);
  const soldDeparture = await Departure.findOne({ where: { flightId: soldFlight.id, date: futureDate } });
  const soldCount = 5;
  await soldDeparture!.update({ soldEconomy: soldCount });
  const confirmedPurchase = await Purchase.create({
    passengerId: passenger.id, status: 'CONFIRMED', total: soldCount * Number(soldFlight.economyPrice)
  });
  await Ticket.bulkCreate(Array.from({ length: soldCount }, () => ({
    purchaseId: confirmedPurchase.id,
    departureId: soldDeparture!.id,
    classId: economy.id,
    price: soldFlight.economyPrice
  })));
  for (const date of otherFutureDates) {
    const departure = await Departure.findOne({ where: { flightId: multiSaleFlight.id, date } });
    if (departure) {
      await departure.update({ soldEconomy: 1 });
      const purchase = await Purchase.create({ passengerId: passenger.id, status: 'CONFIRMED', total: multiSaleFlight.economyPrice });
      await Ticket.create({
        purchaseId: purchase.id, departureId: departure.id, classId: economy.id, price: multiSaleFlight.economyPrice
      });
    }
  }
  await Payment.create({ purchaseId: confirmedPurchase.id, amount: confirmedPurchase.total, status: 'PAID', paidAt: new Date() });
  await Invoice.create({
    purchaseId: confirmedPurchase.id, number: 'DEMO-0001', total: confirmedPurchase.total, issuedAt: new Date()
  });
  await FlightChangeHistory.bulkCreate(generatedFlights.slice(0, 3).map((flight) => ({
    flightId: flight.id,
    changedAt: new Date(),
    userId: admin.id,
    field: 'economyPrice',
    previousValue: String(Number(flight.economyPrice) - 100),
    newValue: String(flight.economyPrice)
  })));
  await Cancellation.bulkCreate(generatedFlights.slice(100).map((flight) => ({
    flightId: flight.id, cancelledAt: new Date(), userId: admin.id
  })));
  await ensureExampleFlightDepartures();
}

export async function resetDatabase(options: { seedDemoFlights?: boolean } = {}) {
  await seedDatabase(options);
}
