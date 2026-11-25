import prisma from '../config/database.js';
import logger from '../utils/logger.js';
import { SocketService } from './socket.service.js';

export const DEFAULT_MASTER_YAPE_QR =
  process.env.DEFAULT_YAPE_QR_PAYLOAD ||
  '000201010211393236878ef6ae2a5e92b84956968ad153b55204561153036045802PE5906YAPERO6004Lima630469A3';

const SPANISH_STOPWORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);

export function normalizeNameTokens(name: string): string[] {
  if (!name) return [];
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[*＊#_~^•·.,\-¡!]+/g, ' ')
    .toLowerCase()
    .trim();

  return cleaned
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0 && !SPANISH_STOPWORDS.has(t));
}

function tokenMatchScore(a: string, b: string): number {
  if (a === b) return a.length >= 2 ? 3 : 1;
  // Maneja abreviaturas de Yape/Plin (ej. "Juan C. Perez L." vs "Juan Carlos Perez Lopez")
  if (a.length === 1 && b.startsWith(a)) return 1;
  if (b.length === 1 && a.startsWith(b)) return 1;
  // Maneja apellidos o nombres truncados por bancos (mínimo 4 caracteres en común al inicio)
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 2;
  return 0;
}

export function matchPayerName(
  expectedName: string | null | undefined,
  receivedSenderName: string
): { matched: boolean; score: number } {
  if (!expectedName) return { matched: false, score: 0 };
  const expected = normalizeNameTokens(expectedName);
  const received = normalizeNameTokens(receivedSenderName);

  if (expected.length === 0 || received.length === 0) {
    return { matched: false, score: 0 };
  }

  const usedExpected = new Set<number>();
  const usedReceived = new Set<number>();
  let totalScore = 0;
  let fullMatchesCount = 0;
  let totalMatches = 0;

  // Paso 1: Emparejar primero coincidencias exactas o prefijos largos (prioridad máxima)
  for (let i = 0; i < received.length; i++) {
    let bestJ = -1;
    let bestScore = 0;
    for (let j = 0; j < expected.length; j++) {
      if (usedExpected.has(j)) continue;
      const sc = tokenMatchScore(received[i], expected[j]);
      if (sc >= 2 && sc > bestScore) {
        bestScore = sc;
        bestJ = j;
      }
    }
    if (bestJ !== -1) {
      usedReceived.add(i);
      usedExpected.add(bestJ);
      totalScore += bestScore;
      fullMatchesCount++;
      totalMatches++;
    }
  }

  // Paso 2: Emparejar iniciales restantes
  for (let i = 0; i < received.length; i++) {
    if (usedReceived.has(i)) continue;
    for (let j = 0; j < expected.length; j++) {
      if (usedExpected.has(j)) continue;
      const sc = tokenMatchScore(received[i], expected[j]);
      if (sc > 0) {
        usedReceived.add(i);
        usedExpected.add(j);
        totalScore += sc;
        totalMatches++;
        break;
      }
    }
  }

  const allExpectedMatched = expected.every((_, j) => usedExpected.has(j));
  const allReceivedMatched = received.every((_, i) => usedReceived.has(i));

  // Exige al menos 1 palabra completa coincidente (>=2 chars), >=2 tokens coincidentes en total,
  // y que todos los tokens de un lado estén contenidos en el otro (evita falsos positivos tipo "Juan Lopez" vs "Juan Ramirez").
  const matched =
    fullMatchesCount >= 1 &&
    totalMatches >= 2 &&
    (allExpectedMatched || allReceivedMatched);

  return { matched, score: matched ? totalScore : 0 };
}

export class SubscriptionValidatorService {
  static async getOrCreateConfig() {
    let config = await prisma.paymentValidatorConfig.findUnique({
      where: { id: 'master' },
    });

    if (!config) {
      config = await prisma.paymentValidatorConfig.create({
        data: {
          id: 'master',
          yapeEnabled: true,
          yapeQrPayload: DEFAULT_MASTER_YAPE_QR,
          plinEnabled: true,
          bankEnabled: true,
          basicPrice: 5.0,
          premiumPrice: 7.0,
          planDays: 30,
        },
      });
    } else if (!config.yapeQrPayload && DEFAULT_MASTER_YAPE_QR) {
      config = await prisma.paymentValidatorConfig.update({
        where: { id: 'master' },
        data: { yapeQrPayload: DEFAULT_MASTER_YAPE_QR },
      });
    }

    return config;
  }

  static isMasterSource(
    config: { masterUserId: string | null; masterDeviceId: string | null },
    paymentUserId: string | null,
    paymentDeviceId: string
  ): boolean {
    if (config.masterDeviceId) {
      return paymentDeviceId === config.masterDeviceId;
    }
    if (config.masterUserId) {
      return paymentUserId === config.masterUserId;
    }
    return false;
  }

  static async activateOrderWithPayment(
    orderId: string,
    paymentId: string | null,
    matchedSenderName: string | null
  ) {
    const now = new Date();

    const result = await prisma.$transaction(async tx => {
      const claim = await tx.subscriptionPayment.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: {
          status: 'COMPLETED',
          providerPaymentId: paymentId,
          matchedSenderName: matchedSenderName,
        },
      });

      if (claim.count === 0) return null;

      const order = await tx.subscriptionPayment.findUnique({
        where: { id: orderId },
      });
      if (!order) return null;

      const user = await tx.user.findUnique({ where: { id: order.userId } });
      if (!user) return null;

      const msToAdd = (order.days || 30) * 24 * 60 * 60 * 1000;
      const hasActivePaidSub =
        user.isSubscribed &&
        user.subscriptionEndDate &&
        user.subscriptionEndDate > now;

      const baseDate = hasActivePaidSub ? user.subscriptionEndDate! : now;
      const newEndDate = new Date(baseDate.getTime() + msToAdd);
      const startDate =
        hasActivePaidSub && user.subscriptionStartDate
          ? user.subscriptionStartDate
          : now;

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          isSubscribed: true,
          subscriptionPlan: order.plan || 'basic',
          subscriptionStartDate: startDate,
          subscriptionEndDate: newEndDate,
          lastPaymentId: order.id,
          lastPaymentProvider: order.provider,
          status: 'ACTIVE',
        },
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

      return { order, updatedUser };
    });

    if (result) {
      logger.info(
        `>>> [VALIDADOR] Orden ${result.order.id} VALIDADA (${result.order.plan}, S/ ${result.order.amount}). Usuario ${result.updatedUser.email} activado hasta ${result.updatedUser.subscriptionEndDate}`
      );
      SocketService.emitSubscriptionActivated(result.updatedUser.id, {
        orderId: result.order.id,
        plan: result.order.plan,
        days: result.order.days,
        profile: result.updatedUser,
      });
    }

    return result;
  }

  static async tryMatchIncomingPayment(payment: {
    id: string;
    amount: number;
    senderName: string;
    deviceId: string;
    userId: string | null;
    createdAt: Date;
  }) {
    try {
      const config = await this.getOrCreateConfig();
      if (!this.isMasterSource(config, payment.userId, payment.deviceId)) {
        return null;
      }

      const now = new Date();
      const pendingOrders = await prisma.subscriptionPayment.findMany({
        where: {
          status: 'PENDING',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: 'asc' },
      });

      let bestOrder: (typeof pendingOrders)[number] | null = null;
      let bestScore = 0;

      for (const order of pendingOrders) {
        if (Math.abs(order.amount - payment.amount) > 0.01) continue;
        // Tolerancia de 2 minutos por desfase de reloj si pagó justo al crear la orden
        const minValidTime = new Date(order.createdAt.getTime() - 120 * 1000);
        if (payment.createdAt < minValidTime) continue;

        const matchResult = matchPayerName(order.payerName, payment.senderName);
        if (matchResult.matched && matchResult.score > bestScore) {
          bestScore = matchResult.score;
          bestOrder = order;
        }
      }

      if (!bestOrder) {
        logger.info(
          `>>> [VALIDADOR] Notificación Master recibida (${payment.senderName} - S/ ${payment.amount}), sin orden pendiente coincidente.`
        );
        return null;
      }

      return await this.activateOrderWithPayment(
        bestOrder.id,
        payment.id,
        payment.senderName
      );
    } catch (error) {
      logger.error('Error en tryMatchIncomingPayment:', error);
      return null;
    }
  }

  static async tryRetroactiveMatchForOrder(orderId: string) {
    try {
      const order = await prisma.subscriptionPayment.findUnique({
        where: { id: orderId },
      });
      if (!order || order.status !== 'PENDING') return null;

      const now = new Date();
      if (order.expiresAt && order.expiresAt <= now) {
        await prisma.subscriptionPayment.update({
          where: { id: order.id },
          data: { status: 'EXPIRED' },
        });
        return null;
      }

      const config = await this.getOrCreateConfig();
      if (!config.masterUserId && !config.masterDeviceId) return null;

      const windowStart = new Date(order.createdAt.getTime() - 120 * 1000);

      const usedPayments = await prisma.subscriptionPayment.findMany({
        where: { providerPaymentId: { not: null } },
        select: { providerPaymentId: true },
      });
      const usedIds = usedPayments
        .map(p => p.providerPaymentId)
        .filter((id): id is string => Boolean(id));

      const masterPayments = await prisma.payment.findMany({
        where: {
          ...(config.masterDeviceId
            ? { deviceId: config.masterDeviceId }
            : { userId: config.masterUserId! }),
          createdAt: { gte: windowStart },
          ...(usedIds.length > 0 ? { id: { notIn: usedIds } } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      for (const p of masterPayments) {
        if (Math.abs(p.amount - order.amount) > 0.01) continue;
        const { matched } = matchPayerName(order.payerName, p.senderName);
        if (matched) {
          return await this.activateOrderWithPayment(
            order.id,
            p.id,
            p.senderName
          );
        }
      }

      return null;
    } catch (error) {
      logger.error('Error en tryRetroactiveMatchForOrder:', error);
      return null;
    }
  }
}
