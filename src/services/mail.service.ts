import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

export class MailService {
  // Función para limpiar comillas de las variables de entorno
  private static getEnv(key: string): string {
    const value = process.env[key] || '';
    return value.replace(/['"]+/g, '').trim();
  }

  private static transporter = nodemailer.createTransport({
    host: MailService.getEnv('MAIL_HOST') || 'smtp.gmail.com',
    port: parseInt(MailService.getEnv('MAIL_PORT') || '587'),
    secure: false, // Usamos TLS (587) que es más compatible en DigitalOcean
    auth: {
      user: MailService.getEnv('MAIL_USER'),
      pass: MailService.getEnv('MAIL_PASS'),
    },
    tls: {
      rejectUnauthorized: false // Evita errores de certificados en servidores
    }
  });

  static async sendOTP(email: string, code: string) {
    logger.info(`[SEGURIDAD] OTP Generado para ${email}: ${code}`);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #7C4DFF; margin: 0;">Yape Transporte</h1>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; text-align: center;">
          <h2 style="color: #333;">Verifica tu correo electrónico</h2>
          <p style="color: #666; font-size: 16px;">Usa el siguiente código para completar tu registro:</p>
          <div style="font-size: 32px; font-weight: bold; color: #7C4DFF; letter-spacing: 5px; margin: 20px 0; padding: 10px; border: 2px dashed #7C4DFF; display: inline-block;">
            ${code}
          </div>
          <p style="color: #999; font-size: 14px;">Este código expirará en 15 minutos.</p>
        </div>
        <div style="margin-top: 20px; font-size: 12px; color: #aaa; text-align: center;">
          <p>Si no solicitaste este código, puedes ignorar este correo con seguridad.</p>
          <p>&copy; 2025 Yape Transporte</p>
        </div>
      </div>
    `;

    try {
      const user = MailService.getEnv('MAIL_USER');
      const pass = MailService.getEnv('MAIL_PASS');

      if (!user || !pass) {
        logger.warn(`Skipping email sending to ${email}: MAIL_USER or MAIL_PASS not configured.`);
        return;
      }

      await this.transporter.sendMail({
        from: `"Yape Transporte" <${user}>`,
        to: email,
        subject: 'Código de verificación - Yape Transporte',
        html: html,
      });
      logger.info(`OTP sent successfully to ${email}`);
    } catch (error) {
      logger.error(`Failed to send email to ${email}:`, error);
    }
  }
}
