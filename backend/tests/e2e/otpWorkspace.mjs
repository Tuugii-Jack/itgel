/**
 * Тусгаарласан DB дээр утас + OTP-оор workspace session авна.
 * Нууц код/токеныг хэвлэхгүй.
 */
export function createOtpWorkspace({ req, sql, data }) {
  function lit(value) {
    return String(value ?? '').replace(/'/g, "''");
  }

  function latestLoginOtp(phone) {
    return sql(
      `SELECT code FROM "PhoneOtp" WHERE phone='${lit(phone)}' AND purpose='LOGIN' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    );
  }

  function bindAdminPhone(email, phone) {
    sql(
      `UPDATE "AdminUser" SET phone='${lit(phone)}', "phoneVerifiedAt"=NOW() WHERE email='${lit(email)}'`,
    );
    sql(
      `INSERT INTO "AdminLoginPhone" ("id", "adminUserId", phone, "verifiedAt")
       SELECT concat('clp', replace(gen_random_uuid()::text, '-', '')), id, '${lit(phone)}', NOW()
       FROM "AdminUser" WHERE email='${lit(email)}'
       AND NOT EXISTS (SELECT 1 FROM "AdminLoginPhone" p WHERE p.phone = '${lit(phone)}')`,
    );
  }

  async function otpVerify(phone, name = 'OTP User') {
    const issued = await req('/api/auth/otp', { method: 'POST', body: { phone, name } });
    if (issued.status !== 200) {
      throw new Error(`otp ${issued.status}: ${issued.text}`);
    }
    const code = latestLoginOtp(phone);
    if (!/^\d{6}$/.test(code)) {
      throw new Error('otp code missing');
    }
    const verified = await req('/api/auth/verify', { method: 'POST', body: { phone, code } });
    if (verified.status !== 200) {
      throw new Error(`verify ${verified.status}: ${verified.text}`);
    }
    return data(verified);
  }

  async function workspaceLogin(email, phone) {
    bindAdminPhone(email, phone);
    const result = await otpVerify(phone, 'Workspace');
    if (!result.workspace?.token) {
      throw new Error('workspace token missing');
    }
    return {
      token: result.workspace.token,
      customerToken: result.token,
      user: result.workspace.user,
    };
  }

  return { latestLoginOtp, bindAdminPhone, otpVerify, workspaceLogin };
}
