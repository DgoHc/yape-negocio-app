import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  console.log('--- VERIFICACIÓN DE BASE DE DATOS ---');
  try {
    const adminCount = await prisma.adminUser.count();
    console.log(`Total de Administradores: ${adminCount}`);

    if (adminCount > 0) {
      const admins = await prisma.adminUser.findMany({
        select: { username: true, role: true }
      });
      console.log('Usuarios encontrados:');
      admins.forEach(a => console.log(` - ${a.username} (${a.role})`));
    } else {
      console.log('⚠️ No se encontró ningún administrador. Ejecuta: npx prisma db seed');
    }

    const deviceCount = await prisma.device.count();
    console.log(`Total de Dispositivos: ${deviceCount}`);

  } catch (error) {
    console.error('❌ Error conectando a la base de datos:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
