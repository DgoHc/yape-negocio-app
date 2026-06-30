import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import 'dotenv/config';

const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'info', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
    { level: 'error', emit: 'stdout' },
  ],
});

// @ts-ignore
prisma.$on('query', (e: any) => {
  logger.debug(e.query);
});

export default prisma;
