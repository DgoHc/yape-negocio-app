import { z } from 'zod';

export const registerDeviceSchema = z.object({
  body: z.object({
    uuid: z.string().min(1),
    phoneNumber: z.string().optional(),
    alias: z.string().optional(),
    deviceName: z.string().optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    androidVersion: z.string().optional(),
    pushToken: z.string().optional(),
  }),
});

export const paymentSchema = z.object({
  body: z.object({
    externalId: z.string().optional(),
    amount: z.number().positive(),
    currency: z.string().default('S/'),
    senderName: z.string().min(1),
    rawText: z.string().optional(),
    deviceId: z.string().uuid(),
  }),
});

export const adminLoginSchema = z.object({
  body: z.object({
    username: z.string().min(3),
    pin: z.string().length(6), // Assuming 6 digit PIN
  }),
});

export const registerUserSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    phone: z.string().optional(),
    businessType: z.string().optional(),
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    email: z.string().email(),
    code: z.string().length(6),
  }),
});

export const resendOtpSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const googleLoginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    name: z.string().min(2),
    googleId: z.string().min(1),
  }),
});

export const updateDeviceSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    isApproved: z.boolean().optional(),
    alias: z.string().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  }),
});

export const adminUserSchema = z.object({
  body: z.object({
    username: z.string().min(3),
    pin: z.string().length(6),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']).default('ADMIN'),
  }),
});

export const updateAdminUserSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  }),
});
