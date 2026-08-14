import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env, isProd } from '../env.js';
import {
  EMAIL_LOGO_CID,
  EMAIL_LOGO_FALLBACK_URL,
  escapeHtml,
  officialEmailHtml,
  otpCodeHtml,
  SHOP_URL,
} from './mailLayout.js';

const smtpReady = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const transporter = smtpReady
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  : null;

function fromHeader(): string {
  const raw = env.SMTP_FROM ?? env.SMTP_USER ?? 'noreply@itgelshop.mn';
  const address = raw.match(/<([^>]+)>/)?.[1]?.trim() ?? raw.trim();
  return `"Итгэл" <${address}>`;
}

function logoBuffer(): Buffer | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'assets/email-logo.png'),
    path.join(here, '../../assets/email-logo.png'),
    path.join(here, '../../../assets/email-logo.png'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file);
  }
  return null;
}

const attachedLogo = logoBuffer();
const logoSrc = attachedLogo ? `cid:${EMAIL_LOGO_CID}` : EMAIL_LOGO_FALLBACK_URL;

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export interface SendMailResult {
  ok: boolean;
  error?: string;
  /** Dev дээр SMTP байхгүй үед UI тестлэхэд. */
  devCode?: string;
}

/**
 * И-мэйл илгээнэ. SMTP тохируулаагүй бол development-д console + devCode,
 * production-д алдаа буцаана.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Хэрэв илгээлт mock бол энэ кодыг devCode-оор буцаана. */
  codeForDev?: string;
}): Promise<SendMailResult> {
  if (!transporter) {
    const msg = `[mail] SMTP тохируулаагүй — ${opts.to}: ${opts.subject}\n${opts.text}`;
    console.info(msg);
    if (isProd) return { ok: false, error: 'И-мэйл илгээх тохиргоо дутуу байна.' };
    return { ok: true, devCode: opts.codeForDev };
  }

  try {
    await transporter.sendMail({
      from: fromHeader(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html:
        opts.html ??
        officialEmailHtml({
          preheader: opts.subject,
          heading: opts.subject,
          bodyHtml: `<p style="margin:0;white-space:pre-wrap">${escapeHtml(opts.text)}</p>`,
          logoSrc,
        }),
      attachments: attachedLogo
        ? [
            {
              filename: 'itgel-logo.png',
              content: attachedLogo,
              cid: EMAIL_LOGO_CID,
              contentDisposition: 'inline',
              contentType: 'image/png',
            },
          ]
        : undefined,
    });
    return { ok: true, ...(isProd ? {} : { devCode: opts.codeForDev }) };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'И-мэйл илгээж чадсангүй.';
    console.error('[mail]', error);
    return { ok: false, error };
  }
}

function letter(
  heading: string,
  paragraphs: string[],
  extra?: { html?: string; text?: string; insertHtmlAfter?: number },
): MailContent {
  const pHtml = paragraphs.map(
    (p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`,
  );
  const insertAt = extra?.insertHtmlAfter ?? pHtml.length;
  if (extra?.html) pHtml.splice(insertAt, 0, extra.html);
  const textParts = extra?.text
    ? [
        ...paragraphs.slice(0, extra.insertHtmlAfter ?? paragraphs.length),
        extra.text,
        ...paragraphs.slice(extra.insertHtmlAfter ?? paragraphs.length),
      ]
    : paragraphs;
  const text = `${textParts.join('\n\n')}\n\nХүндэтгэсэн,\nИтгэл\n${SHOP_URL}`;
  return {
    subject: `Итгэл — ${heading}`,
    text,
    html: officialEmailHtml({
      preheader: `${heading}. ${paragraphs[0] ?? ''}`,
      heading,
      bodyHtml: pHtml.join('\n'),
      logoSrc,
    }),
  };
}

export const mailTemplates = {
  verify: (code: string) =>
    letter(
      'И-мэйл хаяг баталгаажуулах',
      [
        'Хүндэт харилцагч танаа,',
        'Таны и-мэйл хаягийг баталгаажуулах нэг удаагийн кодыг доор илгээлээ. Энэ кодыг өөр хүнтэй хуваалцахгүй байхыг хүсье.',
        'Хэрэв та энэ хүсэлтийг илгээгээгүй бол захидлыг үл хэрэгсэнэ үү.',
      ],
      {
        html: otpCodeHtml(code),
        text: `Нэг удаагийн код: ${code}\nКод 10 минутын дотор хүчинтэй.`,
        insertHtmlAfter: 2,
      },
    ),
  reset: (code: string) =>
    letter(
      'Нууц үг сэргээх',
      [
        'Хүндэт харилцагч танаа,',
        'Таны Итгэл бүртгэлийн нууц үгийг сэргээх нэг удаагийн кодыг доор илгээлээ. Кодыг оруулсны дараа шинэ нууц үг тохируулна уу.',
        'Хэрэв та нууц үг сэргээх хүсэлт илгээгээгүй бол энэ захидлыг үл хэрэгсэж, нууц үгээ солихыг зөвлөж байна.',
      ],
      {
        html: otpCodeHtml(code),
        text: `Нэг удаагийн код: ${code}\nКод 10 минутын дотор хүчинтэй.`,
        insertHtmlAfter: 2,
      },
    ),
  /** Админ төлбөр шалгаад захиалгыг баталгаажуулсан. */
  orderConfirmed: (code: string, name?: string | null) => {
    const greet = name?.trim() ? `Хүндэт ${name.trim()},` : 'Хүндэт харилцагч танаа,';
    return letter(`Захиалга ${code} баталгаажлаа`, [
      greet,
      `Таны ${code} дугаартай захиалгын төлбөрийг хүлээн авч, захиалгыг амжилттай баталгаажууллаа.`,
      'Бараа ирэхэд танд мэдэгдэх болно. Захиалгын төлөвийг itgelshop.mn дээрх бүртгэлээсээ харах боломжтой.',
    ]);
  },
};
