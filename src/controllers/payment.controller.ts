import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import { SocketService } from '../services/socket.service.js';
import logger from '../utils/logger.js';

export class PaymentController {
  static async create(req: FastifyRequest, reply: FastifyReply) {
    const { externalId, deviceId, amount, currency, senderName, rawText, operationNumber } = req.body as any;
    const authUserId = (req as any).user?.id;

    try {
      let device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device) {
        device = await prisma.device.findUnique({ where: { uuid: deviceId } });
      }

      if (!device) {
        return reply.status(404).send({ error: 'Dispositivo no registrado en el sistema.' });
      }

      if (!device.userId && authUserId) {
        await prisma.device.update({
          where: { id: device.id },
          data: { userId: authUserId }
        });
        device.userId = authUserId;
      }

      const targetUserId = device.userId || authUserId || null;

      const payment = await prisma.payment.create({
        data: {
          externalId,
          amount,
          currency,
          senderName,
          rawText,
          deviceId: device.id,
          operationNumber,
          userId: targetUserId
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
    const { deviceId } = (req.query as { deviceId?: string }) || {};
    const userId = (req as any).user?.id;

    try {
      const userDevices = userId
        ? await prisma.device.findMany({ where: { userId }, select: { id: true } })
        : [];
      const deviceIds: string[] = userDevices.map(d => d.id);

      if (deviceId) {
        const specificDevice = await prisma.device.findFirst({
          where: { OR: [{ id: deviceId }, { uuid: deviceId }] },
          select: { id: true }
        });
        if (specificDevice && !deviceIds.includes(specificDevice.id)) {
          deviceIds.push(specificDevice.id);
        }
      }

      // Obtener usuarios socios vinculados activos (UserLink)
      const linkedUsersMap = new Map<string, { name: string; alias?: string | null }>();
      const linkedUserIds: string[] = [];

      if (userId) {
        const activeLinks = await prisma.userLink.findMany({
          where: {
            OR: [
              { sourceId: userId },
              { targetId: userId }
            ],
            status: 'ACTIVE'
          },
          include: {
            source: { select: { id: true, name: true, phone: true } },
            target: { select: { id: true, name: true, phone: true } }
          }
        });

        for (const link of activeLinks) {
          const isSource = link.sourceId === userId;
          const partner = isSource ? link.target : link.source;
          if (partner && partner.id !== userId) {
            linkedUserIds.push(partner.id);
            linkedUsersMap.set(partner.id, {
              name: partner.name,
              alias: link.alias || partner.name
            });
          }
        }
      }

      const payments = await prisma.payment.findMany({
        where: {
          OR: [
            ...(userId ? [{ userId }] : []),
            ...(deviceIds.length > 0 ? [{ deviceId: { in: deviceIds } }] : []),
            ...(linkedUserIds.length > 0 ? [{ userId: { in: linkedUserIds } }] : [])
          ]
        },
        include: {
          user: { select: { id: true, name: true } },
          device: { select: { id: true, alias: true, deviceName: true } }
        },
        orderBy: { createdAt: 'desc' },
      });

      const formattedPayments = payments.map(p => {
        const isFromPartner = !!(p.userId && p.userId !== userId && linkedUserIds.includes(p.userId));
        const partnerInfo = isFromPartner && p.userId ? linkedUsersMap.get(p.userId) : null;

        return {
          id: p.id,
          externalId: p.externalId,
          amount: p.amount,
          currency: p.currency,
          senderName: p.senderName,
          rawText: p.rawText,
          operationNumber: p.operationNumber,
          deviceId: p.deviceId,
          createdAt: p.createdAt,
          isLinked: isFromPartner,
          linkedUserName: isFromPartner ? (partnerInfo?.alias || partnerInfo?.name || p.device?.alias || 'Socio Vinculado') : null
        };
      });

      return reply.send(formattedPayments);
    } catch (error) {
      logger.error('Error getting payments:', error);
      return reply.send([]);
    }
  }

  static async clearHistory(req: FastifyRequest, reply: FastifyReply) {
    const userId = (req as any).user?.id;
    const { deviceId } = (req.query as { deviceId?: string }) || (req.body as any) || {};

    try {
      const userDevices = userId
        ? await prisma.device.findMany({ where: { userId }, select: { id: true } })
        : [];
      const deviceIds: string[] = userDevices.map(d => d.id);

      if (deviceId) {
        const specificDevice = await prisma.device.findFirst({
          where: { OR: [{ id: deviceId }, { uuid: deviceId }] },
          select: { id: true }
        });
        if (specificDevice && !deviceIds.includes(specificDevice.id)) {
          deviceIds.push(specificDevice.id);
        }
      }

      let deletedCount = 0;
      if (userId || deviceIds.length > 0) {
        const result = await prisma.payment.deleteMany({
          where: {
            OR: [
              ...(userId ? [{ userId }] : []),
              ...(deviceIds.length > 0 ? [{ deviceId: { in: deviceIds } }] : [])
            ]
          }
        });
        deletedCount = result.count;
      }

      logger.info(`>>> [HISTORIAL] Se eliminaron ${deletedCount} pagos de PostgreSQL para userId ${userId} y dispositivos: ${JSON.stringify(deviceIds)}`);

      return reply.send({
        message: 'Historial de pagos limpiado en el servidor exitosamente.',
        deletedCount
      });
    } catch (error) {
      logger.error('Error clearing payment history on server:', error);
      return reply.status(500).send({ error: 'No se pudo limpiar el historial en el servidor.' });
    }
  }
}
