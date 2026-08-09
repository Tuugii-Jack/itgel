import { env } from '../env.js';

export interface SmsMessage {
  phone: string;
  text: string;
}

/** Провайдер солиход зөвхөн энэ интерфейсийг шинээр хэрэгжүүлнэ. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ ok: boolean; id?: string; error?: string }>;
}

/** Dev — console руу бичнэ. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  async send(message: SmsMessage) {
    console.info(`[sms:console] → ${message.phone}\n${message.text}`);
    return { ok: true, id: `console-${Date.now()}` };
  }
}

/** Ерөнхий HTTP провайдер — ихэнх монгол SMS gateway-д тохирно. */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly sender: string,
  ) {}

  async send(message: SmsMessage) {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ from: this.sender, to: message.phone, text: message.text }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}

function build(): SmsProvider {
  if (env.SMS_PROVIDER === 'http' && env.SMS_API_URL && env.SMS_API_KEY) {
    return new HttpSmsProvider(env.SMS_API_URL, env.SMS_API_KEY, env.SMS_SENDER);
  }
  return new ConsoleSmsProvider();
}

export const sms: SmsProvider = build();

export const smsTemplates = {
  otp: (code: string) => `itgel: Нэвтрэх код ${code}. Хугацаа 5 минут.`,
  orderCreated: (code: string, amount: number) =>
    `itgel: Захиалга ${code} бүртгэгдлээ. Төлөх дүн ${amount.toLocaleString('mn-MN')}₮.`,
  arrived: (code: string, address: string, workHours: string) =>
    `itgel: ${code} захиалга агуулахад ирлээ. Авах хаяг: ${address}. Цаг: ${workHours}. Код-оо хэлж авна уу.`,
};
