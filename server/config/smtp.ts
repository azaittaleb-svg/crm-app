export const smtpConfig = {
  senderEmail: process.env.SENDER_EMAIL || '',
  senderPassword: process.env.SENDER_PASSWORD || '',
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : true,
  timeout: parseInt(process.env.SMTP_TIMEOUT || '15000', 10),
};
