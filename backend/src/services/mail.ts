import nodemailer from 'nodemailer';
import { env, isProd } from '../env.js';

const smtpReady = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const transporter = smtpReady
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  : null;

const fromAddress = env.SMTP_FROM ?? env.SMTP_USER ?? 'noreply@itgel.mn';

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
      from: fromAddress,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? `<pre style="font-family:sans-serif">${opts.text}</pre>`,
    });
    return { ok: true, ...(isProd ? {} : { devCode: opts.codeForDev }) };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'И-мэйл илгээж чадсангүй.';
    console.error('[mail]', error);
    return { ok: false, error };
  }
}

export const mailTemplates = {
  verify: (code: string) => ({
    subject: 'itgel — и-мэйл баталгаажуулах код',
    text: `Таны баталгаажуулах код: ${code}\n\nКод 10 минутын дотор хүчинтэй.\nХэрэв та бүртгүүлээгүй бол энэ захидлыг үл хэрэгсэнэ үү.`,
  }),
  reset: (code: string) => ({
    subject: 'itgel — нууц үг сэргээх код',
    text: `Нууц үг сэргээх код: ${code}\n\nКод 10 минутын дотор хүчинтэй.\nХэрэв та хүсээгүй бол энэ захидлыг үл хэрэгсэнэ үү.`,
  }),
  /** Админ төлбөр шалгаад захиалгыг баталгаажуулсан. */
  orderConfirmed: (code: string, name?: string | null) => {
    const greet = name?.trim() ? `${name.trim()}, ` : '';
    return {
      subject: `itgel — захиалга ${code} амжилттай баталгаажлаа`,
      text: `${greet}таны ${code} захиалга амжилттай баталгаажлаа.\n\nТөлбөр хүлээн авсан. Бараа ирэхэд мэдэгдэнэ.\nБаярлалаа.`,
    };
  },
};
