/**
 * ============================================================================
 * ไฟล์: 02_Security.gs  |  ความปลอดภัยของระบบ
 *  - เข้ารหัสรหัสผ่านด้วย salt เฉพาะราย + วนซ้ำหลายพันรอบ (key stretching)
 *  - เปรียบเทียบค่าแฮชแบบ constant-time กัน timing attack
 *  - เซสชันแบบมี token, หมดอายุอัตโนมัติ, เพิกถอนได้
 *  - จำกัดจำนวนครั้งการล็อกอินผิด (brute-force protection)
 *  - ตรวจความแข็งแรงของรหัสผ่าน
 * ============================================================================
 */

const SESSION_PREFIX_ = 'SESS::';
const RATE_PREFIX_ = 'RATE::';
const LEGACY_SALT_ = 'teacher_eval_salt_2024';

// ==================== สุ่มค่า / รหัสผ่าน ====================

/** สร้าง token สุ่มความยาวสูงสุด 64 ตัวอักษร (hex) จาก UUID */
function randomToken_(length) {
  let src = '';
  while (src.length < (length || 64)) {
    src += Utilities.getUuid().replace(/-/g, '');
  }
  return src.substring(0, length || 64);
}

/** สร้างรหัสผ่านที่อ่านง่าย ไม่มีตัวอักษรที่สับสน (0/O, 1/l) */
function generatePassword_(length) {
  const len = Math.min(Math.max(length || 10, 8), 24);
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const src = randomToken_(len * 2 + 8);
  let out = '';
  for (let i = 0; i < len - 2; i++) {
    out += pool.charAt(parseInt(src.substr(i * 2, 2), 16) % pool.length);
  }
  // การันตีว่ามีตัวเลขอย่างน้อย 2 ตัวเสมอ เพื่อผ่านนโยบายรหัสผ่าน
  out += digits.charAt(parseInt(src.substr(len * 2, 2), 16) % digits.length);
  out += digits.charAt(parseInt(src.substr(len * 2 + 2, 2), 16) % digits.length);
  return out;
}

/** สร้างรหัส OTP 6 หลักสำหรับกู้คืนรหัสผ่าน */
function generateOtp_() {
  const src = randomToken_(12);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += String(parseInt(src.substr(i * 2, 2), 16) % 10);
  }
  return out;
}

// ==================== การเข้ารหัสรหัสผ่าน ====================

function sha256Hex_(text) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/**
 * เข้ารหัสรหัสผ่านแบบ key stretching:
 * แฮช SHA-256 ซ้ำหลายพันรอบ โดยผสม salt ทุกรอบ
 * ทำให้การเดารหัสผ่านแบบสุ่มช้าลงมหาศาลเมื่อเทียบกับ SHA-256 รอบเดียวของระบบเดิม
 */
function hashPassword_(password, salt, iterations) {
  const rounds = Math.max(1, Number(iterations) || 4096);
  let bytes = Utilities.newBlob(salt + '|' + password).getBytes();
  const saltBytes = Utilities.newBlob(salt).getBytes();
  for (let i = 0; i < rounds; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(saltBytes));
  }
  return Utilities.base64Encode(bytes);
}

/** เปรียบเทียบสตริงแบบใช้เวลาเท่ากันเสมอ (constant-time) */
function safeEquals_(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  if (s1.length !== s2.length) return false;
  let diff = 0;
  for (let i = 0; i < s1.length; i++) {
    diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
  }
  return diff === 0;
}

/** แฮชแบบเดิม (ระบบ v2) ใช้ตรวจสอบเพื่อย้ายข้อมูลผู้ใช้เดิมโดยไม่ต้องตั้งรหัสใหม่ */
function legacyHash_(password) {
  return sha256Hex_(password + LEGACY_SALT_);
}

/**
 * ตรวจรหัสผ่าน รองรับทั้งรูปแบบใหม่ (salt + iterations) และรูปแบบเดิมของ v2
 * @return {{valid: boolean, needsUpgrade: boolean}}
 */
function verifyPassword_(password, storedHash, salt, iterations) {
  const hash = String(storedHash || '');
  if (!hash) return { valid: false, needsUpgrade: false };

  if (salt) {
    return { valid: safeEquals_(hashPassword_(password, salt, iterations), hash), needsUpgrade: false };
  }
  // ไม่มี salt = ข้อมูลจากระบบเดิม
  const isLegacy = safeEquals_(legacyHash_(password), hash);
  return { valid: isLegacy, needsUpgrade: isLegacy };
}

/** สร้างชุดข้อมูลรหัสผ่านใหม่พร้อม salt */
function makePasswordRecord_(password, iterations) {
  const salt = randomToken_(32);
  const rounds = Number(iterations) || getSettingNumber_(SETTING_KEYS.PASSWORD_ITERATIONS, 4096);
  return { hash: hashPassword_(password, salt, rounds), salt: salt, iterations: rounds };
}

// ==================== นโยบายรหัสผ่าน ====================

const WEAK_PASSWORDS_ = ['123456', '12345678', 'password', 'admin', 'admin123', '1234567890',
  'qwerty', 'abc123', '111111', '000000', 'p@ssword', 'passw0rd', 'school', 'teacher'];

/** ตรวจความแข็งแรงของรหัสผ่าน คืน {ok, message} */
function checkPasswordPolicy_(password) {
  const p = String(password || '');
  if (p.length < 8) return { ok: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' };
  if (p.length > 72) return { ok: false, message: 'รหัสผ่านต้องยาวไม่เกิน 72 ตัวอักษร' };
  if (!/[A-Za-zก-๙]/.test(p)) return { ok: false, message: 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว' };
  if (!/[0-9]/.test(p)) return { ok: false, message: 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว' };
  if (/^\s|\s$/.test(p)) return { ok: false, message: 'รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง' };
  if (WEAK_PASSWORDS_.indexOf(p.toLowerCase()) !== -1) {
    return { ok: false, message: 'รหัสผ่านนี้ง่ายเกินไป กรุณาตั้งรหัสผ่านที่คาดเดายาก' };
  }
  return { ok: true };
}

/** ประเมินความแข็งแรงเป็นคะแนน 0-4 สำหรับแสดงผลบนหน้าเว็บ */
function passwordStrength_(password) {
  const p = String(password || '');
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;
  return score;
}

// ==================== เซสชัน ====================

function scriptProps_() {
  return PropertiesService.getScriptProperties();
}

function sessionKey_(token) {
  return SESSION_PREFIX_ + sha256Hex_(token);
}

/**
 * สร้างเซสชันใหม่
 * @param {Object} payload ข้อมูลผู้ใช้ที่ต้องการเก็บ เช่น {kind:'admin'} หรือ {kind:'evaluator', id, name, role, scope}
 */
function createSession_(payload) {
  pruneSessions_();
  const token = randomToken_(48);
  const idleMin = getSettingNumber_(SETTING_KEYS.SESSION_IDLE_MINUTES, 120);
  const maxHours = getSettingNumber_(SETTING_KEYS.SESSION_MAX_HOURS, 8);
  const now = Date.now();
  const record = Object.assign({}, payload, {
    createdAt: now,
    lastSeen: now,
    idleMs: idleMin * 60 * 1000,
    expiresAt: now + maxHours * 60 * 60 * 1000
  });
  scriptProps_().setProperty(sessionKey_(token), JSON.stringify(record));
  return { token: token, session: record };
}

/** อ่านเซสชันจาก token พร้อมต่ออายุ idle timeout */
function readSession_(token) {
  if (!token) return null;
  const key = sessionKey_(token);
  const raw = scriptProps_().getProperty(key);
  if (!raw) return null;

  let record;
  try { record = JSON.parse(raw); } catch (e) { scriptProps_().deleteProperty(key); return null; }

  const now = Date.now();
  if (now > record.expiresAt || (now - record.lastSeen) > record.idleMs) {
    scriptProps_().deleteProperty(key);
    return null;
  }
  record.lastSeen = now;
  scriptProps_().setProperty(key, JSON.stringify(record));
  return record;
}

function destroySession_(token) {
  if (token) scriptProps_().deleteProperty(sessionKey_(token));
}

/** ยกเลิกเซสชันทั้งหมด (ใช้เมื่อเปลี่ยนรหัสผ่านหรือกู้คืนรหัสผ่าน) */
function destroyAllSessions_(kind) {
  const props = scriptProps_();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX_) !== 0) return;
    if (!kind) { props.deleteProperty(k); return; }
    try {
      if (JSON.parse(all[k]).kind === kind) props.deleteProperty(k);
    } catch (e) { props.deleteProperty(k); }
  });
}

/** ลบเซสชันที่หมดอายุออกจากที่เก็บ */
function pruneSessions_() {
  const props = scriptProps_();
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX_) !== 0 && k.indexOf(RATE_PREFIX_) !== 0) return;
    try {
      const rec = JSON.parse(all[k]);
      const expired = k.indexOf(SESSION_PREFIX_) === 0
        ? (now > rec.expiresAt || (now - rec.lastSeen) > rec.idleMs)
        : (now > (rec.until || 0) && now > (rec.windowEnd || 0));
      if (expired) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

/** ตรวจสิทธิ์ผู้ดูแลระบบ — โยน error ถ้าไม่ผ่าน */
function requireAdmin_(token) {
  const session = readSession_(token);
  if (!session || session.kind !== 'admin') {
    throw new Error('เซสชันหมดอายุหรือไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบใหม่');
  }
  return session;
}

/** ตรวจสิทธิ์ผู้ประเมิน — โยน error ถ้าไม่ผ่าน */
function requireEvaluator_(token) {
  const session = readSession_(token);
  if (!session || session.kind !== 'evaluator') {
    throw new Error('เซสชันหมดอายุหรือไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบใหม่');
  }
  return session;
}

/** ตรวจสิทธิ์ผู้ใช้ระบบทุกประเภท */
function requireSession_(token) {
  const session = readSession_(token);
  if (!session) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return session;
}

// ==================== จำกัดจำนวนครั้งการพยายามเข้าสู่ระบบ ====================

/**
 * ตรวจว่าถูกล็อกอยู่หรือไม่
 * @return {{blocked: boolean, retryInMinutes: number, attempts: number}}
 */
function rateLimitStatus_(bucket) {
  const key = RATE_PREFIX_ + sha256Hex_(bucket);
  const raw = scriptProps_().getProperty(key);
  if (!raw) return { blocked: false, retryInMinutes: 0, attempts: 0 };
  let rec;
  try { rec = JSON.parse(raw); } catch (e) { return { blocked: false, retryInMinutes: 0, attempts: 0 }; }

  const now = Date.now();
  if (rec.until && now < rec.until) {
    return { blocked: true, retryInMinutes: Math.ceil((rec.until - now) / 60000), attempts: rec.count || 0 };
  }
  if (rec.windowEnd && now > rec.windowEnd) {
    scriptProps_().deleteProperty(key);
    return { blocked: false, retryInMinutes: 0, attempts: 0 };
  }
  return { blocked: false, retryInMinutes: 0, attempts: rec.count || 0 };
}

/** บันทึกความพยายามที่ล้มเหลว 1 ครั้ง และล็อกเมื่อเกินจำนวนที่กำหนด */
function rateLimitFail_(bucket, maxAttempts, lockMinutes) {
  const key = RATE_PREFIX_ + sha256Hex_(bucket);
  const max = maxAttempts || getSettingNumber_(SETTING_KEYS.MAX_LOGIN_ATTEMPTS, 5);
  const lockMs = (lockMinutes || getSettingNumber_(SETTING_KEYS.LOCKOUT_MINUTES, 15)) * 60000;
  const now = Date.now();

  let rec = { count: 0, windowEnd: now + 30 * 60000, until: 0 };
  const raw = scriptProps_().getProperty(key);
  if (raw) { try { rec = JSON.parse(raw); } catch (e) { /* ใช้ค่าเริ่มต้น */ } }
  if (!rec.windowEnd || now > rec.windowEnd) { rec.count = 0; rec.windowEnd = now + 30 * 60000; }

  rec.count = (rec.count || 0) + 1;
  if (rec.count >= max) {
    rec.until = now + lockMs;
    rec.count = 0;
  }
  scriptProps_().setProperty(key, JSON.stringify(rec));
  return {
    locked: !!rec.until && now < rec.until,
    remaining: Math.max(0, max - (rec.count || 0)),
    retryInMinutes: Math.ceil(lockMs / 60000)
  };
}

function rateLimitReset_(bucket) {
  scriptProps_().deleteProperty(RATE_PREFIX_ + sha256Hex_(bucket));
}

/** อีเมลบัญชี Google ที่กำลังใช้งาน (อาจว่างได้ในเว็บแอปแบบไม่ระบุตัวตน) */
function activeUserEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/**
 * ตรวจว่าบัญชี Google ที่ใช้งานอยู่ได้รับอนุญาตให้เข้าสู่ระบบผู้ดูแลหรือไม่
 * (จำกัดได้จากการตั้งค่า admin_allowed_emails — ถ้าเว้นว่างคือไม่จำกัด)
 */
function adminEmailAllowed_() {
  const allow = str_(getSetting_(SETTING_KEYS.ADMIN_ALLOWED_EMAILS, ''));
  if (!allow) return true;
  const email = activeUserEmail_().toLowerCase();
  if (!email) return false;
  return allow.split(',').map(function (e) { return e.trim().toLowerCase(); })
    .filter(String).indexOf(email) !== -1;
}
