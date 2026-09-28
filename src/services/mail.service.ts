import axios from 'axios';
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

export class MailService {
  private static getResendApiKey(): string {
    return (process.env.RESEND_API_KEY || '').replace(/['"]+/g, '').trim();
  }

  static async sendOTP(email: string, code: string) {
    logger.info(`[SEGURIDAD] Enviando OTP para ${email}: ${code}`);
    const apiKey = this.getResendApiKey();

    if (apiKey) {
      try {
        await axios.post(
          'https://api.resend.com/emails',
          {
            from: 'SonoPay <otp@novabytexrj.com>',
            to: email,
            subject: 'Código de Verificación - SonoPay',
            html: `
              <div style="font-family: sans-serif; text-align: center; border: 1px solid #eee; padding: 20px; border-radius: 10px; max-width: 500px; margin: 0 auto;">
                <h2 style="color: #7C4DFF;">Verifica tu identidad</h2>
                <p>Usa este código para verificar tu cuenta en SonoPay:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; color: #333;">${code}</div>
                <p style="color: #999; font-size: 12px;">Este código expira en 15 minutos.</p>
              </div>
            `
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        logger.info(`OTP sent successfully via RESEND to ${email}`);
        return;
      } catch (error: any) {
        const errorData = error.response?.data;
        logger.error('Resend API Error (OTP):', errorData || error.message);
      }
    } else {
      logger.warn('RESEND_API_KEY no configurada. Intentando fallback por SMTP...');
    }

    // Fallback via SMTP if configured
    await this.sendViaSmtp(
      email,
      'Código de Verificación - SonoPay',
      `Tu código de verificación SonoPay es: ${code}`
    );
  }

  static async sendPasswordResetOTP(email: string, code: string) {
    logger.info(`[RECUPERACIÓN] Enviando OTP de recuperación para ${email}: ${code}`);
    const apiKey = this.getResendApiKey();

    if (apiKey) {
      try {
        await axios.post(
          'https://api.resend.com/emails',
          {
            from: 'SonoPay <otp@novabytexrj.com>',
            to: email,
            subject: 'Recuperación de Contraseña - SonoPay',
            html: `
              <div style="font-family: sans-serif; text-align: center; border: 1px solid #eee; padding: 20px; border-radius: 10px; max-width: 500px; margin: 0 auto;">
                <h2 style="color: #7C4DFF;">Restablece tu contraseña</h2>
                <p>Has solicitado restablecer tu contraseña en SonoPay. Ingresa el siguiente código de seguridad en la aplicación:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; color: #333;">${code}</div>
                <p style="color: #666; font-size: 13px;">Si no solicitaste este cambio, puedes ignorar este correo de manera segura.</p>
                <p style="color: #999; font-size: 12px;">Este código expira en 15 minutos.</p>
              </div>
            `
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        logger.info(`Password reset OTP sent successfully via RESEND to ${email}`);
        return;
      } catch (error: any) {
        const errorData = error.response?.data;
        logger.error('Resend API Error (Password Reset):', errorData || error.message);
      }
    } else {
      logger.warn('RESEND_API_KEY no configurada. Intentando fallback por SMTP...');
    }

    // Fallback via SMTP if configured
    await this.sendViaSmtp(
      email,
      'Recuperación de Contraseña - SonoPay',
      `Tu código para restablecer tu contraseña en SonoPay es: ${code}`
    );
  }

  private static async sendViaSmtp(to: string, subject: string, text: string) {
    const host = process.env.MAIL_HOST;
    const port = parseInt(process.env.MAIL_PORT || '587', 10);
    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;

    if (!host || !user || !pass || user.includes('TU_CORREO')) {
      logger.error('SMTP no configurado correctamente. No se pudo enviar el correo.');
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: process.env.MAIL_SECURE === 'true',
        auth: { user, pass }
      });

      await transporter.sendMail({
        from: `SonoPay <${user}>`,
        to,
        subject,
        text
      });
      logger.info(`Correo enviado por SMTP a ${to}`);
    } catch (error: any) {
      logger.error('Error al enviar correo por SMTP:', error.message);
    }
  }
}
