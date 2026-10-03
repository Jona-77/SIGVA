import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

type AuthUser = {
  id: number;
  email: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getTokenFromHeader(headerValue: string | undefined) {
  if (!headerValue) {
    return null;
  }
  const [schema, token] = headerValue.split(' ');
  if (schema !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: 'Sesión no válida o expirada.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: number; role: string; email: string };
    req.user = { id: decoded.userId, email: decoded.email, role: decoded.role };
    return next();
  } catch {
    return res.status(401).json({ message: 'Sesión no válida o expirada.' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Sesión no válida o expirada.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tiene permisos suficientes.' });
    }
    return next();
  };
}
