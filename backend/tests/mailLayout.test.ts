import { describe, expect, it } from 'vitest';
import { mailTemplates } from '../src/services/mail.js';
import { escapeHtml, officialEmailHtml, otpCodeHtml } from '../src/services/mailLayout.js';

describe('mailLayout', () => {
  it('HTML тусгай тэмдэгтийг escape хийнэ', () => {
    expect(escapeHtml('A <b> & "x"')).toBe('A &lt;b&gt; &amp; &quot;x&quot;');
  });

  it('албан загварт лого, нэр, подпис орно', () => {
    const html = officialEmailHtml({
      preheader: 'preview',
      heading: 'Гарчиг',
      bodyHtml: '<p>Бие</p>',
      logoSrc: 'cid:itgel-logo@itgelshop.mn',
    });
    expect(html).toContain('cid:itgel-logo@itgelshop.mn');
    expect(html).toContain('Итгэл');
    expect(html).toContain('Захиалгын дэлгүүр');
    expect(html).toContain('itgelshop.mn');
    expect(html).toContain('Хүндэтгэсэн');
  });

  it('OTP код HTML-д escape хийгдэнэ', () => {
    expect(otpCodeHtml('12<34')).toContain('12&lt;34');
  });
});

describe('mailTemplates', () => {
  it('баталгаажуулах захидалд код, лого орно', () => {
    const mail = mailTemplates.verify('482910');
    expect(mail.subject).toMatch(/^Итгэл — /);
    expect(mail.text).toContain('482910');
    expect(mail.html).toContain('482910');
    expect(mail.html).toContain('Итгэл');
    expect(mail.html).toMatch(/cid:itgel-logo@itgelshop\.mn|itgelshop\.mn\/logo\.png/);
  });

  it('захиалгын нэрийг escape хийнэ', () => {
    const mail = mailTemplates.orderConfirmed('IT-1', 'Бат <script>');
    expect(mail.html).toContain('Бат &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
  });
});
