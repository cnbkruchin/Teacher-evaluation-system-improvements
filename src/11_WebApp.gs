/**
 * ============================================================================
 * ไฟล์: 11_WebApp.gs  |  จุดเริ่มต้นของหน้าจอระบบ
 *  - doGet: ใช้งานผ่านลิงก์เว็บแอป (มือถือ/แท็บเล็ต/คอมพิวเตอร์)
 *  - เมนูใน Google Sheets: เปิดระบบในหน้าต่างซ้อน สำหรับผู้ดูแลระบบ
 * ============================================================================
 */

/** เปิดระบบผ่านลิงก์เว็บแอป */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.mode = 'webapp';
  return template.evaluate()
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://ssl.gstatic.com/docs/spreadsheets/spreadsheets_2020q4.ico');
}

/** ลิงก์เว็บแอปที่เผยแพร่แล้ว (คืนค่าว่างถ้ายังไม่ได้เผยแพร่) */
function webAppUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/** ใช้ในไฟล์ HTML: <?!= include('Styles') ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==================== เมนูใน Google Sheets ====================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏫 ระบบประเมินผล')
    .addItem('🚀 เปิดระบบ', 'showApp')
    .addSeparator()
    .addItem('⚙️ ติดตั้ง / อัปเกรดระบบ', 'setupSystem')
    .addItem('🔗 ลิงก์เว็บแอปสำหรับผู้ประเมิน', 'showWebAppUrl')
    .addSeparator()
    .addSubMenu(ui.createMenu('🆘 ลืมรหัสผ่านผู้ดูแลระบบ')
      .addItem('🔑 รีเซ็ตรหัสผ่านผู้ดูแลระบบ', 'recoverAdminPassword')
      .addItem('📧 ตั้งอีเมลกู้คืนรหัสผ่าน', 'setRecoveryEmailFromMenu'))
    .addSeparator()
    .addItem('🩺 ตรวจสุขภาพระบบ', 'showHealthCheck')
    .addItem('ℹ️ คู่มือการใช้งาน', 'showHelp')
    .addToUi();
}

/** เปิดระบบในหน้าต่างซ้อนบน Google Sheets */
function showApp() {
  if (!sheetExists_(SHEETS.SETTINGS)) {
    SpreadsheetApp.getUi().alert('⚠️ ยังไม่ได้ติดตั้งระบบ\n\nกรุณาเลือกเมนู "🏫 ระบบประเมินผล → ⚙️ ติดตั้ง / อัปเกรดระบบ" ก่อน');
    return;
  }
  const template = HtmlService.createTemplateFromFile('Index');
  template.mode = 'dialog';
  const html = template.evaluate().setWidth(1400).setHeight(900);
  SpreadsheetApp.getUi().showModalDialog(html, APP.NAME + ' v' + APP.VERSION);
}

/** แสดงลิงก์เว็บแอปเพื่อส่งให้ผู้ประเมิน */
function showWebAppUrl() {
  const ui = SpreadsheetApp.getUi();
  const url = webAppUrl_();

  if (!url) {
    ui.alert('🔗 ลิงก์เว็บแอป',
      'ยังไม่ได้เผยแพร่เว็บแอป\n\nวิธีเผยแพร่:\n' +
      '1. เปิดเมนู ส่วนขยาย (Extensions) → Apps Script\n' +
      '2. กด Deploy → New deployment → เลือก Web app\n' +
      '3. ตั้ง Execute as: Me, Who has access: Anyone\n' +
      '4. กด Deploy แล้วคัดลอกลิงก์ที่ได้\n\n' +
      'จากนั้นกลับมาที่เมนูนี้อีกครั้งเพื่อดูลิงก์', ui.ButtonSet.OK);
    return;
  }
  ui.alert('🔗 ลิงก์สำหรับเข้าใช้งานระบบ',
    url + '\n\nส่งลิงก์นี้ให้ผู้ประเมินเพื่อเข้าใช้งานผ่านมือถือหรือคอมพิวเตอร์ได้ทันที\n' +
    '(ผู้ประเมินต้องเข้าสู่ระบบด้วยชื่อและรหัสผ่านที่ผู้ดูแลระบบออกให้)', ui.ButtonSet.OK);
}

/** ตรวจสุขภาพระบบอย่างรวดเร็วจากเมนู */
function showHealthCheck() {
  const report = healthCheck_();
  const lines = report.items.map(function (i) {
    return (i.ok ? '✅ ' : '⚠️ ') + i.label + (i.detail ? ' — ' + i.detail : '');
  });
  SpreadsheetApp.getUi().alert('🩺 ผลการตรวจสอบระบบ\n\n' + lines.join('\n') +
    '\n\nสรุป: ' + (report.healthy ? 'ระบบพร้อมใช้งาน' : 'มีบางรายการที่ควรแก้ไข'));
}

function healthCheck_() {
  const items = [];
  const push = function (ok, label, detail) { items.push({ ok: ok, label: label, detail: detail || '' }); };

  Object.keys(SHEETS).forEach(function (k) {
    push(sheetExists_(SHEETS[k]), 'ชีท "' + SHEETS[k] + '"', sheetExists_(SHEETS[k]) ? '' : 'ยังไม่มี — สั่งติดตั้งระบบ');
  });

  const hasAdmin = !!str_(getSetting_(SETTING_KEYS.ADMIN_HASH, ''));
  push(hasAdmin, 'รหัสผ่านผู้ดูแลระบบ', hasAdmin ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า');

  const recovery = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
  push(!!recovery, 'อีเมลกู้คืนรหัสผ่าน', recovery ? maskEmail_(recovery) : 'ยังไม่ตั้งค่า (แนะนำให้ตั้ง)');

  const teachers = sheetExists_(SHEETS.TEACHERS) ? readTable_(SHEETS.TEACHERS).rows.length : 0;
  push(teachers > 0, 'รายชื่อครู', teachers + ' คน');

  const evaluators = sheetExists_(SHEETS.EVALUATORS) ? readTable_(SHEETS.EVALUATORS).rows.length : 0;
  push(evaluators > 0, 'ผู้ประเมิน', evaluators + ' คน');

  const term = currentTerm_();
  const duty = sheetExists_(SHEETS.DUTY) ? dutyRosterFor_(term.year, term.semester).rows.length : 0;
  push(duty > 0, 'ตารางเวร ' + termLabel_(term.year, term.semester), duty + ' รายการ');

  const webapp = webAppUrl_();
  push(!!webapp, 'ลิงก์เว็บแอป', webapp ? 'เผยแพร่แล้ว' : 'ยังไม่ได้เผยแพร่');

  // กฎที่ตั้งเป็น "ปฏิเสธข้อมูลที่ไม่ถูกต้อง" จะทำให้ระบบบันทึกข้อมูลไม่ได้
  // (ส่วนใหญ่เป็นกฎที่ค้างมาจากระบบรุ่นก่อน) จึงควรเตือนให้สั่งติดตั้งซ้ำเพื่อล้างทิ้ง
  const blocking = countBlockingValidations_();
  push(blocking === 0, 'กฎการกรอกข้อมูลในชีท',
    blocking === 0 ? 'ไม่มีกฎที่ขวางการบันทึก'
      : 'พบกฎแบบบล็อกค้างอยู่ ' + blocking + ' คอลัมน์ — สั่ง "ติดตั้ง / อัปเกรดระบบ" เพื่อล้างทิ้ง');

  return { healthy: items.every(function (i) { return i.ok; }), items: items };
}

function apiHealthCheck(token) {
  return guard_(function () {
    requireAdmin_(token);
    return ok_(healthCheck_());
  });
}

function showHelp() {
  const help =
    '📖 คู่มือการใช้งาน — ' + APP.NAME + ' v' + APP.VERSION + '\n' +
    '══════════════════════════════════════\n\n' +
    '🚀 เริ่มต้นใช้งาน\n' +
    '  1. เมนู "⚙️ ติดตั้ง / อัปเกรดระบบ" (ทำครั้งเดียว)\n' +
    '  2. เมนู "🚀 เปิดระบบ" → เข้าสู่ระบบผู้ดูแล\n' +
    '  3. ตั้งค่าอีเมลกู้คืนรหัสผ่านในหน้า "ตั้งค่าและความปลอดภัย"\n' +
    '  4. เพิ่มรายชื่อครู → ผู้ประเมิน → ตารางเวรประจำวัน\n\n' +
    '👑 ผู้ดูแลระบบทำอะไรได้บ้าง\n' +
    '  • แดชบอร์ดภาพรวมและความคืบหน้าการประเมิน\n' +
    '  • จัดการครู ผู้ประเมิน เกณฑ์ และตารางเวรรายภาคเรียน\n' +
    '  • เลือกและจัดลำดับผู้ถูกประเมิน แล้วส่งออก Excel / PDF\n' +
    '  • ค้นข้อมูลย้อนหลังในคลังข้อมูล และกู้คืนได้\n\n' +
    '📝 ผู้ประเมิน\n' +
    '  • เข้าผ่านลิงก์เว็บแอป ด้วยชื่อและรหัสผ่านที่ผู้ดูแลออกให้\n' +
    '  • เห็นเฉพาะครูและเกณฑ์ตามสิทธิ์ของตนเอง\n' +
    '  • แก้ไขผลที่เคยบันทึกได้ โดยระบบเก็บฉบับเดิมไว้ในคลังข้อมูล\n\n' +
    '🔑 ลืมรหัสผ่านผู้ดูแลระบบ (3 ช่องทาง)\n' +
    '  1. หน้าเข้าสู่ระบบ → "ลืมรหัสผ่าน?" → รับ OTP ทางอีเมลกู้คืน\n' +
    '  2. เมนู "🆘 ลืมรหัสผ่านผู้ดูแลระบบ" (เจ้าของไฟล์เท่านั้น)\n' +
    '  3. Apps Script Editor → รันฟังก์ชัน emergencyResetAdminPassword()\n\n' +
    '📅 เวรประจำวัน\n' +
    '  ตารางเวรแยกอิสระตามปีการศึกษาและภาคเรียน เปลี่ยนเวรภาคเรียนใหม่\n' +
    '  ได้โดยข้อมูลภาคเรียนเดิมไม่เปลี่ยนตาม และคัดลอกจากภาคเรียนก่อนได้';

  SpreadsheetApp.getUi().alert(help);
}

/** นับคอลัมน์ที่ยังมีกฎการกรอกข้อมูลแบบบล็อก (สาเหตุของ Exception ตอนบันทึกข้อมูล) */
function countBlockingValidations_() {
  let count = 0;
  validatedSheets_().forEach(function (name) {
    const sheet = ss_().getSheetByName(name);
    if (!sheet) return;
    try {
      const rules = sheet.getRange(2, 1, 1, sheet.getMaxColumns()).getDataValidations()[0] || [];
      rules.forEach(function (rule) {
        if (rule && rule.getAllowInvalid() === false) count++;
      });
    } catch (e) { /* อ่านกฎไม่ได้ก็ข้ามไป */ }
  });
  return count;
}
