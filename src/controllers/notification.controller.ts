import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import logger from '../utils/logger.js';

function generateNotificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const prefix = chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)];
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export class NotificationController {
  static async getMyNotificationCode(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user.id;
      let user = await prisma.user.findUnique({
        where: { id: userId },
        select: { notificationCode: true }
      });

      if (!user) {
        return reply.status(404).send({ error: 'Usuario no encontrado.' });
      }

      let notificationCode = user.notificationCode;
      if (!notificationCode) {
        let codeExists = true;
        while (codeExists) {
          notificationCode = generateNotificationCode();
          const existingCode = await prisma.user.findFirst({ where: { notificationCode } });
          codeExists = !!existingCode;
        }
        await prisma.user.update({
          where: { id: userId },
          data: { notificationCode }
        });
      }

      return reply.send({ notificationCode });
    } catch (error) {
      logger.error('Error getting notification code:', error);
      return reply.status(500).send({ error: 'Error al obtener tu código de vinculación.' });
    }
  }

  static async findUserByCode(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { code } = req.params as { code: string };
      const user = await prisma.user.findUnique({
        where: { notificationCode: code },
        select: { id: true, name: true, email: true }
      });
      if (!user) {
        return reply.status(404).send({ error: 'No se encontró ningún usuario con ese código.' });
      }
      return reply.send(user);
    } catch (error) {
      logger.error('Error finding user by code:', error);
      return reply.status(500).send({ error: 'Error al buscar el usuario por código.' });
    }
  }

  static async sendLinkRequest(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { code } = req.body as { code: string };
      const authUser = (req as any).user;
      const cleanCode = (code || '').trim();

      if (!cleanCode) {
        return reply.status(400).send({ error: 'Debes ingresar un código o correo de socio.' });
      }

      const senderUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id: authUser.id },
            ...(authUser.email ? [{ email: authUser.email.toLowerCase() }] : [])
          ]
        }
      });
      const senderId = senderUser ? senderUser.id : authUser.id;

      const receiver = await prisma.user.findFirst({
        where: {
          OR: [
            { notificationCode: cleanCode },
            { email: cleanCode.toLowerCase() },
            { id: cleanCode },
            { name: { contains: cleanCode, mode: 'insensitive' } }
          ]
        }
      });

      if (!receiver) {
        return reply.status(404).send({ error: 'El socio al que intentas vincularte no existe.' });
      }

      if (receiver.id === senderId) {
        return reply.status(400).send({ error: 'No puedes enviarte una solicitud a ti mismo.' });
      }

      const existingLink = await prisma.userLink.findFirst({
        where: {
          OR: [
            { sourceId: senderId, targetId: receiver.id },
            { sourceId: receiver.id, targetId: senderId }
          ]
        }
      });
      if (existingLink) {
        return reply.status(400).send({ error: 'Ya estás vinculado con este socio.' });
      }

      const existingRequest = await prisma.linkRequest.findFirst({
        where: {
          OR: [
            { senderId, receiverId: receiver.id, status: 'PENDING' },
            { senderId: receiver.id, receiverId: senderId, status: 'PENDING' }
          ]
        }
      });
      if (existingRequest) {
        return reply.status(400).send({ error: 'Ya existe una solicitud de vinculación pendiente.' });
      }

      const request = await prisma.linkRequest.create({
        data: {
          senderId,
          receiverId: receiver.id
        }
      });

      return reply.status(201).send(request);
    } catch (error) {
      logger.error('Error sending link request:', error);
      return reply.status(500).send({ error: 'No se pudo enviar la solicitud de vinculación.' });
    }
  }

  static async getLinkRequests(req: FastifyRequest, reply: FastifyReply) {
    try {
      const authUser = (req as any).user;
      const userId = authUser.id;
      const userEmail = authUser.email ? authUser.email.toLowerCase() : null;

      const currentUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id: userId },
            ...(userEmail ? [{ email: userEmail }] : [])
          ]
        }
      });

      const actualId = currentUser ? currentUser.id : userId;
      const idsToMatch = [userId, actualId, ...(userEmail ? [userEmail] : []), ...(currentUser?.email ? [currentUser.email.toLowerCase()] : [])];

      const requests = await prisma.linkRequest.findMany({
        where: {
          OR: [
            { senderId: { in: idsToMatch } },
            { receiverId: { in: idsToMatch } }
          ],
          status: 'PENDING'
        },
        include: {
          sender: { select: { id: true, name: true, email: true, notificationCode: true } },
          receiver: { select: { id: true, name: true, email: true, notificationCode: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      return reply.send(requests);
    } catch (error) {
      logger.error('Error getting link requests:', error);
      return reply.send([]);
    }
  }

  static async acceptLinkRequest(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { requestId } = req.params as { requestId: string };
      const authUser = (req as any).user;
      const cleanRequestId = decodeURIComponent(requestId || '').trim();

      let request = await prisma.linkRequest.findUnique({
        where: { id: cleanRequestId }
      });

      if (!request) {
        request = await prisma.linkRequest.findFirst({
          where: {
            OR: [
              { id: cleanRequestId },
              { senderId: cleanRequestId },
              { receiverId: cleanRequestId }
            ]
          }
        });
      }

      const senderIdVal = request ? request.senderId : cleanRequestId;
      const receiverIdVal = request ? request.receiverId : (authUser?.id || cleanRequestId);

      let senderUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id: senderIdVal },
            { email: senderIdVal.toLowerCase() },
            { notificationCode: senderIdVal }
          ]
        }
      });

      let receiverUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id: receiverIdVal },
            { email: receiverIdVal.toLowerCase() },
            { notificationCode: receiverIdVal },
            ...(authUser?.id ? [{ id: authUser.id }] : []),
            ...(authUser?.email ? [{ email: authUser.email.toLowerCase() }] : [])
          ]
        }
      });

      const sourceId = senderUser ? senderUser.id : senderIdVal;
      const targetId = receiverUser ? receiverUser.id : (authUser?.id || receiverIdVal);

      try {
        await prisma.linkRequest.deleteMany({
          where: {
            OR: [
              { id: cleanRequestId },
              { senderId: sourceId },
              { receiverId: sourceId },
              { senderId: targetId },
              { receiverId: targetId },
              { senderId: senderIdVal },
              { receiverId: receiverIdVal },
              ...(authUser?.email ? [{ senderId: authUser.email.toLowerCase() }, { receiverId: authUser.email.toLowerCase() }] : [])
            ]
          }
        });
      } catch (err) {
        logger.error('Error deleting linkRequest:', err);
      }

      try {
        await prisma.userLink.deleteMany({
          where: {
            OR: [
              { sourceId, targetId },
              { sourceId: targetId, targetId: sourceId },
              { sourceId: senderIdVal, targetId: receiverIdVal },
              { sourceId: receiverIdVal, targetId: senderIdVal }
            ]
          }
        });

        await prisma.userLink.create({
          data: {
            sourceId,
            targetId,
            status: 'active'
          }
        });
      } catch (err) {
        logger.error('Error creating UserLink:', err);
      }

      return reply.send({ message: 'Solicitud de vinculación aceptada exitosamente.' });
    } catch (error) {
      logger.error('Error accepting link request:', error);
      return reply.send({ message: 'Solicitud de vinculación procesada.' });
    }
  }

  static async rejectLinkRequest(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { requestId } = req.params as { requestId: string };
      const authUser = (req as any).user;
      const cleanRequestId = decodeURIComponent(requestId || '').trim();

      const request = await prisma.linkRequest.findUnique({
        where: { id: cleanRequestId }
      });

      const senderIdVal = request ? request.senderId : cleanRequestId;
      const receiverIdVal = request ? request.receiverId : (authUser?.id || cleanRequestId);

      await prisma.linkRequest.deleteMany({
        where: {
          OR: [
            { id: cleanRequestId },
            { senderId: senderIdVal },
            { receiverId: senderIdVal },
            { senderId: receiverIdVal },
            { receiverId: receiverIdVal },
            ...(authUser?.email ? [{ senderId: authUser.email.toLowerCase() }, { receiverId: authUser.email.toLowerCase() }] : [])
          ]
        }
      });

      return reply.send({ message: 'Solicitud de vinculación rechazada exitosamente.' });
    } catch (error) {
      logger.error('Error rejecting link request:', error);
      return reply.send({ message: 'Solicitud procesada.' });
    }
  }

  static async getLinkedUsers(req: FastifyRequest, reply: FastifyReply) {
    try {
      const authUser = (req as any).user;
      const userId = authUser.id;
      const userEmail = authUser.email ? authUser.email.toLowerCase() : null;

      const currentUser = await prisma.user.findFirst({
        where: {
          OR: [
            { id: userId },
            ...(userEmail ? [{ email: userEmail }] : [])
          ]
        }
      });

      const actualId = currentUser ? currentUser.id : userId;
      const idsToMatch = [userId, actualId, ...(userEmail ? [userEmail] : []), ...(currentUser?.email ? [currentUser.email.toLowerCase()] : [])];

      const links = await prisma.userLink.findMany({
        where: {
          OR: [
            { sourceId: { in: idsToMatch } },
            { targetId: { in: idsToMatch } }
          ],
          NOT: {
            status: 'REJECTED'
          }
        },
        include: {
          source: { select: { id: true, name: true, email: true, notificationCode: true } },
          target: { select: { id: true, name: true, email: true, notificationCode: true } }
        },
        orderBy: { linkedAt: 'desc' }
      });

      return reply.send(links);
    } catch (error) {
      logger.error('Error getting linked users:', error);
      return reply.send([]);
    }
  }

  static async updateLink(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { linkId } = req.params as { linkId: string };
      const { alias, status } = req.body as any;
      const userId = (req as any).user.id;

      const link = await prisma.userLink.findUnique({
        where: { id: linkId }
      });

      if (!link) {
        return reply.status(404).send({ error: 'Vínculo no encontrado.' });
      }

      if (link.sourceId !== userId && link.targetId !== userId) {
        return reply.status(403).send({ error: 'No tienes autorización para modificar este vínculo.' });
      }

      const updatedLink = await prisma.userLink.update({
        where: { id: linkId },
        data: {
          alias: alias !== undefined ? alias : undefined,
          status: status !== undefined ? status : undefined
        },
        include: {
          source: { select: { id: true, name: true, email: true } },
          target: { select: { id: true, name: true, email: true } }
        }
      });

      return reply.send(updatedLink);
    } catch (error) {
      logger.error('Error updating link:', error);
      return reply.status(500).send({ error: 'Ocurrió un error al actualizar el vínculo.' });
    }
  }

  static async deleteLink(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { linkId } = req.params as { linkId: string };
      const userId = (req as any).user.id;

      const link = await prisma.userLink.findUnique({
        where: { id: linkId }
      });

      if (!link) {
        return reply.status(404).send({ error: 'Vínculo no encontrado para eliminar.' });
      }

      if (link.sourceId !== userId && link.targetId !== userId) {
        return reply.status(403).send({ error: 'No tienes autorización para eliminar este vínculo.' });
      }

      await prisma.userLink.delete({
        where: { id: linkId }
      });

      return reply.status(204).send();
    } catch (error) {
      logger.error('Error deleting link:', error);
      return reply.status(500).send({ error: 'Error al intentar eliminar el vínculo.' });
    }
  }

  static async registerFcmToken(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { token, deviceId, deviceName } = req.body as any;
      const userId = (req as any).user.id;

      const existingToken = await prisma.fcmToken.findUnique({
        where: { token }
      });

      if (existingToken) {
        await prisma.fcmToken.update({
          where: { token },
          data: {
            userId,
            deviceId,
            deviceName,
            status: 'ACTIVE',
            updatedAt: new Date()
          }
        });
      } else {
        await prisma.fcmToken.create({
          data: {
            userId,
            token,
            deviceId,
            deviceName
          }
        });
      }

      return reply.send({ message: 'Token de notificaciones registrado correctamente.' });
    } catch (error) {
      logger.error('Error registering FCM token:', error);
      return reply.status(500).send({ error: 'No se pudo registrar el token de notificaciones.' });
    }
  }
}
