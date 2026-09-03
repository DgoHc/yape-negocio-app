import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 1. Crear el usuario Administrador Maestro
  const adminPin = process.env.ADMIN_PIN || '2025889966';
  const adminSalt = 'static_salt_for_admin';
  const adminPinHash = '869062608404285741639f7f8582f07011d88257007e0689b6574a441e8c62c3:static_salt_for_admin';

  await prisma.adminUser.upsert({
    where: { username: 'diego_master' },
    update: {},
    create: {
      username: 'diego_master',
      pinHash: adminPinHash,
      role: 'SUPER_ADMIN',
    },
  });

  // 2. CREAR CUENTA DE TESTER PARA GOOGLE PLAY
  // Esta cuenta tendrá acceso total de por vida para los revisores.
  const testerEmail = 'tester@novabytexrj.com';
  const testerPassword = await bcrypt.hash('google123456', 10);
  const farFuture = new Date();
  farFuture.setFullYear(farFuture.getFullYear() + 10); // Suscripción válida por 10 años

  await prisma.user.upsert({
    where: { email: testerEmail },
    update: {
      isVerified: true,
      isSubscribed: true,
      subscriptionEndDate: farFuture,
    },
    create: {
      email: testerEmail,
      name: 'Google Play Tester',
      password: testerPassword,
      isVerified: true,
      isSubscribed: true,
      subscriptionEndDate: farFuture,
      businessType: 'Comercio',
      notificationCode: 'TEST-GOOGLE',
    },
  });

  console.log('✅ SEED COMPLETO: Admin y Tester de Google creados con éxito.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
