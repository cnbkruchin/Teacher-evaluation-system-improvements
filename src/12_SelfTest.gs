/**
 * ============================================================================
 * ไฟล์: 12_SelfTest.gs  |  ทดสอบตรรกะหลักของระบบ
 *
 * วิธีใช้: เปิด Apps Script Editor → เลือกฟังก์ชัน runSelfTest → กด Run
 *          แล้วดูผลได้ที่ Execution log
 * การทดสอบนี้ "ไม่แก้ไขข้อมูลจริง" ทำงานกับข้อมูลจำลองในหน่วยความจำเท่านั้น
 * ============================================================================
 */

function runSelfTest() {
  const results = [];
  const check = function (label, condition, detail) {
    results.push({ ok: !!condition, label: label, detail: detail === undefined ? '' : String(detail) });
  };

  // --- การเข้ารหัสรหัสผ่าน ---
  const salt = randomToken_(32);
  const hash = hashPassword_('TestPassword1', salt, 256);
  check('แฮชรหัสผ่านให้ผลคงที่', hash === hashPassword_('TestPassword1', salt, 256));
  check('salt ต่างกัน → แฮชต่างกัน', hash !== hashPassword_('TestPassword1', randomToken_(32), 256));
  check('รหัสผ่านผิด → แฮชไม่ตรง', hash !== hashPassword_('TestPassword2', salt, 256));
  check('เปรียบเทียบแบบ constant-time ถูกต้อง', safeEquals_(hash, hash) && !safeEquals_(hash, hash + 'x'));
  check('รองรับรหัสผ่านรูปแบบเดิมของ v2', verifyPassword_('abc', legacyHash_('abc'), '', 0).valid);
  check('ตรวจพบว่าต้องอัปเกรดการเข้ารหัส', verifyPassword_('abc', legacyHash_('abc'), '', 0).needsUpgrade);

  // --- นโยบายรหัสผ่าน ---
  check('ปฏิเสธรหัสผ่านสั้น', !checkPasswordPolicy_('a1').ok);
  check('ปฏิเสธรหัสผ่านไม่มีตัวเลข', !checkPasswordPolicy_('abcdefghij').ok);
  check('ปฏิเสธรหัสผ่านคาดเดาง่าย', !checkPasswordPolicy_('password').ok);
  check('ยอมรับรหัสผ่านที่ดี', checkPasswordPolicy_('Krupraseom2568').ok);
  check('รหัสผ่านที่ระบบสุ่มผ่านนโยบายเสมอ', checkPasswordPolicy_(generatePassword_(10)).ok);

  // --- การคำนวณคะแนน ---
  const criteria = loadCriteria_();
  check('โหลดเกณฑ์การประเมินได้', criteria.length > 0, criteria.length + ' ข้อ');
  const perfect = {};
  criteria.forEach(function (c) { perfect[c.id] = 5; });
  const calcPerfect = computeScore_(perfect, criteria);
  check('ให้ 5 ทุกข้อ → เฉลี่ย 5.00', calcPerfect.average === 5, calcPerfect.average);
  check('ให้ 5 ทุกข้อ → ระดับดีเยี่ยม', calcPerfect.rating === RATING_LABELS[0], calcPerfect.rating);

  const partial = {};
  partial[criteria[0].id] = 4;
  if (criteria[1]) partial[criteria[1].id] = 2;
  const calcPartial = computeScore_(partial, criteria);
  check('นับเฉพาะข้อที่ให้คะแนน', calcPartial.count === Object.keys(partial).length, calcPartial.count);
  check('คะแนนเต็มคิดจากข้อที่ตอบ', calcPartial.max === calcPartial.count * 5, calcPartial.max);

  const t = ratingThresholds_();
  check('ระดับ ดีเยี่ยม ถูกต้อง', ratingOf_(t.excellent) === RATING_LABELS[0]);
  check('ระดับ ดีมาก ถูกต้อง', ratingOf_(t.great) === RATING_LABELS[1]);
  check('ระดับ ปรับปรุง ถูกต้อง', ratingOf_(1) === RATING_LABELS[4]);

  // --- สิทธิ์ตามบทบาท ---
  Object.keys(ROLES).forEach(function (key) {
    const list = criteriaForRole_(ROLES[key]);
    check('บทบาท "' + ROLES[key] + '" มีเกณฑ์ที่ประเมินได้', list.length > 0, list.length + ' ข้อ');
  });

  // --- โครงสร้างข้อมูล ---
  Object.keys(SHEETS).forEach(function (key) {
    check('มีชีท "' + SHEETS[key] + '"', sheetExists_(SHEETS[key]));
  });
  check('หัวตารางผลการประเมินครบถ้วน',
    resultHeaders_().length === RESULT_BASE_HEADERS.length + MAX_CRITERIA + RESULT_TAIL_HEADERS.length);

  // --- ตารางเวรรายภาคเรียน ---
  const term = currentTerm_();
  const roster = dutyRosterFor_(term.year, term.semester);
  check('อ่านตารางเวรของภาคเรียนปัจจุบันได้', Array.isArray(roster.rows), roster.rows.length + ' รายการ');
  const other = dutyRosterFor_(term.year, term.semester === '1' ? '2' : '1');
  check('ตารางเวรของแต่ละภาคเรียนแยกจากกัน', roster.rows !== other.rows);

  // --- การตั้งค่า ---
  check('มีอีเมลกู้คืนรหัสผ่าน', !!str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, '')),
    str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, '')) ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า (แนะนำให้ตั้ง)');
  check('ตั้งค่ารหัสผ่านผู้ดูแลระบบแล้ว', !!str_(getSetting_(SETTING_KEYS.ADMIN_HASH, '')));
  check('ใช้การเข้ารหัสแบบมี salt', !!str_(getSetting_(SETTING_KEYS.ADMIN_SALT, '')),
    str_(getSetting_(SETTING_KEYS.ADMIN_SALT, '')) ? 'ใช้แล้ว' : 'จะอัปเกรดอัตโนมัติเมื่อเข้าสู่ระบบครั้งถัดไป');

  // --- สรุปผล ---
  const passed = results.filter(function (r) { return r.ok; }).length;
  const lines = results.map(function (r) {
    return (r.ok ? '✅ ' : '❌ ') + r.label + (r.detail ? '  → ' + r.detail : '');
  });
  const summary = '\n===== ผลการทดสอบระบบ v' + APP.VERSION + ' =====\n' +
    lines.join('\n') + '\n\nผ่าน ' + passed + ' / ' + results.length + ' รายการ\n';

  console.log(summary);
  Logger.log(summary);
  return { passed: passed, total: results.length, results: results };
}
