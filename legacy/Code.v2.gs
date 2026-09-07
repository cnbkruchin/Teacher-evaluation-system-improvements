// ========================================================
// ระบบประเมินผลการปฏิบัติงานครู - กิจการนักเรียน
// Version 2.0 - มีระบบ Admin / ผู้ประเมิน แยกสิทธิ์
// ========================================================

// ==================== CONFIG ====================
const CONFIG = {
  SHEETS: {
    TEACHERS: 'รายชื่อครู',
    EVALUATORS: 'ผู้ประเมิน',
    CRITERIA: 'เกณฑ์การประเมิน',
    RESULTS: 'ผลการประเมิน',
    SUMMARY: 'สรุปผลการประเมิน',
    LOG: 'ประวัติการประเมิน',
    SETTINGS: 'ตั้งค่าระบบ'
  },
  LEVELS: ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'],
  DAYS: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'],
  EVALUATOR_ROLES: {
    VICE_DIRECTOR: 'รองผู้อำนวยการฝ่ายกิจการนักเรียน',
    HEAD_AFFAIRS: 'หัวหน้ากลุ่มบริหารงานกิจการนักเรียน',
    HEAD_LEVEL: 'หัวหน้าระดับชั้น',
    HEAD_DUTY: 'หัวหน้าเวรประจำวัน'
  }
};

const CRITERIA = [
  { id: 1, name: 'คัดกรองนักเรียนรายบุคคล', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 2, name: 'การออกเยี่ยมบ้านนักเรียน', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 3, name: 'SDQ/EQ / ระบบ School Health Hero', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 4, name: 'ประชุมผู้ปกครองสัมพันธ์ (Classroom Meeting)', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 5, name: 'ติดตามแก้ไขนักเรียนกลุ่มเสี่ยงสารเสพติด', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 6, name: 'ติดตามแก้ไขนักเรียนกลุ่มเสี่ยงผิดระเบียบ', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 7, name: 'การปฏิบัติหน้าที่เวรประจำวัน', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_DUTY'] },
  { id: 8, name: 'การโฮมรูม / เช็คสถิติเข้าแถวหน้าเสาธง', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] },
  { id: 9, name: 'การให้ความร่วมมือกลุ่มบริหารงานกิจการนักเรียน', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS'] },
  { id: 10, name: 'โรงเรียนคุณธรรม / กิจกรรมห้องเรียนสีขาว', evaluatedBy: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'] }
];

// ==================== PASSWORD UTILS ====================

function generatePassword(length) {
  length = length || 8;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function hashPassword(password) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + 'teacher_eval_salt_2024');
  return raw.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// ==================== SETUP ====================

function setupSystem() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    '⚙️ ตั้งค่าระบบ',
    'การดำเนินการนี้จะสร้าง Sheet ทั้งหมด\n(ถ้ามีอยู่แล้วจะถูกล้างข้อมูล)\n\nต้องการดำเนินการต่อหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // สร้าง Sheet ทั้งหมด
  Object.values(CONFIG.SHEETS).forEach(function(name) {
    createSheetIfNotExists(ss, name);
  });

  setupSettingsSheet(ss);
  setupTeachersSheet(ss);
  setupEvaluatorsSheet(ss);
  setupCriteriaSheet(ss);
  setupResultsSheet(ss);
  setupSummarySheet(ss);
  setupLogSheet(ss);

  // ตั้งค่า Admin Password ครั้งแรก
  const adminPassword = generatePassword(10);
  const settingsSheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  settingsSheet.getRange('B2').setValue(hashPassword(adminPassword));

  // Log
  addLog('ระบบ', 'ตั้งค่าระบบครั้งแรก');

  ui.alert(
    '✅ ตั้งค่าระบบเรียบร้อย!\n\n' +
    '🔑 รหัสผ่าน Admin: ' + adminPassword + '\n\n' +
    '⚠️ กรุณาจดรหัสผ่านนี้ไว้ให้ดี!\n' +
    '(สามารถเปลี่ยนรหัสผ่านได้ภายหลังผ่านเมนู Admin)\n\n' +
    'ขั้นตอนถัดไป:\n' +
    '1. กรอกรายชื่อครูในชีท "รายชื่อครู"\n' +
    '2. เพิ่มผู้ประเมินผ่านเมนู Admin'
  );
}

function createSheetIfNotExists(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function setupSettingsSheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  sheet.clear();
  sheet.getRange('A1').setValue('คีย์').setFontWeight('bold');
  sheet.getRange('B1').setValue('ค่า').setFontWeight('bold');
  sheet.getRange('A2').setValue('admin_password_hash');
  sheet.getRange('A3').setValue('system_version');
  sheet.getRange('B3').setValue('2.0');
  sheet.getRange('A4').setValue('setup_date');
  sheet.getRange('B4').setValue(new Date());

  const headerRange = sheet.getRange(1, 1, 1, 2);
  headerRange.setBackground('#212121').setFontColor('#fff').setFontWeight('bold');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 400);

  // ซ่อน Sheet นี้
  sheet.hideSheet();
}

function setupTeachersSheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  sheet.clear();

  const headers = ['ลำดับ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อ-นามสกุล', 'ระดับชั้นที่สังกัด', 'เวรประจำวัน', 'สถานะ'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setFontSize(11);

  const prefixRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['นาย', 'นาง', 'นางสาว', 'ว่าที่ ร.ต.', 'ดร.']).build();
  sheet.getRange(2, 2, 200, 1).setDataValidation(prefixRule);

  const levelRule = SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.LEVELS).build();
  sheet.getRange(2, 6, 200, 1).setDataValidation(levelRule);

  const dayRule = SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.DAYS).build();
  sheet.getRange(2, 7, 200, 1).setDataValidation(dayRule);

  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['ใช้งาน', 'ไม่ใช้งาน']).build();
  sheet.getRange(2, 8, 200, 1).setDataValidation(statusRule);

  for (let i = 2; i <= 201; i++) {
    sheet.getRange(i, 5).setFormula('=IF(C' + i + '<>"", B' + i + '&C' + i + '&" "&D' + i + ', "")');
    sheet.getRange(i, 1).setFormula('=IF(C' + i + '<>"", ROW()-1, "")');
  }

  sheet.setColumnWidths(1, 1, 60);
  sheet.setColumnWidths(2, 1, 100);
  sheet.setColumnWidths(3, 2, 120);
  sheet.setColumnWidths(5, 1, 200);
  sheet.setColumnWidths(6, 1, 140);
  sheet.setColumnWidths(7, 1, 130);
  sheet.setColumnWidths(8, 1, 100);
  sheet.setFrozenRows(1);
}

function setupEvaluatorsSheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  sheet.clear();

  const headers = ['ลำดับ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อ-นามสกุล', 'บทบาท',
    'ระดับชั้น/วัน', 'อีเมล', 'รหัสผ่าน (Hash)', 'สถานะ'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#b71c1c').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setFontSize(11);

  const roles = Object.values(CONFIG.EVALUATOR_ROLES);
  const roleRule = SpreadsheetApp.newDataValidation().requireValueInList(roles).build();
  sheet.getRange(2, 6, 50, 1).setDataValidation(roleRule);

  const levelDayOptions = CONFIG.LEVELS.concat(CONFIG.DAYS);
  const levelDayRule = SpreadsheetApp.newDataValidation().requireValueInList(levelDayOptions).build();
  sheet.getRange(2, 7, 50, 1).setDataValidation(levelDayRule);

  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['ใช้งาน', 'ไม่ใช้งาน']).build();
  sheet.getRange(2, 10, 50, 1).setDataValidation(statusRule);

  for (let i = 2; i <= 51; i++) {
    sheet.getRange(i, 5).setFormula('=IF(C' + i + '<>"", B' + i + '&C' + i + '&" "&D' + i + ', "")');
    sheet.getRange(i, 1).setFormula('=IF(C' + i + '<>"", ROW()-1, "")');
  }

  sheet.setColumnWidths(1, 1, 60);
  sheet.setColumnWidths(2, 1, 100);
  sheet.setColumnWidths(3, 2, 120);
  sheet.setColumnWidths(5, 1, 200);
  sheet.setColumnWidths(6, 1, 260);
  sheet.setColumnWidths(7, 1, 130);
  sheet.setColumnWidths(8, 1, 200);
  sheet.setColumnWidths(9, 1, 250);
  sheet.setColumnWidths(10, 1, 100);
  sheet.setFrozenRows(1);
}

function setupCriteriaSheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CRITERIA);
  sheet.clear();

  const headers = ['ข้อที่', 'เกณฑ์การประเมิน', 'ผู้มีสิทธิ์ประเมิน', 'น้ำหนัก (%)'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#1b5e20').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);

  const criteriaData = CRITERIA.map(function(c) {
    var evaluatorNames = c.evaluatedBy.map(function(role) { return CONFIG.EVALUATOR_ROLES[role]; }).join(', ');
    return [c.id, c.name, evaluatorNames, 10];
  });
  sheet.getRange(2, 1, criteriaData.length, 4).setValues(criteriaData);

  sheet.getRange(14, 1).setValue('ระดับคะแนน').setFontWeight('bold').setFontSize(12);
  sheet.getRange(15, 1, 1, 3).setValues([['ระดับ', 'ความหมาย', 'คำอธิบาย']])
    .setBackground('#e8f5e9').setFontWeight('bold');
  sheet.getRange(16, 1, 5, 3).setValues([
    [5, 'ดีเยี่ยม', 'ปฏิบัติได้ครบถ้วนสมบูรณ์ เป็นแบบอย่างที่ดี'],
    [4, 'ดีมาก', 'ปฏิบัติได้ครบถ้วน มีคุณภาพดี'],
    [3, 'ดี', 'ปฏิบัติได้ตามมาตรฐาน'],
    [2, 'พอใช้', 'ปฏิบัติได้บางส่วน ต้องปรับปรุง'],
    [1, 'ปรับปรุง', 'ปฏิบัติได้น้อย ต้องปรับปรุงอย่างเร่งด่วน']
  ]);

  sheet.setColumnWidths(1, 1, 60);
  sheet.setColumnWidths(2, 1, 350);
  sheet.setColumnWidths(3, 1, 400);
  sheet.setColumnWidths(4, 1, 100);
  sheet.setFrozenRows(1);
}

function setupResultsSheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.RESULTS);
  sheet.clear();

  const headers = [
    'Timestamp', 'ผู้ประเมิน', 'บทบาทผู้ประเมิน', 'ภาคเรียน',
    'ครูผู้รับการประเมิน', 'ระดับชั้น', 'เวรประจำวัน',
    'ข้อ 1', 'ข้อ 2', 'ข้อ 3', 'ข้อ 4', 'ข้อ 5',
    'ข้อ 6', 'ข้อ 7', 'ข้อ 8', 'ข้อ 9', 'ข้อ 10',
    'คะแนนรวม', 'คะแนนเฉลี่ย', 'ระดับผลการประเมิน', 'ข้อเสนอแนะ'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#e65100').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(10).setWrap(true);
  sheet.setFrozenRows(1);
}

function setupSummarySheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SUMMARY);
  sheet.clear();

  const headers = [
    'ลำดับ', 'ชื่อ-นามสกุล', 'ระดับชั้น', 'เวรประจำวัน',
    'คะแนนจาก รอง ผอ.', 'คะแนนจาก หน.กิจการ',
    'คะแนนจาก หน.ระดับ', 'คะแนนจาก หน.เวร',
    'คะแนนเฉลี่ยรวม', 'ระดับผลประเมิน', 'จำนวนครั้งที่ถูกประเมิน'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#4a148c').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(10).setWrap(true);
  sheet.setFrozenRows(1);
}

function setupLogSheet(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
  sheet.clear();

  const headers = ['วันที่-เวลา', 'ผู้ดำเนินการ', 'รายละเอียด'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#37474f').setFontColor('#fff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setColumnWidths(1, 1, 180);
  sheet.setColumnWidths(2, 1, 200);
  sheet.setColumnWidths(3, 1, 500);
  sheet.setFrozenRows(1);
}

function addLog(user, detail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
  if (sheet) {
    sheet.appendRow([new Date(), user, detail]);
  }
}

// ==================== CUSTOM MENU ====================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏫 ระบบประเมินผล')
    .addItem('🔐 เข้าสู่ระบบ Admin', 'showAdminLogin')
    .addItem('📝 เข้าสู่ระบบผู้ประเมิน', 'showEvaluatorLogin')
    .addSeparator()
    //.addItem('⚙️ ตั้งค่าระบบ (ครั้งแรก)', 'setupSystem')
    .addItem('ℹ️ คู่มือการใช้งาน', 'showHelp')
    .addToUi();
}

// ==================== ADMIN LOGIN ====================

function showAdminLogin() {
  const html = HtmlService.createHtmlOutputFromFile('AdminLogin')
    .setWidth(420).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '🔐 เข้าสู่ระบบ Admin');
}

function verifyAdminPassword(password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (!sheet) return { success: false, message: 'กรุณาตั้งค่าระบบก่อน' };

  const storedHash = sheet.getRange('B2').getValue();
  const inputHash = hashPassword(password);

  if (inputHash === storedHash) {
    // เก็บ session token ใน PropertiesService
    const token = generatePassword(32);
    const userProps = PropertiesService.getUserProperties();
    userProps.setProperty('admin_token', token);
    userProps.setProperty('admin_token_time', new Date().getTime().toString());
    addLog('Admin', 'เข้าสู่ระบบ Admin');
    return { success: true, token: token };
  }
  return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' };
}

function isAdminLoggedIn() {
  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('admin_token');
  const tokenTime = userProps.getProperty('admin_token_time');
  if (!token || !tokenTime) return false;
  // Session หมดอายุ 2 ชม.
  const elapsed = new Date().getTime() - parseInt(tokenTime);
  return elapsed < 7200000;
}

function showAdminPanel() {
  if (!isAdminLoggedIn()) {
    SpreadsheetApp.getUi().alert('⛔ กรุณาเข้าสู่ระบบ Admin ก่อน');
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('AdminPanel')
    .setWidth(900).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '🛡️ แผงควบคุม Admin');
}

// ==================== EVALUATOR LOGIN ====================

function showEvaluatorLogin() {
  const html = HtmlService.createHtmlOutputFromFile('EvaluatorLogin')
    .setWidth(420).setHeight(350);
  SpreadsheetApp.getUi().showModalDialog(html, '📝 เข้าสู่ระบบผู้ประเมิน');
}

function verifyEvaluatorPassword(evaluatorName, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  const data = sheet.getDataRange().getValues();
  const inputHash = hashPassword(password);

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === evaluatorName && data[i][8] === inputHash && data[i][9] !== 'ไม่ใช้งาน') {
      const token = generatePassword(32);
      const userProps = PropertiesService.getUserProperties();
      userProps.setProperty('evaluator_token', token);
      userProps.setProperty('evaluator_name', evaluatorName);
      userProps.setProperty('evaluator_role', data[i][5]);
      userProps.setProperty('evaluator_scope', data[i][6] || '');
      userProps.setProperty('evaluator_token_time', new Date().getTime().toString());
      addLog(evaluatorName, 'เข้าสู่ระบบผู้ประเมิน');
      return {
        success: true, token: token,
        name: evaluatorName, role: data[i][5], scope: data[i][6] || ''
      };
    }
  }
  return { success: false, message: 'ชื่อผู้ประเมินหรือรหัสผ่านไม่ถูกต้อง' };
}

function getEvaluatorSession() {
  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('evaluator_token');
  const tokenTime = userProps.getProperty('evaluator_token_time');
  if (!token || !tokenTime) return null;
  const elapsed = new Date().getTime() - parseInt(tokenTime);
  if (elapsed >= 7200000) return null;
  return {
    name: userProps.getProperty('evaluator_name'),
    role: userProps.getProperty('evaluator_role'),
    scope: userProps.getProperty('evaluator_scope')
  };
}

function getEvaluatorListForLogin() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  var list = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] && data[i][9] !== 'ไม่ใช้งาน') {
      list.push({
        name: data[i][4],
        role: data[i][5],
        scope: data[i][6] || ''
      });
    }
  }
  return list;
}

// ==================== ADMIN FUNCTIONS ====================

function adminGetEvaluators() {
  if (!isAdminLoggedIn()) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  const data = sheet.getDataRange().getValues();
  var list = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][2]) {
      list.push({
        row: i + 1,
        prefix: data[i][1],
        firstName: data[i][2],
        lastName: data[i][3],
        fullName: data[i][4],
        role: data[i][5],
        scope: data[i][6],
        email: data[i][7],
        status: data[i][9]
      });
    }
  }
  return list;
}

function adminAddEvaluator(formData) {
  if (!isAdminLoggedIn()) return { success: false, message: 'ไม่มีสิทธิ์' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  const lastRow = sheet.getLastRow() + 1;

  // สุ่มรหัสผ่าน
  const plainPassword = generatePassword(8);
  const hashedPassword = hashPassword(plainPassword);

  sheet.getRange(lastRow, 2).setValue(formData.prefix);
  sheet.getRange(lastRow, 3).setValue(formData.firstName);
  sheet.getRange(lastRow, 4).setValue(formData.lastName);
  // col 5 มีสูตรอยู่แล้ว แต่ต้องใส่สูตรใหม่สำหรับแถวใหม่
  sheet.getRange(lastRow, 5).setFormula('=IF(C' + lastRow + '<>"", B' + lastRow + '&C' + lastRow + '&" "&D' + lastRow + ', "")');
  sheet.getRange(lastRow, 1).setFormula('=IF(C' + lastRow + '<>"", ROW()-1, "")');
  sheet.getRange(lastRow, 6).setValue(formData.role);
  sheet.getRange(lastRow, 7).setValue(formData.scope || '');
  sheet.getRange(lastRow, 8).setValue(formData.email || '');
  sheet.getRange(lastRow, 9).setValue(hashedPassword);
  sheet.getRange(lastRow, 10).setValue('ใช้งาน');

  addLog('Admin', 'เพิ่มผู้ประเมิน: ' + formData.firstName + ' ' + formData.lastName + ' (' + formData.role + ')');

  return {
    success: true,
    password: plainPassword,
    fullName: formData.prefix + formData.firstName + ' ' + formData.lastName,
    message: 'เพิ่มผู้ประเมินเรียบร้อย'
  };
}

function adminResetEvaluatorPassword(fullName) {
  if (!isAdminLoggedIn()) return { success: false, message: 'ไม่มีสิทธิ์' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === fullName) {
      const newPassword = generatePassword(8);
      sheet.getRange(i + 1, 9).setValue(hashPassword(newPassword));
      addLog('Admin', 'รีเซ็ตรหัสผ่าน: ' + fullName);
      return { success: true, password: newPassword, fullName: fullName };
    }
  }
  return { success: false, message: 'ไม่พบผู้ประเมิน' };
}

function adminToggleEvaluatorStatus(fullName) {
  if (!isAdminLoggedIn()) return { success: false, message: 'ไม่มีสิทธิ์' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EVALUATORS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === fullName) {
      const newStatus = data[i][9] === 'ใช้งาน' ? 'ไม่ใช้งาน' : 'ใช้งาน';
      sheet.getRange(i + 1, 10).setValue(newStatus);
      addLog('Admin', 'เปลี่ยนสถานะ ' + fullName + ' → ' + newStatus);
      return { success: true, newStatus: newStatus };
    }
  }
  return { success: false, message: 'ไม่พบผู้ประเมิน' };
}

function adminChangePassword(oldPassword, newPassword) {
  if (!isAdminLoggedIn()) return { success: false, message: 'ไม่มีสิทธิ์' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  const storedHash = sheet.getRange('B2').getValue();

  if (hashPassword(oldPassword) !== storedHash) {
    return { success: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
  }

  sheet.getRange('B2').setValue(hashPassword(newPassword));
  addLog('Admin', 'เปลี่ยนรหัสผ่าน Admin');
  return { success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อย' };
}

function adminDeleteEvaluation(rowIndex) {
  if (!isAdminLoggedIn()) return { success: false, message: 'ไม่มีสิทธิ์' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.RESULTS);
  if (rowIndex > 1 && rowIndex <= sheet.getLastRow()) {
    const teacherName = sheet.getRange(rowIndex, 5).getValue();
    sheet.deleteRow(rowIndex);
    addLog('Admin', 'ลบผลประเมิน แถวที่ ' + rowIndex + ' (' + teacherName + ')');
    return { success: true };
  }
  return { success: false, message: 'ไม่พบข้อมูล' };
}

// ==================== EVALUATOR FUNCTIONS (ฟอร์มประเมิน) ====================

function showEvaluationForm() {
  const session = getEvaluatorSession();
  if (!session) {
    SpreadsheetApp.getUi().alert('⛔ กรุณาเข้าสู่ระบบผู้ประเมินก่อน');
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('EvaluationForm')
    .setWidth(850).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '📝 แบบประเมินผลการปฏิบัติงานครู');
}

function getLoggedInEvaluator() {
  return getEvaluatorSession();
}

function getTeachersForEvaluator(evaluatorName, evaluatorRole, evaluatorScope) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  const data = sheet.getDataRange().getValues();

  var teachers = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][2] || data[i][7] === 'ไม่ใช้งาน') continue;
    var teacher = { name: data[i][4], level: data[i][5], dutyDay: data[i][6] };

    if (evaluatorRole === CONFIG.EVALUATOR_ROLES.VICE_DIRECTOR ||
        evaluatorRole === CONFIG.EVALUATOR_ROLES.HEAD_AFFAIRS) {
      teachers.push(teacher);
    } else if (evaluatorRole === CONFIG.EVALUATOR_ROLES.HEAD_LEVEL) {
      if (teacher.level === evaluatorScope) teachers.push(teacher);
    } else if (evaluatorRole === CONFIG.EVALUATOR_ROLES.HEAD_DUTY) {
      if (teacher.dutyDay === evaluatorScope) teachers.push(teacher);
    }
  }
  return teachers;
}

function getCriteriaForRole(evaluatorRole) {
  var roleKey = Object.keys(CONFIG.EVALUATOR_ROLES).find(function(key) {
    return CONFIG.EVALUATOR_ROLES[key] === evaluatorRole;
  });
  return CRITERIA.filter(function(c) {
    return c.evaluatedBy.indexOf(roleKey) !== -1;
  }).map(function(c) {
    return { id: c.id, name: c.name };
  });
}

function submitEvaluation(formData) {
  const session = getEvaluatorSession();
  if (!session) return { success: false, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEETS.RESULTS);
  const timestamp = new Date();

  const row = [
    timestamp, formData.evaluatorName, formData.evaluatorRole, formData.semester,
    formData.teacherName, formData.teacherLevel, formData.teacherDutyDay,
    formData.scores[1] || '', formData.scores[2] || '', formData.scores[3] || '',
    formData.scores[4] || '', formData.scores[5] || '', formData.scores[6] || '',
    formData.scores[7] || '', formData.scores[8] || '', formData.scores[9] || '',
    formData.scores[10] || '', '', '', '', formData.comment || ''
  ];

  const lastRow = resultSheet.getLastRow() + 1;
  resultSheet.getRange(lastRow, 1, 1, row.length).setValues([row]);

  const scoreRange = 'H' + lastRow + ':Q' + lastRow;
  resultSheet.getRange(lastRow, 18).setFormula('=SUMPRODUCT((' + scoreRange + '<>"")*' + scoreRange + ')');
  resultSheet.getRange(lastRow, 19).setFormula('=IF(R' + lastRow + '>0, R' + lastRow + '/COUNTIF(' + scoreRange + ',"<>"), 0)');
  resultSheet.getRange(lastRow, 20).setFormula(
    '=IF(S' + lastRow + '>=4.5,"ดีเยี่ยม",IF(S' + lastRow + '>=3.5,"ดีมาก",IF(S' + lastRow + '>=2.5,"ดี",IF(S' + lastRow + '>=1.5,"พอใช้","ปรับปรุง"))))'
  );

  addLog(formData.evaluatorName, 'ประเมินครู: ' + formData.teacherName + ' | ภาคเรียน: ' + formData.semester);
  return { success: true, message: 'บันทึกผลการประเมินเรียบร้อยแล้ว ✅' };
}

// ==================== ADMIN REPORTS ====================

function generateSummary() {
  if (!isAdminLoggedIn()) {
    SpreadsheetApp.getUi().alert('⛔ กรุณาเข้าสู่ระบบ Admin ก่อน');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEETS.RESULTS);
  const summarySheet = ss.getSheetByName(CONFIG.SHEETS.SUMMARY);
  const resultData = resultSheet.getDataRange().getValues();

  if (resultData.length <= 1) {
    SpreadsheetApp.getUi().alert('ยังไม่มีข้อมูลผลการประเมิน');
    return;
  }

  if (summarySheet.getLastRow() > 1) {
    summarySheet.getRange(2, 1, summarySheet.getLastRow() - 1, summarySheet.getLastColumn()).clear();
  }

  var teacherScores = {};
  for (let i = 1; i < resultData.length; i++) {
    var teacherName = resultData[i][4];
    var evaluatorRole = resultData[i][2];
    var avgScore = resultData[i][18];
    if (!teacherName) continue;

    if (!teacherScores[teacherName]) {
      teacherScores[teacherName] = {
        level: resultData[i][5], dutyDay: resultData[i][6],
        viceDirector: [], headAffairs: [], headLevel: [], headDuty: [], count: 0
      };
    }
    teacherScores[teacherName].count++;

    if (evaluatorRole === CONFIG.EVALUATOR_ROLES.VICE_DIRECTOR) teacherScores[teacherName].viceDirector.push(avgScore);
    else if (evaluatorRole === CONFIG.EVALUATOR_ROLES.HEAD_AFFAIRS) teacherScores[teacherName].headAffairs.push(avgScore);
    else if (evaluatorRole === CONFIG.EVALUATOR_ROLES.HEAD_LEVEL) teacherScores[teacherName].headLevel.push(avgScore);
    else if (evaluatorRole === CONFIG.EVALUATOR_ROLES.HEAD_DUTY) teacherScores[teacherName].headDuty.push(avgScore);
  }

  var row = 2, index = 1;
  for (var name in teacherScores) {
    var d = teacherScores[name];
    var avgVD = d.viceDirector.length > 0 ? avg(d.viceDirector) : '';
    var avgHA = d.headAffairs.length > 0 ? avg(d.headAffairs) : '';
    var avgHL = d.headLevel.length > 0 ? avg(d.headLevel) : '';
    var avgHD = d.headDuty.length > 0 ? avg(d.headDuty) : '';
    var all = d.viceDirector.concat(d.headAffairs).concat(d.headLevel).concat(d.headDuty);
    var totalAvg = all.length > 0 ? avg(all) : 0;
    var level = getLevel(totalAvg);

    summarySheet.getRange(row, 1, 1, 11).setValues([[
      index, name, d.level, d.dutyDay,
      avgVD !== '' ? avgVD.toFixed(2) : '-', avgHA !== '' ? avgHA.toFixed(2) : '-',
      avgHL !== '' ? avgHL.toFixed(2) : '-', avgHD !== '' ? avgHD.toFixed(2) : '-',
      totalAvg.toFixed(2), level, d.count
    ]]);

    var levelCell = summarySheet.getRange(row, 10);
    if (level === 'ดีเยี่ยม') levelCell.setBackground('#c8e6c9');
    else if (level === 'ดีมาก') levelCell.setBackground('#dcedc8');
    else if (level === 'ดี') levelCell.setBackground('#fff9c4');
    else if (level === 'พอใช้') levelCell.setBackground('#ffe0b2');
    else levelCell.setBackground('#ffcdd2');

    row++; index++;
  }

  addLog('Admin', 'สรุปผลการประเมิน จำนวน ' + (index - 1) + ' คน');
  SpreadsheetApp.getUi().alert('✅ สรุปผลการประเมินเรียบร้อย\nจำนวนครูทั้งหมด: ' + (index - 1) + ' คน');
  ss.setActiveSheet(summarySheet);
}

function avg(arr) {
  return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
}

function getLevel(score) {
  if (score >= 4.5) return 'ดีเยี่ยม';
  if (score >= 3.5) return 'ดีมาก';
  if (score >= 2.5) return 'ดี';
  if (score >= 1.5) return 'พอใช้';
  return 'ปรับปรุง';
}

function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEETS.RESULTS);
  const data = resultSheet.getDataRange().getValues();

  if (data.length <= 1) return { totalEvaluations: 0, teachers: {}, byLevel: {}, byDay: {}, byRole: {}, ratingDistribution: {} };

  var stats = {
    totalEvaluations: data.length - 1,
    teachers: {}, byLevel: {}, byDay: {}, byRole: {},
    ratingDistribution: { 'ดีเยี่ยม': 0, 'ดีมาก': 0, 'ดี': 0, 'พอใช้': 0, 'ปรับปรุง': 0 }
  };

  for (let i = 1; i < data.length; i++) {
    var tName = data[i][4], level = data[i][5], day = data[i][6],
        role = data[i][2], theAvg = data[i][18] ? Number(data[i][18]) : 0,
        rating = data[i][19];
    if (!tName) continue;

    if (!stats.teachers[tName]) stats.teachers[tName] = { scores: [], level: level, day: day };
    stats.teachers[tName].scores.push(theAvg);

    if (level) { if (!stats.byLevel[level]) stats.byLevel[level] = []; stats.byLevel[level].push(theAvg); }
    if (day) { if (!stats.byDay[day]) stats.byDay[day] = []; stats.byDay[day].push(theAvg); }
    if (role) { if (!stats.byRole[role]) stats.byRole[role] = 0; stats.byRole[role]++; }
    if (rating && stats.ratingDistribution.hasOwnProperty(rating)) stats.ratingDistribution[rating]++;
  }
  return stats;
}

function getEvaluationHistory(teacherName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEETS.RESULTS);
  const data = resultSheet.getDataRange().getValues();
  var results = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][4] && data[i][4].toString().indexOf(teacherName) !== -1) {
      results.push({
        row: i + 1,
        timestamp: data[i][0],
        evaluator: data[i][1],
        role: data[i][2],
        semester: data[i][3],
        teacher: data[i][4],
        avg: data[i][18],
        rating: data[i][19],
        comment: data[i][20]
      });
    }
  }
  return results;
}

// ==================== HELP ====================

function showHelp() {
  const help =
    '📖 คู่มือการใช้งาน - ระบบประเมินผลการปฏิบัติงานครู v2.0\n' +
    '═══════════════════════════════════════════\n\n' +
    '🔐 ระบบแบ่งเป็น 2 ส่วน:\n\n' +
    '👑 Admin:\n' +
    '  - เข้าด้วยรหัสผ่าน Admin (ได้ตอนตั้งค่าระบบ)\n' +
    '  - จัดการรายชื่อผู้ประเมิน (เพิ่ม/ลบ/รีเซ็ตรหัสผ่าน)\n' +
    '  - ดูผลการประเมินทั้งหมด + แดชบอร์ด\n' +
    '  - สรุปผล + ส่งออก PDF\n' +
    '  - เปลี่ยนรหัสผ่าน Admin\n\n' +
    '📝 ผู้ประเมิน:\n' +
    '  - เข้าด้วยชื่อ + รหัสผ่านที่ได้จาก Admin\n' +
    '  - เห็นเฉพาะฟอร์มประเมินเท่านั้น\n' +
    '  - ประเมินได้เฉพาะครูและเกณฑ์ตามสิทธิ์\n' +
    '  - ไม่เห็น Sheet ข้อมูลใดๆ\n\n' +
    '⚠️ รหัสผ่านผู้ประเมินจะสุ่มสร้างอัตโนมัติ\n' +
    '   Admin สามารถรีเซ็ตรหัสผ่านได้ทุกเมื่อ';

  SpreadsheetApp.getUi().alert(help);
}