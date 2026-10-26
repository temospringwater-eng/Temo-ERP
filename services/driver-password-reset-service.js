'use strict';
const crypto = require('crypto');

// Central ERP only: driver-specific, emailed, short-lived recovery codes.
// No passwords, recovery tokens or account-existence details are returned by request().
function createDriverPasswordResetService({ query, insert, update, hashPassword, sendEmail }) {
  const message = 'If this active driver has a registered email address, a reset code will be sent.';
  const invalid = 'Invalid or expired code. Ask your Company Admin if recovery is unavailable.';
  const codeHash = (userId, code) => crypto.createHash('sha256')
    .update(String(userId) + ':' + String(code).toUpperCase())
    .digest('hex');

  async function driver(username) {
    const rows = await query(`SELECT u.id, u.email, u.company_id
      FROM users u JOIN companies c ON c.id = u.company_id
      WHERE LOWER(u.username) = ? AND u.active = 1 AND u.status = 'active'
        AND u.role IN ('driver','delivery_driver') AND c.status = 'active'
      LIMIT 1`, [String(username || '').trim().toLowerCase()]);
    return rows[0] || null;
  }

  async function request(username) {
    const identifier = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._@+-]{2,120}$/.test(identifier)) return { success: true, message };
    const user = await driver(identifier);
    if (!user || !user.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user.email)) {
      return { success: true, message };
    }
    // Persistent per-account throttle. Never disclose accounts or their email.
    const counts = await query(`SELECT COUNT(*) AS n FROM driver_password_reset_codes
       WHERE user_id = ? AND created_at >= datetime('now','-1 hour')`, [user.id]);
    if (Number(counts[0]?.n || 0) >= 3) return { success: true, message };
    const code = crypto.randomBytes(6).toString('hex').toUpperCase(); // 48-bit, 12 hex chars
    const hash = codeHash(user.id, code);
    await update(`UPDATE driver_password_reset_codes SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND used_at IS NULL`, [user.id]);
    const record = await insert(`INSERT INTO driver_password_reset_codes
      (user_id, code_hash, expires_at)
      VALUES (?, ?, datetime('now','+10 minutes'))`, [user.id, hash]);
    const delivery = await sendEmail({
      recipient: user.email,
      type: 'driver_password_reset',
      variables: {},
      subject: 'TEMO Driver - password reset verification code',
      message: `Your TEMO Driver recovery code is: ${code}\n\nThis code expires in 10 minutes. Never share it. If you did not request it, contact your company administrator.`
    });
    if (delivery.status !== 'sent') {
      await update('UPDATE driver_password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [record.id]);
    }
    return { success: true, message };
  }

  async function confirm(username, suppliedCode, newPassword) {
    const identifier = String(username || '').trim().toLowerCase();
    const code = String(suppliedCode || '').trim().toUpperCase();
    const password = String(newPassword || '');
    if (!/^[A-F0-9]{12}$/.test(code) || password.length < 8 || password.length > 256)
      return { success: false, message: invalid };
    const user = await driver(identifier);
    if (!user) return { success: false, message: invalid };
    const rows = await query(`SELECT id, code_hash FROM driver_password_reset_codes
      WHERE user_id = ? AND used_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP AND attempts < 5
      ORDER BY id DESC LIMIT 1`, [user.id]);
    const item = rows[0];
    if (!item) return { success: false, message: invalid };
    // Count every attempt, including incorrect codes, before checking its hash.
    const attempt = await update(`UPDATE driver_password_reset_codes
      SET attempts = attempts + 1
      WHERE id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempts < 5`, [item.id]);
    if (attempt.changes !== 1) return { success: false, message: invalid };
    const expected = Buffer.from(String(item.code_hash), 'hex');
    const actual = Buffer.from(codeHash(user.id, code), 'hex');
    if (expected.length !== 32 || !crypto.timingSafeEqual(expected, actual))
      return { success: false, message: invalid };
    // One-time consumption prevents duplicate requests from resetting twice.
    const consumed = await update(`UPDATE driver_password_reset_codes SET used_at = CURRENT_TIMESTAMP
      WHERE id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`, [item.id]);
    if (consumed.changes !== 1) return { success: false, message: invalid };
    await update('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND company_id = ?',
      [hashPassword(password), user.id, user.company_id]);
    await update('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    return { success: true, message: 'Password reset successfully.' };
  }
  return { request, confirm };
}

module.exports = { createDriverPasswordResetService };
