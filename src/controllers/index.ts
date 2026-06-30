import { Request, Response } from 'express';
import prisma from '../config/database';
import { SocketService } from '../services/socket.service';
import { MailService } from '../services/mail.service';
import logger from '../utils/logger';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import axios from 'axios';
import { MercadoPagoConfig, Preference } from 'mercadopago';

// Helpers
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateNotificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars like O, 0, I, 1
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export class DeviceController {
  static async register(req: Request, res: Response) {
    const {
      uuid,
      phoneNumber,
      alias,
      deviceName,
      brand,
      model,
      androidVersion,
      pushToken
    } = req.body;
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
          phoneNumber,
          alias,
          deviceName,
          brand,
          model,
          androidVersion,
          pushToken,
          userId: userId || undefined,
        },
      });
      res.status(201).json(device);
    } catch (error) {
      logger.error('Error registering device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getDevices(req: Request, res: Response) {
    try {
      const devices = await prisma.device.findMany({
        orderBy: { createdAt: 'desc' },
      });
      res.json(devices);
    } catch (error) {
      logger.error('Error getting devices:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async adminRegisterDevice(req: Request, res: Response) {
    const { uuid, alias, phoneNumber } = req.body;
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
        },
      });
      res.status(201).json(device);
    } catch (error) {
      logger.error('Error admin registering device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getStatus(req: Request, res: Response) {
    const { uuid } = req.params;
    try {
      const device = await prisma.device.findUnique({
        where: { uuid: uuid as string },
      });
      if (!device) return res.status(404).json({ error: 'Device not found' });
      res.json({ 
        isApproved: device.isApproved,
        status: device.status,
        alias: device.alias,
        phoneNumber: device.phoneNumber
      });
    } catch (error) {
      logger.error('Error getting device status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async unapprove(req: Request, res: Response) {
    const { uuid } = req.body;
    try {
      const device = await prisma.device.update({
        where: { uuid: uuid as string },
        data: { isApproved: false },
      });
      res.json({ message: 'Device unapproved successfully', device });
    } catch (error) {
      logger.error('Error unapproving device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async updateDevice(req: Request, res: Response) {
    const { id } = req.params;
    const { isApproved, alias, status } = req.body;
    logger.info(`Updating device ${id} with:`, { isApproved, alias, status });
    try {
      const device = await prisma.device.update({
        where: { id: id as string },
        data: { 
          isApproved: isApproved !== undefined ? isApproved : undefined,
          alias: alias !== undefined ? alias : undefined,
          status: status !== undefined ? status : undefined,
        },
      });
      logger.info(`Device ${id} updated successfully`);
      res.json(device);
    } catch (error) {
      logger.error('Error updating device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async deleteDevice(req: Request, res: Response) {
    const { id } = req.params;
    try {
      await prisma.device.delete({ where: { id: id as string } });
      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export class PaymentController {
  static async create(req: Request, res: Response) {
    const { externalId, amount, currency, senderName, rawText, deviceId } = req.body;
    try {
      const payment = await prisma.payment.create({
        data: { externalId, amount, currency, senderName, rawText, deviceId },
      });
      
      SocketService.emitPaymentReceived(deviceId, payment);
      
      res.status(201).json(payment);
    } catch (error) {
      logger.error('Error creating payment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getPayments(req: Request, res: Response) {
    const { deviceId } = req.query;
    try {
      const payments = await prisma.payment.findMany({
        where: deviceId ? { deviceId: deviceId as string } : {},
        orderBy: { createdAt: 'desc' },
      });
      res.json(payments);
    } catch (error) {
      logger.error('Error getting payments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export class AdminController {
  static async login(req: Request, res: Response) {
    const { username, pin } = req.body;
    try {
      const admin = await prisma.adminUser.findUnique({ where: { username } });
      if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
      
      if (admin.status === 'SUSPENDED') {
        return res.status(403).json({ error: 'Account suspended' });
      }

      const pinHash = crypto.createHash('sha256').update(pin).digest('hex');
      if (pinHash !== admin.pinHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: admin.id, username: admin.username, role: admin.role },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' }
      );

      res.json({ token, role: admin.role });
    } catch (error) {
      logger.error('Error in admin login:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getUsers(req: Request, res: Response) {
    try {
      const users = await prisma.adminUser.findMany({
        select: { id: true, username: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json(users);
    } catch (error) {
      logger.error('Error getting admin users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async createUser(req: Request, res: Response) {
    const { username, pin, role } = req.body;
    try {
      const pinHash = crypto.createHash('sha256').update(pin).digest('hex');
      const user = await prisma.adminUser.create({
        data: { username, pinHash, role },
      });
      res.status(201).json({ id: user.id, username: user.username, role: user.role });
    } catch (error) {
      logger.error('Error creating admin user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async updateUser(req: Request, res: Response) {
    const { id } = req.params;
    const { role, status } = req.body;
    try {
      const user = await prisma.adminUser.update({
        where: { id: id as string },
        data: { role, status },
      });
      res.json({ id: user.id, username: user.username, role: user.role, status: user.status });
    } catch (error) {
      logger.error('Error updating admin user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async deleteUser(req: Request, res: Response) {
    const { id } = req.params;
    try {
      await prisma.adminUser.delete({ where: { id: id as string } });
      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting admin user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getAppUsers(req: Request, res: Response) {
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
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(users);
    } catch (error) {
      logger.error('Error getting app users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async updateAppUserSubscription(req: Request, res: Response) {
    const { id } = req.params;
    const { isSubscribed } = req.body;
    try {
      const user = await prisma.user.update({
        where: { id },
        data: {
          isSubscribed,
          subscriptionStartDate: isSubscribed ? new Date() : undefined,
          subscriptionEndDate: isSubscribed ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : undefined
        },
      });
      res.json(user);
    } catch (error) {
      logger.error('Error updating app user subscription:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// Helper to generate unique notification codes (like NBX-7K4D91)
function generateNotificationCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const prefix = chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)];
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * 36)];
  }
  return `${prefix}-${code}`;
}

export class UserController {
  static async register(req: Request, res: Response) {
    const { name, email, password, phone, businessType } = req.body;
    try {
      const existingUser = await prisma.user.findUnique({ where: { email } });

      if (existingUser) {
        if (existingUser.isVerified) {
          return res.status(400).json({ error: 'El usuario ya existe y está verificado.' });
        }
        // If user exists but is not verified, we allow "re-registering" (updating data and sending new OTP)
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Generate notification code if new user
      let notificationCode = existingUser?.notificationCode;
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

      // Handle OTP
      const code = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await prisma.verificationCode.create({
        data: {
          email,
          code,
          expiresAt,
        },
      });

      await MailService.sendOTP(email, code);

      res.status(201).json({
        message: 'Registro exitoso. Por favor verifica tu correo electrónico.',
        email: user.email,
        requiresVerification: true
      });
    } catch (error) {
      logger.error('Error registering user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async verifyEmail(req: Request, res: Response) {
    const { email, code } = req.body;
    try {
      const verification = await prisma.verificationCode.findFirst({
        where: { email, code },
        orderBy: { createdAt: 'desc' }
      });

      if (!verification) {
        return res.status(400).json({ error: 'Código de verificación inválido.' });
      }

      if (verification.expiresAt < new Date()) {
        return res.status(400).json({ error: 'El código ha expirado.' });
      }

      if (verification.attempts >= 3) {
        return res.status(400).json({ error: 'Demasiados intentos fallidos. Solicita un nuevo código.' });
      }

      // Update user as verified
      const user = await prisma.user.update({
        where: { email },
        data: { isVerified: true }
      });

      // Cleanup codes
      await prisma.verificationCode.deleteMany({ where: { email } });

      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '30d' }
      );

      res.json({
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
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async resendOTP(req: Request, res: Response) {
    const { email } = req.body;
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
      if (user.isVerified) return res.status(400).json({ error: 'El correo ya está verificado.' });

      // Generate new OTP
      const code = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.verificationCode.create({
        data: { email, code, expiresAt },
      });

      await MailService.sendOTP(email, code);

      res.json({ message: 'Nuevo código enviado.' });
    } catch (error) {
      logger.error('Error resending OTP:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async login(req: Request, res: Response) {
    const { email, password } = req.body;
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

      if (!user.isVerified) {
        return res.status(403).json({
          error: 'Correo no verificado',
          requiresVerification: true,
          email: user.email
        });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) return res.status(401).json({ error: 'Credenciales inválidas' });

      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '30d' }
      );

      res.json({
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
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async googleLogin(req: Request, res: Response) {
    const { email, name, googleId } = req.body;
    try {
      let user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        // Create new user for Google if not exists
        const notificationCode = generateNotificationCode();
        user = await prisma.user.create({
          data: {
            email,
            name,
            password: await bcrypt.hash(`GOOGLE_SIGN_IN_${googleId}`, 10),
            isVerified: true, // Google accounts are trusted/verified
            notificationCode,
          }
        });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '30d' }
      );

      res.json({
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
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async startTrial(req: Request, res: Response) {
    try {
      const user = await prisma.user.update({
        where: { id: (req as any).user.id },
        data: {
          trialStartDate: new Date(),
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        },
      });

      res.json({
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
      logger.error('Error starting trial:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getProfile(req: Request, res: Response) {
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
          subscriptionEndDate: true,
        },
      });

      // Generate notification code if it doesn't exist
      if (user && !user.notificationCode) {
        let notificationCode: string;
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
            subscriptionEndDate: true,
          }
        });
      }
      
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (error) {
      logger.error('Error getting user profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async updateProfile(req: Request, res: Response) {
    const { name, phone, businessType } = req.body;
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
          subscriptionEndDate: true,
        },
      });

      res.json(user);
    } catch (error) {
      logger.error('Error updating user profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export class NotificationController {
  static async getMyNotificationCode(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { notificationCode: true }
      });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Generate notification code if it doesn't exist (for existing users)
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

      res.json({ notificationCode });
    } catch (error) {
      logger.error('Error getting notification code:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async findUserByCode(req: Request, res: Response) {
    try {
      const { code } = req.params;
      const user = await prisma.user.findUnique({
        where: { notificationCode: code },
        select: { id: true, name: true, email: true }
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    } catch (error) {
      logger.error('Error finding user by code:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async sendLinkRequest(req: Request, res: Response) {
    try {
      const { code } = req.body;
      const senderId = (req as any).user.id;

      const receiver = await prisma.user.findUnique({
        where: { notificationCode: code }
      });
      if (!receiver) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (receiver.id === senderId) {
        return res.status(400).json({ error: 'Cannot link to yourself' });
      }

      // Check if already linked or request exists
      const existingLink = await prisma.userLink.findFirst({
        where: {
          OR: [
            { sourceId: senderId, targetId: receiver.id },
            { sourceId: receiver.id, targetId: senderId }
          ]
        }
      });
      if (existingLink) {
        return res.status(400).json({ error: 'Already linked' });
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
        return res.status(400).json({ error: 'Link request already exists' });
      }

      const request = await prisma.linkRequest.create({
        data: { senderId, receiverId: receiver.id }
      });

      res.status(201).json(request);
    } catch (error) {
      logger.error('Error sending link request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getLinkRequests(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const requests = await prisma.linkRequest.findMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        include: {
          sender: { select: { id: true, name: true, email: true } },
          receiver: { select: { id: true, name: true, email: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(requests);
    } catch (error) {
      logger.error('Error getting link requests:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async acceptLinkRequest(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const userId = (req as any).user.id;

      const request = await prisma.linkRequest.findUnique({
        where: { id: requestId }
      });

      if (!request || request.receiverId !== userId) {
        return res.status(404).json({ error: 'Request not found' });
      }

      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: 'Request already processed' });
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

      res.json({ message: 'Request accepted' });
    } catch (error) {
      logger.error('Error accepting link request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async rejectLinkRequest(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const userId = (req as any).user.id;

      const request = await prisma.linkRequest.findUnique({
        where: { id: requestId }
      });

      if (!request || request.receiverId !== userId) {
        return res.status(404).json({ error: 'Request not found' });
      }

      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: 'Request already processed' });
      }

      await prisma.linkRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED' }
      });

      res.json({ message: 'Request rejected' });
    } catch (error) {
      logger.error('Error rejecting link request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getLinkedUsers(req: Request, res: Response) {
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
      res.json(links);
    } catch (error) {
      logger.error('Error getting linked users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async updateLink(req: Request, res: Response) {
    try {
      const { linkId } = req.params;
      const { alias, status } = req.body;
      const userId = (req as any).user.id;

      const link = await prisma.userLink.findUnique({
        where: { id: linkId }
      });

      if (!link) {
        return res.status(404).json({ error: 'Link not found' });
      }

      if (link.sourceId !== userId && link.targetId !== userId) {
        return res.status(403).json({ error: 'Not authorized' });
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

      res.json(updatedLink);
    } catch (error) {
      logger.error('Error updating link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async deleteLink(req: Request, res: Response) {
    try {
      const { linkId } = req.params;
      const userId = (req as any).user.id;

      const link = await prisma.userLink.findUnique({
        where: { id: linkId }
      });

      if (!link) {
        return res.status(404).json({ error: 'Link not found' });
      }

      if (link.sourceId !== userId && link.targetId !== userId) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      await prisma.userLink.delete({
        where: { id: linkId }
      });

      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async registerFcmToken(req: Request, res: Response) {
    try {
      const { token, deviceId, deviceName } = req.body;
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

      res.json({ message: 'Token registered' });
    } catch (error) {
      logger.error('Error registering FCM token:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export class PaymentGatewayController {
  static async createCulqiPayment(req: Request, res: Response) {
    try {
      const { amount, currency, description } = req.body;
      
      const subscriptionPayment = await prisma.subscriptionPayment.create({
        data: {
          userId: (req as any).user.id,
          amount: amount / 100,
          currency: currency,
          provider: 'CULQI',
        },
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
        data: { providerPaymentId: response.data.id },
      });

      res.json({
        id: response.data.id,
        payment_url: `https://checkout.culqi.com/orders/${response.data.id}`,
      });
    } catch (error) {
      logger.error('Error creating Culqi payment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async createMercadoPagoPayment(req: Request, res: Response) {
    try {
      const { amount, currency, description } = req.body;
      
      const subscriptionPayment = await prisma.subscriptionPayment.create({
        data: {
          userId: (req as any).user.id,
          amount: amount,
          currency: currency,
          provider: 'MERCADO_PAGO',
        },
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
        data: { providerPaymentId: result.id },
      });

      res.json({
        id: result.id,
        init_point: result.init_point,
      });
    } catch (error) {
      logger.error('Error creating Mercado Pago payment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async createYapePayment(req: Request, res: Response) {
    try {
      const { amount, currency, description } = req.body;
      
      const subscriptionPayment = await prisma.subscriptionPayment.create({
        data: {
          userId: (req as any).user.id,
          amount: amount,
          currency: currency,
          provider: 'YAPE',
        },
      });

      // NOTE: For Yape, you'll need to use a payment aggregator like Culqi or Niubiz
      // This is a placeholder implementation
      res.json({
        id: subscriptionPayment.id,
        payment_url: 'https://yape.pe', // Replace with actual Yape checkout URL from your aggregator
      });
    } catch (error) {
      logger.error('Error creating Yape payment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async culqiWebhook(req: Request, res: Response) {
    try {
      // TODO: Verify Culqi webhook signature
      const event = req.body;
      logger.info('Received Culqi webhook event:', event);

      if (event.type === 'order.status.changed') {
        const orderId = event.data.object.id;
        const orderStatus = event.data.object.status;

        const subscriptionPayment = await prisma.subscriptionPayment.findFirst({
          where: { providerPaymentId: orderId },
        });

        if (subscriptionPayment) {
          if (orderStatus === 'paid') {
            await prisma.subscriptionPayment.update({
              where: { id: subscriptionPayment.id },
              data: { status: 'COMPLETED' },
            });

            // Activate subscription
            await prisma.user.update({
              where: { id: subscriptionPayment.userId },
              data: {
                isSubscribed: true,
                subscriptionStartDate: new Date(),
                subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                lastPaymentId: subscriptionPayment.id,
                lastPaymentProvider: 'CULQI',
              },
            });
          } else if (orderStatus === 'expired' || orderStatus === 'deleted') {
            await prisma.subscriptionPayment.update({
              where: { id: subscriptionPayment.id },
              data: { status: 'FAILED' },
            });
          }
        }
      }

      res.status(200).send();
    } catch (error) {
      logger.error('Error handling Culqi webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async mercadoPagoWebhook(req: Request, res: Response) {
    try {
      // TODO: Verify Mercado Pago webhook signature
      const event = req.body;
      logger.info('Received Mercado Pago webhook event:', event);

      // TODO: Handle payment status changes

      res.status(200).send();
    } catch (error) {
      logger.error('Error handling Mercado Pago webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
