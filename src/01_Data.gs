/**
 * ============================================================================
 * ไฟล์: 01_Data.gs  |  ชั้นเข้าถึงข้อมูล (Data Access Layer)
 * อ่าน/เขียนชีทโดยอ้างอิงจาก "ชื่อหัวคอลัมน์" ไม่ใช่เลขคอลัมน์
 * ทำให้เพิ่ม/ย้ายคอลัมน์ในอนาคตได้โดยโค้ดไม่พัง
 * ============================================================================
 */

/**
 * ---------------------------------------------------------------------------
 * แคช 2 ชั้น เพื่อลดจำนวนครั้งที่ต้องคุยกับ Google Sheets (ตัวหลักที่ทำให้ระบบช้า)
 *   ชั้นที่ 1  MEMO_   — จำไว้ภายในการทำงานครั้งเดียว (เร็วที่สุด ไม่มีโอกาสข้อมูลเก่า)
 *   ชั้นที่ 2  Cache   — แชร์ข้ามผู้ใช้และข้ามครั้ง เฉพาะตารางที่เปลี่ยนไม่บ่อย
 * ทุกครั้งที่มีการเขียนข้อมูล แคชของตารางนั้นจะถูกล้างทันที ข้อมูลจึงไม่ค้าง
 * ---------------------------------------------------------------------------
 */
const MEMO_ = { ss: null, sheets: {}, tables: {}, headers: {}, derived: {} };

/** ตารางที่แคชข้ามการทำงานได้ (เปลี่ยนไม่บ่อย) — ตารางผลการประเมินไม่แคช เพื่อให้เห็นข้อมูลล่าสุดเสมอ */
const CACHEABLE_TABLES_ = [SHEETS.TEACHERS, SHEETS.EVALUATORS, SHEETS.CRITERIA, SHEETS.DUTY,
  SHEETS.SETTINGS, SHEETS.SETS, SHEETS.SET_GROUPS];
const TABLE_CACHE_TTL_ = 300;          // วินาที
const TABLE_CACHE_MAX_ = 90000;        // อักขระ (ขีดจำกัดของ CacheService คือ 100KB ต่อคีย์)

/** สเปรดชีตหลักของระบบ */
function ss_() {
  if (MEMO_.ss) return MEMO_.ss;
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { MEMO_.ss = active; return active; }
  // กรณีรันเป็นเว็บแอปแบบ standalone ให้ใช้ ID ที่บันทึกไว้
  const id = PropertiesService.getScriptProperties().getProperty('spreadsheet_id');
  if (!id) throw new Error('ไม่พบสเปรดชีตของระบบ กรุณาเปิดจากไฟล์ Google Sheets ของระบบ');
  MEMO_.ss = SpreadsheetApp.openById(id);
  return MEMO_.ss;
}

function getSheet_(name, createIfMissing) {
  if (MEMO_.sheets[name]) return MEMO_.sheets[name];
  const ss = ss_();
  let sheet = ss.getSheetByName(name);
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(name);
    MEMO_.sheets = {};
  }
  if (!sheet) throw new Error('ไม่พบชีท "' + name + '" กรุณาสั่งติดตั้ง/อัปเกรดระบบก่อน');
  MEMO_.sheets[name] = sheet;
  return sheet;
}

function sheetExists_(name) {
  if (MEMO_.sheets[name]) return true;
  const sheet = ss_().getSheetByName(name);
  if (sheet) MEMO_.sheets[name] = sheet;
  return !!sheet;
}

/** ล้างแคชของตารางที่ถูกแก้ไข (เรียกอัตโนมัติจากทุกฟังก์ชันที่เขียนข้อมูล) */
function invalidateTable_(name) {
  delete MEMO_.tables[name];
  delete MEMO_.headers[name];
  MEMO_.derived = {};   // ค่าที่แปลงมาจากตาราง (เช่น ชุดประเมิน) ต้องคำนวณใหม่
  if (name === SHEETS.SETTINGS) SETTINGS_CACHE_ = null;
  if (CACHEABLE_TABLES_.indexOf(name) === -1) return;
  try {
    CacheService.getScriptCache().remove('tbl::' + name);
  } catch (e) { /* ไม่มีแคชก็ไม่เป็นไร */ }
}

function invalidateAllTables_() {
  MEMO_.tables = {};
  MEMO_.headers = {};
  MEMO_.sheets = {};
  MEMO_.derived = {};
  SETTINGS_CACHE_ = null;
  try {
    CacheService.getScriptCache().removeAll(CACHEABLE_TABLES_.map(function (n) { return 'tbl::' + n; }));
  } catch (e) { /* ไม่มีแคชก็ไม่เป็นไร */ }
}

/** แปลงค่าเป็น JSON โดยคงชนิดวันที่ไว้ เพื่อให้ข้อมูลจากแคชเหมือนอ่านจากชีทจริง */
function encodeTable_(table) {
  return JSON.stringify(table, function (key, value) {
    const raw = this[key];
    return raw instanceof Date ? { __date: raw.toISOString() } : value;
  });
}

function decodeTable_(text) {
  return JSON.parse(text, function (key, value) {
    if (value && typeof value === 'object' && typeof value.__date === 'string') return new Date(value.__date);
    return value;
  });
}

/**
 * อ่านทั้งชีทเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคีย์
 * ผลลัพธ์ถูกจำไว้ จึงเรียกซ้ำในงานเดียวกันได้โดยไม่เสียเวลาเพิ่ม
 */
function readTable_(name) {
  if (MEMO_.tables[name]) return MEMO_.tables[name];

  // ชั้นที่ 2: แคชที่แชร์ข้ามผู้ใช้
  if (CACHEABLE_TABLES_.indexOf(name) !== -1) {
    try {
      const cached = CacheService.getScriptCache().get('tbl::' + name);
      if (cached) {
        const table = decodeTable_(cached);
        MEMO_.tables[name] = table;
        MEMO_.headers[name] = table.headers;
        return table;
      }
    } catch (e) { /* อ่านแคชไม่ได้ ให้อ่านจากชีทตามปกติ */ }
  }

  const table = readTableFromSheet_(name);
  MEMO_.tables[name] = table;
  MEMO_.headers[name] = table.headers;

  if (CACHEABLE_TABLES_.indexOf(name) !== -1) {
    try {
      const encoded = encodeTable_(table);
      if (encoded.length <= TABLE_CACHE_MAX_) {
        CacheService.getScriptCache().put('tbl::' + name, encoded, TABLE_CACHE_TTL_);
      }
    } catch (e) { /* เก็บแคชไม่ได้ ไม่กระทบการทำงาน */ }
  }
  return table;
}

/** อ่านจากชีทจริง (ใช้ภายใน) */
function readTableFromSheet_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const rows = [];

  // เก็บตำแหน่งคอลัมน์ที่มีชื่อหัวตารางไว้ล่วงหน้า เพื่อไม่ต้องตรวจซ้ำทุกแถว
  const cols = [];
  for (let c = 0; c < headers.length; c++) {
    if (headers[c]) cols.push({ index: c, name: headers[c] });
  }

  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    let hasData = false;
    const obj = { _row: i + 1 };
    for (let c = 0; c < cols.length; c++) {
      const v = raw[cols[c].index];
      obj[cols[c].name] = v;
      if (v !== '' && v !== null && v !== undefined) hasData = true;
    }
    if (hasData) rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function tableHeaders_(name) {
  if (MEMO_.headers[name]) return MEMO_.headers[name];
  const sheet = getSheet_(name);
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  MEMO_.headers[name] = headers;
  return headers;
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
  invalidateTable_(name);
  return row;
}

/** เพิ่มข้อมูลหลายแถวพร้อมกันในการเขียนครั้งเดียว */
function appendRecords_(name, objects) {
  if (!objects || !objects.length) return 0;
  const sheet = getSheet_(name);
  const headers = tableHeaders_(name);
  const start = sheet.getLastRow() + 1;
  const values = objects.map(function (o) { return objectToRow_(headers, o); });
  sheet.getRange(start, 1, values.length, headers.length).setValues(values);
  invalidateTable_(name);
  return values.length;
}

/**
 * อัปเดตเฉพาะฟิลด์ที่ส่งมาในแถวที่ระบุ
 * เขียนเป็นช่วงเดียว (1 ครั้ง) แทนการเขียนทีละช่อง ทำให้เร็วขึ้นมากเมื่อแก้หลายฟิลด์
 */
function updateRecord_(name, rowIndex, patch) {
  const sheet = getSheet_(name);
  const headers = tableHeaders_(name);

  let min = -1, max = -1;
  const targets = [];
  Object.keys(patch).forEach(function (key) {
    const col = headers.indexOf(key);
    if (col === -1) return;
    targets.push({ col: col, value: patch[key] });
    if (min === -1 || col < min) min = col;
    if (col > max) max = col;
  });
  if (!targets.length) return;

  const width = max - min + 1;
  const range = sheet.getRange(rowIndex, min + 1, 1, width);

  // ถ้าฟิลด์ที่แก้ครอบคลุมทุกคอลัมน์ในช่วงอยู่แล้ว ก็ไม่ต้องอ่านค่าเดิมก่อนเขียน
  const values = (targets.length === width) ? [new Array(width)] : range.getValues();
  targets.forEach(function (t) { values[0][t.col - min] = normalizeCell_(t.value); });

  range.setValues(values);
  invalidateTable_(name);
}

function normalizeCell_(v) {
  return (v === undefined || v === null) ? '' : v;
}

/** อัปเดตหลายแถวในชีทเดียวกัน โดยเขียนเป็นช่วงต่อเนื่องเท่าที่ทำได้ */
function updateRecords_(name, updates) {
  if (!updates || !updates.length) return 0;
  updates.forEach(function (u) { updateRecord_(name, u.row, u.patch); });
  return updates.length;
}

function deleteRecord_(name, rowIndex) {
  const sheet = getSheet_(name);
  if (rowIndex > 1 && rowIndex <= sheet.getLastRow()) {
    sheet.deleteRow(rowIndex);
    invalidateTable_(name);
  }
}

/**
 * ลบหลายแถวพร้อมกัน โดยรวมแถวที่ติดกันเป็นชุดเดียว
 * (ลบทีละแถวในลูปจะช้ามากเมื่อข้อมูลเยอะ)
 */
function deleteRecords_(name, rowIndexes) {
  if (!rowIndexes || !rowIndexes.length) return 0;
  const sheet = getSheet_(name);
  const rows = rowIndexes.filter(function (r) { return r > 1; })
    .sort(function (a, b) { return b - a; });   // ลบจากล่างขึ้นบน เลขแถวจึงไม่เลื่อน

  let deleted = 0;
  let i = 0;
  while (i < rows.length) {
    let count = 1;
    while (i + count < rows.length && rows[i + count] === rows[i] - count) count++;
    const start = rows[i] - count + 1;
    if (count === 1) sheet.deleteRow(start);
    else sheet.deleteRows(start, count);
    deleted += count;
    i += count;
  }
  invalidateTable_(name);
  return deleted;
}

/** ล้างข้อมูลทั้งหมดใต้หัวตาราง (ไม่ลบหัวตาราง) */
function clearBody_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(1, sheet.getLastColumn());
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastCol).clear();
  invalidateTable_(name);
}

// ==================== การตั้งค่าระบบ ====================

let SETTINGS_CACHE_ = null;

function readSettings_(forceReload) {
  if (SETTINGS_CACHE_ && !forceReload) return SETTINGS_CACHE_;
  if (forceReload) invalidateTable_(SHEETS.SETTINGS);

  const map = {};
  if (sheetExists_(SHEETS.SETTINGS)) {
    readTable_(SHEETS.SETTINGS).rows.forEach(function (r) {
      const key = str_(r['คีย์']);
      if (key) map[key] = r['ค่า'];
    });
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
        invalidateTable_(SHEETS.SETTINGS);
        return;
      }
    }
  }
  const row = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(row, 1, 1, 3).setValues([[key, value, SETTING_DESCRIPTIONS[key] || '']]);
  invalidateTable_(SHEETS.SETTINGS);
}

/** บันทึกการตั้งค่าหลายรายการในการอ่าน 1 ครั้ง เขียน 1 ครั้ง */
function setSettings_(patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;

  const sheet = getSheet_(SHEETS.SETTINGS, true);
  const lastRow = sheet.getLastRow();
  const width = 3;
  const existing = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];

  const indexOfKey = {};
  existing.forEach(function (r, i) {
    const k = String(r[0]).trim();
    if (k) indexOfKey[k] = i;
  });

  const additions = [];
  keys.forEach(function (k) {
    const value = patch[k] === undefined || patch[k] === null ? '' : patch[k];
    if (indexOfKey[k] !== undefined) {
      existing[indexOfKey[k]][1] = value;
      if (!existing[indexOfKey[k]][2]) existing[indexOfKey[k]][2] = SETTING_DESCRIPTIONS[k] || '';
    } else {
      additions.push([k, value, SETTING_DESCRIPTIONS[k] || '']);
    }
  });

  if (existing.length) sheet.getRange(2, 1, existing.length, width).setValues(existing);
  if (additions.length) {
    sheet.getRange(2 + existing.length, 1, additions.length, width).setValues(additions);
  }
  invalidateTable_(SHEETS.SETTINGS);
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

/**
 * หารหัสถัดไปโดยดูจากแถวสุดท้ายของชีท (รหัสถูกสร้างเรียงต่อกันเสมอ)
 * เร็วกว่าการอ่านทั้งตารางมาก โดยเฉพาะชีทคลังข้อมูลที่มีข้อมูลสะสมจำนวนมาก
 */
function nextCodeFromSheet_(sheetName, columnName, prefix) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return prefix + '-0001';

  const col = tableHeaders_(sheetName).indexOf(columnName);
  if (col === -1) return prefix + '-0001';

  // อ่านย้อนจากท้ายไม่เกิน 50 แถว เผื่อแถวท้าย ๆ ไม่มีรหัส
  const take = Math.min(50, lastRow - 1);
  const values = sheet.getRange(lastRow - take + 1, col + 1, take, 1).getValues();
  let max = 0;
  values.forEach(function (r) {
    const m = String(r[0]).match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  if (!max) return nextCode_(prefix, readTable_(sheetName).rows.map(function (r) { return r[columnName]; }));
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
