/**
 * ============================================================================
 * ไฟล์: 01_Data.gs  |  ชั้นเข้าถึงข้อมูล (Data Access Layer)
 * อ่าน/เขียนชีทโดยอ้างอิงจาก "ชื่อหัวคอลัมน์" ไม่ใช่เลขคอลัมน์
 * ทำให้เพิ่ม/ย้ายคอลัมน์ในอนาคตได้โดยโค้ดไม่พัง
 * ============================================================================
 */

/** สเปรดชีตหลักของระบบ */
function ss_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  // กรณีรันเป็นเว็บแอปแบบ standalone ให้ใช้ ID ที่บันทึกไว้
  const id = PropertiesService.getScriptProperties().getProperty('spreadsheet_id');
  if (!id) throw new Error('ไม่พบสเปรดชีตของระบบ กรุณาเปิดจากไฟล์ Google Sheets ของระบบ');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name, createIfMissing) {
  const ss = ss_();
  let sheet = ss.getSheetByName(name);
  if (!sheet && createIfMissing) sheet = ss.insertSheet(name);
  if (!sheet) throw new Error('ไม่พบชีท "' + name + '" กรุณาสั่งติดตั้ง/อัปเกรดระบบก่อน');
  return sheet;
}

function sheetExists_(name) {
  return !!ss_().getSheetByName(name);
}

/** อ่านทั้งชีทเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคีย์ */
function readTable_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    let hasData = false;
    const obj = { _row: i + 1 };
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = raw[c];
      if (raw[c] !== '' && raw[c] !== null && raw[c] !== undefined) hasData = true;
    }
    if (hasData) rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function tableHeaders_(name) {
  const sheet = getSheet_(name);
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

/** แปลง object → array ตามลำดับหัวคอลัมน์ */
function objectToRow_(headers, obj) {
  return headers.map(function (h) {
    const v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}

/** เพิ่มข้อมูล 1 แถวต่อท้ายชีท คืนค่าเลขแถวที่เขียน */
function appendRecord_(name, obj) {
  const sheet = getSheet_(name);
  const headers = tableHeaders_(name);
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, headers.length).setValues([objectToRow_(headers, obj)]);
  return row;
}

/** เพิ่มข้อมูลหลายแถวพร้อมกัน (เร็วกว่าเรียก appendRecord_ ทีละแถว) */
function appendRecords_(name, objects) {
  if (!objects || !objects.length) return 0;
  const sheet = getSheet_(name);
  const headers = tableHeaders_(name);
  const start = sheet.getLastRow() + 1;
  const values = objects.map(function (o) { return objectToRow_(headers, o); });
  sheet.getRange(start, 1, values.length, headers.length).setValues(values);
  return values.length;
}

/** อัปเดตเฉพาะฟิลด์ที่ส่งมาในแถวที่ระบุ */
function updateRecord_(name, rowIndex, patch) {
  const sheet = getSheet_(name);
  const headers = tableHeaders_(name);
  Object.keys(patch).forEach(function (key) {
    const col = headers.indexOf(key);
    if (col === -1) return;
    const v = patch[key];
    sheet.getRange(rowIndex, col + 1).setValue(v === undefined || v === null ? '' : v);
  });
}

function deleteRecord_(name, rowIndex) {
  const sheet = getSheet_(name);
  if (rowIndex > 1 && rowIndex <= sheet.getLastRow()) sheet.deleteRow(rowIndex);
}

/** ล้างข้อมูลทั้งหมดใต้หัวตาราง (ไม่ลบหัวตาราง) */
function clearBody_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(1, sheet.getLastColumn());
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastCol).clear();
}

// ==================== การตั้งค่าระบบ ====================

let SETTINGS_CACHE_ = null;

function readSettings_(forceReload) {
  if (SETTINGS_CACHE_ && !forceReload) return SETTINGS_CACHE_;
  const map = {};
  if (sheetExists_(SHEETS.SETTINGS)) {
    const sheet = getSheet_(SHEETS.SETTINGS);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      values.forEach(function (r) {
        const key = String(r[0]).trim();
        if (key) map[key] = r[1];
      });
    }
  }
  SETTINGS_CACHE_ = map;
  return map;
}

function getSetting_(key, fallback) {
  const map = readSettings_();
  const v = map[key];
  if (v === undefined || v === null || v === '') {
    if (fallback !== undefined) return fallback;
    return SETTING_DEFAULTS[key] !== undefined ? SETTING_DEFAULTS[key] : '';
  }
  return v;
}

function getSettingNumber_(key, fallback) {
  const n = Number(getSetting_(key, fallback));
  return isNaN(n) ? Number(fallback) : n;
}

function getSettingBool_(key, fallback) {
  const v = String(getSetting_(key, fallback)).trim().toLowerCase();
  return v === 'ใช่' || v === 'true' || v === 'yes' || v === '1';
}

function setSetting_(key, value) {
  const sheet = getSheet_(SHEETS.SETTINGS, true);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        SETTINGS_CACHE_ = null;
        return;
      }
    }
  }
  const row = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(row, 1, 1, 3).setValues([[key, value, SETTING_DESCRIPTIONS[key] || '']]);
  SETTINGS_CACHE_ = null;
}

function setSettings_(patch) {
  Object.keys(patch).forEach(function (k) { setSetting_(k, patch[k]); });
}

// ==================== ยูทิลิตี้ทั่วไป ====================

function nowStamp_() {
  return Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function formatDate_(date, pattern) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return Utilities.formatDate(d, APP.TIMEZONE, pattern || 'dd/MM/yyyy HH:mm');
}

/** แปลงค่าจากชีทให้เป็น string ที่ปลอดภัยสำหรับส่งไปหน้าเว็บ */
function str_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatDate_(v);
  return String(v).trim();
}

function num_(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** สร้างรหัสอ้างอิงแบบเรียงลำดับ เช่น TCH-0007 */
function nextCode_(prefix, existingCodes) {
  let max = 0;
  (existingCodes || []).forEach(function (c) {
    const m = String(c).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + ('0000' + (max + 1)).slice(-4);
}

/** ล็อกการเขียนข้อมูลพร้อมกัน ป้องกันข้อมูลชนกัน */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('ระบบกำลังมีผู้ใช้งานพร้อมกันจำนวนมาก กรุณาลองใหม่อีกครั้ง');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** บันทึกประวัติการใช้งาน (audit log) */
function logAction_(user, role, action, detail) {
  try {
    const sheet = ss_().getSheetByName(SHEETS.LOG);
    if (!sheet) return;
    let account = '';
    try { account = Session.getActiveUser().getEmail() || ''; } catch (e) { account = ''; }
    // เขียนตามชื่อคอลัมน์ เพื่อให้ถูกต้องแม้ลำดับคอลัมน์จะต่างไปจากเดิม
    appendRecord_(SHEETS.LOG, {
      'วันที่-เวลา': new Date(),
      'ผู้ใช้': user || '-',
      'บทบาท': role || '-',
      'การกระทำ': action || '-',
      'รายละเอียด': detail || '',
      'บัญชี Google': account
    });
    // จำกัดขนาด log ไม่ให้โตเกิน 20,000 แถว
    const rows = sheet.getLastRow();
    if (rows > 20000) sheet.deleteRows(2, 5000);
  } catch (err) {
    console.error('logAction_ error: ' + err);
  }
}

/** ตอบกลับมาตรฐานของ API ทุกตัว */
function ok_(data, message) {
  const res = { success: true };
  if (data !== undefined) res.data = data;
  if (message) res.message = message;
  return res;
}

function fail_(message, code) {
  return { success: false, message: message || 'เกิดข้อผิดพลาด', code: code || '' };
}

/** ครอบการทำงานของ API เพื่อไม่ให้ error หลุดไปหน้าเว็บแบบดิบ ๆ */
function guard_(fn) {
  try {
    return fn();
  } catch (err) {
    console.error(err.stack || err);
    return fail_(err && err.message ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด');
  }
}
