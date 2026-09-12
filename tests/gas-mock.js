/* จำลอง Google Apps Script services เพื่อทดสอบตรรกะฝั่งเซิร์ฟเวอร์ด้วย Node */
const crypto = require('crypto');

/* ตัวนับการเรียกใช้ Google Sheets — ใช้วัดประสิทธิภาพ (แต่ละครั้ง = 1 รอบสื่อสารกับเซิร์ฟเวอร์จริง) */
const ops = { reads: 0, writes: 0, deletes: 0 };
function resetOps() { ops.reads = 0; ops.writes = 0; ops.deletes = 0; }

function chainable(target) {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'string') return () => obj.__proxy || obj;  // formatting no-ops
      return undefined;
    }
  });
}

class Sheet {
  constructor(name) {
    this.name = name; this.data = []; this.hidden = false;
    this.validations = new Map();
    this.merges = [];                       // ช่วงเซลล์ที่ผสาน
    this.frozenRows = 0; this.frozenColumns = 0;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  _cell(r, c) {
    if (!this.data[r - 1]) return '';
    const v = this.data[r - 1][c - 1];
    return v === undefined ? '' : v;
  }
  _ensure(r, c) {
    while (this.data.length < r) this.data.push([]);
    for (let i = 0; i < r; i++) {
      while (this.data[i].length < c) this.data[i].push('');
    }
  }
  getLastRow() {
    ops.reads++;
    let last = 0;
    this.data.forEach((row, i) => {
      if (row.some(v => v !== '' && v !== null && v !== undefined)) last = i + 1;
    });
    return last;
  }
  getLastColumn() {
    ops.reads++;
    let last = 0;
    this.data.forEach(row => {
      row.forEach((v, j) => { if (v !== '' && v !== null && v !== undefined) last = Math.max(last, j + 1); });
    });
    return last;
  }
  getMaxColumns() { return Math.max(30, this.getLastColumn()); }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getRange(r, c, nr, nc) { return makeRange(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  /**
   * จำลองข้อจำกัดจริงของ Google Sheets: ตรึงแถว/คอลัมน์ผ่าน "กลางเซลล์ที่ผสาน" ไม่ได้
   * ถ้าเซลล์ผสานเริ่มก่อนเส้นตรึงแต่ลากยาวเลยออกไป จะโยน Exception ทันที
   */
  _assertFreezable(count, axis) {
    const straddling = this.merges.filter(m => {
      const start = axis === 'rows' ? m.r : m.c;
      const span = axis === 'rows' ? m.nr : m.nc;
      return start <= count && start + span - 1 > count;
    });
    if (!straddling.length) return;
    const what = axis === 'rows' ? 'แถว' : 'คอลัมน์';
    throw new Error('ขออภัย จะตรึง' + what + 'ที่มีเฉพาะบางส่วนของเซลล์ที่ผสานไม่ได้ ' +
      'โปรดลองแยกเซลล์ที่ผสาน หรือตรึง' + what + 'เพิ่ม เพื่อให้ครอบคลุมเซลล์ที่ผสานทั้งหมด');
  }
  setFrozenRows(n) { this._assertFreezable(n, 'rows'); this.frozenRows = n; return this; }
  setFrozenColumns(n) { this._assertFreezable(n, 'columns'); this.frozenColumns = n; return this; }
  /** บันทึกช่วงที่ผสาน พร้อมตรวจว่าไม่ได้ผสานคร่อมเส้นตรึงที่มีอยู่ */
  _addMerge(r, c, nr, nc) {
    if (this.frozenRows && r <= this.frozenRows && r + nr - 1 > this.frozenRows) {
      throw new Error('ผสานเซลล์คร่อมแถวที่ตรึงไว้ไม่ได้');
    }
    if (this.frozenColumns && c <= this.frozenColumns && c + nc - 1 > this.frozenColumns) {
      throw new Error('ผสานเซลล์คร่อมคอลัมน์ที่ตรึงไว้ไม่ได้');
    }
    this.merges.push({ r: r, c: c, nr: nr, nc: nc });
  }
  _rule(r, c) { return this.validations.get(r + ':' + c) || null; }
  _setRule(r, c, rule) {
    if (rule) this.validations.set(r + ':' + c, rule);
    else this.validations.delete(r + ':' + c);
  }
  appendRow(values) {
    ops.writes++;
    const r = this.getLastRow() + 1;
    this._ensure(r, values.length);
    values.forEach((v, i) => { this.data[r - 1][i] = v; });
    return this;
  }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteRows(r, n) {
    ops.deletes++;
    this.data.splice(r - 1, n);
    this._shiftRules(r, n);
    return this;
  }
  /** เลื่อนกฎการตรวจสอบข้อมูลขึ้นตามแถวที่ถูกลบ ให้เหมือน Google Sheets ของจริง */
  _shiftRules(from, count) {
    if (!this.validations.size) return;
    const next = new Map();
    this.validations.forEach((rule, key) => {
      const parts = key.split(':');
      const r = Number(parts[0]), c = Number(parts[1]);
      if (r >= from && r < from + count) return;             // แถวที่ถูกลบ
      next.set((r >= from + count ? r - count : r) + ':' + c, rule);
    });
    this.validations = next;
  }
  clear() { this.data = []; this.validations = new Map(); return this; }
  hideSheet() { this.hidden = true; return this; }
  getProtections() { return []; }
  protect() { return chainable({ setDescription() { return this; }, setWarningOnly() { return this; } }); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
}
['setRowHeight','setRowHeights','setColumnWidth','setColumnWidths','autoResizeColumns','hideColumns','showColumns','setTabColor','activate','insertSheet']
  .forEach(m => { Sheet.prototype[m] = function () { return this; }; });

/** กฎการตรวจสอบข้อมูลของชีท (มีเมธอดเหมือนของจริงเพื่อให้โค้ดอ่านคุณสมบัติได้) */
class DataValidationRule {
  constructor(list, allowInvalid, helpText) {
    this.list = list;
    this.allowInvalid = allowInvalid;
    this.helpText = helpText;
  }
  getAllowInvalid() { return this.allowInvalid; }
  getHelpText() { return this.helpText; }
  getCriteriaType() { return 'VALUE_IN_LIST'; }
  getCriteriaValues() { return [this.list ? this.list.slice() : []]; }
}

function columnLetter(col) {
  let out = '';
  let n = col;
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/**
 * จำลองพฤติกรรมจริงของ Google Sheets: กฎที่ตั้งเป็น "ปฏิเสธข้อมูลที่ไม่ถูกต้อง"
 * (setAllowInvalid(false)) จะโยน Exception เมื่อสคริปต์เขียนค่าที่อยู่นอกรายการ
 * มีไว้เพื่อให้ชุดทดสอบจับข้อผิดพลาดประเภทนี้ได้ แทนที่จะไปเจอตอนใช้งานจริง
 */
function enforceValidation(sheet, row, col, value) {
  const rule = sheet._rule(row, col);
  if (!rule || rule.allowInvalid) return;
  if (value === '' || value === null || value === undefined) return;
  if (!Array.isArray(rule.list)) return;
  if (rule.list.indexOf(value) !== -1) return;
  throw new Error('ข้อมูลที่ป้อนลงในเซลล์ ' + columnLetter(col) + row +
    ' ละเมิดกฎการตรวจสอบข้อมูลที่ตั้งไว้ในเซลล์นี้ โปรดป้อนค่าใดค่าหนึ่งต่อไปนี้: ' +
    rule.list.join(', '));
}

function makeRange(sheet, row, col, numRows, numCols) {
  let proxy;
  const range = {
    getValues() {
      ops.reads++;
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) line.push(sheet._cell(row + r, col + c));
        out.push(line);
      }
      return out;
    },
    getValue() { ops.reads++; return sheet._cell(row, col); },
    setValues(values) {
      ops.writes++;
      values.forEach((line, r) => line.forEach((v, c) => enforceValidation(sheet, row + r, col + c, v)));
      sheet._ensure(row + numRows - 1, col + numCols - 1);
      values.forEach((line, r) => line.forEach((v, c) => { sheet.data[row + r - 1][col + c - 1] = v; }));
      return proxy;
    },
    setValue(v) {
      ops.writes++;
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) enforceValidation(sheet, row + r, col + c, v);
      sheet._ensure(row + numRows - 1, col + numCols - 1);
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) sheet.data[row + r - 1][col + c - 1] = v;
      return proxy;
    },
    setDataValidation(rule) {
      if (rule === null || rule === undefined) {
        /* ล้างกฎ: วนเฉพาะกฎที่มีอยู่จริง จะได้ไม่ต้องไล่ทุกเซลล์ในช่วงกว้างๆ */
        Array.from(sheet.validations.keys()).forEach(key => {
          const parts = key.split(':');
          const r = Number(parts[0]), c = Number(parts[1]);
          if (r >= row && r < row + numRows && c >= col && c < col + numCols) sheet.validations.delete(key);
        });
        return proxy;
      }
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) sheet._setRule(row + r, col + c, rule);
      return proxy;
    },
    getDataValidation() { return sheet._rule(row, col); },
    getDataValidations() {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) line.push(sheet._rule(row + r, col + c));
        out.push(line);
      }
      return out;
    },
    getSheet() { return sheet; },
    getA1Notation() { return columnLetter(col) + row; },
    setFormula(f) { return range.setValue(f); },
    merge() { sheet._addMerge(row, col, numRows, numCols); return proxy; },
    clear() { return range.setValue(''); },
    getRow() { return row; },
    getColumn() { return col; },
    getNumRows() { return numRows; },
    getNumColumns() { return numCols; }
  };
  proxy = new Proxy(range, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'string') return () => proxy;
      return undefined;
    }
  });
  return proxy;
}

class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.filter(s => s.name === n)[0] || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(sheet) { const i = this.sheets.indexOf(sheet); if (i !== -1) this.sheets.splice(i, 1); return this; }
  getSheets() { return this.sheets.slice(); }
  getOwner() { return { getEmail: () => 'owner@school.ac.th' }; }
  setActiveSheet(s) { return s; }
}

const store = { properties: {}, mails: [], created: [], logs: [], importTable: null, uploads: [] };
const activeSs = new Spreadsheet('SS_TEST_ID', 'ระบบประเมินผลครู');
activeSs.insertSheet('Sheet1');

/* ทะเบียนสเปรดชีตทั้งหมด เพื่อให้ openById ทำงานเหมือนของจริง */
const spreadsheets = new Map();
spreadsheets.set(activeSs.getId(), activeSs);

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => activeSs,
  getActive: () => activeSs,
  openById: (id) => spreadsheets.get(id) || activeSs,
  flush: () => {},
  create: (name) => {
    const ss = new Spreadsheet('TMP_' + Math.random().toString(36).slice(2), name);
    ss.insertSheet('Sheet1');
    store.created.push(ss);
    spreadsheets.set(ss.getId(), ss);
    return ss;
  },
  newDataValidation: () => {
    const draft = { list: null, allowInvalid: true, helpText: '' };
    const builder = {
      requireValueInList(list) { draft.list = (list || []).slice(); return builder; },
      setAllowInvalid(allow) { draft.allowInvalid = !!allow; return builder; },
      setHelpText(text) { draft.helpText = String(text || ''); return builder; },
      build() { return new DataValidationRule(draft.list, draft.allowInvalid, draft.helpText); }
    };
    return builder;
  },
  ProtectionType: { SHEET: 'SHEET' },
  BorderStyle: { SOLID: 'SOLID' },
  getUi() { throw new Error('UI not available in test'); }
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (store.properties[k] === undefined ? null : store.properties[k]),
    setProperty: (k, v) => { store.properties[k] = String(v); },
    deleteProperty: k => { delete store.properties[k]; },
    getProperties: () => Object.assign({}, store.properties)
  }),
  getUserProperties() { return this.getScriptProperties(); }
};

global.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest(alg, value) {
    const buf = Buffer.isBuffer(value) ? value
      : Array.isArray(value) ? Buffer.from(value.map(b => b & 0xFF))
      : Buffer.from(String(value), 'utf8');
    const hash = crypto.createHash('sha256').update(buf).digest();
    return Array.from(hash).map(b => (b > 127 ? b - 256 : b));
  },
  base64Encode(bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes
      : (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes.map(b => b & 0xFF)));
    return buf.toString('base64');
  },
  base64Decode(text) {
    const buf = Buffer.from(String(text), 'base64');
    return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  },
  getUuid: () => crypto.randomUUID(),
  newBlob(content, type, name) {
    const buf = Buffer.from(typeof content === 'string' ? content : Buffer.from(content));
    return {
      getBytes: () => Array.from(buf).map(b => (b > 127 ? b - 256 : b)),
      getDataAsString: (charset) => {
        const cs = String(charset || 'UTF-8').toUpperCase();
        if (cs === 'UTF-8' || cs === 'UTF8') return buf.toString('utf8');
        // จำลองรหัสภาษาไทยแบบเดิม: ถ้าถอดไม่ได้จริงให้คืนอักขระเสีย
        try { return new TextDecoder('windows-874').decode(buf); }
        catch (e) { return buf.toString('latin1'); }
      },
      setName: function () { return this; },
      getName: () => name || 'blob'
    };
  },
  formatDate(date, tz, pattern) {
    const d = new Date(date);
    const pad = n => String(n).padStart(2, '0');
    return pattern
      .replace(/yyyy/g, d.getFullYear())
      .replace(/MMMM/g, String(d.getMonth() + 1))
      .replace(/MM/g, pad(d.getMonth() + 1))
      .replace(/dd/g, pad(d.getDate()))
      .replace(/\bd\b/g, d.getDate())
      .replace(/HH/g, pad(d.getHours()))
      .replace(/mm/g, pad(d.getMinutes()))
      .replace(/ss/g, pad(d.getSeconds()));
  }
};

global.Session = {
  getActiveUser: () => ({ getEmail: () => 'admin@school.ac.th' }),
  getEffectiveUser: () => ({ getEmail: () => 'owner@school.ac.th' })
};

global.LockService = {
  getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
};

global.MailApp = {
  // Apps Script รองรับทั้งแบบพารามิเตอร์เรียงลำดับ และแบบส่ง object ก้อนเดียว
  sendEmail(to, subject, body) {
    if (to && typeof to === 'object') store.mails.push({ to: to.to, subject: to.subject, body: to.body });
    else store.mails.push({ to, subject, body });
  }
};

global.DriveApp = {
  getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
  createFolder: (name) => ({
    getName: () => name,
    createFile: (blob) => ({
      getUrl: () => 'https://drive.google.com/file/d/FAKE/view',
      getId: () => 'FAKE_FILE_ID',
      getName: () => blob.getName ? blob.getName() : 'file'
    })
  }),
  getFileById: (id) => ({
    setTrashed: () => { spreadsheets.delete(id); },
    getAs: () => Utilities.newBlob('pdf'),
    getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
    getId: () => id
  })
};

global.UrlFetchApp = {
  fetch: (url, options) => {
    // จำลอง Drive API: อัปโหลดไฟล์ Excel แล้วแปลงเป็น Google Sheets
    if (String(url).indexOf('upload/drive/v3/files') !== -1) {
      const id = 'IMPORTED_' + Math.random().toString(36).slice(2);
      const ss = new Spreadsheet(id, 'imported');
      const sheet = ss.insertSheet('Sheet1');
      const table = store.importTable || [];
      if (table.length) {
        const width = Math.max.apply(null, table.map(r => r.length));
        sheet.getRange(1, 1, table.length, width).setValues(
          table.map(r => { const row = r.slice(); while (row.length < width) row.push(''); return row; })
        );
      }
      spreadsheets.set(id, ss);
      store.uploads.push({ url: String(url), size: (options && options.payload || []).length });
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ id: id, name: 'imported' }),
        getBlob: () => Utilities.newBlob('{}')
      };
    }
    return {
      getResponseCode: () => 200,
      getContentText: () => '{}',
      getBlob: () => Utilities.newBlob('FAKE_EXPORT_CONTENT_' + 'x'.repeat(500))
    };
  }
};

global.ScriptApp = {
  getOAuthToken: () => 'fake-token',
  getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' })
};

global.HtmlService = {
  createTemplateFromFile: () => ({ evaluate: () => chainable({ setTitle() { return this; } }) }),
  createHtmlOutputFromFile: () => ({ getContent: () => '' })
};

const cacheStore = new Map();
global.CacheService = {
  getScriptCache: () => ({
    get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
    put: (k, v) => { cacheStore.set(k, v); },
    remove: k => { cacheStore.delete(k); },
    removeAll: keys => { (keys || []).forEach(k => cacheStore.delete(k)); },
    getAll: keys => {
      const out = {};
      (keys || []).forEach(k => { if (cacheStore.has(k)) out[k] = cacheStore.get(k); });
      return out;
    }
  }),
  getUserCache() { return this.getScriptCache(); },
  getDocumentCache() { return this.getScriptCache(); }
};

global.Logger = { log: () => {} };

module.exports = { store, activeSs, Spreadsheet, Sheet, ops, resetOps, cacheStore, spreadsheets };
