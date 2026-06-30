import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import logger from '../utils/logger';

export class SocketService {
  private static io: SocketServer;

  static init(server: HttpServer) {
    this.io = new SocketServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket) => {
      logger.info(`New client connected: ${socket.id}`);

      socket.on('join', (deviceId: string) => {
        socket.join(deviceId);
        logger.info(`Socket ${socket.id} joined room: ${deviceId}`);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });
  }

  static emitPaymentReceived(deviceId: string, payment: Record<string, unknown>) {
    if (!this.io) {
      logger.error('Socket.io not initialized');
      return;
    }
    this.io.to(deviceId).emit('payment:received', payment);
    logger.info(`Emitted payment:received to room: ${deviceId}`);
  }
}
