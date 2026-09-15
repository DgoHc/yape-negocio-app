import axios from 'axios';
import logger from '../utils/logger.js';

export class MailService {
  static async sendOTP(email: string, code: string) {
    logger.info(`[SEGURIDAD] Enviando OTP para ${email}: ${code}`);

    const apiKey = (process.env.RESEND_API_KEY || '').replace(/['"]+/g, '').trim();

    if (!apiKey) {
      logger.warn('RESEND_API_KEY no configurada. El correo no se enviará, pero el código es visible arriba.');
      return;
    }

    try {
      await axios.post('https://api.resend.com/emails', {
        from: 'SonoPay <onboarding@resend.dev>', // Usamos el dominio de prueba de Resend
        to: email,
        subject: 'Tu código de verificación - SonoPay',
        html: `<strong>Tu código es: ${code}</strong>. Expira en 15 minutos.`
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      logger.info(`OTP sent successfully via RESEND to ${email}`);
    } catch (error: any) {
      logger.error('Resend API Error:', error.response?.data || error.message);
    }
  }
}
