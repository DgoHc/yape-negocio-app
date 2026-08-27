import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // CONFIGURACIÓN DE ACCESO SEGURO
  // Cambia estos valores por algo que solo tú sepas
  const username = process.env.ADMIN_USERNAME || 'diego_admin_elite';
  const pin = process.env.ADMIN_PIN || '998877665544332211'; // PIN muy largo y seguro

  // Hashing consistently with AdminController.createUser
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.createHash('sha256').update(pin + salt).digest('hex');
  const pinHash = `${hashed}:${salt}`;

  const admin = await prisma.adminUser.upsert({
    where: { username },
    update: {},
    create: {
      username,
      pinHash,
      role: 'SUPER_ADMIN',
    },
  });

  console.log('--------------------------------------');
  console.log('SEED COMPLETO');
  console.log(`Usuario Admin creado: ${admin.username}`);
  console.log(`PIN: ${pin}`);
  console.log('--------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
