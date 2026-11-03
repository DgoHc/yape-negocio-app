import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // CONFIGURACIÓN DE ACCESO SEGURO PARA EL ADMINISTRADOR PRINCIPAL
  const username = process.env.ADMIN_USERNAME || 'diego_master';
  const pin = process.env.ADMIN_PIN || '2025889966';

  // Hashing consistente con salt seguro
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.createHash('sha256').update(pin + salt).digest('hex');
  const pinHash = `${hashed}:${salt}`;

  const admin = await prisma.adminUser.upsert({
    where: { username },
    update: {
      pinHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE'
    },
    create: {
      username,
      pinHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE'
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
