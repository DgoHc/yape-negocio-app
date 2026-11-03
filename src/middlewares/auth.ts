import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import logger from '../utils/logger.js';

interface UserPayload {
  id: string;
  email?: string;
  username?: string;
  role?: string;
}

export const authenticateJWT = async (req: FastifyRequest, reply: FastifyReply) => {
  // 1. Verificar si se proporciona la Master Key (Acceso administrativo seguro)
  const masterKey = process.env.MASTER_KEY;
  const providedKey = req.headers['x-master-key'];

  if (masterKey && typeof providedKey === 'string' && masterKey.length > 0) {
    const masterBuf = Buffer.from(masterKey);
    const providedBuf = Buffer.from(providedKey);
    if (masterBuf.length === providedBuf.length && crypto.timingSafeEqual(masterBuf, providedBuf)) {
      (req as any).user = {
        id: 'system-master',
        username: 'MASTER_ADMIN',
        role: 'SUPER_ADMIN'
      };
      return;
    }
  }

  // 2. Autenticación JWT normal
  try {
    await req.jwtVerify();
  } catch (err) {
    logger.warn('Failed JWT authentication attempt');
    return reply.status(401).send({ error: 'Sesión expirada o no autorizada.' });
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as UserPayload;
    if (!user || !user.role || !roles.includes(user.role)) {
      return reply.status(403).send({ error: 'Acceso denegado: Permisos insuficientes.' });
    }
  };
};

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('🔴 [CRÍTICO]: JWT_SECRET no está configurada en producción.');
      throw new Error('JWT_SECRET env variable is required in production');
    }
    return 'secret';
  }
  return secret;
};
