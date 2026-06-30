import http from 'http';
import app from './app';
import { SocketService } from './services/socket.service';
import logger from './utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize Socket.io
SocketService.init(server);

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
  logger.info(`Swagger docs available at http://localhost:${port}/docs`);
});
