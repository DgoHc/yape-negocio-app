import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import jwt from '@fastify/jwt';
import logger from './utils/logger.js';
import routes from './routes/index.js';
import { getJwtSecret } from './middlewares/auth.js';

const app: FastifyInstance = Fastify({
  logger: false, // Usamos nuestro propio logger (Winston)
});

// 1. Registro de Seguridad y CORS
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

await app.register(cors, {
  origin: '*',
});

// 2. Limitación de peticiones
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// 3. Autenticación JWT
await app.register(jwt, {
  secret: getJwtSecret(),
});

// 4. Configuración de Swagger (Documentación)
await app.register(swagger, {
  openapi: {
    info: {
      title: 'SonoPay API (Elite)',
      description: 'API de alto rendimiento para gestión de pagos SonoPay',
      version: '2.1.0',
    },
    servers: [{ url: 'https://api.novabytexrj.com' }],
  },
});

await app.register(swaggerUi, {
  routePrefix: '/docs',
});

// 5. Logging de peticiones
app.addHook('onRequest', async (request, reply) => {
  logger.info(`${request.method} ${request.url}`);
});

// Ruta raíz para verificación
app.get('/', async () => {
  return {
    name: 'SonoPay API',
    version: '2.1.0',
    status: 'online',
    docs: '/docs'
  };
});

// Rutas legales para aprobación de Culqi
app.get('/privacy', async (request, reply) => {
  reply.type('text/html').send('<h1>Política de Privacidad - SonoPay</h1><p>En SonoPay protegemos tus datos. Solo procesamos notificaciones de pago para lectura por voz.</p>');
});

app.get('/terms', async (request, reply) => {
  reply.type('text/html').send('<h1>Términos de Servicio - SonoPay</h1><p>Al usar SonoPay, aceptas que la app acceda a tus notificaciones de pago para convertirlas en audio.</p>');
});

// 6. Registro de Rutas (Plugins)
await app.register(routes, { prefix: '/api' });

// 7. Manejo de Errores Global
app.setErrorHandler((error, request, reply) => {
  logger.error(error instanceof Error ? error.stack : String(error));
  reply.status(500).send({ error: 'Ocurrió un error interno en el servidor.' });
});

export default app;
