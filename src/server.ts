import 'dotenv/config';
import app from './app.js';
import { SocketService } from './services/socket.service.js';
import logger from './utils/logger.js';

const port = Number(process.env.PORT) || 3000;

const start = async () => {
  try {
    // 1. Iniciar servidor Fastify
    await app.listen({ port, host: '0.0.0.0' });

    // 2. Inicializar Socket.io usando el servidor interno de Fastify
    SocketService.init(app.server);

    logger.info(`🚀 Servidor ELITE corriendo en http://localhost:${port}`);
    logger.info(`📜 Documentación Swagger en http://localhost:${port}/docs`);
  } catch (err) {
    logger.error('Error al arrancar el servidor:', err);
    process.exit(1);
  }
};

start();
