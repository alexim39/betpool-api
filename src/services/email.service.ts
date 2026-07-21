import nodemailer from 'nodemailer';

const emailUser = process.env.EMAIL_USER || 'support@betpool.tech';
const emailPass = process.env.EMAIL_PASS || '';
const emailFrom = process.env.EMAIL_FROM || '"BetPool" <noreply@betpool.tech>';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'betpool.tech',
  secure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === 'true' : false,
  port: Number(process.env.EMAIL_PORT || 587),
  auth: {
    user: emailUser,
    pass: emailPass,
  },
});

export const sendEmail = async (
  to: string,
  subject: string,
  html: string
): Promise<void> => {
  if (!to) {
    console.error('Email send failed — no recipient');
    return;
  }

  try {
    await transporter.sendMail({ from: emailFrom, to, subject, html });
  } catch (error) {
    console.error(`Email send failed — to:${to} subject:"${subject}" error:${error}`);
  }
};

const BRAND = {
  primary: '#0A1428',
  accent: '#00E676',
  accentGradient: 'linear-gradient(135deg, #00E676 0%, #00C853 100%)',
  gold: '#D4AF37',
  goldGradient: 'linear-gradient(135deg, #E8B923 0%, #D4AF37 100%)',
  bodyBg: '#0A1428',
  cardBg: '#0D1A30',
  cardBorder: 'rgba(255,255,255,0.06)',
  cardRadius: '16px',
  fontStack: "'Inter', Arial, sans-serif",
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.7)',
  textMuted: 'rgba(255,255,255,0.4)',
  footerBg: '#0A1428',
  footerText: 'rgba(255,255,255,0.4)',
  maxWidth: '560px',
  logoUrl: '',
};

export const wrapEmail = (title: string, content: string, preheader?: string): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};font-family:${BRAND.fontStack};color:${BRAND.textPrimary}">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:${BRAND.maxWidth};margin:40px auto;background:${BRAND.cardBg};border-radius:${BRAND.cardRadius};overflow:hidden;border:1px solid ${BRAND.cardBorder}">
    <tr>
      <td style="padding:32px 32px 24px;text-align:center;background:${BRAND.primary}">
        <span style="font-size:28px;font-weight:800;font-family:'Inter',Arial,sans-serif">
          <span style="background:${BRAND.accentGradient};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Bet</span>
          <span style="background:${BRAND.goldGradient};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Pool</span>
        </span>
        <h1 style="margin:12px 0 0;font-size:18px;color:#fff;font-weight:700;letter-spacing:-0.3px">${title}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 32px;font-size:15px;line-height:1.6;color:${BRAND.textSecondary}">
        ${content}
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;background:${BRAND.footerBg};text-align:center;color:${BRAND.footerText};font-size:12px;line-height:1.5;border-top:1px solid rgba(255,255,255,0.04)">
        <p style="margin:0 0 4px">&copy; ${new Date().getFullYear()} BetPool. All rights reserved.</p>
        <p style="margin:0">Powered by BetPool &mdash; smart micro-betting for everyone.</p>
        <p style="margin:4px 0 0">Need help? Contact <a href="mailto:support@betpool.tech" style="color:${BRAND.accent};text-decoration:none;font-weight:600">support@betpool.tech</a></p>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const brandedButton = (text: string, url: string): string => `<div style="text-align:center;margin:24px 0">
  <a href="${url}" style="display:inline-block;padding:14px 36px;background:${BRAND.accentGradient};color:#0A1428;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;font-family:'Inter',Arial,sans-serif">${text}</a>
</div>`;
