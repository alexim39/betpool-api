import nodemailer from 'nodemailer';
import { logger } from './logger.service';

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
    logger.error('Email send failed — no recipient');
    return;
  }

  try {
    await transporter.sendMail({ from: emailFrom, to, subject, html });
  } catch (error) {
    logger.error('Email send failed', { to, subject, error });
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
  cardBgAlt: '#0F1D36',
  cardBorder: 'rgba(255,255,255,0.06)',
  cardRadius: '16px',
  fontStack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.7)',
  textMuted: 'rgba(255,255,255,0.4)',
  footerBg: '#0A1428',
  footerText: 'rgba(255,255,255,0.35)',
  maxWidth: '560px',
  logoUrl: process.env.LOGO_URL || 'https://betpool.tech/img/logo/logo.jpg',
};

export const wrapEmail = (title: string, content: string, preheader?: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0A1428;font-family:${BRAND.fontStack};color:#FFFFFF">
  ${preheader ? `<!--[if !mso]><!-- --><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0A1428;mso-hide:all">${preheader}</div><!--<![endif]-->` : ''}

  <!-- Dot-grid background texture -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A1428;background-image:radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px);background-size:32px 32px" bgcolor="#0A1428">
    <tr>
      <td align="center" style="padding:24px 16px">

        <!-- Main card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#0D1A30;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06)" bgcolor="#0D1A30">

          <!-- Header with logo and decorative top border -->
          <tr>
            <td style="padding:4px 0 0;background:linear-gradient(90deg, #00E676, #E8B923);font-size:0;line-height:0" height="4" bgcolor="#00E676">
              <table width="100%" cellpadding="0" cellspacing="0" height="4">
                <tr>
                  <td width="50%" height="4" style="background:#00E676;font-size:0;line-height:0" bgcolor="#00E676">&nbsp;</td>
                  <td width="50%" height="4" style="background:#E8B923;font-size:0;line-height:0" bgcolor="#E8B923">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 20px;text-align:center;background-color:#0A1428" bgcolor="#0A1428">
              <img src="${BRAND.logoUrl}" alt="BetPool" width="132" style="display:block;margin:0 auto;border:0;outline:none;height:auto">
              <div style="width:60px;height:3px;margin:16px auto 0;background:linear-gradient(90deg, #00E676, #E8B923);border-radius:2px"></div>
              <h1 style="margin:12px 0 0;font-size:20px;color:#FFFFFF;font-weight:700;letter-spacing:-0.3px;mso-line-height-rule:exactly;line-height:1.3">${title}</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:28px 32px 32px;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.75)" bgcolor="#0D1A30">
              ${content}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:1px;background:rgba(255,255,255,0.06);font-size:0;line-height:0">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 32px;text-align:center;background-color:#0A1428" bgcolor="#0A1428">
              <img src="${BRAND.logoUrl}" alt="BetPool" width="88" style="display:inline-block;border:0;outline:none;height:auto;opacity:0.5">
              <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.35)">
                &copy; ${new Date().getFullYear()} BetPool. All rights reserved.
              </p>
              <p style="margin:4px 0 0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.35)">
                Need help? <a href="mailto:support@betpool.tech" style="color:#00E676;text-decoration:none;font-weight:600">support@betpool.tech</a>
              </p>
              <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.2)">
                This is an automated message from BetPool. Please do not reply directly.
              </p>
            </td>
          </tr>

        </table>

        <!-- Postscript -->
        <p style="margin:16px 0 0;font-size:11px;color:rgba(255,255,255,0.2);text-align:center">
          Smart AI micro-betting for everyone
        </p>

      </td>
    </tr>
  </table>
</body>
</html>`;

export const brandedButton = (text: string, url: string): string => `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="border-radius:10px;background:linear-gradient(135deg, #00E676 0%, #00C853 100%);padding:1px" bgcolor="#00E676">
            <a href="${url}" style="display:inline-block;padding:14px 36px;background:#0D1A30;color:#00E676;text-decoration:none;border-radius:9px;font-size:15px;font-weight:700;font-family:${BRAND.fontStack};margin:0">${text}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
