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
        // Auto-registrar dispositivo para nunca perder un pago
        device = await prisma.device.create({
          data: {
            uuid: deviceId,
            userId: authUserId || undefined,
            lastConnectedAt: new Date(),
            status: 'ACTIVE',
            isApproved: true,
          }
        });
        logger.info(`Dispositivo ${deviceId} auto-registrado en create payment para usuario ${authUserId}`);
      }

      // Reasignar dispositivo al usuario autenticado si es necesario
      if (authUserId && device.userId !== authUserId) {
        await prisma.device.update({
          where: { id: device.id },
          data: { userId: authUserId }
        });
        device.userId = authUserId;
      }

      // El usuario autenticado SIEMPRE tiene prioridad de propiedad sobre el dispositivo
      const targetUserId = authUserId || device.userId || null;

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

      // Emitir en tiempo real a los socios vinculados activos (status: ACTIVE)
      if (targetUserId) {
        try {
          const activeLinks = await prisma.userLink.findMany({
            where: {
              OR: [
                { sourceId: targetUserId },
                { targetId: targetUserId }
              ],
              status: 'ACTIVE'
            },
            include: {
              source: { select: { id: true, name: true } },
              target: { select: { id: true, name: true } }
            }
          });

          for (const link of activeLinks) {
            const isSource = link.sourceId === targetUserId;
            const partnerId = isSource ? link.targetId : link.sourceId;
            const sourceUser = isSource ? link.source : link.target;

            const partnerDevices = await prisma.device.findMany({
              where: { userId: partnerId },
              select: { id: true, uuid: true }
            });

            const partnerPaymentPayload = {
              ...payment,
              isLinked: true,
              linkedUserName: link.alias || sourceUser.name || 'Socio Vinculado'
            };

            for (const pDev of partnerDevices) {
              SocketService.emitPaymentReceived(pDev.id, partnerPaymentPayload);
              if (pDev.uuid) {
                SocketService.emitPaymentReceived(pDev.uuid, partnerPaymentPayload);
              }
            }
          }
        } catch (linkError) {
          logger.error('Error emitiendo pago a socios vinculados:', linkError);
        }
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
        let specificDevice = await prisma.device.findFirst({
          where: { OR: [{ id: deviceId }, { uuid: deviceId }] },
          select: { id: true, userId: true }
        });

        // Si el dispositivo no existe aún y el usuario está autenticado, lo auto-creamos
        if (!specificDevice && userId) {
          const newDev = await prisma.device.create({
            data: {
              uuid: deviceId,
              userId: userId,
              lastConnectedAt: new Date(),
              status: 'ACTIVE',
              isApproved: true,
            }
          });
          specificDevice = { id: newDev.id, userId: newDev.userId };
        }

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

      // Filtro estricto para evitar filtración de pagos entre usuarios no vinculados:
      let whereClause: any;
      if (userId) {
        whereClause = {
          OR: [
            { userId },
            ...(linkedUserIds.length > 0 ? [{ userId: { in: linkedUserIds } }] : []),
            ...(deviceIds.length > 0 ? [{ userId: null, deviceId: { in: deviceIds } }] : [])
          ]
        };
      } else if (deviceIds.length > 0) {
        whereClause = {
          userId: null,
          deviceId: { in: deviceIds }
        };
      } else {
        return reply.send([]);
      }

      const payments = await prisma.payment.findMany({
        where: whereClause,
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
        let specificDevice = await prisma.device.findFirst({
          where: { OR: [{ id: deviceId }, { uuid: deviceId }] },
          select: { id: true, userId: true }
        });

        // Si el dispositivo no existe aún y el usuario está autenticado, lo auto-creamos
        if (!specificDevice && userId) {
          const newDev = await prisma.device.create({
            data: {
              uuid: deviceId,
              userId: userId,
              lastConnectedAt: new Date(),
              status: 'ACTIVE',
              isApproved: true,
            }
          });
          specificDevice = { id: newDev.id, userId: newDev.userId };
        }

        if (specificDevice && !deviceIds.includes(specificDevice.id)) {
          deviceIds.push(specificDevice.id);
        }
      }

      let deletedCount = 0;
      if (userId) {
        const result = await prisma.payment.deleteMany({
          where: {
            OR: [
              { userId },
              ...(deviceIds.length > 0 ? [{ userId: null, deviceId: { in: deviceIds } }] : [])
            ]
          }
        });
        deletedCount = result.count;
      } else if (deviceIds.length > 0) {
        const result = await prisma.payment.deleteMany({
          where: {
            userId: null,
            deviceId: { in: deviceIds }
          }
        });
        deletedCount = result.count;
      }

      logger.info(`>>> [HISTORIAL] Se eliminaron ${deletedCount} pagos de PostgreSQL para userId ${userId}`);

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
