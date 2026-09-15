import axios from 'axios';
import logger from '../utils/logger.js';

export class MailService {
  static async sendOTP(email: string, code: string) {
    logger.info(`[SEGURIDAD] Enviando OTP para ${email}: ${code}`);

    const apiKey = (process.env.RESEND_API_KEY || '').replace(/['"]+/g, '').trim();

    if (!apiKey) {
      logger.warn('RESEND_API_KEY no configurada.');
      return;
    }

    try {
      // IMPORTANTE: Una vez que el dominio esté 'Verified' en Resend,
      // usaremos el remitente oficial de novabytexrj.com
      await axios.post('https://api.resend.com/emails', {
        from: 'SonoPay <otp@novabytexrj.com>',
        to: email,
        subject: 'Código de Verificación - SonoPay',
        html: `
          <div style="font-family: sans-serif; text-align: center; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #7C4DFF;">Verifica tu identidad</h2>
            <p>Usa este código para ingresar a SonoPay:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; color: #333;">${code}</div>
            <p style="color: #999; font-size: 12px;">Este código expira en 15 minutos.</p>
          </div>
        `
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      logger.info(`OTP sent successfully via RESEND to ${email}`);
    } catch (error: any) {
      const errorData = error.response?.data;
      logger.error('Resend API Error:', errorData || error.message);
    }
  }
}
