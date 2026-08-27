import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../config/database.js';
import { SocketService } from '../services/socket.service.js';
import { MailService } from '../services/mail.service.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Helpers
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateNotificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const prefix = chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)];
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * 36)];
  }
  return `${prefix}-${code}`;
}

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
    const { uuid } = req.body as { uuid: string };
    try {
      const device = await prisma.device.update({
        where: { uuid },
        data: { isApproved: false }
      });
      return reply.send({ message: 'Dispositivo desaprobado correctamente.' });
    } catch (error) {
      logger.error('Error unapproving device:', error);
      return reply.status(404).send({ error: 'Dispositivo no encontrado para desaprobar.' });
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
      const payments = await prisma.payment.findMany({
        where: {
          userId,
          deviceId: deviceId || undefined
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(payments);
    } catch (error) {
      logger.error('Error getting payments:', error);
      return reply.status(500).send({ error: 'Error al obtener la lista de pagos.' });
    }
  }
}

export class AdminController {
  static async login(req: FastifyRequest, reply: FastifyReply) {
    const { username, pin } = req.body as any;
    try {
      const admin = await prisma.adminUser.findUnique({ where: { username } });
      if (!admin) return reply.status(401).send({ error: 'Invalid credentials' });
      
      if (admin.status === 'SUSPENDED') {
        return reply.status(403).send({ error: 'Account suspended' });
      }

      const storedHash = admin.pinHash;
      let isPinValid = false;

      if (storedHash.includes(':')) {
        const [hashed, salt] = storedHash.split(':');
        const inputHash = crypto.createHash('sha256').update(pin + salt).digest('hex');
        isPinValid = (inputHash === hashed);
      } else {
        const inputHash = crypto.createHash('sha256').update(pin).digest('hex');
        isPinValid = (inputHash === storedHash);
      }

      if (!isPinValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = (req.server as any).jwt.sign(
        { id: admin.id, username: admin.username, role: admin.role },
        { expiresIn: '24h' }
      );

      return reply.send({ token, role: admin.role });
    } catch (error) {
      logger.error('Error in admin login:', error);
      return reply.status(500).send({ error: 'Ocurrió un error inesperado durante el inicio de sesión.' });
    }
  }

  static async getUsers(req: FastifyRequest, reply: FastifyReply) {
    try {
      const users = await prisma.adminUser.findMany({
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(users);
    } catch (error) {
      logger.error('Error getting admin users:', error);
      return reply.status(500).send({ error: 'No se pudo cargar la lista de administradores.' });
    }
  }

  static async createUser(req: FastifyRequest, reply: FastifyReply) {
    const { username, pin, role } = req.body as any;
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hashed = crypto.createHash('sha256').update(pin + salt).digest('hex');
      const pinHash = `${hashed}:${salt}`;
      const user = await prisma.adminUser.create({
        data: { username, pinHash, role }
      });
      return reply.status(201).send({ id: user.id, username: user.username, role: user.role });
    } catch (error) {
      logger.error('Error creating admin user:', error);
      return reply.status(500).send({ error: 'No se pudo crear el usuario administrador. ¿El nombre de usuario ya existe?' });
    }
  }

  static async updateUser(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const { role, status } = req.body as any;
    try {
      const user = await prisma.adminUser.update({
        where: { id },
        data: { role, status }
      });
      return reply.send({ id: user.id, username: user.username, role: user.role, status: user.status });
    } catch (error) {
      logger.error('Error updating admin user:', error);
      return reply.status(404).send({ error: 'Administrador no encontrado para actualizar.' });
    }
  }

  static async deleteUser(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    try {
      await prisma.adminUser.delete({ where: { id } });
      return reply.status(204).send();
    } catch (error) {
      logger.error('Error deleting admin user:', error);
      return reply.status(404).send({ error: 'No se pudo eliminar el administrador.' });
    }
  }

  static async getAppUsers(req: FastifyRequest, reply: FastifyReply) {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          businessType: true,
          isSubscribed: true,
          trialEndDate: true,
          subscriptionEndDate: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(users);
    } catch (error) {
      logger.error('Error getting app users:', error);
      return reply.status(500).send({ error: 'Error al obtener los usuarios de la aplicación.' });
    }
  }

  static async updateAppUserSubscription(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const { isSubscribed } = req.body as { isSubscribed: boolean };
    try {
      const user = await prisma.user.update({
        where: { id },
        data: {
          isSubscribed,
          subscriptionStartDate: isSubscribed ? new Date() : undefined,
          subscriptionEndDate: isSubscribed ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : undefined
        }
      });
      return reply.send(user);
    } catch (error) {
      logger.error('Error updating app user subscription:', error);
      return reply.status(404).send({ error: 'Usuario no encontrado para gestionar suscripción.' });
    }
  }
}

export class UserController {
  static async register(req: FastifyRequest, reply: FastifyReply) {
    const { name, email, password, phone, businessType } = req.body as any;
    try {
      const existingUser = await prisma.user.findUnique({ where: { email } });

      if (existingUser) {
        if (existingUser.isVerified) {
          return reply.status(400).send({ error: 'El usuario ya existe y está verificado.' });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      let notificationCode = existingUser?.notificationCode || '';
      if (!notificationCode) {
        let codeExists = true;
        while (codeExists) {
          notificationCode = generateNotificationCode();
          const existingCode = await prisma.user.findFirst({ where: { notificationCode } });
          codeExists = !!existingCode;
        }
      }

      const user = await prisma.user.upsert({
        where: { email },
        update: {
          name,
          password: hashedPassword,
          phone,
          businessType,
          isVerified: false,
        },
        create: {
          name,
          email,
          password: hashedPassword,
          phone,
          businessType,
          notificationCode,
          isVerified: false
        },
      });

      // TRUCO PARA EL TESTER DE GOOGLE PLAY: Código fijo si es el email de prueba
      const code = (email === 'tester@novabytexrj.com') ? '123456' : generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.verificationCode.create({
        data: {
          email,
          code,
          expiresAt,
        },
      });

      logger.info(`[SEGURIDAD] OTP para ${email}: ${code}`);
      await MailService.sendOTP(email, code);

      return reply.status(201).send({
        message: 'Registro exitoso. Por favor verifica tu correo electrónico.',
        email: user.email,
        requiresVerification: true
      });
    } catch (error) {
      logger.error('Error registering user:', error);
      return reply.status(500).send({ error: 'Ocurrió un error al registrar el usuario. Inténtalo de nuevo.' });
    }
  }

  static async verifyEmail(req: FastifyRequest, reply: FastifyReply) {
    const { email, code } = req.body as any;
    try {
      // MASTER BYPASS FOR TESTER
      if (email === 'tester@novabytexrj.com' && code === '123456') {
        const user = await prisma.user.update({
          where: { email },
          data: { isVerified: true }
        });
        await prisma.verificationCode.deleteMany({ where: { email } });
        const token = (req.server as any).jwt.sign({ id: user.id, email: user.email }, { expiresIn: '30d' });
        return reply.send({
          id: user.id, name: user.name, email: user.email, phone: user.phone,
          businessType: user.businessType, token, isVerified: true,
          isSubscribed: user.isSubscribed, trialEndDate: user.trialEndDate,
          subscriptionEndDate: user.subscriptionEndDate,
        });
      }

      const verification = await prisma.verificationCode.findFirst({
        where: { email, code },
        orderBy: { createdAt: 'desc' }
      });

      if (!verification) {
        return reply.status(400).send({ error: 'El código de verificación es incorrecto.' });
      }

      if (verification.expiresAt < new Date()) {
        return reply.status(400).send({ error: 'Este código de verificación ha expirado.' });
      }

      if (verification.attempts >= 3) {
        return reply.status(400).send({ error: 'Has superado el número de intentos. Solicita un nuevo código.' });
      }

      const user = await prisma.user.update({
        where: { email },
        data: { isVerified: true }
      });

      await prisma.verificationCode.deleteMany({ where: { email } });

      const token = (req.server as any).jwt.sign(
        { id: user.id, email: user.email },
        { expiresIn: '30d' }
      );

      return reply.send({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        businessType: user.businessType,
        token,
        isVerified: true,
        isSubscribed: user.isSubscribed,
        trialEndDate: user.trialEndDate,
        subscriptionEndDate: user.subscriptionEndDate,
      });
    } catch (error) {
      logger.error('Error verifying email:', error);
      return reply.status(500).send({ error: 'Error al verificar el correo electrónico.' });
    }
  }

  static async resendOTP(req: FastifyRequest, reply: FastifyReply) {
    const { email } = req.body as { email: string };
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.status(404).send({ error: 'El correo ingresado no está registrado.' });
      if (user.isVerified) return reply.status(400).send({ error: 'Este correo electrónico ya ha sido verificado.' });

      const code = (email === 'tester@novabytexrj.com') ? '123456' : generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.verificationCode.create({
        data: { email, code, expiresAt }
      });

      if (email !== 'tester@novabytexrj.com') {
        await MailService.sendOTP(email, code);
      }

      return reply.send({ message: 'Se ha enviado un nuevo código de verificación a tu correo.' });
    } catch (error) {
      logger.error('Error resending OTP:', error);
      return reply.status(500).send({ error: 'No se pudo reenviar el código. Inténtalo más tarde.' });
    }
  }

  static async login(req: FastifyRequest, reply: FastifyReply) {
    const { email, password } = req.body as any;
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.status(401).send({ error: 'Credenciales inválidas o usuario no registrado.' });

      if (!user.isVerified) {
        return reply.status(403).send({
          error: 'Tu cuenta aún no ha sido verificada.',
          requiresVerification: true,
          email: user.email
        });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) return reply.status(401).send({ error: 'Contraseña incorrecta. Inténtalo de nuevo.' });

      const token = (req.server as any).jwt.sign(
        { id: user.id, email: user.email },
        { expiresIn: '30d' }
      );

      return reply.send({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        businessType: user.businessType,
        token,
        isSubscribed: user.isSubscribed,
        trialEndDate: user.trialEndDate,
        subscriptionEndDate: user.subscriptionEndDate,
      });
    } catch (error) {
      logger.error('Error logging in user:', error);
      return reply.status(500).send({ error: 'Ocurrió un error al intentar iniciar sesión.' });
    }
  }

  static async googleLogin(req: FastifyRequest, reply: FastifyReply) {
    const { email, name, googleId } = req.body as any;
    logger.info(`Google login request for: ${email}`);
    try {
      let user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        logger.info(`Creating new user via Google: ${email}`);
        const notificationCode = generateNotificationCode();
        user = await prisma.user.create({
          data: {
            email,
            name,
            password: await bcrypt.hash(`GOOGLE_SIGN_IN_${googleId}`, 10),
            isVerified: true,
            notificationCode,
          }
        });
      } else {
        logger.info(`Existing user logged in via Google: ${email}`);
      }

      const token = (req.server as any).jwt.sign(
        { id: user.id, email: user.email },
        { expiresIn: '30d' }
      );

      return reply.send({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        businessType: user.businessType,
        token,
        isVerified: true,
        isSubscribed: user.isSubscribed,
        trialEndDate: user.trialEndDate,
        subscriptionEndDate: user.subscriptionEndDate,
      });
    } catch (error) {
      logger.error('Error in google login:', error);
      return reply.status(500).send({ error: 'Error al iniciar sesión con Google.' });
    }
  }

  static async startTrial(req: FastifyRequest, reply: FastifyReply) {
    const userId = (req as any).user?.id;
    logger.info(`>>> [DEBUG] Start trial request for user ID: ${userId}`);
    try {
      if (!userId) {
        logger.warn('>>> [DEBUG] startTrial failed: No userId in request');
        return reply.status(401).send({ error: 'Usuario no autenticado.' });
      }

      // Verificar si el usuario ya tiene una prueba o suscripción
      const currentUser = await prisma.user.findUnique({ where: { id: userId } });
      if (currentUser?.trialEndDate) {
        logger.info(`>>> [DEBUG] User ${userId} already has a trial. Overwriting...`);
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          trialStartDate: new Date(),
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        }
      });

      logger.info(`>>> [DEBUG] Trial started successfully for user: ${user.email}`);
      return reply.send({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        businessType: user.businessType,
        isSubscribed: user.isSubscribed,
        trialEndDate: user.trialEndDate,
        subscriptionEndDate: user.subscriptionEndDate,
      });
    } catch (error) {
      logger.error('>>> [DEBUG] Error starting trial:', error);
      return reply.status(500).send({ error: 'Error interno al activar el periodo de prueba.' });
    }
  }

  static async getProfile(req: FastifyRequest, reply: FastifyReply) {
    try {
      let user = await prisma.user.findUnique({
        where: { id: (req as any).user.id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          businessType: true,
          notificationCode: true,
          isSubscribed: true,
          trialEndDate: true,
          subscriptionEndDate: true
        }
      });

      if (user && !user.notificationCode) {
        let notificationCode = '';
        let codeExists = true;
        while (codeExists) {
          notificationCode = generateNotificationCode();
          const existingCode = await prisma.user.findFirst({ where: { notificationCode } });
          codeExists = !!existingCode;
        }
        user = await prisma.user.update({
          where: { id: user.id },
          data: { notificationCode },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            businessType: true,
            notificationCode: true,
            isSubscribed: true,
            trialEndDate: true,
            subscriptionEndDate: true
          }
        });
      }
      
      if (!user) return reply.status(404).send({ error: 'Perfil de usuario no encontrado.' });
      return reply.send(user);
    } catch (error) {
      logger.error('Error getting user profile:', error);
      return reply.status(500).send({ error: 'Error al cargar los datos del perfil.' });
    }
  }

  static async updateProfile(req: FastifyRequest, reply: FastifyReply) {
    const { name, phone, businessType } = req.body as any;
    try {
      const user = await prisma.user.update({
        where: { id: (req as any).user.id },
        data: {
          name: name || undefined,
          phone: phone || undefined,
          businessType: businessType || undefined,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          businessType: true,
          notificationCode: true,
          isSubscribed: true,
          trialEndDate: true,
          subscriptionEndDate: true
        }
      });

      return reply.send(user);
    } catch (error) {
      logger.error('Error updating user profile:', error);
      return reply.status(500).send({ error: 'No se pudo actualizar la información del perfil.' });
    }
  }
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
      const senderId = (req as any).user.id;

      const receiver = await prisma.user.findUnique({
        where: { notificationCode: code }
      });
      if (!receiver) {
        return reply.status(404).send({ error: 'El usuario al que intentas vincularte no existe.' });
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
        return reply.status(400).send({ error: 'Ya estás vinculado con este usuario.' });
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
        data: { senderId, receiverId: receiver.id }
      });

      return reply.status(201).send(request);
    } catch (error) {
      logger.error('Error sending link request:', error);
      return reply.status(500).send({ error: 'No se pudo enviar la solicitud de vinculación.' });
    }
  }

  static async getLinkRequests(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user.id;
      const requests = await prisma.linkRequest.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }]
        },
        include: {
          sender: { select: { id: true, name: true, email: true } },
          receiver: { select: { id: true, name: true, email: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return reply.send(requests);
    } catch (error) {
      logger.error('Error getting link requests:', error);
      return reply.status(500).send({ error: 'Error al cargar las solicitudes de vinculación.' });
    }
  }

  static async acceptLinkRequest(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { requestId } = req.params as { requestId: string };
      const userId = (req as any).user.id;

      const request = await prisma.linkRequest.findUnique({
        where: { id: requestId }
      });

      if (!request || request.receiverId !== userId) {
        return reply.status(404).send({ error: 'La solicitud de vinculación no existe o no te pertenece.' });
      }

      if (request.status !== 'PENDING') {
        return reply.status(400).send({ error: 'Esta solicitud ya ha sido procesada.' });
      }

      await prisma.$transaction([
        prisma.linkRequest.update({
          where: { id: requestId },
          data: { status: 'ACCEPTED' }
        }),
        prisma.userLink.create({
          data: {
            sourceId: request.senderId,
            targetId: request.receiverId
          }
        })
      ]);

      return reply.send({ message: 'Solicitud de vinculación aceptada.' });
    } catch (error) {
      logger.error('Error accepting link request:', error);
      return reply.status(500).send({ error: 'Error al aceptar la solicitud de vinculación.' });
    }
  }

  static async rejectLinkRequest(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { requestId } = req.params as { requestId: string };
      const userId = (req as any).user.id;

      const request = await prisma.linkRequest.findUnique({
        where: { id: requestId }
      });

      if (!request || request.receiverId !== userId) {
        return reply.status(404).send({ error: 'La solicitud no existe o no te pertenece.' });
      }

      if (request.status !== 'PENDING') {
        return reply.status(400).send({ error: 'Esta solicitud ya ha sido procesada.' });
      }

      await prisma.linkRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED' }
      });

      return reply.send({ message: 'Solicitud de vinculación rechazada.' });
    } catch (error) {
      logger.error('Error rejecting link request:', error);
      return reply.status(500).send({ error: 'Error al rechazar la solicitud de vinculación.' });
    }
  }

  static async getLinkedUsers(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user.id;
      const links = await prisma.userLink.findMany({
        where: {
          OR: [{ sourceId: userId }, { targetId: userId }]
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
      return reply.status(500).send({ error: 'Error al obtener la lista de usuarios vinculados.' });
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

      if (event.type === 'order.status.changed') {
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
