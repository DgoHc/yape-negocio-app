import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import logger from '../utils/logger.js';
import axios from 'axios';
import { MercadoPagoConfig, Preference } from 'mercadopago';

export class PaymentGatewayController {
  static async createCulqiPayment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { amount, currency, description } = req.body as any;

      const subscriptionPayment = await prisma.subscriptionPayment.create({
        data: {
          userId: (req as any).user.id,
          amount: amount / 100,
          currency: currency,
          provider: 'CULQI',
        }
      });

      const culqiApiKey = process.env.CULQI_SECRET_KEY;
      const response = await axios.post('https://api.culqi.com/v2/orders', {
        amount: amount,
        currency_code: currency,
        description: description,
        order_number: subscriptionPayment.id,
        client_details: {
          email: (req as any).user.email,
        },
      }, {
        headers: {
          Authorization: `Bearer ${culqiApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      await prisma.subscriptionPayment.update({
        where: { id: subscriptionPayment.id },
        data: { providerPaymentId: response.data.id }
      });

      return reply.send({
        id: response.data.id,
        payment_url: `https://checkout.culqi.com/orders/${response.data.id}`,
      });
    } catch (error) {
      logger.error('Error creating Culqi payment:', error);
      return reply.status(500).send({ error: 'Error al generar la orden de pago en Culqi. Inténtalo de nuevo.' });
    }
  }

  static async createMercadoPagoPayment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { amount, currency, description } = req.body as any;

      const subscriptionPayment = await prisma.subscriptionPayment.create({
        data: {
          userId: (req as any).user.id,
          amount: amount,
          currency: currency,
          provider: 'MERCADO_PAGO',
        }
      });

      const mpConfig = new MercadoPagoConfig({
        accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
      });

      const preference = new Preference(mpConfig);
      const result = await preference.create({
        body: {
          items: [
            {
              id: subscriptionPayment.id,
              title: description,
              quantity: 1,
              unit_price: amount,
              currency_id: currency,
            },
          ],
          back_urls: {
            success: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-success`,
            failure: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-failure`,
            pending: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/payment-pending`,
          },
          auto_return: 'approved',
        },
      });

      await prisma.subscriptionPayment.update({
        where: { id: subscriptionPayment.id },
        data: { providerPaymentId: result.id }
      });

      return reply.send({
        id: result.id,
        init_point: result.init_point,
      });
    } catch (error) {
      logger.error('Error creating Mercado Pago payment:', error);
      return reply.status(500).send({ error: 'Error al generar la orden de pago en Mercado Pago.' });
    }
  }

  static async createYapePayment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { amount, currency, description } = req.body as any;

      const subscriptionPayment = await prisma.subscriptionPayment.create({
        data: {
          userId: (req as any).user.id,
          amount: amount,
          currency: currency,
          provider: 'YAPE',
        }
      });

      return reply.send({
        id: subscriptionPayment.id,
        payment_url: 'https://yape.pe',
      });
    } catch (error) {
      logger.error('Error creating Yape payment:', error);
      return reply.status(500).send({ error: 'Error al procesar el pago con Yape.' });
    }
  }

  static async culqiWebhook(req: FastifyRequest, reply: FastifyReply) {
    try {
      const event = req.body as any;
      logger.info('Received Culqi webhook event:', event);

      if (event.type === 'order.status.changed' || event.type === 'order.update') {
        const orderId = event.data.object.id;
        const orderStatus = event.data.object.status;

        const subscriptionPayment = await prisma.subscriptionPayment.findFirst({
          where: { providerPaymentId: orderId },
        });

        if (subscriptionPayment) {
          if (orderStatus === 'paid') {
            await prisma.$transaction([
              prisma.subscriptionPayment.update({
                where: { id: subscriptionPayment.id },
                data: { status: 'COMPLETED' }
              }),
              prisma.user.update({
                where: { id: subscriptionPayment.userId },
                data: {
                  isSubscribed: true,
                  subscriptionStartDate: new Date(),
                  subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                  lastPaymentId: subscriptionPayment.id,
                  lastPaymentProvider: 'CULQI',
                }
              })
            ]);
          } else if (orderStatus === 'expired' || orderStatus === 'deleted') {
            await prisma.subscriptionPayment.update({
              where: { id: subscriptionPayment.id },
              data: { status: 'FAILED' }
            });
          }
        }
      }

      return reply.status(200).send();
    } catch (error) {
      logger.error('Error handling Culqi webhook:', error);
      return reply.status(500).send({ error: 'Error interno al procesar el webhook de pago.' });
    }
  }

  static async mercadoPagoWebhook(req: FastifyRequest, reply: FastifyReply) {
    try {
      const event = req.body as any;
      logger.info('Received Mercado Pago webhook event:', event);

      return reply.status(200).send();
    } catch (error) {
      logger.error('Error handling Mercado Pago webhook:', error);
      return reply.status(500).send({ error: 'Error interno al procesar el webhook de Mercado Pago.' });
    }
  }
}
