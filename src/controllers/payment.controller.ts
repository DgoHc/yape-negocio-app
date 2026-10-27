import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import { SocketService } from '../services/socket.service.js';
import logger from '../utils/logger.js';

export class PaymentController {
  static async create(req: FastifyRequest, reply: FastifyReply) {
    const { externalId, deviceId, amount, currency, senderName, rawText, operationNumber } = req.body as any;
    try {
      let device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device) {
        device = await prisma.device.findUnique({ where: { uuid: deviceId } });
      }

      if (!device) {
        return reply.status(404).send({ error: 'Dispositivo no registrado en el sistema.' });
      }

      const payment = await prisma.payment.create({
        data: {
          externalId,
          amount,
          currency,
          senderName,
          rawText,
          deviceId: device.id,
          operationNumber,
          userId: device.userId
        }
      });

      SocketService.emitPaymentReceived(device.id, payment);
      if (deviceId !== device.id) {
        SocketService.emitPaymentReceived(deviceId, payment);
      }

      return reply.status(201).send(payment);
    } catch (error) {
      logger.error('Error creating payment:', error);
      return reply.status(500).send({ error: 'No se pudo registrar el pago. Inténtalo de nuevo.' });
    }
  }

  static async getPayments(req: FastifyRequest, reply: FastifyReply) {
    const { deviceId } = req.query as { deviceId?: string };
    const userId = (req as any).user?.id;

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const payments = await prisma.payment.findMany({
        where: {
          userId,
          deviceId: deviceId || undefined,
          ...(user?.historyLastClearedAt ? { createdAt: { gt: user.historyLastClearedAt } } : {})
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(payments);
    } catch (error) {
      logger.error('Error getting payments:', error);
      return reply.send([]);
    }
  }

  static async clearHistory(req: FastifyRequest, reply: FastifyReply) {
    const userId = (req as any).user?.id;
    try {
      const now = new Date();
      await prisma.user.update({
        where: { id: userId },
        data: { historyLastClearedAt: now }
      });
      return reply.send({ message: 'Historial de pagos limpiado en el servidor exitosamente.' });
    } catch (error) {
      logger.error('Error clearing payment history on server:', error);
      return reply.send({ message: 'Historial limpiado.' });
    }
  }
}
