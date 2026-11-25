import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import logger from '../utils/logger.js';

export class SocketService {
  private static io: SocketServer;

  static init(server: HttpServer) {
    this.io = new SocketServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket: any) => {
      logger.info(`New client connected: ${socket.id}`);

      socket.on('join', (deviceId: string) => {
        socket.join(deviceId);
        logger.info(`Socket ${socket.id} joined room: ${deviceId}`);
      });

      socket.on('join_user', (userId: string) => {
        if (userId) {
          socket.join(`user:${userId}`);
          logger.info(`Socket ${socket.id} joined user room: user:${userId}`);
        }
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

  static emitSubscriptionActivated(userId: string, payload: Record<string, unknown>) {
    if (!this.io || !userId) return;
    this.io.to(`user:${userId}`).emit('subscription:activated', payload);
    logger.info(`Emitted subscription:activated to user room: user:${userId}`);
  }
}
