/**
 * ============================================================================
 * ไฟล์: 03_Setup.gs  |  ติดตั้ง / อัปเกรดระบบ และย้ายข้อมูลจากระบบเดิม (v2)
 * การติดตั้งเป็นแบบ "ปลอดภัย": สร้างเฉพาะสิ่งที่ยังไม่มี ไม่ลบข้อมูลเดิม
 * ============================================================================
 */

const HEADER_STYLES_ = {};
HEADER_STYLES_[SHEETS.TEACHERS] = '#1a237e';
HEADER_STYLES_[SHEETS.EVALUATORS] = '#b71c1c';
HEADER_STYLES_[SHEETS.CRITERIA] = '#1b5e20';
HEADER_STYLES_[SHEETS.DUTY] = '#00695c';
HEADER_STYLES_[SHEETS.RESULTS] = '#e65100';
HEADER_STYLES_[SHEETS.ARCHIVE] = '#4e342e';
HEADER_STYLES_[SHEETS.SUMMARY] = '#4a148c';
HEADER_STYLES_[SHEETS.LOG] = '#37474f';
HEADER_STYLES_[SHEETS.SETTINGS] = '#212121';

/**
 * ติดตั้ง/อัปเกรดระบบ — เรียกจากเมนู
 * ปลอดภัยต่อการเรียกซ้ำ (idempotent) และจะย้ายข้อมูลจากระบบเดิมให้อัตโนมัติ
 */
function setupSystem() {
  const ui = SpreadsheetApp.getUi();
  const isFresh = !sheetExists_(SHEETS.SETTINGS);

  const answer = ui.alert(
    '⚙️ ติดตั้ง / อัปเกรดระบบ v' + APP.VERSION,
    isFresh
      ? 'ระบบจะสร้างชีทและโครงสร้างข้อมูลทั้งหมด พร้อมสร้างรหัสผ่านผู้ดูแลระบบให้ 1 ชุด\n\nต้องการดำเนินการต่อหรือไม่?'
      : 'ระบบจะตรวจสอบและเพิ่มเฉพาะชีท/คอลัมน์ที่ยังขาด\nข้อมูลเดิมทั้งหมดจะถูกเก็บไว้ (ไม่มีการล้างข้อมูล)\n\nต้องการดำเนินการต่อหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  const result = runSetup_();
  let message = '✅ ' + (isFresh ? 'ติดตั้งระบบเรียบร้อย!' : 'อัปเกรดระบบเรียบร้อย!') + '\n\n';
  if (result.migrated.length) {
    message += '📦 ย้ายข้อมูลจากระบบเดิม:\n' + result.migrated.map(function (m) { return '  • ' + m; }).join('\n') + '\n\n';
  }
  if (result.adminPassword) {
    message += '🔑 รหัสผ่านผู้ดูแลระบบ: ' + result.adminPassword + '\n' +
      '⚠️ กรุณาจดรหัสผ่านนี้ไว้ทันที (จะไม่แสดงซ้ำอีก)\n\n';
  }
  message += 'ขั้นตอนถัดไป:\n' +
    '1. เปิดเมนู "🏫 ระบบประเมินผล → 🚀 เปิดระบบ"\n' +
    '2. เข้าสู่ระบบผู้ดูแล แล้วตั้งค่าอีเมลกู้คืนรหัสผ่านในหน้า "ตั้งค่าและความปลอดภัย"\n' +
    '3. เพิ่มรายชื่อครู ผู้ประเมิน และตารางเวรประจำวันของภาคเรียน';

  ui.alert(message);
}

/** ตรรกะการติดตั้งจริง แยกออกมาเพื่อให้เรียกใช้/ทดสอบได้โดยไม่ต้องผ่าน UI */
function runSetup_() {
  const ss = ss_();
  const created = [];
  const migrated = [];

  // 1) ชีทประวัติของระบบเดิม (v2 ใช้ชื่อ "ประวัติการประเมิน" และมีคอลัมน์ไม่ตรงกับของใหม่)
  //    เก็บไว้เป็นชีทแยกเพื่อไม่ให้ข้อมูลเดิมสูญหายและไม่ทำให้คอลัมน์ปนกัน
  const legacyLog = ss.getSheetByName('ประวัติการประเมิน');
  if (legacyLog) {
    legacyLog.setName(LEGACY_LOG_SHEET_);
    migrated.push('เก็บประวัติการใช้งานของระบบเดิมไว้ที่ชีท "' + LEGACY_LOG_SHEET_ + '"');
  }

  // 2) สร้างชีทและหัวตารางที่จำเป็น
  ensureSheet_(SHEETS.SETTINGS, ['คีย์', 'ค่า', 'คำอธิบาย'], created);
  ensureSheet_(SHEETS.TEACHERS, TEACHER_HEADERS, created);
  ensureSheet_(SHEETS.EVALUATORS, EVALUATOR_HEADERS, created);
  ensureSheet_(SHEETS.CRITERIA, CRITERIA_HEADERS, created);
  ensureSheet_(SHEETS.DUTY, DUTY_HEADERS, created);
  ensureSheet_(SHEETS.RESULTS, resultHeaders_(), created);
  ensureSheet_(SHEETS.ARCHIVE, archiveHeaders_(), created);
  ensureSheet_(SHEETS.SUMMARY, SUMMARY_HEADERS, created);
  ensureSheet_(SHEETS.LOG, LOG_HEADERS, created);

  // 3) ค่าตั้งต้นของระบบ
  seedSettings_();

  // 4) เกณฑ์การประเมินเริ่มต้น (ถ้ายังไม่มี)
  if (readTable_(SHEETS.CRITERIA).rows.length === 0) {
    seedCriteria_();
    created.push('เกณฑ์การประเมินเริ่มต้น');
  }

  // 5) ย้ายข้อมูลจากระบบเดิม
  const migrationResult = migrateLegacyData_();
  migrationResult.forEach(function (m) { migrated.push(m); });

  // 6) จัดรูปแบบ ตรวจสอบความถูกต้อง และป้องกันชีทอ่อนไหว
  applyFormatting_();
  applyValidations_();
  protectSensitiveSheets_();

  // 7) รหัสผ่านผู้ดูแลระบบ (สร้างเฉพาะครั้งแรกที่ยังไม่เคยมี)
  let adminPassword = '';
  if (!str_(getSetting_(SETTING_KEYS.ADMIN_HASH, ''))) {
    adminPassword = generatePassword_(12);
    const rec = makePasswordRecord_(adminPassword, getSettingNumber_(SETTING_KEYS.ADMIN_ITER, 4096));
    setSettings_({
      admin_password_hash: rec.hash,
      admin_password_salt: rec.salt,
      admin_password_iterations: rec.iterations,
      admin_password_changed_at: nowStamp_()
    });
  }

  setSetting_(SETTING_KEYS.VERSION, APP.VERSION);
  if (!str_(getSetting_(SETTING_KEYS.SETUP_DATE, ''))) setSetting_(SETTING_KEYS.SETUP_DATE, nowStamp_());
  PropertiesService.getScriptProperties().setProperty('spreadsheet_id', ss.getId());

  logAction_('ระบบ', 'system', 'ติดตั้ง/อัปเกรดระบบ',
    'เวอร์ชัน ' + APP.VERSION + (created.length ? ' | สร้างใหม่: ' + created.join(', ') : ''));

  return { created: created, migrated: migrated, adminPassword: adminPassword };
}

/** สร้างชีทถ้ายังไม่มี และเติมคอลัมน์ที่ขาดโดยไม่แตะข้อมูลเดิม */
function ensureSheet_(name, headers, createdList) {
  const ss = ss_();
  let sheet = ss.getSheetByName(name);
  let isNew = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    isNew = true;
    if (createdList) createdList.push(name);
  }
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  if (isNew || existing.filter(String).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  // เติมเฉพาะคอลัมน์ที่ยังไม่มี ต่อท้ายตาราง (ข้อมูลเดิมไม่ขยับ)
  const missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function seedSettings_() {
  const current = readSettings_(true);
  const patch = {};
  Object.keys(SETTING_DEFAULTS).forEach(function (key) {
    if (current[key] === undefined || current[key] === '') patch[key] = SETTING_DEFAULTS[key];
  });
  if (!current[SETTING_KEYS.CURRENT_YEAR]) patch[SETTING_KEYS.CURRENT_YEAR] = guessAcademicYear_();
  if (!current[SETTING_KEYS.CURRENT_SEMESTER]) patch[SETTING_KEYS.CURRENT_SEMESTER] = guessSemester_();
  if (!current[SETTING_KEYS.ACADEMIC_YEARS]) {
    const y = Number(guessAcademicYear_());
    patch[SETTING_KEYS.ACADEMIC_YEARS] = [y - 1, y, y + 1].join(',');
  }
  if (Object.keys(patch).length) setSettings_(patch);
}

function seedCriteria_() {
  const rows = DEFAULT_CRITERIA.map(function (c) {
    return {
      'ข้อที่': c.id,
      'เกณฑ์การประเมิน': c.name,
      'ผู้มีสิทธิ์ประเมิน': c.roles.map(function (r) { return ROLES[r]; }).join(', '),
      'น้ำหนัก (%)': c.weight,
      'คำอธิบาย': '',
      'สถานะ': STATUS.ACTIVE
    };
  });
  appendRecords_(SHEETS.CRITERIA, rows);

  writeScoreLegend_();
}

/**
 * ตารางความหมายของระดับคะแนน
 * วางไว้ในคอลัมน์ H เป็นต้นไป (นอกช่วงหัวตารางของเกณฑ์) เพื่อไม่ให้ระบบอ่านปนกับข้อมูลเกณฑ์
 */
function writeScoreLegend_() {
  const sheet = getSheet_(SHEETS.CRITERIA);
  const col = CRITERIA_HEADERS.length + 2; // เว้น 1 คอลัมน์จากตารางเกณฑ์
  sheet.getRange(1, col, 1, 3).merge().setValue('ความหมายของระดับคะแนน')
    .setFontWeight('bold').setHorizontalAlignment('center').setBackground('#1b5e20').setFontColor('#ffffff');
  sheet.getRange(2, col, 1, 3).setValues([['ระดับ', 'ความหมาย', 'คำอธิบาย']])
    .setBackground('#e8f5e9').setFontWeight('bold');
  sheet.getRange(3, col, SCORE_MEANING.length, 3).setValues(
    SCORE_MEANING.map(function (s) { return [s.score, s.label, s.desc]; })
  );
  sheet.setColumnWidth(col, 60);
  sheet.setColumnWidth(col + 1, 110);
  sheet.setColumnWidth(col + 2, 340);
}

/** จัดรูปแบบหัวตาราง ความกว้างคอลัมน์ และตรึงแถวแรก */
function applyFormatting_() {
  Object.keys(HEADER_STYLES_).forEach(function (name) {
    const ss = ss_();
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastColumn() === 0) return;
    const cols = sheet.getLastColumn();
    sheet.getRange(1, 1, 1, cols)
      .setBackground(HEADER_STYLES_[name])
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setFontSize(10)
      .setWrap(true);
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 40);
  });

  const widths = {};
  widths[SHEETS.TEACHERS] = [90, 90, 120, 130, 200, 160, 130, 110, 150, 200, 90, 150];
  widths[SHEETS.EVALUATORS] = [110, 90, 120, 130, 200, 250, 160, 200, 260, 200, 110, 130, 90, 160, 110, 160, 150];
  widths[SHEETS.DUTY] = [110, 100, 90, 90, 200, 110, 120, 180, 90, 100, 130, 200, 90, 150, 160];
  widths[SHEETS.SETTINGS] = [230, 380, 420];

  Object.keys(widths).forEach(function (name) {
    const sheet = ss_().getSheetByName(name);
    if (!sheet) return;
    widths[name].forEach(function (w, i) {
      if (i < sheet.getMaxColumns()) sheet.setColumnWidth(i + 1, w);
    });
  });

  // ซ่อนคอลัมน์รหัสผ่านในชีทผู้ประเมิน เพื่อไม่ให้ค่าแฮชเกะกะสายตา
  const evalSheet = ss_().getSheetByName(SHEETS.EVALUATORS);
  if (evalSheet) {
    const headers = tableHeaders_(SHEETS.EVALUATORS);
    ['รหัสผ่าน (Hash)', 'Salt', 'รอบการเข้ารหัส'].forEach(function (h) {
      const idx = headers.indexOf(h);
      if (idx >= 0) evalSheet.hideColumns(idx + 1);
    });
  }
}

/** ตั้งกฎการกรอกข้อมูล (dropdown) ให้ชีทที่ผู้ใช้กรอกเองได้ */
function applyValidations_() {
  const rule = function (list) {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true)
      .setAllowInvalid(false).build();
  };
  const apply = function (sheetName, headerName, list, rows) {
    const sheet = ss_().getSheetByName(sheetName);
    if (!sheet) return;
    const idx = tableHeaders_(sheetName).indexOf(headerName);
    if (idx === -1) return;
    sheet.getRange(2, idx + 1, rows || 500, 1).setDataValidation(rule(list));
  };

  apply(SHEETS.TEACHERS, 'คำนำหน้า', PREFIXES);
  apply(SHEETS.TEACHERS, 'ระดับชั้นที่ปรึกษา', LEVELS);
  apply(SHEETS.TEACHERS, 'เวรประจำวัน (ค่าเริ่มต้น)', DAYS);
  apply(SHEETS.TEACHERS, 'สถานะ', [STATUS.ACTIVE, STATUS.INACTIVE]);

  apply(SHEETS.EVALUATORS, 'คำนำหน้า', PREFIXES, 200);
  apply(SHEETS.EVALUATORS, 'บทบาท', Object.keys(ROLES).map(function (k) { return ROLES[k]; }), 200);
  apply(SHEETS.EVALUATORS, 'ขอบเขต (ระดับชั้น/วัน)', LEVELS.concat(DAYS), 200);
  apply(SHEETS.EVALUATORS, 'สถานะ', [STATUS.ACTIVE, STATUS.INACTIVE], 200);

  apply(SHEETS.DUTY, 'ภาคเรียน', ALL_SEMESTERS.map(function (x) { return x.value; }), 2000);
  apply(SHEETS.DUTY, 'เวรประจำวัน', DAYS, 2000);
  apply(SHEETS.DUTY, 'บทบาทในเวร', DUTY_POSITIONS, 2000);
  apply(SHEETS.DUTY, 'สถานะ', [STATUS.ACTIVE, STATUS.INACTIVE], 2000);

  apply(SHEETS.CRITERIA, 'สถานะ', [STATUS.ACTIVE, STATUS.INACTIVE], 50);
}

/** ซ่อนและป้องกันชีทที่มีข้อมูลอ่อนไหว */
function protectSensitiveSheets_() {
  PROTECTED_SHEETS.forEach(function (name) {
    const sheet = ss_().getSheetByName(name);
    if (!sheet) return;
    try {
      sheet.hideSheet();
    } catch (e) { /* ซ่อนไม่ได้ถ้าเป็นชีทเดียวที่เหลือ */ }
    try {
      const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      if (!existing.length) {
        sheet.protect()
          .setDescription('ข้อมูลอ่อนไหวของระบบประเมินผล — แก้ไขผ่านหน้าจอระบบเท่านั้น')
          .setWarningOnly(true);
      }
    } catch (e) { /* บางบัญชีไม่มีสิทธิ์ป้องกันชีท */ }
  });
}

// ==================== ย้ายข้อมูลจากระบบเดิม (v2 → v3) ====================

/**
 * ย้ายข้อมูลจากโครงสร้างเดิมมาสู่โครงสร้างใหม่:
 *  - เติมรหัสครู / รหัสผู้ประเมิน ให้ทุกแถวที่ยังไม่มี
 *  - แปลงผลการประเมินเดิม (ไม่มีรหัส/ปีการศึกษา) ให้อยู่ในรูปแบบใหม่
 *  - คัดลอกเวรประจำวันเดิมของครู เข้าสู่ตารางเวรของภาคเรียนปัจจุบัน
 * เรียกซ้ำได้โดยไม่ทำข้อมูลซ้ำซ้อน
 */
function migrateLegacyData_() {
  const notes = [];
  const year = str_(getSetting_(SETTING_KEYS.CURRENT_YEAR, guessAcademicYear_()));
  const semester = str_(getSetting_(SETTING_KEYS.CURRENT_SEMESTER, guessSemester_()));

  // --- ครู: เติมรหัสครูและชื่อ-นามสกุลที่เคยเป็นสูตร ---
  const teacherSheet = ss_().getSheetByName(SHEETS.TEACHERS);
  if (teacherSheet) {
    const table = readTable_(SHEETS.TEACHERS);
    const codes = table.rows.map(function (r) { return str_(r['รหัสครู']); });
    let filled = 0;
    table.rows.forEach(function (row) {
      const patch = {};
      if (!str_(row['รหัสครู'])) {
        const code = nextCode_('TCH', codes);
        codes.push(code);
        patch['รหัสครู'] = code;
      }
      if (!str_(row['ชื่อ-นามสกุล']) && str_(row['ชื่อ'])) {
        patch['ชื่อ-นามสกุล'] = str_(row['คำนำหน้า']) + str_(row['ชื่อ']) + ' ' + str_(row['นามสกุล']);
      }
      // v2 ใช้ชื่อคอลัมน์ต่างจาก v3 — คัดลอกค่ามาไว้ที่คอลัมน์ใหม่
      if (!str_(row['ระดับชั้นที่ปรึกษา']) && str_(row['ระดับชั้นที่สังกัด'])) {
        patch['ระดับชั้นที่ปรึกษา'] = str_(row['ระดับชั้นที่สังกัด']);
      }
      if (!str_(row['เวรประจำวัน (ค่าเริ่มต้น)']) && str_(row['เวรประจำวัน'])) {
        patch['เวรประจำวัน (ค่าเริ่มต้น)'] = str_(row['เวรประจำวัน']);
      }
      if (!str_(row['สถานะ'])) patch['สถานะ'] = STATUS.ACTIVE;
      if (Object.keys(patch).length) { updateRecord_(SHEETS.TEACHERS, row._row, patch); filled++; }
    });
    if (filled) notes.push('อัปเดตข้อมูลครู ' + filled + ' รายการ');
  }

  // --- ผู้ประเมิน: เติมรหัส และทำเครื่องหมายรหัสผ่านรูปแบบเดิม ---
  const evalTable = readTable_(SHEETS.EVALUATORS);
  const evalCodes = evalTable.rows.map(function (r) { return str_(r['รหัสผู้ประเมิน']); });
  let evalFilled = 0;
  evalTable.rows.forEach(function (row) {
    const patch = {};
    if (!str_(row['รหัสผู้ประเมิน'])) {
      const code = nextCode_('EVA', evalCodes);
      evalCodes.push(code);
      patch['รหัสผู้ประเมิน'] = code;
    }
    if (!str_(row['ชื่อ-นามสกุล']) && str_(row['ชื่อ'])) {
      patch['ชื่อ-นามสกุล'] = str_(row['คำนำหน้า']) + str_(row['ชื่อ']) + ' ' + str_(row['นามสกุล']);
    }
    if (!str_(row['ขอบเขต (ระดับชั้น/วัน)']) && str_(row['ระดับชั้น/วัน'])) {
      patch['ขอบเขต (ระดับชั้น/วัน)'] = str_(row['ระดับชั้น/วัน']);
    }
    if (!str_(row['สถานะ'])) patch['สถานะ'] = STATUS.ACTIVE;
    if (Object.keys(patch).length) { updateRecord_(SHEETS.EVALUATORS, row._row, patch); evalFilled++; }
  });
  if (evalFilled) notes.push('อัปเดตข้อมูลผู้ประเมิน ' + evalFilled + ' รายการ');

  // --- ผลการประเมินเดิม: เติมรหัส ปีการศึกษา และคำนวณคะแนนให้เป็นค่าคงที่ ---
  const migratedResults = migrateLegacyResults_(year);
  if (migratedResults) notes.push('ย้ายผลการประเมินเดิม ' + migratedResults + ' รายการ');

  // --- เวรประจำวัน: สร้างตารางเวรให้ภาคเรียนปัจจุบัน และทุกภาคเรียนที่พบในผลการประเมินเดิม ---
  const terms = [{ year: year, semester: semester }];
  readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
    const y = str_(r['ปีการศึกษา']), s = str_(r['ภาคเรียน']);
    if (!y || !s) return;
    const exists = terms.some(function (t) { return t.year === y && t.semester === s; });
    if (!exists) terms.push({ year: y, semester: s });
  });

  terms.forEach(function (t) {
    const created = seedDutyRosterFromTeachers_(t.year, t.semester);
    if (created) notes.push('สร้างตารางเวร ' + termLabel_(t.year, t.semester) + ' จำนวน ' + created + ' รายการ');
  });

  return notes;
}

/** แปลงผลการประเมินรูปแบบเดิมให้เข้ากับโครงสร้างใหม่ */
function migrateLegacyResults_(defaultYear) {
  const sheet = ss_().getSheetByName(SHEETS.RESULTS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const table = readTable_(SHEETS.RESULTS);
  const teacherIndex = buildTeacherIndex_();
  const evaluatorIndex = buildEvaluatorIndex_();
  const criteria = loadCriteria_();
  const ids = table.rows.map(function (r) { return str_(r['รหัสการประเมิน']); });
  let count = 0;

  table.rows.forEach(function (row) {
    if (str_(row['รหัสการประเมิน'])) return; // ย้ายแล้ว
    const patch = {};
    const id = nextCode_('EVR', ids);
    ids.push(id);
    patch['รหัสการประเมิน'] = id;

    // ภาคเรียนรูปแบบเดิมคือ "1/2568" → แยกเป็นภาคเรียน + ปีการศึกษา
    const semesterRaw = str_(row['ภาคเรียน']);
    if (semesterRaw.indexOf('/') !== -1) {
      const parts = semesterRaw.split('/');
      patch['ภาคเรียน'] = parts[0].trim();
      patch['ปีการศึกษา'] = parts[1].trim();
    } else {
      if (!str_(row['ปีการศึกษา'])) patch['ปีการศึกษา'] = defaultYear;
      if (!semesterRaw) patch['ภาคเรียน'] = '1';
    }

    const teacherName = str_(row['ครูผู้รับการประเมิน']);
    if (!str_(row['รหัสครู']) && teacherIndex.byName[teacherName]) {
      patch['รหัสครู'] = teacherIndex.byName[teacherName].id;
    }
    const evaluatorName = str_(row['ผู้ประเมิน']);
    if (!str_(row['รหัสผู้ประเมิน']) && evaluatorIndex.byName[evaluatorName]) {
      patch['รหัสผู้ประเมิน'] = evaluatorIndex.byName[evaluatorName].id;
    }
    if (!str_(row['วันที่บันทึก']) && row['Timestamp']) patch['วันที่บันทึก'] = row['Timestamp'];
    if (!str_(row['สถานะ'])) patch['สถานะ'] = STATUS.NORMAL;

    // คำนวณคะแนนใหม่เป็นค่าคงที่ (ระบบเดิมเก็บเป็นสูตร ซึ่งพังเมื่อย้าย/จัดเก็บข้อมูล)
    const scores = {};
    criteria.forEach(function (c) {
      const v = row[CRITERIA_COL_PREFIX + c.id];
      if (v !== '' && v !== null && v !== undefined) scores[c.id] = num_(v);
    });
    const calc = computeScore_(scores, criteria);
    patch['คะแนนรวม'] = calc.total;
    patch['คะแนนเต็ม'] = calc.max;
    patch['คะแนนเฉลี่ย'] = calc.average;
    patch['ระดับผลการประเมิน'] = calc.rating;

    updateRecord_(SHEETS.RESULTS, row._row, patch);
    count++;
  });
  return count;
}

/** สร้างตารางเวรของภาคเรียนที่กำหนดจากค่าเริ่มต้นในชีทรายชื่อครู (ถ้ายังไม่มีข้อมูล) */
function seedDutyRosterFromTeachers_(year, semester) {
  const existing = readTable_(SHEETS.DUTY).rows.filter(function (r) {
    return str_(r['ปีการศึกษา']) === String(year) && str_(r['ภาคเรียน']) === String(semester);
  });
  if (existing.length) return 0;

  const teachers = readTable_(SHEETS.TEACHERS).rows;
  const codes = readTable_(SHEETS.DUTY).rows.map(function (r) { return str_(r['รหัสรายการ']); });
  const rows = [];
  teachers.forEach(function (t) {
    const day = str_(t['เวรประจำวัน (ค่าเริ่มต้น)']) || str_(t['เวรประจำวัน']);
    if (!day) return;
    const code = nextCode_('DUT', codes);
    codes.push(code);
    rows.push({
      'รหัสรายการ': code,
      'ปีการศึกษา': String(year),
      'ภาคเรียน': String(semester),
      'รหัสครู': str_(t['รหัสครู']),
      'ชื่อ-นามสกุล': str_(t['ชื่อ-นามสกุล']),
      'เวรประจำวัน': day,
      'บทบาทในเวร': 'กรรมการเวร',
      'จุดปฏิบัติหน้าที่': '',
      'เวลาเริ่ม': '',
      'เวลาสิ้นสุด': '',
      'ระดับชั้นที่ดูแล': str_(t['ระดับชั้นที่ปรึกษา']),
      'หมายเหตุ': 'สร้างอัตโนมัติจากข้อมูลเดิม',
      'สถานะ': STATUS.ACTIVE,
      'ผู้บันทึก': 'ระบบ',
      'วันที่บันทึก': new Date()
    });
  });
  appendRecords_(SHEETS.DUTY, rows);
  return rows.length;
}

/** ดัชนีครูสำหรับค้นหาด้วยรหัสหรือชื่อ */
function buildTeacherIndex_() {
  const rows = readTable_(SHEETS.TEACHERS).rows;
  const byId = {}, byName = {};
  rows.forEach(function (r) {
    const item = {
      id: str_(r['รหัสครู']),
      name: str_(r['ชื่อ-นามสกุล']),
      level: str_(r['ระดับชั้นที่ปรึกษา']),
      room: str_(r['ห้องที่ปรึกษา']),
      department: str_(r['กลุ่มสาระ/ฝ่าย']),
      defaultDay: str_(r['เวรประจำวัน (ค่าเริ่มต้น)']),
      email: str_(r['อีเมล']),
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      _row: r._row
    };
    if (item.id) byId[item.id] = item;
    if (item.name) byName[item.name] = item;
  });
  return { byId: byId, byName: byName, list: rows };
}

function buildEvaluatorIndex_() {
  const rows = readTable_(SHEETS.EVALUATORS).rows;
  const byId = {}, byName = {};
  rows.forEach(function (r) {
    const item = {
      id: str_(r['รหัสผู้ประเมิน']),
      name: str_(r['ชื่อ-นามสกุล']),
      role: str_(r['บทบาท']),
      scope: str_(r['ขอบเขต (ระดับชั้น/วัน)']),
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      _row: r._row
    };
    if (item.id) byId[item.id] = item;
    if (item.name) byName[item.name] = item;
  });
  return { byId: byId, byName: byName, list: rows };
}
