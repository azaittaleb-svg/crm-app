import nodemailer from 'nodemailer';
import { smtpConfig } from '../config/smtp';
import { logger } from '../utils/logger';

export interface SendEmailParams {
  to: string;
  subject?: string;
  body?: string;
  attachmentName?: string;
  pdfBase64?: string;
}

export class EmailService {
  static async sendEmail({
    to,
    subject,
    body,
    attachmentName,
    pdfBase64,
  }: SendEmailParams): Promise<void> {
    const senderEmail = (process.env.SENDER_EMAIL || smtpConfig.senderEmail || '').trim();
    const senderPassword = (process.env.SENDER_PASSWORD || smtpConfig.senderPassword || '').trim();
    const timeout = parseInt(process.env.SMTP_TIMEOUT || String(smtpConfig.timeout || 15000), 10);
    const smtpHost = (process.env.SMTP_HOST || smtpConfig.host || '').trim();

    if (!senderEmail || !senderPassword) {
      throw new Error(
        'Configuration SMTP manquante sur le serveur (SENDER_EMAIL / SENDER_PASSWORD).'
      );
    }

    if (!to) {
      throw new Error("L'adresse destinataire est requise.");
    }

    const transportOptions: any = {
      service: 'gmail',
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      auth: {
        user: senderEmail,
        pass: senderPassword.replace(/\s+/g, ''),
      },
      tls: {
        rejectUnauthorized: false,
      },
    };

    if (smtpHost) {
      delete transportOptions.service;
      transportOptions.host = smtpHost;
      transportOptions.port = parseInt(process.env.SMTP_PORT || String(smtpConfig.port || 465), 10);
      transportOptions.secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : (smtpConfig.secure ?? true);
    }

    const transporter = nodemailer.createTransport(transportOptions);

    const attachments: any[] = [];
    if (pdfBase64) {
      logger.info(`Traitement de la pièce jointe (Taille base64: ${pdfBase64.length} caractères)`);

      let cleanBase64 = pdfBase64;
      if (cleanBase64.includes(';base64,')) {
        cleanBase64 = cleanBase64.split(';base64,').pop() || '';
      } else if (cleanBase64.startsWith('data:')) {
        const commaIndex = cleanBase64.indexOf(',');
        if (commaIndex > -1) {
          cleanBase64 = cleanBase64.substring(commaIndex + 1);
        }
      }

      attachments.push({
        filename: attachmentName || 'document.pdf',
        content: Buffer.from(cleanBase64.trim(), 'base64'),
        contentType: 'application/pdf',
      });
    }

    await transporter.sendMail({
      from: `"Cockpit d'Exploitation" <${senderEmail.trim()}>`,
      to: to.trim(),
      subject: subject || 'Document de Facturation',
      html:
        body ||
        `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f1f1f1; border-radius: 8px;">
          <h2 style="color: #696cff; border-bottom: 1px solid #eee; padding-bottom: 10px;">Votre Document est Prêt</h2>
          <p>Bonjour,</p>
          <p>Veuillez trouver ci-joint votre document de facturation au format PDF.</p>
          <p style="margin-top: 20px; font-size: 12px; color: #999;">Cet email a été envoyé automatiquement depuis votre Cockpit d'Exploitation.</p>
        </div>
      `,
      attachments,
    });

    logger.info(`Email envoyé avec succès à: ${to.trim().slice(0, 3)}***@***`);
  }
}
