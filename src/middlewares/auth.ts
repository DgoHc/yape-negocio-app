import { FastifyRequest, FastifyReply } from 'fastify';
import logger from '../utils/logger.js';

interface UserPayload {
  id: string;
  email?: string;
  username?: string;
  role?: string;
}

export const authenticateJWT = async (req: FastifyRequest, reply: FastifyReply) => {
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
    if (!user || (user.role && !roles.includes(user.role))) {
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
