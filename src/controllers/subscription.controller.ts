import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import logger from '../utils/logger.js';
import {
  SubscriptionValidatorService,
  normalizeNameTokens,
} from '../services/subscription-validator.service.js';

export class SubscriptionController {
  static async getPlansAndConfig(req: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await SubscriptionValidatorService.getOrCreateConfig();

      return reply.send({
        planDays: config.planDays,
        trialDays: 15,
        isMasterConfigured: Boolean(config.masterUserId || config.masterDeviceId),
        plans: [
          {
            id: 'basic',
            name: 'Plan Básico',
            price: config.basicPrice,
            days: config.planDays,
            badge: null,
            benefits: [
              'Anuncios por voz en tiempo real',
              'Detección automática en segundo plano',
              'Historial y reportes Excel',
              '1 Dispositivo principal',
            ],
          },
          {
            id: 'premium',
            name: 'Plan Premium',
            price: config.premiumPrice,
            days: config.planDays,
            badge: 'RECOMENDADO',
            benefits: [
              'Todo lo del Plan Básico',
              'Vinculación de múltiples socios en vivo',
              'Alertas automáticas por WhatsApp',
              'Soporte prioritario 24/7',
            ],
          },
        ],
        methods: {
          yape: {
            enabled: config.yapeEnabled,
            qrPayload: config.yapeQrPayload,
            phone: config.yapePhone,
            holderName: config.yapeHolderName,
          },
          plin: {
            enabled: config.plinEnabled && Boolean(config.plinQrPayload || config.plinPhone),
            qrPayload: config.plinQrPayload,
            phone: config.plinPhone,
            holderName: config.plinHolderName,
          },
          transfer: {
            enabled: config.bankEnabled && Boolean(config.bankAccount || config.bankCci),
            bankName: config.bankName,
            accountNumber: config.bankAccount,
            cci: config.bankCci,
            holderName: config.bankHolderName,
          },
        },
      });
    } catch (error) {
      logger.error('Error getting subscription config:', error);
      return reply.status(500).send({ error: 'No se pudo cargar la configuración de suscripciones.' });
    }
  }

  static async createOrder(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return reply.status(401).send({ error: 'Usuario no autenticado.' });

      const { plan, provider, payerName } = req.body as {
        plan: string;
        provider: string;
        payerName: string;
      };

      const cleanPlan = plan === 'premium' ? 'premium' : 'basic';
      const cleanProvider = ['YAPE', 'PLIN', 'TRANSFER'].includes((provider || '').toUpperCase())
        ? provider.toUpperCase()
        : 'YAPE';
      const cleanPayerName = (payerName || '').trim();

      const tokens = normalizeNameTokens(cleanPayerName);
      if (tokens.length < 2) {
        return reply.status(400).send({
          error: 'Ingresa tu Nombre y Apellido completos tal como figuran en tu cuenta.',
        });
      }

      const config = await SubscriptionValidatorService.getOrCreateConfig();
      const amount = cleanPlan === 'premium' ? config.premiumPrice : config.basicPrice;
      const days = config.planDays || 30;
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 minutos

      // Expirar órdenes previas abiertas del mismo usuario
      await prisma.subscriptionPayment.updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });

      const order = await prisma.subscriptionPayment.create({
        data: {
          userId,
          plan: cleanPlan,
          days,
          amount,
          currency: 'PEN',
          provider: cleanProvider,
          payerName: cleanPayerName,
          status: 'PENDING',
          expiresAt,
        },
      });

      // Verificar si la notificación ya llegó segundos antes de generar la orden
      const matched = await SubscriptionValidatorService.tryRetroactiveMatchForOrder(order.id);
      if (matched) {
        return reply.status(201).send({
          order: matched.order,
          activated: true,
          profile: matched.updatedUser,
        });
      }

      return reply.status(201).send({
        order,
        activated: false,
      });
    } catch (error) {
      logger.error('Error creating subscription order:', error);
      return reply.status(500).send({ error: 'No se pudo generar la orden de pago.' });
    }
  }

  static async getOrderStatus(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params as { id: string };

      let order = await prisma.subscriptionPayment.findUnique({ where: { id } });
      if (!order || order.userId !== userId) {
        return reply.status(404).send({ error: 'Orden de pago no encontrada.' });
      }

      if (order.status === 'PENDING') {
        const matched = await SubscriptionValidatorService.tryRetroactiveMatchForOrder(order.id);
        if (matched) {
          return reply.send({
            order: matched.order,
            activated: true,
            profile: matched.updatedUser,
          });
        }
        order = (await prisma.subscriptionPayment.findUnique({ where: { id } })) || order;
      }

      let profile = null;
      if (order.status === 'COMPLETED') {
        profile = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            businessType: true,
            notificationCode: true,
            isSubscribed: true,
            subscriptionPlan: true,
            trialEndDate: true,
            subscriptionStartDate: true,
            subscriptionEndDate: true,
          },
        });
      }

      return reply.send({
        order,
        activated: order.status === 'COMPLETED',
        profile,
      });
    } catch (error) {
      logger.error('Error checking order status:', error);
      return reply.status(500).send({ error: 'Error al consultar el estado del pago.' });
    }
  }

  static async getAdminConfig(req: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await SubscriptionValidatorService.getOrCreateConfig();
      const candidateUsers = await prisma.user.findMany({
        where: { NOT: { status: 'DELETED' } },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          devices: {
            select: {
              id: true,
              uuid: true,
              alias: true,
              deviceName: true,
              brand: true,
              model: true,
              lastConnectedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        config,
        candidates: candidateUsers,
      });
    } catch (error) {
      logger.error('Error getting admin validator config:', error);
      return reply.status(500).send({ error: 'No se pudo cargar la configuración del validador.' });
    }
  }

  static async updateAdminConfig(req: FastifyRequest, reply: FastifyReply) {
    try {
      await SubscriptionValidatorService.getOrCreateConfig();
      const body = (req.body as any) || {};

      const updated = await prisma.paymentValidatorConfig.update({
        where: { id: 'master' },
        data: {
          masterUserId: body.masterUserId !== undefined ? (body.masterUserId || null) : undefined,
          masterDeviceId: body.masterDeviceId !== undefined ? (body.masterDeviceId || null) : undefined,
          yapeEnabled: body.yapeEnabled !== undefined ? Boolean(body.yapeEnabled) : undefined,
          yapeQrPayload: body.yapeQrPayload !== undefined ? (body.yapeQrPayload || null) : undefined,
          yapePhone: body.yapePhone !== undefined ? (body.yapePhone || null) : undefined,
          yapeHolderName: body.yapeHolderName !== undefined ? (body.yapeHolderName || null) : undefined,
          plinEnabled: body.plinEnabled !== undefined ? Boolean(body.plinEnabled) : undefined,
          plinQrPayload: body.plinQrPayload !== undefined ? (body.plinQrPayload || null) : undefined,
          plinPhone: body.plinPhone !== undefined ? (body.plinPhone || null) : undefined,
          plinHolderName: body.plinHolderName !== undefined ? (body.plinHolderName || null) : undefined,
          bankEnabled: body.bankEnabled !== undefined ? Boolean(body.bankEnabled) : undefined,
          bankName: body.bankName !== undefined ? (body.bankName || null) : undefined,
          bankAccount: body.bankAccount !== undefined ? (body.bankAccount || null) : undefined,
          bankCci: body.bankCci !== undefined ? (body.bankCci || null) : undefined,
          bankHolderName: body.bankHolderName !== undefined ? (body.bankHolderName || null) : undefined,
          basicPrice: body.basicPrice !== undefined ? Number(body.basicPrice) : undefined,
          premiumPrice: body.premiumPrice !== undefined ? Number(body.premiumPrice) : undefined,
          planDays: body.planDays !== undefined ? Number(body.planDays) : undefined,
        },
      });

      logger.info(
        `>>> [ADMIN] Configuración del Validador Master actualizada. Cuenta Master: ${updated.masterUserId}, Celular Master: ${updated.masterDeviceId}`
      );
      return reply.send(updated);
    } catch (error) {
      logger.error('Error updating admin validator config:', error);
      return reply.status(500).send({ error: 'No se pudo actualizar la configuración del validador.' });
    }
  }

  static async getAdminOrders(req: FastifyRequest, reply: FastifyReply) {
    try {
      const orders = await prisma.subscriptionPayment.findMany({
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return reply.send(orders);
    } catch (error) {
      logger.error('Error getting admin subscription orders:', error);
      return reply.status(500).send({ error: 'Error al cargar las solicitudes de suscripción.' });
    }
  }

  static async approveAdminOrder(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const order = await prisma.subscriptionPayment.findUnique({ where: { id } });
      if (!order) {
        return reply.status(404).send({ error: 'Orden no encontrada.' });
      }
      if (order.status === 'COMPLETED') {
        return reply.status(400).send({ error: 'Esta orden ya fue aprobada anteriormente.' });
      }

      // Permitir aprobar manualmente incluso si había expirado
      if (order.status !== 'PENDING') {
        await prisma.subscriptionPayment.update({
          where: { id },
          data: { status: 'PENDING' },
        });
      }

      const result = await SubscriptionValidatorService.activateOrderWithPayment(
        id,
        null,
        'Aprobación manual desde Panel Admin'
      );

      if (!result) {
        return reply.status(400).send({ error: 'No se pudo aprobar la orden.' });
      }

      return reply.send({
        message: 'Pago aprobado y suscripción activada exitosamente.',
        order: result.order,
        profile: result.updatedUser,
      });
    } catch (error) {
      logger.error('Error approving admin subscription order:', error);
      return reply.status(500).send({ error: 'No se pudo aprobar la orden de suscripción.' });
    }
  }

  static async rejectAdminOrder(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      await prisma.subscriptionPayment.update({
        where: { id },
        data: { status: 'FAILED' },
      });
      return reply.send({ message: 'Orden marcada como rechazada.' });
    } catch (error) {
      logger.error('Error rejecting admin subscription order:', error);
      return reply.status(500).send({ error: 'No se pudo rechazar la orden.' });
    }
  }
}
