/**
 * วัดจำนวนครั้งที่ระบบเรียกใช้ Google Sheets ในแต่ละงาน
 * ยิ่งน้อย = ยิ่งเร็ว (แต่ละครั้งคือการสื่อสารกับเซิร์ฟเวอร์ของ Google ~20-80 มิลลิวินาที)
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const mock = require('./gas-mock.js');
const SRC = path.join(__dirname, '..', 'src');
let code = '';
fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort()
  .forEach(f => { code += fs.readFileSync(path.join(SRC, f), 'utf8') + '\n'; });
vm.runInThisContext(code, { filename: 'bundle.gs' });

const SILENT = { log: console.log };
console.log = function () {};   // ปิดเสียง log ของระบบระหว่างวัดผล

/* ---------- เตรียมข้อมูลจำลองขนาดใกล้เคียงโรงเรียนจริง ---------- */
runSetup_();
const T = createSession_({ kind: 'admin', name: 'ผู้ดูแลระบบ', role: 'ผู้ดูแลระบบ' }).token;

const LEVELS_ = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
const DAYS_ = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
const TEACHER_COUNT = 120;
const rows = [];
for (let i = 0; i < TEACHER_COUNT; i++) {
  rows.push({
    'รหัสครู': 'TCH-' + ('0000' + (i + 1)).slice(-4),
    'คำนำหน้า': 'นาย', 'ชื่อ': 'ครู' + (i + 1), 'นามสกุล': 'ทดสอบ',
    'ชื่อ-นามสกุล': 'นายครู' + (i + 1) + ' ทดสอบ',
    'ระดับชั้นที่ปรึกษา': LEVELS_[i % 6],
    'เวรประจำวัน (ค่าเริ่มต้น)': DAYS_[i % 5],
    'สถานะ': 'ใช้งาน', 'วันที่เพิ่ม': new Date()
  });
}
appendRecords_(SHEETS.TEACHERS, rows);

const evaluators = [
  { p: 'นาย', f: 'รองผอ', l: 'ทดสอบ', role: ROLES.VICE_DIRECTOR, scope: '' },
  { p: 'นาง', f: 'หัวหน้ากิจการ', l: 'ทดสอบ', role: ROLES.HEAD_AFFAIRS, scope: '' }
];
LEVELS_.forEach(function (lv, i) { evaluators.push({ p: 'นาย', f: 'หัวหน้าระดับ' + (i + 1), l: 'ทดสอบ', role: ROLES.HEAD_LEVEL, scope: lv }); });
DAYS_.forEach(function (d, i) { evaluators.push({ p: 'นาง', f: 'หัวหน้าเวร' + (i + 1), l: 'ทดสอบ', role: ROLES.HEAD_DUTY, scope: d }); });
const evaluatorRows = evaluators.map(function (e, i) {
  const pw = makePasswordRecord_('Password123', 64);
  return {
    'รหัสผู้ประเมิน': 'EVA-' + ('0000' + (i + 1)).slice(-4),
    'คำนำหน้า': e.p, 'ชื่อ': e.f, 'นามสกุล': e.l, 'ชื่อ-นามสกุล': e.p + e.f + ' ' + e.l,
    'บทบาท': e.role, 'ขอบเขต (ระดับชั้น/วัน)': e.scope,
    'รหัสผ่าน (Hash)': pw.hash, 'Salt': pw.salt, 'รอบการเข้ารหัส': 64,
    'สถานะ': 'ใช้งาน', 'จำนวนครั้งที่ผิด': 0, 'วันที่เพิ่ม': new Date()
  };
});
appendRecords_(SHEETS.EVALUATORS, evaluatorRows);

const YEAR = currentTerm_().year, SEM = currentTerm_().semester;
appendRecords_(SHEETS.DUTY, rows.map(function (t, i) {
  return {
    'รหัสรายการ': 'DUT-' + ('0000' + (i + 1)).slice(-4),
    'ปีการศึกษา': YEAR, 'ภาคเรียน': SEM,
    'รหัสครู': t['รหัสครู'], 'ชื่อ-นามสกุล': t['ชื่อ-นามสกุล'],
    'เวรประจำวัน': t['เวรประจำวัน (ค่าเริ่มต้น)'], 'บทบาทในเวร': 'กรรมการเวร',
    'สถานะ': 'ใช้งาน', 'วันที่บันทึก': new Date()
  };
}));

// ผลการประเมิน: ครู 120 คน × ผู้ประเมิน 3 คน
const criteria = loadCriteria_();
const resultRows = [];
let n = 0;
rows.forEach(function (t, ti) {
  ['EVA-0001', 'EVA-0002', 'EVA-000' + (3 + (ti % 6))].forEach(function (evaId, k) {
    const rec = {
      'รหัสการประเมิน': 'EVR-' + ('0000' + (++n)).slice(-4),
      'วันที่บันทึก': new Date(), 'ปีการศึกษา': YEAR, 'ภาคเรียน': SEM,
      'รหัสผู้ประเมิน': evaId, 'ผู้ประเมิน': evaluatorRows[k]['ชื่อ-นามสกุล'],
      'บทบาทผู้ประเมิน': evaluatorRows[k]['บทบาท'],
      'รหัสครู': t['รหัสครู'], 'ครูผู้รับการประเมิน': t['ชื่อ-นามสกุล'],
      'ระดับชั้น': t['ระดับชั้นที่ปรึกษา'], 'เวรประจำวัน': t['เวรประจำวัน (ค่าเริ่มต้น)'],
      'คะแนนรวม': 40, 'คะแนนเต็ม': 50, 'คะแนนเฉลี่ย': 4 + (ti % 10) / 10,
      'ระดับผลการประเมิน': 'ดีมาก', 'ข้อเสนอแนะ': 'ความเห็นทดสอบ',
      'สถานะ': 'ปกติ', 'แก้ไขครั้งที่': 0
    };
    criteria.forEach(function (c) { rec[CRITERIA_COL_PREFIX + c.id] = 4; });
    resultRows.push(rec);
  });
});
appendRecords_(SHEETS.RESULTS, resultRows);

/* ---------- วัดผล ---------- */
const scenarios = [
  ['เปิดแดชบอร์ด', function () { apiAdminOverview(T, YEAR, SEM); }],
  ['เปิดหน้าผลการประเมิน', function () { apiListResults(T, { year: YEAR, semester: SEM }); }],
  ['เปิดหน้าเลือก/ส่งออก', function () { apiExportCandidates(T, YEAR, SEM); }],
  ['ประมวลผลก่อนส่งออก', function () { apiPreviewExport(T, { year: YEAR, semester: SEM }); }],
  ['เปิดหน้าผู้ประเมิน', function () { apiListEvaluators(T); }],
  ['เปิดหน้าทะเบียนครู', function () { apiListTeachers(T, YEAR, SEM, true); }],
  ['เปิดหน้าเวรประจำวัน', function () { apiListDuty(T, YEAR, SEM); }],
  ['เปิดหน้าประวัติการใช้งาน', function () { apiListLogs(T, 200); }],
  ['ผู้ประเมินเปิดแบบประเมิน', function () {
    const s = createSession_({ kind: 'evaluator', id: 'EVA-0001', name: evaluatorRows[0]['ชื่อ-นามสกุล'],
      role: ROLES.VICE_DIRECTOR, scope: '' });
    apiEvaluatorContext(s.token, YEAR, SEM);
  }],
  ['ผู้ประเมินบันทึกผล 1 คน', function () {
    const s = createSession_({ kind: 'evaluator', id: 'EVA-0002', name: evaluatorRows[1]['ชื่อ-นามสกุล'],
      role: ROLES.HEAD_AFFAIRS, scope: '' });
    const sc = {};
    criteriaForRole_(ROLES.HEAD_AFFAIRS).forEach(function (c) { sc[c.id] = 5; });
    apiSubmitEvaluation(s.token, { year: YEAR, semester: SEM, teacherId: 'TCH-0005', scores: sc, comment: 'ดี' });
  }],
  ['บันทึกข้อมูลครู 1 คน', function () {
    apiSaveTeacher(T, { id: 'TCH-0003', prefix: 'นาย', firstName: 'ครู3', lastName: 'ทดสอบ',
      level: 'ม.3', defaultDay: 'พุธ', status: 'ใช้งาน' });
  }]
];

const out = [];
function freshExecution() {
  // จำลองการเริ่มทำงานครั้งใหม่ของ Apps Script (หน่วยความจำชั่วคราวถูกล้าง)
  MEMO_.tables = {}; MEMO_.headers = {}; MEMO_.sheets = {}; MEMO_.derived = {};
  SETTINGS_CACHE_ = null;
}
function clearSharedCache() {
  if (mock.cacheStore) mock.cacheStore.clear();
}

scenarios.forEach(function (sc) {
  // ครั้งแรก: แคชร่วมว่าง (เช่น หลังระบบว่างเกิน 5 นาที หรือเพิ่งมีการแก้ไขข้อมูล)
  freshExecution(); clearSharedCache();
  mock.resetOps();
  sc[1]();
  const cold = mock.ops.reads + mock.ops.writes + mock.ops.deletes;

  // ครั้งถัดไป: แคชร่วมพร้อมใช้งาน (กรณีปกติระหว่างใช้งานจริง)
  freshExecution();
  mock.resetOps();
  sc[1]();
  const warm = mock.ops.reads + mock.ops.writes + mock.ops.deletes;

  out.push({ name: sc[0], cold: cold, warm: warm });
});

console.log = SILENT.log;
console.log('ข้อมูลทดสอบ: ครู ' + TEACHER_COUNT + ' คน · ผู้ประเมิน ' + evaluatorRows.length +
  ' คน · ผลการประเมิน ' + resultRows.length + ' รายการ');
console.log('ตัวเลข = จำนวนครั้งที่ต้องคุยกับ Google Sheets (ยิ่งน้อยยิ่งเร็ว)\n');
console.log('งาน'.padEnd(30) + 'ครั้งแรก'.padStart(12) + 'ครั้งถัดไป'.padStart(14));
console.log('─'.repeat(58));
let totalCold = 0, totalWarm = 0;
out.forEach(function (r) {
  totalCold += r.cold; totalWarm += r.warm;
  console.log(r.name.padEnd(28) + String(r.cold).padStart(10) + String(r.warm).padStart(12));
});
console.log('─'.repeat(58));
console.log('รวมทุกงาน'.padEnd(28) + String(totalCold).padStart(10) + String(totalWarm).padStart(12));
console.log('\nก่อนปรับปรุง: 215 ครั้ง');
console.log('หลังปรับปรุง: ' + totalCold + ' ครั้ง (ครั้งแรก) · ' + totalWarm + ' ครั้ง (ครั้งถัดไป)');
console.log('ลดลง ' + Math.round((1 - totalCold / 215) * 100) + '% และ ' +
  Math.round((1 - totalWarm / 215) * 100) + '% ตามลำดับ');
