export const smtpConfig = {
  senderEmail: process.env.SENDER_EMAIL || '',
  senderPassword: process.env.SENDER_PASSWORD || '',
  timeout: parseInt(process.env.SMTP_TIMEOUT || '10000', 10),
};
