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
  constructor(name) { this.name = name; this.data = []; this.hidden = false; }
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
  appendRow(values) {
    ops.writes++;
    const r = this.getLastRow() + 1;
    this._ensure(r, values.length);
    values.forEach((v, i) => { this.data[r - 1][i] = v; });
    return this;
  }
  deleteRow(r) { ops.deletes++; this.data.splice(r - 1, 1); return this; }
  deleteRows(r, n) { ops.deletes++; this.data.splice(r - 1, n); return this; }
  clear() { this.data = []; return this; }
  hideSheet() { this.hidden = true; return this; }
  getProtections() { return []; }
  protect() { return chainable({ setDescription() { return this; }, setWarningOnly() { return this; } }); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
}
['setFrozenRows','setFrozenColumns','setRowHeight','setRowHeights','setColumnWidth','setColumnWidths','autoResizeColumns','hideColumns','showColumns','setTabColor','activate','insertSheet']
  .forEach(m => { Sheet.prototype[m] = function () { return this; }; });

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
      sheet._ensure(row + numRows - 1, col + numCols - 1);
      values.forEach((line, r) => line.forEach((v, c) => { sheet.data[row + r - 1][col + c - 1] = v; }));
      return proxy;
    },
    setValue(v) {
      ops.writes++;
      sheet._ensure(row + numRows - 1, col + numCols - 1);
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) sheet.data[row + r - 1][col + c - 1] = v;
      return proxy;
    },
    setFormula(f) { return range.setValue(f); },
    merge() { return proxy; },
    clear() { return range.setValue(''); },
    getRow() { return row; },
    getColumn() { return col; },
    getNumRows() { return numRows; }
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
    const builder = {
      requireValueInList() { return builder; },
      setAllowInvalid() { return builder; },
      build() { return {}; }
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
