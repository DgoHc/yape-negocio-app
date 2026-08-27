import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

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
  logger.debug(`Query: ${e.query} | Params: ${e.params}`);
});

export default prisma;
