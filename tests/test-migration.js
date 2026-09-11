/* ทดสอบการย้ายข้อมูลจากระบบเดิม (v2) มาสู่ v3 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const mock = require('./gas-mock.js');
const SRC = path.join(__dirname, '..', 'src');
let code = '';
fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort()
  .forEach(f => { code += fs.readFileSync(path.join(SRC, f), 'utf8') + '\n'; });
vm.runInThisContext(code, { filename: 'bundle.gs' });

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n▶ ' + t); }

/* ---------- สร้างสเปรดชีตแบบระบบเดิม (v2) ---------- */
const ss = mock.activeSs;
function makeSheet(name, headers, rows) {
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return sh;
}

// v2: ตั้งค่าระบบ (แฮชรหัสผ่านแบบเดิม)
const legacyAdminPassword = 'OldAdminPass1';
const legacySettings = ss.insertSheet('ตั้งค่าระบบ');
legacySettings.getRange(1, 1, 1, 2).setValues([['คีย์', 'ค่า']]);
legacySettings.getRange(2, 1, 3, 2).setValues([
  ['admin_password_hash', legacyHash_(legacyAdminPassword)],
  ['system_version', '2.0'],
  ['setup_date', new Date('2024-05-01')]
]);

// v2: รายชื่อครู
makeSheet('รายชื่อครู',
  ['ลำดับ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อ-นามสกุล', 'ระดับชั้นที่สังกัด', 'เวรประจำวัน', 'สถานะ'],
  [
    [1, 'นาย', 'สมชาย', 'ใจดี', 'นายสมชาย ใจดี', 'ม.1', 'จันทร์', 'ใช้งาน'],
    [2, 'นาง', 'สมหญิง', 'รักเรียน', 'นางสมหญิง รักเรียน', 'ม.2', 'อังคาร', 'ใช้งาน'],
    [3, 'นางสาว', 'มาลี', 'ศรีสุข', 'นางสาวมาลี ศรีสุข', 'ม.3', 'พุธ', 'ใช้งาน']
  ]);

// v2: ผู้ประเมิน
const legacyEvaluatorPassword = 'EvalOld2024';
makeSheet('ผู้ประเมิน',
  ['ลำดับ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อ-นามสกุล', 'บทบาท', 'ระดับชั้น/วัน', 'อีเมล', 'รหัสผ่าน (Hash)', 'สถานะ'],
  [
    [1, 'นาย', 'บุญมี', 'ผู้บริหาร', 'นายบุญมี ผู้บริหาร', 'รองผู้อำนวยการฝ่ายกิจการนักเรียน', '', '', legacyHash_(legacyEvaluatorPassword), 'ใช้งาน'],
    [2, 'นาย', 'ระดับ', 'หนึ่งดี', 'นายระดับ หนึ่งดี', 'หัวหน้าระดับชั้น', 'ม.1', '', legacyHash_(legacyEvaluatorPassword), 'ใช้งาน'],
    [3, 'นาง', 'เวร', 'จันทร์ดี', 'นางเวร จันทร์ดี', 'หัวหน้าเวรประจำวัน', 'จันทร์', '', legacyHash_(legacyEvaluatorPassword), 'ใช้งาน']
  ]);

// v2: ผลการประเมิน (ภาคเรียนเป็นรูปแบบ "1/2568", คะแนนรวม/เฉลี่ยเป็นสูตร)
makeSheet('ผลการประเมิน',
  ['Timestamp', 'ผู้ประเมิน', 'บทบาทผู้ประเมิน', 'ภาคเรียน', 'ครูผู้รับการประเมิน', 'ระดับชั้น', 'เวรประจำวัน',
    'ข้อ 1', 'ข้อ 2', 'ข้อ 3', 'ข้อ 4', 'ข้อ 5', 'ข้อ 6', 'ข้อ 7', 'ข้อ 8', 'ข้อ 9', 'ข้อ 10',
    'คะแนนรวม', 'คะแนนเฉลี่ย', 'ระดับผลการประเมิน', 'ข้อเสนอแนะ'],
  [
    [new Date('2025-07-01'), 'นายบุญมี ผู้บริหาร', 'รองผู้อำนวยการฝ่ายกิจการนักเรียน', '1/2568',
      'นายสมชาย ใจดี', 'ม.1', 'จันทร์', 5, 5, 4, 4, 5, 5, 4, 4, 5, 5, '=SUM()', '=AVG()', '=IF()', 'ทำงานดี'],
    [new Date('2025-07-02'), 'นายระดับ หนึ่งดี', 'หัวหน้าระดับชั้น', '1/2568',
      'นายสมชาย ใจดี', 'ม.1', 'จันทร์', 4, 4, 4, 3, 4, 4, '', 4, '', 4, '=SUM()', '=AVG()', '=IF()', ''],
    [new Date('2025-07-03'), 'นายบุญมี ผู้บริหาร', 'รองผู้อำนวยการฝ่ายกิจการนักเรียน', '2/2568',
      'นางสมหญิง รักเรียน', 'ม.2', 'อังคาร', 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, '=SUM()', '=AVG()', '=IF()', 'ควรพัฒนา']
  ]);

// v2: ชีทอื่น ๆ
makeSheet('เกณฑ์การประเมิน', ['ข้อที่', 'เกณฑ์การประเมิน', 'ผู้มีสิทธิ์ประเมิน', 'น้ำหนัก (%)'],
  DEFAULT_CRITERIA.map(c => [c.id, c.name, c.roles.map(r => ROLES[r]).join(', '), 10]));
makeSheet('สรุปผลการประเมิน', ['ลำดับ', 'ชื่อ-นามสกุล'], []);
makeSheet('ประวัติการประเมิน', ['วันที่-เวลา', 'ผู้ดำเนินการ', 'รายละเอียด'],
  [[new Date('2025-06-01'), 'Admin', 'ตั้งค่าระบบครั้งแรก'], [new Date('2025-07-01'), 'นายบุญมี ผู้บริหาร', 'ประเมินครู']]);

SETTINGS_CACHE_ = null;

/* ---------- อัปเกรด ---------- */
section('อัปเกรดจากระบบเดิม v2 → v3');
const result = runSetup_();
check('ไม่สร้างรหัสผ่านผู้ดูแลใหม่ (ของเดิมยังใช้ได้)', !result.adminPassword, result.adminPassword);
check('มีรายงานการย้ายข้อมูล', result.migrated.length > 0, result.migrated);
console.log('    รายละเอียด: ' + result.migrated.join(' | '));

section('รหัสผ่านเดิมยังใช้งานได้และถูกอัปเกรด');
const adminLogin = apiAdminLogin(legacyAdminPassword, 'devA');
check('ผู้ดูแลระบบเข้าสู่ระบบด้วยรหัสผ่านเดิมได้', adminLogin.success === true, adminLogin.message);
const T = adminLogin.data.token;
SETTINGS_CACHE_ = null;
check('แฮชถูกอัปเกรดเป็นแบบมี salt', !!str_(getSetting_(SETTING_KEYS.ADMIN_SALT, '')));
check('เข้าสู่ระบบซ้ำด้วยรหัสผ่านเดิมยังได้หลังอัปเกรด', apiAdminLogin(legacyAdminPassword, 'devB').success === true);

section('ข้อมูลครูถูกย้ายครบ');
const teachers = apiListTeachers(T, '2568', '1', true).data;
check('ครู 3 คนยังอยู่ครบ', teachers.length === 3, teachers.length);
check('ได้รหัสครูอัตโนมัติ', teachers.every(t => /^TCH-\d{4}$/.test(t.id)), teachers.map(t => t.id));
check('ย้ายระดับชั้นจากคอลัมน์เดิม', teachers.filter(t => t.name.indexOf('สมชาย') !== -1)[0].level === 'ม.1',
  teachers.map(t => t.level));
check('ย้ายเวรประจำวันจากคอลัมน์เดิม',
  teachers.filter(t => t.name.indexOf('สมชาย') !== -1)[0].defaultDay === 'จันทร์',
  teachers.map(t => t.defaultDay));

section('ข้อมูลผู้ประเมินถูกย้ายครบ');
const evaluators = apiListEvaluators(T).data.rows;
check('ผู้ประเมิน 3 คนยังอยู่ครบ', evaluators.length === 3, evaluators.length);
check('ย้ายขอบเขต (ระดับชั้น/วัน) มาถูกคอลัมน์',
  evaluators.filter(e => e.role === 'หัวหน้าระดับชั้น')[0].scope === 'ม.1',
  evaluators.map(e => e.role + '=' + e.scope));
const evLogin = apiEvaluatorLogin('นายบุญมี ผู้บริหาร', legacyEvaluatorPassword);
check('ผู้ประเมินเข้าสู่ระบบด้วยรหัสผ่านเดิมได้', evLogin.success === true, evLogin.message);

section('ผลการประเมินเดิมถูกแปลงเป็นรูปแบบใหม่');
const results = readTable_(SHEETS.RESULTS).rows;
check('ผลการประเมิน 3 รายการยังอยู่ครบ', results.length === 3, results.length);
check('ได้รหัสการประเมินทุกแถว', results.every(r => /^EVR-\d{4}$/.test(str_(r['รหัสการประเมิน']))));
check('แยก "1/2568" เป็นภาคเรียน 1 + ปีการศึกษา 2568',
  str_(results[0]['ภาคเรียน']) === '1' && str_(results[0]['ปีการศึกษา']) === '2568',
  [str_(results[0]['ภาคเรียน']), str_(results[0]['ปีการศึกษา'])]);
check('เชื่อมโยงกับรหัสครูอัตโนมัติ', results.every(r => /^TCH-\d{4}$/.test(str_(r['รหัสครู']))),
  results.map(r => str_(r['รหัสครู'])));
check('คำนวณคะแนนใหม่แทนสูตรที่พัง (แถวแรกเฉลี่ย 4.6)',
  Math.abs(num_(results[0]['คะแนนเฉลี่ย']) - 4.6) < 0.001, num_(results[0]['คะแนนเฉลี่ย']));
check('คิดเฉพาะข้อที่ให้คะแนน (แถวที่ 2 มี 8 ข้อ เฉลี่ย 3.88)',
  Math.abs(num_(results[1]['คะแนนเฉลี่ย']) - 3.88) < 0.001, num_(results[1]['คะแนนเฉลี่ย']));
check('ระบุระดับผลการประเมินให้ใหม่', str_(results[0]['ระดับผลการประเมิน']) === 'ดีเยี่ยม',
  str_(results[0]['ระดับผลการประเมิน']));
check('ข้อเสนอแนะเดิมยังอยู่', str_(results[0]['ข้อเสนอแนะ']) === 'ทำงานดี');

section('ตารางเวรของภาคเรียนถูกสร้างจากข้อมูลเดิม');
const duty = apiListDuty(T, '2568', '1').data;
check('สร้างตารางเวรภาคเรียน 1/2568 ให้อัตโนมัติ', duty.rows.length === 3, duty.rows.length);
check('เวรตรงกับข้อมูลเดิม',
  duty.rows.filter(r => r.teacherName.indexOf('สมชาย') !== -1)[0].day === 'จันทร์');

section('ประวัติการใช้งานเดิมไม่สูญหาย');
check('เก็บชีทประวัติเดิมไว้', sheetExists_('ประวัติการใช้งาน (ระบบเดิม)'));
const oldLog = readTable_('ประวัติการใช้งาน (ระบบเดิม)').rows;
check('ประวัติเดิม 2 รายการยังอยู่', oldLog.length === 2, oldLog.length);
const newLogs = readLogs_(50);
check('ชีทประวัติใหม่บันทึกคอลัมน์ถูกต้อง',
  newLogs.length > 0 && !!newLogs[0].action && !!newLogs[0].time, newLogs[0]);

section('ใช้งานต่อได้ทันทีหลังอัปเกรด');
const overview = apiAdminOverview(T, '2568', '1');
check('แดชบอร์ดทำงานกับข้อมูลเดิม', overview.success === true, overview.message);
check('นับการประเมินเดิมได้ถูกต้อง', overview.data.stats.totalEvaluations === 2, overview.data.stats.totalEvaluations);
const cand = apiExportCandidates(T, '2568', '1').data;
check('เลือกผู้ถูกประเมินเพื่อส่งออกได้', cand.candidates.length === 3, cand.candidates.length);
const exported = apiExportReport(T, {
  year: '2568', semester: '1',
  teacherIds: cand.candidates.map(c => c.key).reverse(),
  formats: ['xlsx', 'pdf'], options: {}
});
check('ส่งออกรายงานจากข้อมูลเดิมได้', exported.success === true, exported.message);

console.log('\n════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' รายการ / ไม่ผ่าน ' + fail + ' รายการ');
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
