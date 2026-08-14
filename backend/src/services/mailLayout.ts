export const SHOP_URL = 'https://itgelshop.mn';
export const EMAIL_LOGO_CID = 'itgel-logo@itgelshop.mn';
export const EMAIL_LOGO_FALLBACK_URL = `${SHOP_URL}/logo.png`;

const NAVY = '#2a2a65';
const CYAN = '#44b9ea';
const INK = '#1a1a2e';
const MUTED = '#5c5c78';
const LINE = '#e6e6ef';
const PAGE = '#f4f5f8';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function otpCodeHtml(code: string): string {
  return `<div style="margin:24px 0;padding:18px 16px;background:${PAGE};border:1px solid ${LINE};border-radius:10px;text-align:center">
  <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};font-family:Arial,Helvetica,sans-serif">Нэг удаагийн код</div>
  <div style="margin-top:8px;font-size:32px;letter-spacing:0.28em;font-weight:700;color:${NAVY};font-family:'Courier New',Courier,monospace">${escapeHtml(code)}</div>
  <div style="margin-top:8px;font-size:12px;color:${MUTED};font-family:Arial,Helvetica,sans-serif">10 минутын дотор хүчинтэй</div>
</div>`;
}

export function officialEmailHtml(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  logoSrc: string;
}): string {
  const preheader = escapeHtml(opts.preheader);
  const heading = escapeHtml(opts.heading);

  return `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
          <tr>
            <td style="background:${NAVY};padding:22px 28px">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px">
                    <img src="${opts.logoSrc}" width="52" height="52" alt="Итгэл" style="display:block;width:52px;height:52px;border:0;border-radius:12px;background:#000" />
                  </td>
                  <td style="vertical-align:middle">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.02em">Итгэл</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${CYAN};margin-top:2px">Захиалгын дэлгүүр</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background:${CYAN};font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;font-family:Arial,Helvetica,sans-serif">
              <h1 style="margin:0 0 18px;font-size:18px;line-height:1.4;color:${NAVY};font-weight:700">${heading}</h1>
              <div style="font-size:15px;line-height:1.65;color:${INK}">${opts.bodyHtml}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${MUTED}">
              Хүндэтгэсэн,<br />
              <strong style="color:${NAVY}">Итгэл</strong>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid ${LINE};background:${PAGE};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED}">
              Энэхүү захидал автоматаар илгээгдсэн тул хариу бичих шаардлагагүй.<br />
              <a href="${SHOP_URL}" style="color:${NAVY};text-decoration:none;font-weight:600">itgelshop.mn</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
