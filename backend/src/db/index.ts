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
  declare history: CreationOptional<Array<Record<string, unknown>>>;
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
    type: DataTypes.STRING,
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
  history: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  }
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
    type: DataTypes.STRING,
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
  const existing = await Departure.findAll({
    where: { flightId: flight.id },
    attributes: ['date']
  });
  const existingDates = new Set(existing.map((departure) => departure.date));
  const missingDates = dates.filter((date) => !existingDates.has(date));
  if (missingDates.length > 0) {
    await Departure.bulkCreate(missingDates.map((date) => ({ flightId: flight.id, date })));
  }
}

export async function seedDatabase() {
  await sequelize.sync({ force: true });

  const [adminRole, employeeRole, passengerRole] = await Role.bulkCreate([
    { name: 'admin' },
    { name: 'employee' },
    { name: 'passenger' }
  ]);

  await User.create({
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

  await User.create({
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

  const airports = await Airport.findAll({ order: [['id', 'ASC']] });
  if (airports.length >= 2) {
    await Flight.create({
      flightNumber: 'AR1450',
      daysOfWeek: '1,5',
      departureTime: '08:30',
      arrivalTime: '09:45',
      originAirportId: airports[0].id,
      destinationAirportId: airports[1].id,
      availableFrom: '2026-11-01',
      availableTo: '2026-11-30',
      economySeats: 180,
      firstClassSeats: 20,
      economyPrice: 12500,
      firstClassPrice: 34500,
      status: 'ACTIVE'
    });
  }
  await ensureExampleFlightDepartures();
}

export async function resetDatabase() {
  await sequelize.sync({ force: true });
  await seedDatabase();
}
