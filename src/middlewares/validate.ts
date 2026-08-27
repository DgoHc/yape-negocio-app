import { FastifyRequest, FastifyReply } from 'fastify';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema) => 
  async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          status: 'error',
          message: 'Los datos enviados no son válidos.',
          errors: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          })),
        });
      }
      return reply.status(500).send({ status: 'error', message: 'Ocurrió un error interno en el servidor.' });
    }
  };
