import nodemailer from 'nodemailer';
import logger from '../utils/logger';

export class MailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT || '587'),
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  static async sendOTP(email: string, code: string) {
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
          <p style="color: #999; font-size: 14px;">Este código expirará en 10 minutos.</p>
        </div>
        <div style="margin-top: 20px; font-size: 12px; color: #aaa; text-align: center;">
          <p>Si no solicitaste este código, puedes ignorar este correo con seguridad.</p>
          <p>&copy; 2025 Yape Transporte</p>
        </div>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `"Yape Transporte" <${process.env.MAIL_USER}>`,
        to: email,
        subject: 'Código de verificación - Yape Transporte',
        html: html,
      });
      logger.info(`OTP sent successfully to ${email}`);
    } catch (error) {
      logger.error(`Error sending email to ${email}:`, error);
      // In development, we still log the code so the user can test without working SMTP
      if (process.env.NODE_ENV === 'development') {
        logger.info(`[DEV ONLY] Verification code for ${email}: ${code}`);
      }
      throw error;
    }
  }
}
