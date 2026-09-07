/* โหลดโค้ด .gs ทั้งหมดเข้า Node แล้วรันสถานการณ์ใช้งานจริง */
const fs = require('fs'), path = require('path'), vm = require('vm');
const mock = require('./gas-mock.js');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
let code = '';
files.forEach(f => { code += fs.readFileSync(path.join(SRC, f), 'utf8') + '\n'; });

// รันในบริบท global เดียวกันเพื่อให้ทุกไฟล์เห็นกัน
vm.runInThisContext(code, { filename: 'bundle.gs' });

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n▶ ' + t); }

/* ---------- 1. ติดตั้งระบบ ---------- */
section('ติดตั้งระบบ (runSetup_)');
const setup = runSetup_();
check('สร้างชีทครบทุกชีท', Object.values(SHEETS).every(n => sheetExists_(n)));
check('ได้รหัสผ่านผู้ดูแลระบบครั้งแรก', !!setup.adminPassword && setup.adminPassword.length === 12);
check('เกณฑ์การประเมินเริ่มต้น 10 ข้อ', loadCriteria_().length === 10, loadCriteria_().length);
const ADMIN_PW = setup.adminPassword;

section('เรียกติดตั้งซ้ำต้องไม่ทำข้อมูลเสียหาย (idempotent)');
const before = readTable_(SHEETS.CRITERIA).rows.length;
const setup2 = runSetup_();
check('ไม่สร้างรหัสผ่านใหม่ทับของเดิม', !setup2.adminPassword);
check('เกณฑ์ไม่ถูกเพิ่มซ้ำ', readTable_(SHEETS.CRITERIA).rows.length === before, readTable_(SHEETS.CRITERIA).rows.length);

/* ---------- 2. เข้าสู่ระบบผู้ดูแล ---------- */
section('เข้าสู่ระบบผู้ดูแลระบบ');
check('รหัสผ่านผิด → ปฏิเสธ', apiAdminLogin('wrong-password', 'dev1').success === false);
const login = apiAdminLogin(ADMIN_PW, 'dev1');
check('รหัสผ่านถูก → ผ่าน', login.success === true, login);
const T = login.data.token;
check('ได้ token', !!T);
check('เรียก API โดยไม่มี token ต้องไม่ผ่าน', apiListEvaluators('bogus-token').success === false);

/* ---------- 3. ข้อมูลครู ---------- */
section('จัดการข้อมูลครู');
const teacherNames = [
  ['นาย', 'สมชาย', 'ใจดี', 'ม.1', 'จันทร์'],
  ['นาง', 'สมหญิง', 'รักเรียน', 'ม.1', 'อังคาร'],
  ['นางสาว', 'มาลี', 'ศรีสุข', 'ม.2', 'จันทร์'],
  ['นาย', 'ประยุทธ', 'มั่นคง', 'ม.3', 'พุธ'],
  ['ดร.', 'วิชัย', 'เก่งกาจ', 'ม.6', 'ศุกร์']
];
teacherNames.forEach(t => {
  const r = apiSaveTeacher(T, { prefix: t[0], firstName: t[1], lastName: t[2], level: t[3], defaultDay: t[4], email: '' });
  if (!r.success) console.log('    save teacher failed:', r.message);
});
const teachers = apiListTeachers(T, '', '', true).data;
check('เพิ่มครู 5 คน', teachers.length === 5, teachers.length);
check('รหัสครูเรียงลำดับ TCH-0001..', teachers.some(t => t.id === 'TCH-0001'));
check('เพิ่มชื่อซ้ำไม่ได้', apiSaveTeacher(T, { prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' }).success === false);

/* ---------- 4. ผู้ประเมิน ---------- */
section('จัดการผู้ประเมิน');
const evalDefs = [
  ['นาย', 'บุญมี', 'ผู้บริหาร', 'รองผู้อำนวยการฝ่ายกิจการนักเรียน', ''],
  ['นาง', 'สายฝน', 'กิจการดี', 'หัวหน้ากลุ่มบริหารงานกิจการนักเรียน', ''],
  ['นาย', 'ระดับ', 'หนึ่งดี', 'หัวหน้าระดับชั้น', 'ม.1'],
  ['นาง', 'เวร', 'จันทร์ดี', 'หัวหน้าเวรประจำวัน', 'จันทร์']
];
const passwords = {};
evalDefs.forEach(e => {
  const r = apiSaveEvaluator(T, { prefix: e[0], firstName: e[1], lastName: e[2], role: e[3], scope: e[4] });
  if (r.success) passwords[r.data.name] = r.data.password;
  else console.log('    save evaluator failed:', r.message);
});
check('เพิ่มผู้ประเมิน 4 คน', Object.keys(passwords).length === 4, Object.keys(passwords));
check('หัวหน้าระดับชั้นต้องระบุขอบเขต',
  apiSaveEvaluator(T, { prefix: 'นาย', firstName: 'ก', lastName: 'ข', role: 'หัวหน้าระดับชั้น', scope: '' }).success === false);
check('รหัสผ่านที่สุ่มผ่านนโยบายรหัสผ่าน',
  Object.values(passwords).every(p => checkPasswordPolicy_(p).ok), Object.values(passwords));

/* ---------- 5. ตารางเวรรายภาคเรียน ---------- */
section('ตารางเวรประจำวันแยกอิสระตามภาคเรียน');
const YEAR = currentTerm_().year;
setSetting_(SETTING_KEYS.CURRENT_SEMESTER, '1');
SETTINGS_CACHE_ = null;

const seeded = apiSeedDuty(T, YEAR, '1', false);
check('สร้างตารางเวรจากค่าเริ่มต้นในทะเบียนครูได้', seeded.success === true, seeded.message);
const duty1 = apiListDuty(T, YEAR, '1').data;
check('ภาคเรียน 1 มีตารางเวร 5 รายการ', duty1.rows.length === 5, duty1.rows.length);

const somchai = teachers.filter(t => t.name.indexOf('สมชาย') !== -1)[0];
const dutyRowSomchai = duty1.rows.filter(r => r.teacherId === somchai.id)[0];
check('สมชายอยู่เวรวันจันทร์ในภาคเรียน 1', dutyRowSomchai && dutyRowSomchai.day === 'จันทร์');

// คัดลอกไปภาคเรียน 2 แล้วเปลี่ยนวันเวรของสมชายเป็นพฤหัสบดี
const copy = apiCopyDuty(T, { fromYear: YEAR, fromSemester: '1', toYear: YEAR, toSemester: '2' });
check('คัดลอกตารางเวรไปภาคเรียน 2 สำเร็จ', copy.success === true, copy.message);
const duty2 = apiListDuty(T, YEAR, '2').data;
const somchai2 = duty2.rows.filter(r => r.teacherId === somchai.id)[0];
const changed = apiSaveDuty(T, {
  id: somchai2.id, year: YEAR, semester: '2', teacherId: somchai.id,
  day: 'พฤหัสบดี', position: 'หัวหน้าเวร', location: 'ประตูหน้า', startTime: '07:00', endTime: '08:00'
});
check('แก้ไขเวรภาคเรียน 2 สำเร็จ', changed.success === true, changed.message);

const recheck1 = dutyRosterFor_(YEAR, '1').byTeacherId[somchai.id];
const recheck2 = dutyRosterFor_(YEAR, '2').byTeacherId[somchai.id];
check('ภาคเรียน 1 ยังเป็นวันจันทร์ (ไม่ถูกกระทบ)', recheck1.day === 'จันทร์', recheck1.day);
check('ภาคเรียน 2 เป็นวันพฤหัสบดี', recheck2.day === 'พฤหัสบดี', recheck2.day);
check('เก็บรายละเอียดเวรได้ (จุดปฏิบัติ/เวลา/บทบาท)',
  recheck2.location === 'ประตูหน้า' && recheck2.startTime === '07:00' && recheck2.position === 'หัวหน้าเวร');
check('ครู 1 คนมีเวรได้ 1 รายการต่อภาคเรียน',
  apiSaveDuty(T, { year: YEAR, semester: '2', teacherId: somchai.id, day: 'ศุกร์' }).success === false);

/* ---------- 6. สิทธิ์การมองเห็นครูของผู้ประเมิน ---------- */
section('ขอบเขตการประเมินตามบทบาท (อิงตารางเวรของภาคเรียน)');
const dutyHeadTeachers1 = teachersForEvaluator_('หัวหน้าเวรประจำวัน', 'จันทร์', YEAR, '1');
const dutyHeadTeachers2 = teachersForEvaluator_('หัวหน้าเวรประจำวัน', 'จันทร์', YEAR, '2');
check('หัวหน้าเวรจันทร์ ภาคเรียน 1 เห็นครู 2 คน', dutyHeadTeachers1.length === 2, dutyHeadTeachers1.map(t => t.name));
check('หัวหน้าเวรจันทร์ ภาคเรียน 2 เห็นครู 1 คน (สมชายย้ายไปพฤหัสฯ)',
  dutyHeadTeachers2.length === 1, dutyHeadTeachers2.map(t => t.name));
check('หัวหน้าระดับ ม.1 เห็นเฉพาะครู ม.1',
  teachersForEvaluator_('หัวหน้าระดับชั้น', 'ม.1', YEAR, '1').every(t => t.level === 'ม.1'));
check('รอง ผอ. เห็นครูทุกคน', teachersForEvaluator_('รองผู้อำนวยการฝ่ายกิจการนักเรียน', '', YEAR, '1').length === 5);

/* ---------- 7. ผู้ประเมินเข้าสู่ระบบและบันทึกผล ---------- */
section('ผู้ประเมินบันทึกผลการประเมิน');
const vdName = Object.keys(passwords).filter(n => n.indexOf('บุญมี') !== -1)[0];
check('ล็อกอินผู้ประเมินด้วยรหัสผิด → ไม่ผ่าน', apiEvaluatorLogin(vdName, 'wrong123').success === false);
const evLogin = apiEvaluatorLogin(vdName, passwords[vdName]);
check('ล็อกอินผู้ประเมินสำเร็จ', evLogin.success === true, evLogin.message);
const ET = evLogin.data.token;
check('บังคับเปลี่ยนรหัสผ่านครั้งแรก', evLogin.data.mustChangePassword === true);

const ctx = apiEvaluatorContext(ET, YEAR, '1').data;
check('รอง ผอ. ประเมินได้ทั้ง 10 ข้อ', ctx.criteria.length === 10, ctx.criteria.length);
check('เห็นครูครบ 5 คน', ctx.teachers.length === 5);

const scoresFull = {};
ctx.criteria.forEach((c, i) => { scoresFull[c.id] = (i % 2 === 0) ? 5 : 4; });
const submit = apiSubmitEvaluation(ET, {
  year: YEAR, semester: '1', teacherId: somchai.id, scores: scoresFull, comment: 'ปฏิบัติงานดีมาก'
});
check('บันทึกผลการประเมินสำเร็จ', submit.success === true, submit.message);
check('คะแนนเฉลี่ยคำนวณถูกต้อง (4.5)', Math.abs(submit.data.average - 4.5) < 0.001, submit.data.average);
check('ระดับผล = ดีเยี่ยม', submit.data.rating === 'ดีเยี่ยม', submit.data.rating);

check('ให้คะแนนไม่ครบทุกข้อ → ปฏิเสธ',
  apiSubmitEvaluation(ET, { year: YEAR, semester: '1', teacherId: somchai.id, scores: { 1: 5 } }).success === false);
check('คะแนนนอกช่วง 1-5 → ปฏิเสธ',
  apiSubmitEvaluation(ET, { year: YEAR, semester: '1', teacherId: somchai.id, scores: Object.assign({}, scoresFull, { 1: 9 }) }).success === false);

// หัวหน้าเวรวันจันทร์ประเมินสมชายในภาคเรียน 2 ไม่ได้ (สมชายย้ายไปเวรพฤหัสฯ)
const dutyName = Object.keys(passwords).filter(n => n.indexOf('เวร') !== -1)[0];
const dutyLogin = apiEvaluatorLogin(dutyName, passwords[dutyName]);
const DT = dutyLogin.data.token;
const dutyCriteria = apiEvaluatorContext(DT, YEAR, '1').data.criteria;
check('หัวหน้าเวรประเมินได้เฉพาะข้อ "การปฏิบัติหน้าที่เวรประจำวัน" (1 ข้อ)',
  dutyCriteria.length === 1 && dutyCriteria[0].id === 7, dutyCriteria.map(c => c.id));
check('หัวหน้าระดับชั้นประเมินได้ 8 ข้อ',
  criteriaForRole_('หัวหน้าระดับชั้น').length === 8, criteriaForRole_('หัวหน้าระดับชั้น').length);
check('หัวหน้ากลุ่มกิจการนักเรียนประเมินได้ครบ 10 ข้อ',
  criteriaForRole_('หัวหน้ากลุ่มบริหารงานกิจการนักเรียน').length === 10);
const dutyScores = {};
dutyCriteria.forEach(c => { dutyScores[c.id] = 4; });
check('หัวหน้าเวรจันทร์ประเมินสมชายในภาคเรียน 2 ไม่ได้',
  apiSubmitEvaluation(DT, { year: YEAR, semester: '2', teacherId: somchai.id, scores: dutyScores }).success === false);
check('หัวหน้าเวรจันทร์ประเมินสมชายในภาคเรียน 1 ได้',
  apiSubmitEvaluation(DT, { year: YEAR, semester: '1', teacherId: somchai.id, scores: dutyScores }).success === true);

/* ---------- 8. เก็บผลเดิมเมื่อแก้ไข ---------- */
section('เก็บข้อมูลการประเมินเดิมเมื่อบันทึกทับ');
const archiveBefore = readTable_(SHEETS.ARCHIVE).rows.length;
const scoresLow = {};
ctx.criteria.forEach(c => { scoresLow[c.id] = 3; });
const resubmit = apiSubmitEvaluation(ET, {
  year: YEAR, semester: '1', teacherId: somchai.id, scores: scoresLow, comment: 'แก้ไขคะแนน'
});
check('บันทึกทับสำเร็จ', resubmit.success === true, resubmit.message);
check('ฉบับเดิมถูกเก็บเข้าคลัง', readTable_(SHEETS.ARCHIVE).rows.length === archiveBefore + 1);
const arch = readTable_(SHEETS.ARCHIVE).rows.slice(-1)[0];
check('คลังเก็บคะแนนเดิมไว้ (4.5)', Math.abs(num_(arch['คะแนนเฉลี่ย']) - 4.5) < 0.001, num_(arch['คะแนนเฉลี่ย']));
check('ประเภทการจัดเก็บ = ฉบับแก้ไข', str_(arch['ประเภทการจัดเก็บ']) === 'ฉบับแก้ไข');
const results = readTable_(SHEETS.RESULTS).rows.filter(r => str_(r['ครูผู้รับการประเมิน']).indexOf('สมชาย') !== -1
  && str_(r['ผู้ประเมิน']) === vdName);
check('ไม่เกิดรายการซ้ำในตารางหลัก', results.length === 1, results.length);
check('นับเป็นการแก้ไขครั้งที่ 1', num_(results[0]['แก้ไขครั้งที่']) === 1);

/* ---------- 9. ประมวลผล เลือก และจัดลำดับก่อนส่งออก ---------- */
section('เลือกและจัดลำดับผู้ถูกประเมินก่อนประมวลผล');
// ให้ผู้ประเมินอีกคนประเมินครูเพิ่มเพื่อให้มีข้อมูลหลากหลาย
const haName = Object.keys(passwords).filter(n => n.indexOf('สายฝน') !== -1)[0];
const haToken = apiEvaluatorLogin(haName, passwords[haName]).data.token;
const haCtx = apiEvaluatorContext(haToken, YEAR, '1').data;
haCtx.teachers.forEach((t, idx) => {
  const sc = {};
  haCtx.criteria.forEach(c => { sc[c.id] = [5, 4, 3, 5, 2][idx % 5]; });
  apiSubmitEvaluation(haToken, { year: YEAR, semester: '1', teacherId: t.id, scores: sc, comment: 'ความเห็นที่ ' + (idx + 1) });
});

const candidates = apiExportCandidates(T, YEAR, '1').data;
check('รายชื่อผู้ถูกประเมินครบทุกคน', candidates.candidates.length === 5, candidates.candidates.length);
check('มีข้อมูลเวรของภาคเรียนติดมาด้วย', candidates.candidates.every(c => c.dutyDay !== undefined));

const chosen = [candidates.candidates[3].key, candidates.candidates[0].key, candidates.candidates[2].key];
const preview = apiPreviewExport(T, { year: YEAR, semester: '1', teacherIds: chosen, sortBy: 'custom' });
check('ประมวลผลตามที่เลือกสำเร็จ', preview.success === true, preview.message);
check('ได้เฉพาะ 3 คนที่เลือก', preview.data.rows.length === 3, preview.data.rows.length);
check('เรียงตามลำดับที่ผู้ใช้จัดไว้',
  preview.data.rows.map(r => r.key).join('|') === chosen.join('|'),
  preview.data.rows.map(r => r.name));

const sorted = apiPreviewExport(T, { year: YEAR, semester: '1', teacherIds: chosen, sortBy: 'scoreDesc' }).data.rows;
check('เรียงคะแนนมาก→น้อยได้',
  sorted.every((r, i) => i === 0 || sorted[i - 1].average >= r.average), sorted.map(r => r.average));

/* ---------- 10. ส่งออก Excel / PDF ---------- */
section('ส่งออกรายงาน Excel และ PDF');
const exported = apiExportReport(T, {
  year: YEAR, semester: '1', teacherIds: chosen, formats: ['xlsx', 'pdf'],
  options: { title: 'รายงานทดสอบ', detail: true, comments: true, rawList: true, orientation: 'landscape' }
});
check('ส่งออกสำเร็จ', exported.success === true, exported.message);
check('ได้ไฟล์ 2 รูปแบบ', exported.data.files.length === 2, exported.data.files.map(f => f.format));
check('ไฟล์ Excel มีนามสกุล .xlsx', exported.data.files.some(f => /\.xlsx$/.test(f.name)));
check('ไฟล์ PDF มีนามสกุล .pdf', exported.data.files.some(f => /\.pdf$/.test(f.name)));
check('มีข้อมูล base64 ให้ดาวน์โหลดทันที', exported.data.files.every(f => !!f.base64));

const tempSheets = mock.store.created.slice(-1)[0].getSheets().map(s => s.getName());
check('สร้างแผ่นงานครบ (สรุป/รายข้อ/ข้อเสนอแนะ/รายการทั้งหมด)',
  tempSheets.indexOf('สรุปผลการประเมิน') !== -1 && tempSheets.indexOf('คะแนนรายข้อ') !== -1
  && tempSheets.indexOf('ข้อเสนอแนะ') !== -1 && tempSheets.indexOf('รายการประเมินทั้งหมด') !== -1, tempSheets);

const summaryResult = apiGenerateSummary(T, { year: YEAR, semester: '1', teacherIds: chosen });
check('สรุปผลลงชีทสำเร็จ', summaryResult.success === true, summaryResult.message);
check('ชีทสรุปมี 3 แถว', readTable_(SHEETS.SUMMARY).rows.length === 3, readTable_(SHEETS.SUMMARY).rows.length);

/* ---------- 11. คลังข้อมูลย้อนหลัง ---------- */
section('คลังข้อมูลย้อนหลังและการกู้คืน');
const resultsBefore = readTable_(SHEETS.RESULTS).rows.length;
const archived = apiArchiveTerm(T, YEAR, '1', 'ปิดภาคเรียนทดสอบ');
check('จัดเก็บภาคเรียนสำเร็จ', archived.success === true, archived.message);
check('ตารางหลักว่างลง', readTable_(SHEETS.RESULTS).rows.length === 0, readTable_(SHEETS.RESULTS).rows.length);
check('ข้อมูลย้ายเข้าคลังครบ', archived.data.archived === resultsBefore, [archived.data.archived, resultsBefore]);

const stillReportable = apiPreviewExport(T, { year: YEAR, semester: '1', teacherIds: chosen, includeArchive: true });
check('ยังออกรายงานจากข้อมูลที่จัดเก็บได้',
  stillReportable.data.rows.filter(r => r.count > 0).length === 3,
  stillReportable.data.rows.map(r => r.count));

const archiveList = apiListArchive(T, { year: YEAR, semester: '1', type: 'จัดเก็บภาคเรียน' }).data;
const restoreIds = archiveList.rows.slice(0, 2).map(r => r.batchId);
const restored = apiRestoreArchive(T, restoreIds);
check('กู้คืนข้อมูลจากคลังได้', restored.success === true && restored.data.restored === 2, restored.message);
check('ข้อมูลกลับสู่ตารางหลัก', readTable_(SHEETS.RESULTS).rows.length === 2);

const history = apiTeacherHistory(T, somchai.id);
check('ดูประวัติข้ามภาคเรียนของครูได้', history.success === true && history.data.records.length > 0, history.message);

/* ---------- 12. ความปลอดภัย ---------- */
section('ความปลอดภัย');
check('รหัสผ่านสั้นเกินไป → ไม่ผ่านนโยบาย', checkPasswordPolicy_('abc123').ok === false);
check('รหัสผ่านไม่มีตัวเลข → ไม่ผ่าน', checkPasswordPolicy_('abcdefgh').ok === false);
check('รหัสผ่านคาดเดาง่าย → ไม่ผ่าน', checkPasswordPolicy_('password').ok === false);
check('รหัสผ่านที่ดี → ผ่าน', checkPasswordPolicy_('Kruประเมิน2568').ok === true);

const salt = randomToken_(32);
const h1 = hashPassword_('secret123', salt, 100);
const h2 = hashPassword_('secret123', salt, 100);
check('แฮชเดิมให้ผลเดิม', h1 === h2);
check('salt ต่างกันให้แฮชต่างกัน', hashPassword_('secret123', randomToken_(32), 100) !== h1);
check('เปรียบเทียบแบบ constant-time ทำงานถูกต้อง', safeEquals_(h1, h2) === true && safeEquals_(h1, h1 + 'x') === false);

// รหัสผ่านรูปแบบเดิม (v2) ต้องยังใช้ได้และถูกอัปเกรด
const legacyEval = readTable_(SHEETS.EVALUATORS).rows[0];
updateRecord_(SHEETS.EVALUATORS, legacyEval._row, {
  'รหัสผ่าน (Hash)': legacyHash_('OldPass2024'), 'Salt': '', 'รอบการเข้ารหัส': ''
});
const legacyLogin = apiEvaluatorLogin(str_(legacyEval['ชื่อ-นามสกุล']), 'OldPass2024');
check('รหัสผ่านจากระบบเดิมยังเข้าได้', legacyLogin.success === true, legacyLogin.message);
const upgraded = readTable_(SHEETS.EVALUATORS).rows.filter(r => r._row === legacyEval._row)[0];
check('อัปเกรดเป็นการเข้ารหัสแบบใหม่อัตโนมัติ', !!str_(upgraded['Salt']));

// ล็อกบัญชีเมื่อกรอกผิดหลายครั้ง
const victim = str_(readTable_(SHEETS.EVALUATORS).rows[1]['ชื่อ-นามสกุล']);
let lockedMessage = '';
for (let i = 0; i < 6; i++) {
  const r = apiEvaluatorLogin(victim, 'bad-password-' + i);
  if (r.code === 'LOCKED') lockedMessage = r.message;
}
check('ล็อกบัญชีเมื่อกรอกรหัสผ่านผิดเกินกำหนด', !!lockedMessage, lockedMessage);
const unlocked = apiUnlockEvaluator(T, readTable_(SHEETS.EVALUATORS).rows[1]['รหัสผู้ประเมิน']);
check('ผู้ดูแลปลดล็อกบัญชีได้', unlocked.success === true, unlocked.message);

// เซสชันหมดอายุ
const sess = createSession_({ kind: 'admin', name: 'ทดสอบ' });
const raw = JSON.parse(PropertiesService.getScriptProperties().getProperty(SESSION_PREFIX_ + sha256Hex_(sess.token)));
raw.lastSeen = Date.now() - 999 * 60000;
PropertiesService.getScriptProperties().setProperty(SESSION_PREFIX_ + sha256Hex_(sess.token), JSON.stringify(raw));
check('เซสชันที่ไม่มีการใช้งานนานเกินกำหนดถูกตัด', readSession_(sess.token) === null);

/* ---------- 13. กู้คืนรหัสผ่านผู้ดูแลระบบ ---------- */
section('กู้คืนรหัสผ่านผู้ดูแลระบบ (ลืมรหัสผ่าน)');
check('ยังไม่ตั้งอีเมลกู้คืน → แจ้งเตือนพร้อมทางเลือกอื่น',
  apiRequestAdminRecovery('dev1').code === 'NO_RECOVERY_EMAIL');
apiSaveSettings(T, { recoveryEmail: 'principal@school.ac.th' });
const otpRequest = apiRequestAdminRecovery('dev1');
check('ขอ OTP สำเร็จ', otpRequest.success === true, otpRequest.message);
check('ปกปิดอีเมลปลายทาง', /\*/.test(otpRequest.data.maskedEmail), otpRequest.data.maskedEmail);
const otpMail = mock.store.mails.slice(-1)[0];
const otp = (otpMail.body.match(/OTP\): (\d{6})/) || [])[1];
check('ส่ง OTP 6 หลักทางอีเมล', !!otp, otp);
check('OTP ผิด → ปฏิเสธ', apiVerifyAdminRecovery('000000', 'NewAdmin2568').success === false);
check('รหัสผ่านใหม่ที่อ่อนแอ → ปฏิเสธ', apiVerifyAdminRecovery(otp, '123').success === false);
const recovered = apiVerifyAdminRecovery(otp, 'NewAdmin2568x');
check('ตั้งรหัสผ่านใหม่ด้วย OTP สำเร็จ', recovered.success === true, recovered.message);
check('เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้', apiAdminLogin('NewAdmin2568x', 'dev2').success === true);
check('รหัสผ่านเดิมใช้ไม่ได้แล้ว', apiAdminLogin(ADMIN_PW, 'dev3').success === false);
check('เซสชันผู้ดูแลเดิมถูกเพิกถอน', apiListEvaluators(T).success === false);
check('ใช้ OTP ซ้ำไม่ได้', apiVerifyAdminRecovery(otp, 'AnotherPass2568').success === false);

const emergencyPw = emergencyResetAdminPassword();
check('รีเซ็ตฉุกเฉินจากตัวแก้ไขสคริปต์ได้', apiAdminLogin(emergencyPw, 'dev4').success === true);

/* ---------- 14. ตรวจสุขภาพระบบ ---------- */
section('ตรวจสุขภาพระบบ');
const health = healthCheck_();
check('ตรวจสุขภาพระบบทำงานได้', health.items.length > 0);
check('ทุกชีทมีอยู่จริง', health.items.filter(i => i.label.indexOf('ชีท') === 0).every(i => i.ok));

console.log('\n════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' รายการ / ไม่ผ่าน ' + fail + ' รายการ');
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
