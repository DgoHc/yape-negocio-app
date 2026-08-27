import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const username = 'admin';
  const pin = '123456';

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
