import { FastifyInstance } from 'fastify';
import {
  DeviceController,
  PaymentController,
  AdminController,
  UserController,
  PaymentGatewayController,
  NotificationController
} from '../controllers/index.js';
import { validate } from '../middlewares/validate.js';
import { authenticateJWT, authorizeRoles } from '../middlewares/auth.js';
import { 
  registerDeviceSchema, 
  paymentSchema, 
  adminLoginSchema, 
  updateDeviceSchema,
  adminUserSchema,
  updateAdminUserSchema,
  registerUserSchema,
  verifyEmailSchema,
  resendOtpSchema,
  googleLoginSchema
} from '../dtos/schemas.js';

export default async function routes(fastify: FastifyInstance) {
  // Device routes
  fastify.post('/devices/register', { preHandler: [authenticateJWT, validate(registerDeviceSchema)] }, DeviceController.register);
  fastify.get('/devices/:uuid/status', DeviceController.getStatus);
  fastify.post('/devices/unapprove', { preHandler: authenticateJWT }, DeviceController.unapprove);

  // Payment routes
  fastify.post('/payments', { preHandler: [authenticateJWT, validate(paymentSchema)] }, PaymentController.create);
  fastify.get('/payments', { preHandler: authenticateJWT }, PaymentController.getPayments);

  // Admin routes
  fastify.post('/admin/login', { preHandler: validate(adminLoginSchema) }, AdminController.login);
  fastify.post('/admin/logout', { preHandler: authenticateJWT }, async (request, reply) => {
    return reply.send({ message: 'Logged out successfully' });
  });

  // Device Management
  fastify.get('/admin/devices', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR')] }, DeviceController.getDevices);
  fastify.post('/admin/devices', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN', 'ADMIN'), validate(registerDeviceSchema)] }, DeviceController.adminRegisterDevice);
  fastify.patch('/admin/devices/:id', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN', 'ADMIN'), validate(updateDeviceSchema)] }, DeviceController.updateDevice);
  fastify.delete('/admin/devices/:id', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN')] }, DeviceController.deleteDevice);

  // User Management
  fastify.get('/admin/users', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN')] }, AdminController.getUsers);
  fastify.post('/admin/users', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN'), validate(adminUserSchema)] }, AdminController.createUser);
  fastify.patch('/admin/users/:id', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN'), validate(updateAdminUserSchema)] }, AdminController.updateUser);
  fastify.delete('/admin/users/:id', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN')] }, AdminController.deleteUser);

  // App User Management
  fastify.get('/admin/app-users', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN', 'ADMIN')] }, AdminController.getAppUsers);
  fastify.patch('/admin/app-users/:id/subscription', { preHandler: [authenticateJWT, authorizeRoles('SUPER_ADMIN', 'ADMIN')] }, AdminController.updateAppUserSubscription);

  // User routes
  fastify.post('/users/register', { preHandler: validate(registerUserSchema) }, UserController.register);
  fastify.post('/users/verify-email', { preHandler: validate(verifyEmailSchema) }, UserController.verifyEmail);
  fastify.post('/users/resend-otp', { preHandler: validate(resendOtpSchema) }, UserController.resendOTP);
  fastify.post('/users/login', UserController.login);
  fastify.post('/users/google-login', { preHandler: validate(googleLoginSchema) }, UserController.googleLogin);
  fastify.post('/users/start-trial', { preHandler: authenticateJWT }, UserController.startTrial);
  fastify.get('/users/profile', { preHandler: authenticateJWT }, UserController.getProfile);
  fastify.patch('/users/profile', { preHandler: authenticateJWT }, UserController.updateProfile);

  // Payment Gateway routes
  fastify.post('/payments/culqi', { preHandler: authenticateJWT }, PaymentGatewayController.createCulqiPayment);
  fastify.post('/payments/mercadopago', { preHandler: authenticateJWT }, PaymentGatewayController.createMercadoPagoPayment);
  fastify.post('/payments/yape', { preHandler: authenticateJWT }, PaymentGatewayController.createYapePayment);

  // Webhooks
  fastify.post('/webhooks/culqi', PaymentGatewayController.culqiWebhook);
  fastify.post('/webhooks/mercadopago', PaymentGatewayController.mercadoPagoWebhook);

  // Notification System routes
  fastify.get('/notifications/code', { preHandler: authenticateJWT }, NotificationController.getMyNotificationCode);
  fastify.get('/notifications/find-user/:code', { preHandler: authenticateJWT }, NotificationController.findUserByCode);
  fastify.post('/notifications/link-request', { preHandler: authenticateJWT }, NotificationController.sendLinkRequest);
  fastify.get('/notifications/link-requests', { preHandler: authenticateJWT }, NotificationController.getLinkRequests);
  fastify.post('/notifications/link-requests/:requestId/accept', { preHandler: authenticateJWT }, NotificationController.acceptLinkRequest);
  fastify.post('/notifications/link-requests/:requestId/reject', { preHandler: authenticateJWT }, NotificationController.rejectLinkRequest);
  fastify.get('/notifications/linked-users', { preHandler: authenticateJWT }, NotificationController.getLinkedUsers);
  fastify.patch('/notifications/links/:linkId', { preHandler: authenticateJWT }, NotificationController.updateLink);
  fastify.delete('/notifications/links/:linkId', { preHandler: authenticateJWT }, NotificationController.deleteLink);
  fastify.post('/notifications/fcm-token', { preHandler: authenticateJWT }, NotificationController.registerFcmToken);
}
