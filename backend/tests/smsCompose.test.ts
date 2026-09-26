import { describe, expect, it } from 'vitest';
import { assertSmsText, smsPreviewToken, smsSegmentOf } from '../src/lib/smsCompose.js';

describe('SMS preview helpers', () => {
  it('кирилл текстийг UCS-2 сегментээр тооцно', () => {
    const short = smsSegmentOf('сайн байна уу');
    expect(short.encoding).toBe('ucs2');
    expect(short.segments).toBe(1);
    const long = smsSegmentOf('а'.repeat(71));
    expect(long.segments).toBe(2);
  });

  it('latin текстийг GSM сегментээр тооцно', () => {
    expect(smsSegmentOf('hello').encoding).toBe('gsm');
    expect(smsSegmentOf('a'.repeat(161)).segments).toBe(2);
  });

  it('URL-ийг preview-ийн эцсийн текст дээр хасна', () => {
    expect(assertSmsText('сайн https://itgel.mn байна')).toBe('сайн байна');
  });

  it('хоосон болон хэт урт мессежийг таслана', () => {
    expect(() => assertSmsText('   https://x.mn  ')).toThrow();
    expect(() => assertSmsText('а'.repeat(400))).toThrow();
  });

  it('хүлээн авагч/мессеж өөрчлөгдвөл token өөр', () => {
    const a = smsPreviewToken([{ id: '1', text: 'сайн' }]);
    const b = smsPreviewToken([{ id: '1', text: 'сайн уу' }]);
    const c = smsPreviewToken([{ id: '2', text: 'сайн' }]);
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
