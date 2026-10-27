import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import logger from '../utils/logger.js';

export class DeviceController {
  static async register(req: FastifyRequest, reply: FastifyReply) {
    const {
      uuid,
      phoneNumber,
      alias,
      deviceName,
      brand,
      model,
      androidVersion,
      pushToken
    } = req.body as any;
    const userId = (req as any).user?.id;

    try {
      const device = await prisma.device.upsert({
        where: { uuid },
        update: {
          lastConnectedAt: new Date(),
          userId: userId || undefined,
          phoneNumber: phoneNumber || undefined,
          alias: alias || undefined,
          deviceName: deviceName || undefined,
          brand: brand || undefined,
          model: model || undefined,
          androidVersion: androidVersion || undefined,
          pushToken: pushToken || undefined,
        },
        create: {
          uuid,
          lastConnectedAt: new Date(),
          userId: userId || undefined,
          phoneNumber,
          alias,
          deviceName,
          brand,
          model,
          androidVersion,
          pushToken,
        },
      });
      return reply.status(201).send(device);
    } catch (error) {
      logger.error('Error registering device:', error);
      return reply.status(500).send({ error: 'No se pudo registrar el dispositivo. Inténtalo de nuevo.' });
    }
  }

  static async getDevices(req: FastifyRequest, reply: FastifyReply) {
    try {
      const devices = await prisma.device.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(devices);
    } catch (error) {
      logger.error('Error getting devices:', error);
      return reply.status(500).send({ error: 'No se pudieron obtener los dispositivos.' });
    }
  }

  static async adminRegisterDevice(req: FastifyRequest, reply: FastifyReply) {
    const { uuid, alias, phoneNumber } = req.body as any;
    try {
      const device = await prisma.device.upsert({
        where: { uuid },
        update: {
          alias,
          phoneNumber,
          isApproved: true,
          status: 'ACTIVE'
        },
        create: {
          uuid,
          alias,
          phoneNumber,
          isApproved: true,
          status: 'ACTIVE'
        }
      });
      return reply.status(201).send(device);
    } catch (error) {
      logger.error('Error admin registering device:', error);
      return reply.status(500).send({ error: 'Error al registrar el dispositivo por el administrador.' });
    }
  }

  static async getStatus(req: FastifyRequest, reply: FastifyReply) {
    const { uuid } = req.params as { uuid: string };
    try {
      const device = await prisma.device.findUnique({
        where: { uuid },
      });
      if (!device) return reply.status(404).send({ error: 'Dispositivo no encontrado en el sistema.' });
      return reply.send({
        isApproved: device.isApproved,
        status: device.status,
        alias: device.alias,
        phoneNumber: device.phoneNumber
      });
    } catch (error) {
      logger.error('Error getting device status:', error);
      return reply.status(500).send({ error: 'No se pudo verificar el estado del dispositivo.' });
    }
  }

  static async unapprove(req: FastifyRequest, reply: FastifyReply) {
    const { uuid } = (req.body as any) || (req.params as any) || {};
    try {
      await prisma.device.update({
        where: { uuid },
        data: { isApproved: false }
      });
      return reply.send({ message: 'Dispositivo desaprobado correctamente.' });
    } catch (error) {
      logger.error('Error unapproving device:', error);
      return reply.status(404).send({ error: 'Dispositivo no encontrado.' });
    }
  }

  static async updateDevice(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const { isApproved, alias, status } = req.body as any;
    logger.info(`Updating device ${id} with:`, { isApproved, alias, status });
    try {
      const device = await prisma.device.update({
        where: { id },
        data: {
          isApproved: isApproved !== undefined ? isApproved : undefined,
          alias: alias !== undefined ? alias : undefined,
          status: status !== undefined ? status : undefined,
        }
      });
      logger.info(`Device ${id} updated successfully`);
      return reply.send(device);
    } catch (error) {
      logger.error('Error updating device:', error);
      return reply.status(404).send({ error: 'Dispositivo no encontrado para actualizar.' });
    }
  }

  static async deleteDevice(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    try {
      await prisma.device.delete({ where: { id } });
      return reply.status(204).send();
    } catch (error) {
      logger.error('Error deleting device:', error);
      return reply.status(404).send({ error: 'Dispositivo no encontrado para eliminar.' });
    }
  }
}
