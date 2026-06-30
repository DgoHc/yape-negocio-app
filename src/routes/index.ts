import { Router } from 'express';
import { DeviceController, PaymentController, AdminController, UserController, PaymentGatewayController, NotificationController } from '../controllers';
import { validate } from '../middlewares/validate';
import { authenticateJWT } from '../middlewares/auth';
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
} from '../dtos/schemas';
import { authorizeRoles } from '../middlewares/auth';

const router = Router();

// Device routes
router.post('/devices/register', authenticateJWT, validate(registerDeviceSchema), DeviceController.register);
router.get('/devices/:uuid/status', DeviceController.getStatus);
router.post('/devices/unapprove', authenticateJWT, DeviceController.unapprove);

// Payment routes
router.post('/payments', validate(paymentSchema), PaymentController.create);
router.get('/payments', PaymentController.getPayments);

// Admin routes
router.post('/admin/login', validate(adminLoginSchema), AdminController.login);
router.post('/admin/logout', authenticateJWT, (req, res) => {
  // En una implementación real con Redis, aquí invalidaríamos el token.
  // Por ahora, el cliente simplemente debe borrarlo localmente.
  res.status(200).json({ message: 'Logged out successfully' });
});

// Device Management
router.get('/admin/devices', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'), 
  DeviceController.getDevices
);
router.post('/admin/devices', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN', 'ADMIN'), 
  validate(registerDeviceSchema), 
  DeviceController.adminRegisterDevice
);
router.patch('/admin/devices/:id', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN', 'ADMIN'), 
  validate(updateDeviceSchema), 
  DeviceController.updateDevice
);
router.delete('/admin/devices/:id', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN'), 
  DeviceController.deleteDevice
);

// User Management (SuperAdmin only)
router.get('/admin/users', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN'), 
  AdminController.getUsers
);
router.post('/admin/users', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN'), 
  validate(adminUserSchema), 
  AdminController.createUser
);
router.patch('/admin/users/:id', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN'), 
  validate(updateAdminUserSchema), 
  AdminController.updateUser
);
router.delete('/admin/users/:id', 
  authenticateJWT, 
  authorizeRoles('SUPER_ADMIN'), 
  AdminController.deleteUser
);

// App User Management (SuperAdmin/Admin)
router.get('/admin/app-users',
  authenticateJWT,
  authorizeRoles('SUPER_ADMIN', 'ADMIN'),
  AdminController.getAppUsers
);
router.patch('/admin/app-users/:id/subscription',
  authenticateJWT,
  authorizeRoles('SUPER_ADMIN', 'ADMIN'),
  AdminController.updateAppUserSubscription
);

// User routes
router.post('/users/register', validate(registerUserSchema), UserController.register);
router.post('/users/verify-email', validate(verifyEmailSchema), UserController.verifyEmail);
router.post('/users/resend-otp', validate(resendOtpSchema), UserController.resendOTP);
router.post('/users/login', UserController.login);
router.post('/users/google-login', validate(googleLoginSchema), UserController.googleLogin);
router.post('/users/start-trial', authenticateJWT, UserController.startTrial);
router.get('/users/profile', authenticateJWT, UserController.getProfile);
router.patch('/users/profile', authenticateJWT, UserController.updateProfile);

// Payment Gateway routes
router.post('/payments/culqi', authenticateJWT, PaymentGatewayController.createCulqiPayment);
router.post('/payments/mercadopago', authenticateJWT, PaymentGatewayController.createMercadoPagoPayment);
router.post('/payments/yape', authenticateJWT, PaymentGatewayController.createYapePayment);

// Webhooks
router.post('/webhooks/culqi', PaymentGatewayController.culqiWebhook);
router.post('/webhooks/mercadopago', PaymentGatewayController.mercadoPagoWebhook);

// Notification System routes
router.get('/notifications/code', authenticateJWT, NotificationController.getMyNotificationCode);
router.get('/notifications/find-user/:code', authenticateJWT, NotificationController.findUserByCode);
router.post('/notifications/link-request', authenticateJWT, NotificationController.sendLinkRequest);
router.get('/notifications/link-requests', authenticateJWT, NotificationController.getLinkRequests);
router.post('/notifications/link-requests/:requestId/accept', authenticateJWT, NotificationController.acceptLinkRequest);
router.post('/notifications/link-requests/:requestId/reject', authenticateJWT, NotificationController.rejectLinkRequest);
router.get('/notifications/linked-users', authenticateJWT, NotificationController.getLinkedUsers);
router.patch('/notifications/links/:linkId', authenticateJWT, NotificationController.updateLink);
router.delete('/notifications/links/:linkId', authenticateJWT, NotificationController.deleteLink);
router.post('/notifications/fcm-token', authenticateJWT, NotificationController.registerFcmToken);

export default router;
