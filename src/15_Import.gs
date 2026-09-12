/**
 * ============================================================================
 * ไฟล์: 15_Import.gs  |  นำเข้ารายชื่อครูจากไฟล์ CSV และ Excel
 *
 *  - รองรับ .xlsx .xls .ods (แปลงผ่าน Google Drive) และ .csv .tsv .txt
 *  - รองรับไฟล์ CSV ภาษาไทยที่บันทึกจาก Excel แบบ ANSI (TIS-620/Windows-874)
 *  - จับคู่คอลัมน์จากชื่อหัวตารางอัตโนมัติ (รองรับชื่อคอลัมน์หลายแบบ)
 *  - ตรวจสอบข้อมูลและแสดงตัวอย่างให้ยืนยันก่อนบันทึกจริง
 *  - มีเทมเพลตให้ดาวน์โหลดทั้งแบบ Excel และ CSV
 * ============================================================================
 */

const IMPORT_MAX_BYTES_ = 6 * 1024 * 1024;   // 6 MB
const IMPORT_MAX_ROWS_ = 2000;

/** คอลัมน์ที่ระบบรู้จัก พร้อมชื่อเรียกอื่น ๆ ที่ยอมรับได้ */
const TEACHER_IMPORT_FIELDS = [
  { key: 'code', title: 'รหัสครู', aliases: ['รหัส', 'รหัสประจำตัว', 'id', 'code', 'teacherid'] },
  { key: 'prefix', title: 'คำนำหน้า', aliases: ['คำนำหน้าชื่อ', 'prefix', 'title'] },
  { key: 'firstName', title: 'ชื่อ', aliases: ['ชื่อจริง', 'firstname', 'name'] },
  { key: 'lastName', title: 'นามสกุล', aliases: ['สกุล', 'lastname', 'surname'] },
  { key: 'fullName', title: 'ชื่อ-นามสกุล', aliases: ['ชื่อ-สกุล', 'ชื่อสกุล', 'fullname'] },
  { key: 'department', title: 'กลุ่มสาระ/ฝ่าย', aliases: ['กลุ่มสาระ', 'ฝ่าย', 'แผนก', 'department'] },
  { key: 'level', title: 'ระดับชั้นที่ปรึกษา', aliases: ['ระดับชั้น', 'ชั้น', 'level', 'class'] },
  { key: 'room', title: 'ห้องที่ปรึกษา', aliases: ['ห้อง', 'ห้องเรียน', 'room'] },
  { key: 'day', title: 'เวรประจำวัน', aliases: ['เวรประจำวัน(ค่าเริ่มต้น)', 'เวร', 'วันเวร', 'duty', 'dutyday'] },
  { key: 'email', title: 'อีเมล', aliases: ['อีเมล์', 'email', 'e-mail'] },
  { key: 'status', title: 'สถานะ', aliases: ['status', 'การใช้งาน'] }
];

/** ลำดับคอลัมน์เมื่อไฟล์ไม่มีหัวตาราง */
const TEACHER_IMPORT_POSITIONAL_ = ['prefix', 'firstName', 'lastName', 'level', 'day', 'email'];

function normalizeHeader_(text) {
  return String(text || '').replace(/﻿/g, '').replace(/\s+/g, '').trim().toLowerCase();
}

// ==================== อ่านไฟล์ ====================

/** ถอดรหัสข้อความ รองรับทั้ง UTF-8 และรหัสภาษาไทยแบบเดิมที่ Excel บน Windows มักบันทึกมา */
function decodeTextBytes_(bytes) {
  const charsets = ['UTF-8', 'TIS-620', 'windows-874', 'ISO-8859-11'];
  let fallback = null;
  for (let i = 0; i < charsets.length; i++) {
    try {
      const text = Utilities.newBlob(bytes).getDataAsString(charsets[i]);
      if (text.indexOf('�') === -1) return text.replace(/^﻿/, '');
      if (fallback === null) fallback = text;
    } catch (e) { /* ระบบไม่รองรับรหัสนี้ ลองตัวถัดไป */ }
  }
  return (fallback || '').replace(/^﻿/, '');
}

/** เดาตัวคั่นคอลัมน์จากบรรทัดแรก */
function detectDelimiter_(text) {
  const line = String(text).split(/\r?\n/)[0] || '';
  const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && counts[ch] !== undefined) counts[ch]++;
  }
  let best = ',', bestCount = 0;
  Object.keys(counts).forEach(function (d) {
    if (counts[d] > bestCount) { best = d; bestCount = counts[d]; }
  });
  return bestCount > 0 ? best : ',';
}

/** อ่าน CSV/TSV รองรับเครื่องหมายคำพูดและการขึ้นบรรทัดใหม่ภายในช่อง */
function parseDelimitedText_(text, delimiter) {
  const d = delimiter || detectDelimiter_(text);
  const rows = [];
  let row = [], field = '', inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuote) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === d) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return rows.filter(function (r) {
    return r.some(function (c) { return String(c).trim() !== ''; });
  });
}

/** แปลงไฟล์ Excel เป็น Google Sheets ชั่วคราวเพื่ออ่านข้อมูล แล้วลบทิ้ง */
function readSpreadsheetFile_(bytes, mimeType, fileName) {
  const boundary = '----teacherEvalImport' + Utilities.getUuid().replace(/-/g, '');
  const metadata = { name: 'temp_import_' + Utilities.getUuid().substring(0, 8),
    mimeType: 'application/vnd.google-apps.spreadsheet' };

  const head = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + (mimeType || 'application/octet-stream') + '\r\n\r\n';
  const tail = '\r\n--' + boundary + '--';

  const payload = Utilities.newBlob(head).getBytes()
    .concat(bytes)
    .concat(Utilities.newBlob(tail).getBytes());

  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: payload,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

  if (response.getResponseCode() !== 200) {
    throw new Error('อ่านไฟล์ ' + (fileName || '') + ' ไม่สำเร็จ (รหัส ' + response.getResponseCode() + ')\n' +
      'กรุณาตรวจสอบว่าเป็นไฟล์ Excel ที่ถูกต้อง หรือบันทึกเป็น .csv แล้วลองใหม่');
  }

  const fileId = JSON.parse(response.getContentText()).id;
  try {
    const sheet = SpreadsheetApp.openById(fileId).getSheets()[0];
    const lastRow = Math.min(sheet.getLastRow(), IMPORT_MAX_ROWS_ + 5);
    const lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return [];
    return sheet.getRange(1, 1, lastRow, lastCol).getValues()
      .map(function (row) { return row.map(function (c) { return c instanceof Date ? formatDate_(c, 'dd/MM/yyyy') : c; }); })
      .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  } finally {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* ไม่สำคัญ */ }
  }
}

/** อ่านไฟล์ที่อัปโหลดมาให้เป็นตาราง 2 มิติ */
function readUploadedTable_(file) {
  const name = str_(file.fileName);
  const mime = str_(file.mimeType);
  const bytes = Utilities.base64Decode(str_(file.base64));

  if (bytes.length > IMPORT_MAX_BYTES_) {
    throw new Error('ไฟล์ใหญ่เกิน ' + Math.round(IMPORT_MAX_BYTES_ / 1024 / 1024) + ' MB กรุณาแบ่งไฟล์');
  }

  const lower = name.toLowerCase();
  const isText = /\.(csv|tsv|txt)$/.test(lower) ||
    mime.indexOf('text/') === 0 || mime.indexOf('csv') !== -1;

  if (isText) return parseDelimitedText_(decodeTextBytes_(bytes));
  return readSpreadsheetFile_(bytes, mime, name);
}

// ==================== แปลงข้อมูลให้เป็นรูปแบบของระบบ ====================

function normalizeLevel_(value) {
  const v = str_(value).replace(/\s+/g, '');
  if (!v) return '';
  if (LEVELS.indexOf(v) !== -1) return v;
  const m = v.match(/(\d)/);
  if (m && /^(ม\.?|มัธยมศึกษาปีที่|m\.?)/i.test(v)) return 'ม.' + m[1];
  if (/^[1-6]$/.test(v)) return 'ม.' + v;
  return v;
}

function normalizeDay_(value) {
  const v = str_(value).replace(/\s+/g, '').replace(/^วัน/, '');
  if (!v) return '';
  if (DAYS.indexOf(v) !== -1) return v;
  const map = {
    'mon': 'จันทร์', 'monday': 'จันทร์', 'จ': 'จันทร์',
    'tue': 'อังคาร', 'tuesday': 'อังคาร', 'อ': 'อังคาร',
    'wed': 'พุธ', 'wednesday': 'พุธ', 'พ': 'พุธ',
    'thu': 'พฤหัสบดี', 'thursday': 'พฤหัสบดี', 'พฤหัส': 'พฤหัสบดี', 'พฤ': 'พฤหัสบดี',
    'fri': 'ศุกร์', 'friday': 'ศุกร์', 'ศ': 'ศุกร์'
  };
  return map[v.toLowerCase()] || v;
}

function normalizeStatus_(value) {
  const v = str_(value).toLowerCase();
  if (!v) return STATUS.ACTIVE;
  if (v === 'ไม่ใช้งาน' || v === 'inactive' || v === '0' || v === 'ปิด') return STATUS.INACTIVE;
  return STATUS.ACTIVE;
}

/** จับคู่คอลัมน์ในไฟล์กับฟิลด์ของระบบ */
function mapImportColumns_(headerRow) {
  const mapping = {};
  const matched = [];
  const unknown = [];

  headerRow.forEach(function (raw, index) {
    const normalized = normalizeHeader_(raw);
    if (!normalized) return;
    let found = null;
    TEACHER_IMPORT_FIELDS.forEach(function (field) {
      if (found) return;
      if (normalizeHeader_(field.title) === normalized) { found = field.key; return; }
      field.aliases.forEach(function (alias) {
        if (!found && normalizeHeader_(alias) === normalized) found = field.key;
      });
    });
    if (found) {
      mapping[found] = index;
      matched.push({ column: str_(raw), field: found });
    } else {
      unknown.push(str_(raw));
    }
  });

  return { mapping: mapping, matched: matched, unknown: unknown };
}

/**
 * แยกชื่อเต็มเป็นคำนำหน้า/ชื่อ/นามสกุล
 * เรียงคำนำหน้าจากยาวไปสั้นก่อนเทียบ เพื่อให้ "นางสาว" ถูกจับคู่ก่อน "นาง"
 */
function splitFullName_(fullName) {
  let text = str_(fullName);
  let prefix = '';
  PREFIXES.slice().sort(function (a, b) { return b.length - a.length; })
    .forEach(function (p) {
      if (!prefix && text.indexOf(p) === 0) { prefix = p; text = text.substring(p.length); }
    });
  const parts = text.trim().split(/\s+/);
  return { prefix: prefix, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

/**
 * ตรวจสอบและจัดรูปแบบข้อมูลที่อ่านจากไฟล์
 * @return {{rows: Array, columns: Object, summary: Object}}
 */
function analyzeTeacherImport_(table, options) {
  const o = options || {};
  const updateExisting = !!o.updateExisting;
  if (!table.length) throw new Error('ไม่พบข้อมูลในไฟล์');

  const columns = mapImportColumns_(table[0]);
  const hasHeader = Object.keys(columns.mapping).length > 0;
  const dataRows = hasHeader ? table.slice(1) : table;

  if (!hasHeader) {
    // ไม่มีหัวตาราง → ใช้ลำดับคอลัมน์มาตรฐาน
    TEACHER_IMPORT_POSITIONAL_.forEach(function (key, index) { columns.mapping[key] = index; });
    columns.matched = TEACHER_IMPORT_POSITIONAL_.map(function (key, index) {
      const field = TEACHER_IMPORT_FIELDS.filter(function (f) { return f.key === key; })[0];
      return { column: 'คอลัมน์ที่ ' + (index + 1), field: key };
    });
  }
  if (dataRows.length > IMPORT_MAX_ROWS_) {
    throw new Error('ไฟล์มีข้อมูลมากกว่า ' + IMPORT_MAX_ROWS_ + ' แถว กรุณาแบ่งไฟล์');
  }

  const existing = readTable_(SHEETS.TEACHERS).rows;
  const byCode = {}, byName = {};
  existing.forEach(function (r) {
    const code = str_(r['รหัสครู']);
    const name = str_(r['ชื่อ-นามสกุล']);
    if (code) byCode[code] = r;
    if (name) byName[name] = r;
  });

  const seenInFile = {};
  const get = function (row, key) {
    const index = columns.mapping[key];
    return index === undefined ? '' : str_(row[index]);
  };

  const rows = dataRows.map(function (raw, index) {
    const item = {
      line: index + (hasHeader ? 2 : 1),
      code: get(raw, 'code'),
      prefix: get(raw, 'prefix'),
      firstName: get(raw, 'firstName'),
      lastName: get(raw, 'lastName'),
      department: get(raw, 'department'),
      level: normalizeLevel_(get(raw, 'level')),
      room: get(raw, 'room'),
      day: normalizeDay_(get(raw, 'day')),
      email: get(raw, 'email'),
      status: normalizeStatus_(get(raw, 'status')),
      errors: []
    };

    // รองรับไฟล์ที่มีเฉพาะคอลัมน์ "ชื่อ-นามสกุล"
    const fullNameCell = get(raw, 'fullName');
    if ((!item.firstName || !item.lastName) && fullNameCell) {
      const parts = splitFullName_(fullNameCell);
      if (!item.prefix) item.prefix = parts.prefix;
      if (!item.firstName) item.firstName = parts.firstName;
      if (!item.lastName) item.lastName = parts.lastName;
    }
    if (!item.prefix) item.prefix = 'นาย';

    if (!item.firstName) item.errors.push('ไม่มีชื่อ');
    if (!item.lastName) item.errors.push('ไม่มีนามสกุล');
    if (item.level && LEVELS.indexOf(item.level) === -1) item.errors.push('ระดับชั้น "' + item.level + '" ไม่ถูกต้อง');
    if (item.day && DAYS.indexOf(item.day) === -1) item.errors.push('เวรประจำวัน "' + item.day + '" ไม่ถูกต้อง');
    if (item.email && !isValidEmail_(item.email)) item.errors.push('รูปแบบอีเมลไม่ถูกต้อง');

    item.fullName = item.prefix + item.firstName + ' ' + item.lastName;

    if (item.errors.length) {
      item.status_ = 'error';
      item.message = item.errors.join(' · ');
    } else if (seenInFile[item.fullName]) {
      item.status_ = 'duplicate';
      item.message = 'ชื่อซ้ำกับแถวที่ ' + seenInFile[item.fullName] + ' ในไฟล์เดียวกัน';
    } else {
      seenInFile[item.fullName] = item.line;
      const matchByCode = item.code ? byCode[item.code] : null;
      const matchByName = byName[item.fullName];
      const match = matchByCode || matchByName;
      if (match) {
        item.existingRow = match._row;
        item.existingCode = str_(match['รหัสครู']);
        if (updateExisting) {
          item.status_ = 'update';
          item.message = 'มีอยู่แล้ว → จะอัปเดตข้อมูล';
        } else {
          item.status_ = 'duplicate';
          item.message = 'มีชื่อนี้ในระบบแล้ว (ข้าม)';
        }
      } else {
        item.status_ = 'new';
        item.message = 'เพิ่มใหม่';
      }
    }
    return item;
  });

  const summary = { total: rows.length, new: 0, update: 0, duplicate: 0, error: 0 };
  rows.forEach(function (r) { summary[r.status_ === 'error' ? 'error' : r.status_]++; });

  return { rows: rows, columns: columns, hasHeader: hasHeader, summary: summary };
}

// ==================== API ====================

/** อ่านไฟล์และแสดงตัวอย่างก่อนนำเข้า */
function apiPreviewTeacherImport(token, file, options) {
  return guard_(function () {
    requireAdmin_(token);
    if (!file || !str_(file.base64)) return fail_('กรุณาเลือกไฟล์ที่ต้องการนำเข้า');

    const table = readUploadedTable_(file);
    const analysis = analyzeTeacherImport_(table, options);

    return ok_({
      fileName: str_(file.fileName),
      hasHeader: analysis.hasHeader,
      matchedColumns: analysis.columns.matched,
      unknownColumns: analysis.columns.unknown,
      summary: analysis.summary,
      rows: analysis.rows,
      fields: TEACHER_IMPORT_FIELDS.map(function (f) { return { key: f.key, title: f.title }; })
    });
  });
}

/** บันทึกข้อมูลที่ผ่านการตรวจสอบแล้วลงระบบ */
function apiCommitTeacherImport(token, payload) {
  return guard_(function () {
    requireAdmin_(token);
    const p = payload || {};
    const rows = (p.rows || []).filter(function (r) {
      return r && (r.status_ === 'new' || r.status_ === 'update');
    });
    if (!rows.length) return fail_('ไม่มีรายการที่จะนำเข้า');

    return withLock_(function () {
      // ตรวจซ้ำอีกครั้งกับข้อมูลล่าสุด เพื่อไม่ให้เกิดรายชื่อซ้ำเมื่อมีผู้ใช้งานพร้อมกัน
      const table = readTable_(SHEETS.TEACHERS);
      const codes = table.rows.map(function (r) { return str_(r['รหัสครู']); });
      const byName = {}, byCode = {};
      table.rows.forEach(function (r) {
        const name = str_(r['ชื่อ-นามสกุล']);
        const code = str_(r['รหัสครู']);
        if (name) byName[name] = r;
        if (code) byCode[code] = r;
      });

      const toAdd = [];
      const updates = [];
      const skipped = [];

      rows.forEach(function (item) {
        const fullName = str_(item.prefix) + str_(item.firstName) + ' ' + str_(item.lastName);
        if (!str_(item.firstName) || !str_(item.lastName)) { skipped.push(fullName + ' (ข้อมูลไม่ครบ)'); return; }

        const record = {
          'คำนำหน้า': str_(item.prefix),
          'ชื่อ': str_(item.firstName),
          'นามสกุล': str_(item.lastName),
          'ชื่อ-นามสกุล': fullName,
          'กลุ่มสาระ/ฝ่าย': str_(item.department),
          'ระดับชั้นที่ปรึกษา': normalizeLevel_(item.level),
          'ห้องที่ปรึกษา': str_(item.room),
          'เวรประจำวัน (ค่าเริ่มต้น)': normalizeDay_(item.day),
          'อีเมล': str_(item.email),
          'สถานะ': normalizeStatus_(item.status)
        };

        const existing = (item.code && byCode[item.code]) || byName[fullName];
        if (existing) {
          if (!p.updateExisting) { skipped.push(fullName + ' (มีอยู่แล้ว)'); return; }
          updates.push({
            row: existing._row, patch: record,
            id: str_(existing['รหัสครู']),
            oldName: str_(existing['ชื่อ-นามสกุล']),
            newName: fullName,
            oldStatus: str_(existing['สถานะ']) || STATUS.ACTIVE
          });
        } else {
          const code = str_(item.code) && !byCode[str_(item.code)] ? str_(item.code) : nextCode_('TCH', codes);
          codes.push(code);
          record['รหัสครู'] = code;
          record['วันที่เพิ่ม'] = new Date();
          byName[fullName] = { _row: -1 };
          byCode[code] = { _row: -1 };
          toAdd.push(record);
        }
      });

      appendRecords_(SHEETS.TEACHERS, toAdd);
      updates.forEach(function (u) { updateRecord_(SHEETS.TEACHERS, u.row, u.patch); });

      // ทะเบียนครูเป็นแหล่งข้อมูลหลัก — ตารางเวรและผลการประเมินต้องตามชื่อ/สถานะใหม่ให้ตรง
      let synced = 0;
      updates.forEach(function (u) {
        if (!u.id) return;
        if (u.oldName && u.newName && u.oldName !== u.newName) {
          syncTeacherName_(u.id, u.newName);
          synced++;
        }
        const newStatus = u.patch['สถานะ'];
        if (newStatus && u.oldStatus !== newStatus) syncTeacherStatusToDuty_(u.id, newStatus);
      });

      logAction_('Admin', 'admin', 'นำเข้ารายชื่อครูจากไฟล์',
        'เพิ่ม ' + toAdd.length + ' คน · อัปเดต ' + updates.length + ' คน · ข้าม ' + skipped.length + ' รายการ' +
        (synced ? ' | ปรับชื่อในตารางเวร/ผลการประเมิน ' + synced + ' คน' : '') +
        (p.fileName ? ' | ไฟล์: ' + str_(p.fileName) : ''));

      return ok_({ added: toAdd.length, updated: updates.length, skipped: skipped, synced: synced },
        'นำเข้าเรียบร้อย: เพิ่ม ' + toAdd.length + ' คน' +
        (updates.length ? ', อัปเดต ' + updates.length + ' คน' : '') +
        (skipped.length ? ', ข้าม ' + skipped.length + ' รายการ' : ''));
    });
  });
}

// ==================== เทมเพลตสำหรับกรอกข้อมูล ====================

const TEMPLATE_HEADERS_ = ['รหัสครู', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'กลุ่มสาระ/ฝ่าย',
  'ระดับชั้นที่ปรึกษา', 'ห้องที่ปรึกษา', 'เวรประจำวัน', 'อีเมล', 'สถานะ'];

const TEMPLATE_EXAMPLES_ = [
  ['', 'นาย', 'สมชาย', 'ใจดี', 'กลุ่มสาระคณิตศาสตร์', 'ม.1', '1/2', 'จันทร์', 'somchai@school.ac.th', 'ใช้งาน'],
  ['', 'นาง', 'สมหญิง', 'รักเรียน', 'กลุ่มสาระภาษาไทย', 'ม.2', '2/1', 'อังคาร', '', 'ใช้งาน'],
  ['', 'นางสาว', 'มาลี', 'ศรีสุข', 'กลุ่มสาระวิทยาศาสตร์', 'ม.3', '', 'พุธ', '', 'ใช้งาน']
];

/** สร้างไฟล์เทมเพลตให้ดาวน์โหลด (xlsx หรือ csv) */
function apiDownloadTeacherTemplate(token, format) {
  return guard_(function () {
    requireAdmin_(token);
    const type = str_(format) === 'csv' ? 'csv' : 'xlsx';
    const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd');

    if (type === 'csv') {
      const lines = [TEMPLATE_HEADERS_].concat(TEMPLATE_EXAMPLES_).map(function (row) {
        return row.map(function (cell) {
          const text = String(cell === null || cell === undefined ? '' : cell);
          return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }).join(',');
      });
      // ใส่ BOM เพื่อให้ Excel เปิดไฟล์ภาษาไทยได้ถูกต้อง
      const content = '﻿' + lines.join('\r\n') + '\r\n';
      const blob = Utilities.newBlob(content, 'text/csv');
      return ok_({
        name: 'เทมเพลตรายชื่อครู_' + stamp + '.csv',
        mimeType: 'text/csv',
        base64: Utilities.base64Encode(blob.getBytes())
      });
    }

    const temp = SpreadsheetApp.create('temp_template_' + Utilities.getUuid().substring(0, 8));
    try {
      const sheet = temp.getSheets()[0];
      sheet.setName('รายชื่อครู');
      sheet.getRange(1, 1, 1, TEMPLATE_HEADERS_.length).setValues([TEMPLATE_HEADERS_])
        .setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold')
        .setHorizontalAlignment('center');
      sheet.getRange(2, 1, TEMPLATE_EXAMPLES_.length, TEMPLATE_HEADERS_.length)
        .setValues(TEMPLATE_EXAMPLES_).setFontColor('#9e9e9e').setFontStyle('italic');
      [90, 90, 130, 140, 190, 140, 110, 120, 200, 90].forEach(function (w, i) {
        sheet.setColumnWidth(i + 1, w);
      });
      sheet.setFrozenRows(1);

      // ตัวเลือกแบบเลื่อนลง ช่วยลดการกรอกผิด
      const rule = function (list) {
        return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
      };
      sheet.getRange(2, 2, 500, 1).setDataValidation(rule(PREFIXES));
      sheet.getRange(2, 6, 500, 1).setDataValidation(rule(LEVELS));
      sheet.getRange(2, 8, 500, 1).setDataValidation(rule(DAYS));
      sheet.getRange(2, 10, 500, 1).setDataValidation(rule([STATUS.ACTIVE, STATUS.INACTIVE]));

      const guide = temp.insertSheet('คำแนะนำ');
      const guideRows = [
        ['วิธีใช้เทมเพลตนำเข้ารายชื่อครู', ''],
        ['', ''],
        ['1.', 'กรอกข้อมูลในแผ่นงาน "รายชื่อครู" โดยลบตัวอย่าง 3 แถวสีเทาออกก่อน'],
        ['2.', 'หนึ่งแถวต่อครูหนึ่งคน ห้ามลบหรือเปลี่ยนชื่อแถวหัวตาราง (แถวที่ 1)'],
        ['3.', 'บันทึกไฟล์แล้วอัปโหลดที่เมนู "ครูผู้รับการประเมิน → นำเข้ารายชื่อ"'],
        ['', ''],
        ['คอลัมน์', 'คำอธิบาย'],
        ['รหัสครู', 'เว้นว่างได้ ระบบจะสร้างให้อัตโนมัติ (TCH-0001, TCH-0002, ...)'],
        ['คำนำหน้า', PREFIXES.join(' / ')],
        ['ชื่อ', 'จำเป็นต้องกรอก'],
        ['นามสกุล', 'จำเป็นต้องกรอก'],
        ['กลุ่มสาระ/ฝ่าย', 'เว้นว่างได้'],
        ['ระดับชั้นที่ปรึกษา', LEVELS.join(' / ') + '  (กรอก 1-6 ก็ได้ ระบบจะแปลงให้)'],
        ['ห้องที่ปรึกษา', 'เช่น 1/2 (เว้นว่างได้)'],
        ['เวรประจำวัน', DAYS.join(' / ') + '  — เป็นค่าเริ่มต้น ปรับรายภาคเรียนได้ภายหลัง'],
        ['อีเมล', 'เว้นว่างได้'],
        ['สถานะ', STATUS.ACTIVE + ' / ' + STATUS.INACTIVE + ' (เว้นว่าง = ' + STATUS.ACTIVE + ')'],
        ['', ''],
        ['หมายเหตุ', 'หากมีชื่อซ้ำกับที่มีอยู่แล้ว ระบบจะข้ามให้ หรือเลือก "อัปเดตข้อมูลเดิม" ตอนนำเข้าได้']
      ];
      guide.getRange(1, 1, guideRows.length, 2).setValues(guideRows);
      guide.getRange(1, 1, 1, 2).merge().setFontWeight('bold').setFontSize(14).setFontColor('#1a237e');
      guide.getRange(7, 1, 1, 2).setBackground('#e8eaf6').setFontWeight('bold');
      guide.setColumnWidth(1, 190);
      guide.setColumnWidth(2, 520);
      guide.getRange(1, 2, guideRows.length, 1).setWrap(true);

      SpreadsheetApp.flush();
      const blob = exportBlob_(temp.getId(), 'xlsx', {});
      return ok_({
        name: 'เทมเพลตรายชื่อครู_' + stamp + '.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Utilities.base64Encode(blob.getBytes())
      });
    } finally {
      try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) { /* ไม่สำคัญ */ }
    }
  });
}
