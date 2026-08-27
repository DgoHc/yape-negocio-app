import { AdminUser, Device } from '../models/index.js';
import 'dotenv/config';
import sequelize from '../config/database.js';

async function main() {
  console.log('--- VERIFICACIÓN DE BASE DE DATOS (SEQUELIZE) ---');
  try {
    const adminCount = await AdminUser.count();
    console.log(`Total de Administradores: ${adminCount}`);

    if (adminCount > 0) {
      const admins = await AdminUser.findAll({
        attributes: ['username', 'role']
      });
      console.log('Usuarios encontrados:');
      admins.forEach((a: any) => console.log(` - ${a.username} (${a.role})`));
    } else {
      console.log('⚠️ No se encontró ningún administrador. Ejecuta: npm run db:seed');
    }

    const deviceCount = await Device.count();
    console.log(`Total de Dispositivos: ${deviceCount}`);

  } catch (error) {
    console.error('❌ Error conectando a la base de datos:', error);
  } finally {
    await sequelize.close();
  }
}

main();
