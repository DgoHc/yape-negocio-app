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
      title: 'Yape Transporte API (Elite)',
      description: 'API de alto rendimiento para gestión de pagos Yape',
      version: '2.0.0',
    },
    servers: [{ url: 'http://localhost:3000' }],
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
    name: 'Yape Transporte API',
    version: '2.0.0',
    status: 'online',
    docs: '/docs'
  };
});

// 6. Registro de Rutas (Plugins)
await app.register(routes, { prefix: '/api' });

// 7. Manejo de Errores Global
app.setErrorHandler((error, request, reply) => {
  logger.error(error.stack);
  reply.status(500).send({ error: 'Ocurrió un error interno en el servidor.' });
});

export default app;
