/**
 * ============================================================================
 * ไฟล์: 06_Recovery.gs  |  ระบบหลังบ้านสำหรับกู้คืนรหัสผ่านผู้ดูแลระบบ
 *
 * มี 3 ช่องทางเมื่อ "ลืมรหัสผ่านแอดมิน":
 *  1) OTP ทางอีเมล  — กดลิงก์ "ลืมรหัสผ่าน" ที่หน้าเข้าสู่ระบบ ระบบส่งรหัส 6 หลัก
 *                     ไปยังอีเมลกู้คืนที่ตั้งไว้ แล้วตั้งรหัสผ่านใหม่ได้ทันที
 *  2) เมนูเจ้าของไฟล์ — เมนู "🆘 กู้คืนรหัสผ่านผู้ดูแลระบบ" ใช้ได้เฉพาะเจ้าของ
 *                     Google Sheets เท่านั้น (ไม่ต้องใช้รหัสผ่านเดิม)
 *  3) ตัวแก้ไขสคริปต์ — รันฟังก์ชัน emergencyResetAdminPassword() จาก Apps Script
 *                     Editor ซึ่งเข้าถึงได้เฉพาะผู้มีสิทธิ์แก้ไขสคริปต์
 * ============================================================================
 */

const RECOVERY_KEY_ = 'RECOVERY::admin_otp';
const RECOVERY_TTL_MINUTES_ = 15;
const RECOVERY_MAX_ATTEMPTS_ = 5;

/** ปกปิดอีเมลบางส่วนก่อนแสดงบนหน้าเว็บ เช่น ad***@gmail.com */
function maskEmail_(email) {
  const e = str_(email);
  const at = e.indexOf('@');
  if (at < 1) return '';
  const name = e.substring(0, at);
  const domain = e.substring(at);
  const visible = name.substring(0, Math.min(2, name.length));
  return visible + new Array(Math.max(3, name.length - visible.length + 1)).join('*') + domain;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str_(email));
}

/**
 * ขอรหัส OTP เพื่อกู้คืนรหัสผ่านผู้ดูแลระบบ
 * ระบบจะส่ง OTP ไปยัง "อีเมลกู้คืน" ที่ตั้งไว้เท่านั้น (ผู้ขอไม่สามารถระบุปลายทางเองได้)
 */
function apiRequestAdminRecovery(clientId) {
  return guard_(function () {
    const email = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
    if (!email || !isValidEmail_(email)) {
      return fail_('ยังไม่ได้ตั้งค่าอีเมลสำหรับกู้คืนรหัสผ่าน\n' +
        'กรุณาใช้เมนู "🏫 ระบบประเมินผล → 🆘 กู้คืนรหัสผ่านผู้ดูแลระบบ" ในไฟล์ Google Sheets ' +
        '(เจ้าของไฟล์เท่านั้น) เพื่อรีเซ็ตรหัสผ่าน', 'NO_RECOVERY_EMAIL');
    }

    // จำกัดการขอ OTP ไม่เกิน 3 ครั้ง/ชั่วโมง ต่อเครื่อง และ 10 ครั้ง/ชั่วโมงทั้งระบบ
    const bucket = 'recovery::' + str_(clientId || 'unknown');
    const status = rateLimitStatus_(bucket);
    if (status.blocked) {
      return fail_('ขอรหัสยืนยันบ่อยเกินไป กรุณารออีก ' + status.retryInMinutes + ' นาที', 'LOCKED');
    }
    const globalStatus = rateLimitStatus_('recovery::global');
    if (globalStatus.blocked) {
      return fail_('ระบบกำลังจำกัดการขอรหัสยืนยันชั่วคราว กรุณารออีก ' + globalStatus.retryInMinutes + ' นาที', 'LOCKED');
    }
    rateLimitFail_(bucket, 3, 60);
    rateLimitFail_('recovery::global', 10, 60);

    const otp = generateOtp_();
    const salt = randomToken_(24);
    PropertiesService.getScriptProperties().setProperty(RECOVERY_KEY_, JSON.stringify({
      hash: hashPassword_(otp, salt, 1024),
      salt: salt,
      expiresAt: Date.now() + RECOVERY_TTL_MINUTES_ * 60000,
      attempts: 0,
      requestedBy: activeUserEmail_()
    }));

    const subject = '[' + APP.NAME + '] รหัสยืนยันสำหรับตั้งรหัสผ่านผู้ดูแลระบบใหม่';
    const body =
      'มีการขอตั้งรหัสผ่านผู้ดูแลระบบใหม่\n\n' +
      'รหัสยืนยัน (OTP): ' + otp + '\n' +
      'รหัสนี้ใช้ได้ภายใน ' + RECOVERY_TTL_MINUTES_ + ' นาที และใช้ได้เพียงครั้งเดียว\n\n' +
      'เวลาที่ขอ: ' + nowStamp_() + '\n' +
      'บัญชีที่ขอ: ' + (activeUserEmail_() || 'ไม่ระบุ') + '\n\n' +
      'หากไม่ใช่ท่านที่ทำรายการนี้ ไม่ต้องดำเนินการใด ๆ รหัสจะหมดอายุเอง\n' +
      'และควรตรวจสอบสิทธิ์การเข้าถึงไฟล์ระบบอีกครั้ง\n\n' +
      '— ' + APP.NAME + ' v' + APP.VERSION;

    MailApp.sendEmail(email, subject, body);
    logAction_('-', 'admin', 'ขอรหัสกู้คืนรหัสผ่าน', 'ส่ง OTP ไปยัง ' + maskEmail_(email));

    return ok_({
      maskedEmail: maskEmail_(email),
      expiresInMinutes: RECOVERY_TTL_MINUTES_
    }, 'ส่งรหัสยืนยันไปยังอีเมล ' + maskEmail_(email) + ' แล้ว');
  });
}

/** ยืนยัน OTP และตั้งรหัสผ่านผู้ดูแลระบบใหม่ */
function apiVerifyAdminRecovery(otp, newPassword) {
  return guard_(function () {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty(RECOVERY_KEY_);
    if (!raw) return fail_('ไม่พบคำขอกู้คืนรหัสผ่าน หรือรหัสหมดอายุแล้ว กรุณาขอรหัสใหม่');

    let rec;
    try { rec = JSON.parse(raw); } catch (e) {
      props.deleteProperty(RECOVERY_KEY_);
      return fail_('ข้อมูลคำขอเสียหาย กรุณาขอรหัสใหม่');
    }

    if (Date.now() > rec.expiresAt) {
      props.deleteProperty(RECOVERY_KEY_);
      return fail_('รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่');
    }
    if (rec.attempts >= RECOVERY_MAX_ATTEMPTS_) {
      props.deleteProperty(RECOVERY_KEY_);
      logAction_('-', 'admin', 'กู้คืนรหัสผ่านล้มเหลว', 'ใส่ OTP ผิดเกินจำนวนที่กำหนด');
      return fail_('ใส่รหัสยืนยันผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่');
    }

    if (!safeEquals_(hashPassword_(str_(otp), rec.salt, 1024), rec.hash)) {
      rec.attempts = (rec.attempts || 0) + 1;
      props.setProperty(RECOVERY_KEY_, JSON.stringify(rec));
      return fail_('รหัสยืนยันไม่ถูกต้อง (เหลืออีก ' + (RECOVERY_MAX_ATTEMPTS_ - rec.attempts) + ' ครั้ง)');
    }

    const policy = checkPasswordPolicy_(newPassword);
    if (!policy.ok) return fail_(policy.message);

    applyNewAdminPassword_(newPassword, 'กู้คืนผ่าน OTP ทางอีเมล');
    props.deleteProperty(RECOVERY_KEY_);

    const email = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
    if (email) {
      try {
        MailApp.sendEmail(email, '[' + APP.NAME + '] ตั้งรหัสผ่านผู้ดูแลระบบใหม่เรียบร้อย',
          'รหัสผ่านผู้ดูแลระบบถูกตั้งใหม่เมื่อ ' + nowStamp_() + '\n' +
          'บัญชีที่ดำเนินการ: ' + (activeUserEmail_() || 'ไม่ระบุ') + '\n\n' +
          'หากไม่ใช่ท่าน กรุณาเปลี่ยนรหัสผ่านทันทีและตรวจสอบสิทธิ์การเข้าถึงไฟล์ระบบ');
      } catch (e) { /* ส่งอีเมลแจ้งเตือนไม่สำเร็จ ไม่ถือเป็นข้อผิดพลาดร้ายแรง */ }
    }
    return ok_(null, 'ตั้งรหัสผ่านใหม่เรียบร้อย กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
  });
}

/** ตั้งรหัสผ่านผู้ดูแลระบบใหม่ พร้อมเพิกถอนเซสชันเดิมทั้งหมด */
function applyNewAdminPassword_(newPassword, reason) {
  const rec = makePasswordRecord_(newPassword, getSettingNumber_(SETTING_KEYS.ADMIN_ITER, 4096));
  setSettings_({
    admin_password_hash: rec.hash,
    admin_password_salt: rec.salt,
    admin_password_iterations: rec.iterations,
    admin_password_changed_at: nowStamp_()
  });
  destroyAllSessions_('admin');
  rateLimitReset_('admin::global');
  logAction_('ระบบ', 'admin', 'ตั้งรหัสผ่านผู้ดูแลระบบใหม่', reason || '');
}

// ==================== ช่องทางที่ 2: เมนูสำหรับเจ้าของไฟล์ ====================

/** ตรวจว่าเป็นเจ้าของไฟล์ Google Sheets หรือไม่ */
function isSpreadsheetOwner_() {
  try {
    const owner = ss_().getOwner();
    if (!owner) return true; // ไฟล์ในไดรฟ์ที่แชร์: ใช้สิทธิ์แก้ไขไฟล์เป็นเกณฑ์แทน
    return owner.getEmail() === Session.getEffectiveUser().getEmail();
  } catch (e) {
    return false;
  }
}

/**
 * เมนู: กู้คืนรหัสผ่านผู้ดูแลระบบ (เจ้าของไฟล์เท่านั้น)
 * ใช้เมื่อลืมรหัสผ่าน และยังไม่ได้ตั้งอีเมลกู้คืน หรือเข้าอีเมลไม่ได้
 */
function recoverAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  if (!isSpreadsheetOwner_()) {
    ui.alert('⛔ เฉพาะเจ้าของไฟล์ Google Sheets เท่านั้นที่ใช้เมนูนี้ได้');
    logAction_('-', 'admin', 'ปฏิเสธการกู้คืนรหัสผ่าน', 'ผู้ใช้ไม่ใช่เจ้าของไฟล์: ' + activeUserEmail_());
    return;
  }

  const confirm = ui.alert('🆘 กู้คืนรหัสผ่านผู้ดูแลระบบ',
    'ระบบจะสร้างรหัสผ่านผู้ดูแลระบบชุดใหม่ และยกเลิกการเข้าสู่ระบบของผู้ดูแลทุกเครื่องทันที\n\n' +
    'ต้องการดำเนินการต่อหรือไม่?', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const newPassword = generatePassword_(12);
  applyNewAdminPassword_(newPassword, 'กู้คืนโดยเจ้าของไฟล์: ' + (activeUserEmail_() || 'ไม่ระบุ'));

  let mailNote = '';
  const email = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
  if (email && isValidEmail_(email)) {
    try {
      MailApp.sendEmail(email, '[' + APP.NAME + '] รหัสผ่านผู้ดูแลระบบชุดใหม่',
        'รหัสผ่านผู้ดูแลระบบถูกรีเซ็ตโดยเจ้าของไฟล์เมื่อ ' + nowStamp_() + '\n\n' +
        'รหัสผ่านใหม่: ' + newPassword + '\n\nกรุณาเข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านทันที');
      mailNote = '\n(ส่งสำเนาไปยัง ' + maskEmail_(email) + ' แล้ว)';
    } catch (e) { mailNote = '\n(ส่งอีเมลไม่สำเร็จ: ' + e.message + ')'; }
  }

  ui.alert('✅ รีเซ็ตรหัสผ่านเรียบร้อย\n\n🔑 รหัสผ่านผู้ดูแลระบบใหม่:\n' + newPassword +
    '\n\n⚠️ กรุณาจดไว้ทันที และเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ' + mailNote);
}

/** เมนู: ตั้ง/แก้ไขอีเมลกู้คืนรหัสผ่าน (เจ้าของไฟล์เท่านั้น) */
function setRecoveryEmailFromMenu() {
  const ui = SpreadsheetApp.getUi();
  if (!isSpreadsheetOwner_()) {
    ui.alert('⛔ เฉพาะเจ้าของไฟล์ Google Sheets เท่านั้นที่ใช้เมนูนี้ได้');
    return;
  }
  const current = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
  const response = ui.prompt('📧 อีเมลสำหรับกู้คืนรหัสผ่านผู้ดูแลระบบ',
    'อีเมลปัจจุบัน: ' + (current || '(ยังไม่ได้ตั้งค่า)') + '\n\nกรอกอีเมลใหม่:', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const email = str_(response.getResponseText());
  if (!isValidEmail_(email)) { ui.alert('❌ รูปแบบอีเมลไม่ถูกต้อง'); return; }

  setSetting_(SETTING_KEYS.RECOVERY_EMAIL, email);
  logAction_('เจ้าของไฟล์', 'admin', 'ตั้งค่าอีเมลกู้คืนรหัสผ่าน', maskEmail_(email));
  ui.alert('✅ บันทึกอีเมลกู้คืนรหัสผ่านเรียบร้อย: ' + email);
}

// ==================== ช่องทางที่ 3: รันจากตัวแก้ไขสคริปต์ ====================

/**
 * รีเซ็ตรหัสผ่านผู้ดูแลระบบแบบฉุกเฉิน
 * วิธีใช้: เปิด Apps Script Editor → เลือกฟังก์ชันนี้ → กด Run
 * แล้วดูรหัสผ่านใหม่ได้ที่ Execution log
 * (เข้าถึงได้เฉพาะผู้ที่มีสิทธิ์แก้ไขสคริปต์เท่านั้น)
 */
function emergencyResetAdminPassword() {
  const newPassword = generatePassword_(12);
  applyNewAdminPassword_(newPassword, 'รีเซ็ตฉุกเฉินจากตัวแก้ไขสคริปต์: ' + (activeUserEmail_() || 'ไม่ระบุ'));

  const message = '\n========================================\n' +
    '🔑 รหัสผ่านผู้ดูแลระบบใหม่: ' + newPassword + '\n' +
    '========================================\n' +
    'กรุณาเข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านทันที\n';
  console.log(message);
  Logger.log(message);

  const email = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
  if (email && isValidEmail_(email)) {
    try {
      MailApp.sendEmail(email, '[' + APP.NAME + '] รีเซ็ตรหัสผ่านผู้ดูแลระบบแบบฉุกเฉิน',
        'รหัสผ่านใหม่: ' + newPassword + '\nเวลา: ' + nowStamp_());
    } catch (e) { console.error('ส่งอีเมลไม่สำเร็จ: ' + e.message); }
  }
  return newPassword;
}

/**
 * ตั้งอีเมลกู้คืนรหัสผ่านจากตัวแก้ไขสคริปต์
 * วิธีใช้: แก้ค่า EMAIL ด้านล่างเป็นอีเมลของท่าน แล้วกด Run
 */
function setRecoveryEmailFromEditor() {
  const EMAIL = 'your-email@example.com'; // ← แก้เป็นอีเมลจริงก่อนกด Run
  if (!isValidEmail_(EMAIL) || EMAIL === 'your-email@example.com') {
    throw new Error('กรุณาแก้ค่า EMAIL ในฟังก์ชัน setRecoveryEmailFromEditor() ให้เป็นอีเมลจริงก่อน');
  }
  setSetting_(SETTING_KEYS.RECOVERY_EMAIL, EMAIL);
  logAction_('ระบบ', 'admin', 'ตั้งค่าอีเมลกู้คืนรหัสผ่าน', 'ตั้งค่าจากตัวแก้ไขสคริปต์');
  console.log('✅ ตั้งอีเมลกู้คืนรหัสผ่านเป็น ' + EMAIL + ' เรียบร้อย');
  return EMAIL;
}
