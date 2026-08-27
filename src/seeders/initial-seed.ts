import { AdminUser } from '../models/index.js';
import crypto from 'crypto';
import 'dotenv/config';
import sequelize from '../config/database.js';

async function main() {
  const username = 'admin';
  const pin = '123456'; // PIN inicial
  const pinHash = crypto.createHash('sha256').update(pin).digest('hex');

  const [admin] = await AdminUser.upsert({
    username,
    pinHash,
    role: 'SUPER_ADMIN',
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
    await sequelize.close();
  });
