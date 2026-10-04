import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { Session } from './db/index.js';

type AuthUser = {
  id: number;
  email: string;
  role: string;
  sessionId: string;
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

  void authenticate(token, req, res, next);
}

async function authenticate(token: string, req: Request, res: Response, next: NextFunction) {
  let decoded: jwt.JwtPayload;
  try {
    const value = jwt.verify(token, config.jwtSecret);
    if (typeof value === 'string') {
      return res.status(401).json({ message: 'Sesión no válida o expirada.' });
    }
    decoded = value;
  } catch {
    return res.status(401).json({ message: 'Sesión no válida o expirada.' });
  }

  if (typeof decoded.userId !== 'number' || typeof decoded.email !== 'string'
    || typeof decoded.role !== 'string' || typeof decoded.sessionId !== 'string') {
    return res.status(401).json({ message: 'Sesión no válida o expirada.' });
  }

  try {
    const session = await Session.findByPk(decoded.sessionId);
    const now = new Date();
    if (!session || session.get('revoked') || now.getTime() - new Date(session.get('lastActivity') as Date).getTime()
      > config.sessionTimeoutMinutes * 60_000) {
      return res.status(401).json({ message: 'Sesión no válida o expirada.' });
    }
    await session.update({ lastActivity: now });
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      sessionId: decoded.sessionId
    };
    return next();
  } catch (error) {
    return next(error);
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
