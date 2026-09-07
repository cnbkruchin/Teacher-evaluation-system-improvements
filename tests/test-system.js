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

/* ---------- 14. ตั้งค่าปีการศึกษาและภาคเรียนอย่างอิสระ ---------- */
section('ตั้งค่าปีการศึกษาและภาคเรียนอย่างอิสระ');
const T2 = apiAdminLogin(emergencyPw, 'dev5').data.token;

const overview = apiTermOverview(T2);
check('เปิดหน้าปีการศึกษา/ภาคเรียนได้', overview.success === true, overview.message);
check('แสดงภาคเรียนที่เปิดใช้งาน 2 ภาคเรียนโดยค่าเริ่มต้น',
  overview.data.semesterOptions.filter(o => o.enabled).length === 2,
  overview.data.semesterOptions);
check('มีภาคฤดูร้อนให้เลือกเปิดใช้งาน',
  overview.data.semesterOptions.some(o => o.value === '3' && o.label === 'ภาคฤดูร้อน'));
check('สรุปจำนวนข้อมูลรายภาคเรียนได้', overview.data.terms.length > 0, overview.data.terms.length);

// เปลี่ยนเฉพาะภาคเรียน โดยไม่แตะปีการศึกษา
const beforeYear = currentTerm_().year;
const semOnly = apiSaveTermSettings(T2, { currentSemester: '2' });
check('เปลี่ยนภาคเรียนปัจจุบันได้โดยไม่กระทบปีการศึกษา',
  semOnly.success === true && currentTerm_().semester === '2' && currentTerm_().year === beforeYear,
  [semOnly.message, currentTerm_()]);

// เปลี่ยนเฉพาะปีการศึกษา โดยไม่แตะภาคเรียน
const yearOnly = apiSaveTermSettings(T2, { currentYear: '2570' });
check('เปลี่ยนปีการศึกษาปัจจุบันได้โดยไม่กระทบภาคเรียน',
  yearOnly.success === true && currentTerm_().year === '2570' && currentTerm_().semester === '2',
  [yearOnly.message, currentTerm_()]);
check('ปีการศึกษาใหม่ถูกเพิ่มเข้ารายการอัตโนมัติ',
  academicYears_().indexOf('2570') !== -1, academicYears_());

check('ปีการศึกษาผิดรูปแบบ → ปฏิเสธ', apiSaveTermSettings(T2, { currentYear: '68' }).success === false);
check('เลือกภาคเรียนที่ยังไม่เปิดใช้งาน → ปฏิเสธ',
  apiSaveTermSettings(T2, { currentSemester: '3' }).success === false);

// เปิดใช้งานภาคฤดูร้อน แล้วจึงเลือกได้
const openSummer = apiSaveTermSettings(T2, { semesters: ['1', '2', '3'] });
check('เปิดใช้งานภาคฤดูร้อนได้', openSummer.success === true, openSummer.message);
check('ภาคฤดูร้อนใช้งานได้แล้ว', semesterList_().indexOf('3') !== -1, semesterList_());
check('ตั้งภาคฤดูร้อนเป็นภาคเรียนปัจจุบันได้',
  apiSaveTermSettings(T2, { currentSemester: '3' }).success === true);
check('ชื่อภาคเรียนแสดงถูกต้อง', termLabel_('2570', '3') === 'ภาคฤดูร้อน/2570', termLabel_('2570', '3'));
check('ปิดภาคเรียนทั้งหมดไม่ได้', apiSaveTermSettings(T2, { semesters: [] }).success === false);

// จัดการรายการปีการศึกษา
check('ลบปีการศึกษาปัจจุบันไม่ได้', apiRemoveAcademicYear(T2, '2570').success === false);
apiSaveTermSettings(T2, { currentYear: YEAR, currentSemester: '1' });
const removeYear = apiRemoveAcademicYear(T2, '2570');
check('ลบปีการศึกษาอื่นออกจากรายการได้', removeYear.success === true, removeYear.message);
check('ปีที่ลบหายจากรายการที่ตั้งค่าไว้',
  str_(getSetting_(SETTING_KEYS.ACADEMIC_YEARS, '')).split(',').indexOf('2570') === -1,
  getSetting_(SETTING_KEYS.ACADEMIC_YEARS, ''));

/* ---------- 15. เคลียร์ข้อมูลการประเมินรายภาคเรียน/รายปี ---------- */
section('เคลียร์ข้อมูลการประเมินรายภาคเรียนและรายปีการศึกษา');

// เตรียมข้อมูลใหม่ 2 ภาคเรียน เพื่อทดสอบการเคลียร์แบบเจาะจง
const seedEvaluations = function (year, semester, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      'รหัสการประเมิน': 'EVR-T' + year + semester + i,
      'วันที่บันทึก': new Date(), 'ปีการศึกษา': year, 'ภาคเรียน': semester,
      'ผู้ประเมิน': 'ผู้ประเมินทดสอบ', 'บทบาทผู้ประเมิน': ROLES.VICE_DIRECTOR,
      'รหัสครู': 'TCH-000' + (i + 1), 'ครูผู้รับการประเมิน': 'ครูทดสอบ ' + (i + 1),
      'คะแนนเฉลี่ย': 4, 'ระดับผลการประเมิน': 'ดีมาก', 'สถานะ': 'ปกติ'
    });
  }
  appendRecords_(SHEETS.RESULTS, rows);
  return rows.length;
};
const RESULTS_BEFORE = readTable_(SHEETS.RESULTS).rows.length;
seedEvaluations('2598', '1', 5);
seedEvaluations('2598', '2', 3);
seedEvaluations('2599', '1', 4);

const preview1 = apiClearPreview(T2, { scope: 'term', year: '2598', semester: '1', target: 'results' });
check('ดูจำนวนข้อมูลก่อนเคลียร์รายภาคเรียนได้', preview1.success === true, preview1.message);
check('นับจำนวนถูกต้อง (5 รายการ)', preview1.data.results === 5, preview1.data.results);
check('ข้อความยืนยันคือ "2598/1"', preview1.data.phrase === '2598/1', preview1.data.phrase);

check('พิมพ์ข้อความยืนยันผิด → ปฏิเสธ',
  apiClearResults(T2, { scope: 'term', year: '2598', semester: '1', mode: 'archive', confirm: 'ผิด' }).success === false);

const archiveBefore2 = readTable_(SHEETS.ARCHIVE).rows.length;
const cleared = apiClearResults(T2, {
  scope: 'term', year: '2598', semester: '1', target: 'results',
  mode: 'archive', backup: false, confirm: '2598/1', note: 'ทดสอบเคลียร์ภาคเรียน'
});
check('เคลียร์รายภาคเรียนแบบย้ายเข้าคลังสำเร็จ', cleared.success === true, cleared.message);
check('ย้ายเข้าคลังครบ 5 รายการ', cleared.data.archived === 5, cleared.data.archived);
check('คลังข้อมูลเพิ่มขึ้น 5 รายการ',
  readTable_(SHEETS.ARCHIVE).rows.length === archiveBefore2 + 5);
check('ภาคเรียน 2598/1 ไม่เหลือในตารางหลัก',
  readTable_(SHEETS.RESULTS).rows.filter(r => str_(r['ปีการศึกษา']) === '2598' && str_(r['ภาคเรียน']) === '1').length === 0);
check('ภาคเรียน 2598/2 ยังอยู่ครบ (ไม่ถูกกระทบ)',
  readTable_(SHEETS.RESULTS).rows.filter(r => str_(r['ปีการศึกษา']) === '2598' && str_(r['ภาคเรียน']) === '2').length === 3);
check('กู้คืนจากคลังได้หลังเคลียร์',
  apiListArchive(T2, { year: '2598', semester: '1' }).data.rows.length >= 5);

// เคลียร์ทั้งปีการศึกษาแบบลบถาวร พร้อมสำรองไฟล์
const previewYear = apiClearPreview(T2, { scope: 'year', year: '2599', target: 'both' });
check('ดูจำนวนข้อมูลรายปีการศึกษาได้', previewYear.data.results === 4, previewYear.data.results);
check('ข้อความยืนยันรายปีคือ "2599"', previewYear.data.phrase === '2599', previewYear.data.phrase);

const deleted = apiClearResults(T2, {
  scope: 'year', year: '2599', target: 'both', mode: 'delete',
  backup: true, confirm: '2599', note: 'ทดสอบลบถาวรทั้งปี'
});
check('ลบถาวรทั้งปีการศึกษาสำเร็จ', deleted.success === true, deleted.message);
check('ลบออกจากตารางหลัก 4 รายการ', deleted.data.deletedResults === 4, deleted.data.deletedResults);
check('สร้างไฟล์สำรอง Excel ให้ก่อนลบ', !!deleted.data.backup && /\.xlsx$/.test(deleted.data.backup.name),
  deleted.data.backup);
check('ปีการศึกษา 2599 ไม่เหลือข้อมูล',
  readTable_(SHEETS.RESULTS).rows.filter(r => str_(r['ปีการศึกษา']) === '2599').length === 0);
check('ข้อมูลภาคเรียนอื่นยังอยู่ครบ',
  readTable_(SHEETS.RESULTS).rows.length === RESULTS_BEFORE + 3, readTable_(SHEETS.RESULTS).rows.length);

check('ย้ายเข้าคลังใช้กับคลังข้อมูลไม่ได้',
  apiClearResults(T2, { scope: 'year', year: '2598', target: 'archive', mode: 'archive', confirm: '2598' }).success === false);
check('ไม่พบข้อมูลตามเงื่อนไข → แจ้งเตือน',
  apiClearResults(T2, { scope: 'term', year: '2560', semester: '1', mode: 'archive', confirm: '2560/1' }).success === false);
check('บันทึกการเคลียร์ลงประวัติการใช้งาน',
  readLogs_(50).some(l => l.action.indexOf('เคลียร์ข้อมูล') !== -1));

/* ---------- 16. น้ำหนักกลุ่มผู้ประเมินและคะแนนสุทธิ ---------- */
section('คะแนนสุทธิแบบถ่วงน้ำหนักตามกลุ่มผู้ประเมิน');

// คำนวณตรง ๆ จากสูตร
const netFull = computeNetScore_(
  { VICE_DIRECTOR: 5, HEAD_AFFAIRS: 4, HEAD_LEVEL: 4.5, HEAD_DUTY: 3 },
  { weights: { VICE_DIRECTOR: 40, HEAD_AFFAIRS: 30, HEAD_LEVEL: 20, HEAD_DUTY: 10 }, normalize: true });
check('คำนวณคะแนนสุทธิถูกต้อง (5×40 + 4×30 + 4.5×20 + 3×10) ÷ 100 = 4.40',
  Math.abs(netFull.net - 4.4) < 0.001, netFull.net);
check('ระดับผลอิงคะแนนสุทธิ', netFull.rating === 'ดีมาก', netFull.rating);
check('แสดงสัดส่วนที่ใช้จริงของแต่ละกลุ่ม',
  netFull.breakdown.filter(b => b.key === 'VICE_DIRECTOR')[0].effectiveWeight === 40,
  netFull.breakdown.map(b => b.effectiveWeight));

// ขาดกลุ่มผู้ประเมิน: ปรับสัดส่วนอัตโนมัติ
const netPartial = computeNetScore_(
  { VICE_DIRECTOR: 5, HEAD_AFFAIRS: 4, HEAD_LEVEL: null, HEAD_DUTY: null },
  { weights: { VICE_DIRECTOR: 40, HEAD_AFFAIRS: 30, HEAD_LEVEL: 20, HEAD_DUTY: 10 }, normalize: true });
check('ขาดบางกลุ่ม + ปรับสัดส่วนอัตโนมัติ → (5×40 + 4×30) ÷ 70 = 4.57',
  Math.abs(netPartial.net - 4.57) < 0.01, netPartial.net);
check('ผลรวมน้ำหนักที่ใช้จริงเท่ากับ 70', netPartial.usedWeight === 70, netPartial.usedWeight);

const netNoNorm = computeNetScore_(
  { VICE_DIRECTOR: 5, HEAD_AFFAIRS: 4, HEAD_LEVEL: null, HEAD_DUTY: null },
  { weights: { VICE_DIRECTOR: 40, HEAD_AFFAIRS: 30, HEAD_LEVEL: 20, HEAD_DUTY: 10 }, normalize: false });
check('ปิดปรับสัดส่วน → หารด้วย 100 ได้ 3.20', Math.abs(netNoNorm.net - 3.2) < 0.001, netNoNorm.net);

// ผ่าน API
const w0 = apiGetScoreWeights(T2, YEAR, '1');
check('เปิดหน้าน้ำหนักผู้ประเมินได้', w0.success === true, w0.message);
check('ค่าเริ่มต้นยังไม่เปิดใช้การถ่วงน้ำหนัก', w0.data.enabled === false);
check('น้ำหนักเริ่มต้นรวม 100%', w0.data.total === 100, w0.data.total);

check('น้ำหนักเกิน 100 ต่อกลุ่ม → ปฏิเสธ',
  apiSaveScoreWeights(T2, { enabled: true, weights: { VICE_DIRECTOR: 120, HEAD_AFFAIRS: 0, HEAD_LEVEL: 0, HEAD_DUTY: 0 } }).success === false);
check('น้ำหนักเป็น 0 ทุกกลุ่ม → ปฏิเสธ',
  apiSaveScoreWeights(T2, { enabled: true, weights: { VICE_DIRECTOR: 0, HEAD_AFFAIRS: 0, HEAD_LEVEL: 0, HEAD_DUTY: 0 } }).success === false);

// เตรียมข้อมูลของครู 1 คน ให้มีคะแนนจาก 2 กลุ่มต่างกัน เพื่อตรวจผลรวมจริง
const WYEAR = '2590', WSEM = '1';
appendRecords_(SHEETS.RESULTS, [
  { 'รหัสการประเมิน': 'EVR-W001', 'วันที่บันทึก': new Date(), 'ปีการศึกษา': WYEAR, 'ภาคเรียน': WSEM,
    'ผู้ประเมิน': 'รอง ผอ. ทดสอบ', 'บทบาทผู้ประเมิน': ROLES.VICE_DIRECTOR,
    'รหัสครู': 'TCH-W001', 'ครูผู้รับการประเมิน': 'นายถ่วง น้ำหนัก',
    'คะแนนเฉลี่ย': 5, 'ระดับผลการประเมิน': 'ดีเยี่ยม', 'สถานะ': 'ปกติ' },
  { 'รหัสการประเมิน': 'EVR-W002', 'วันที่บันทึก': new Date(), 'ปีการศึกษา': WYEAR, 'ภาคเรียน': WSEM,
    'ผู้ประเมิน': 'หน.เวร ทดสอบ', 'บทบาทผู้ประเมิน': ROLES.HEAD_DUTY,
    'รหัสครู': 'TCH-W001', 'ครูผู้รับการประเมิน': 'นายถ่วง น้ำหนัก',
    'คะแนนเฉลี่ย': 3, 'ระดับผลการประเมิน': 'ดี', 'สถานะ': 'ปกติ' }
]);

const beforeWeighted = buildSummaryRows_({ year: WYEAR, semester: WSEM })[0];
check('ยังไม่เปิดถ่วงน้ำหนัก → คะแนนทางการคือค่าเฉลี่ยธรรมดา (4.00)',
  Math.abs(beforeWeighted.final - 4) < 0.001 && beforeWeighted.weighted === false, beforeWeighted.final);

const previewW = apiPreviewScoreWeights(T2, {
  year: WYEAR, semester: WSEM, normalize: true,
  weights: { VICE_DIRECTOR: 80, HEAD_AFFAIRS: 0, HEAD_LEVEL: 0, HEAD_DUTY: 20 }
});
check('ทดลองน้ำหนักโดยยังไม่บันทึกได้', previewW.success === true, previewW.message);
check('คะแนนสุทธิที่ทดลอง = (5×80 + 3×20) ÷ 100 = 4.60',
  Math.abs(previewW.data.rows[0].netScore - 4.6) < 0.001, previewW.data.rows[0].netScore);
check('ยังไม่บันทึกจึงไม่กระทบข้อมูลจริง', useRoleWeights_() === false);

const savedW = apiSaveScoreWeights(T2, {
  enabled: true, normalize: true,
  weights: { VICE_DIRECTOR: 80, HEAD_AFFAIRS: 0, HEAD_LEVEL: 0, HEAD_DUTY: 20 }
});
check('บันทึกและเปิดใช้การถ่วงน้ำหนักได้', savedW.success === true, savedW.message);
check('ระบบเปิดใช้การถ่วงน้ำหนักแล้ว', useRoleWeights_() === true);

const afterWeighted = buildSummaryRows_({ year: WYEAR, semester: WSEM })[0];
check('คะแนนทางการเปลี่ยนเป็นคะแนนสุทธิ 4.60',
  Math.abs(afterWeighted.final - 4.6) < 0.001 && afterWeighted.weighted === true, afterWeighted.final);
check('ค่าเฉลี่ยธรรมดายังเก็บไว้ให้ตรวจสอบได้', Math.abs(afterWeighted.average - 4) < 0.001);
check('รายงานมีที่มาของคะแนนรายกลุ่ม',
  afterWeighted.netBreakdown.length === 4 &&
  afterWeighted.netBreakdown.filter(b => b.counted).length === 2,
  afterWeighted.netBreakdown.map(b => b.counted));

const exportedW = apiExportReport(T2, {
  year: WYEAR, semester: WSEM, teacherIds: ['TCH-W001'], formats: ['xlsx'], options: {}
});
check('ส่งออกรายงานพร้อมคะแนนสุทธิได้', exportedW.success === true, exportedW.message);
const wSheets = mock.store.created.slice(-1)[0].getSheets().map(s => s.getName());
check('รายงานมีแผ่นงานอธิบายวิธีคิดคะแนนสุทธิ',
  wSheets.indexOf('วิธีคิดคะแนนสุทธิ') !== -1, wSheets);

// คืนค่าเดิมเพื่อไม่ให้กระทบการทดสอบอื่น
apiSaveScoreWeights(T2, { enabled: false, normalize: true, weights: DEFAULT_ROLE_WEIGHTS });
check('ปิดการถ่วงน้ำหนักกลับได้', useRoleWeights_() === false);

/* ---------- 17. นำเข้ารายชื่อครูจากไฟล์ CSV และ Excel ---------- */
section('นำเข้ารายชื่อครูจากไฟล์');

const b64 = function (text) { return Buffer.from(text, 'utf8').toString('base64'); };
const csvFile = function (text) {
  return { fileName: 'teachers.csv', mimeType: 'text/csv', base64: b64(text) };
};

// เทมเพลต
const tplXlsx = apiDownloadTeacherTemplate(T2, 'xlsx');
check('ดาวน์โหลดเทมเพลต Excel ได้', tplXlsx.success === true && /\.xlsx$/.test(tplXlsx.data.name),
  tplXlsx.message || tplXlsx.data.name);
check('เทมเพลต Excel มีข้อมูลไฟล์', !!tplXlsx.data.base64);
const tplCsv = apiDownloadTeacherTemplate(T2, 'csv');
check('ดาวน์โหลดเทมเพลต CSV ได้', tplCsv.success === true && /\.csv$/.test(tplCsv.data.name));
const tplText = Buffer.from(tplCsv.data.base64, 'base64').toString('utf8');
check('เทมเพลต CSV มี BOM ให้ Excel อ่านภาษาไทยถูก', tplText.charCodeAt(0) === 0xFEFF);
check('เทมเพลต CSV มีหัวตารางครบ', tplText.indexOf('รหัสครู') !== -1 && tplText.indexOf('เวรประจำวัน') !== -1);

// CSV ที่มีหัวตาราง + เครื่องหมายคำพูด
const csv1 =
  'คำนำหน้า,ชื่อ,นามสกุล,กลุ่มสาระ/ฝ่าย,ระดับชั้นที่ปรึกษา,เวรประจำวัน,อีเมล\n' +
  'นาย,นำเข้าหนึ่ง,ทดสอบ,"กลุ่มสาระคณิตศาสตร์, สถิติ",ม.1,จันทร์,import1@school.ac.th\n' +
  'นาง,นำเข้าสอง,ทดสอบ,ภาษาไทย,2,อังคาร,\n' +
  'นางสาว,นำเข้าสาม,ทดสอบ,,ม.6,ศุกร์,ไม่ใช่อีเมล\n';
const p1 = apiPreviewTeacherImport(T2, csvFile(csv1), {});
check('อ่านไฟล์ CSV และจับคู่คอลัมน์ได้', p1.success === true, p1.message);
check('พบข้อมูล 3 แถว', p1.data.summary.total === 3, p1.data.summary);
check('อ่านค่าที่มีจุลภาคในเครื่องหมายคำพูดได้',
  p1.data.rows[0].department === 'กลุ่มสาระคณิตศาสตร์, สถิติ', p1.data.rows[0].department);
check('แปลงระดับชั้น "2" เป็น "ม.2" ให้อัตโนมัติ', p1.data.rows[1].level === 'ม.2', p1.data.rows[1].level);
check('ตรวจพบอีเมลผิดรูปแบบ', p1.data.rows[2].status_ === 'error', p1.data.rows[2].message);
check('นับสรุปถูกต้อง (ใหม่ 2 · ผิดพลาด 1)',
  p1.data.summary.new === 2 && p1.data.summary.error === 1, p1.data.summary);

const teachersBeforeImport = readTable_(SHEETS.TEACHERS).rows.length;
const commit1 = apiCommitTeacherImport(T2, { rows: p1.data.rows, fileName: 'teachers.csv' });
check('นำเข้าเฉพาะแถวที่ถูกต้อง', commit1.success === true && commit1.data.added === 2, commit1.message);
check('จำนวนครูเพิ่มขึ้น 2 คน',
  readTable_(SHEETS.TEACHERS).rows.length === teachersBeforeImport + 2);
const imported1 = readTable_(SHEETS.TEACHERS).rows
  .filter(r => str_(r['ชื่อ-นามสกุล']) === 'นายนำเข้าหนึ่ง ทดสอบ')[0];
check('บันทึกข้อมูลครบทุกช่อง',
  !!imported1 && str_(imported1['ระดับชั้นที่ปรึกษา']) === 'ม.1' &&
  str_(imported1['เวรประจำวัน (ค่าเริ่มต้น)']) === 'จันทร์' &&
  /^TCH-\d{4}$/.test(str_(imported1['รหัสครู'])),
  imported1 && [imported1['ระดับชั้นที่ปรึกษา'], imported1['เวรประจำวัน (ค่าเริ่มต้น)'], imported1['รหัสครู']]);

// นำเข้าซ้ำ → ข้าม
const p2 = apiPreviewTeacherImport(T2, csvFile(csv1), {});
check('ตรวจพบชื่อซ้ำกับที่มีในระบบ', p2.data.summary.duplicate === 2, p2.data.summary);
check('ไม่มีรายการให้เพิ่มซ้ำ',
  apiCommitTeacherImport(T2, { rows: p2.data.rows }).success === false);

// โหมดอัปเดตข้อมูลเดิม
const csvUpdate =
  'คำนำหน้า,ชื่อ,นามสกุล,ระดับชั้นที่ปรึกษา,เวรประจำวัน\n' +
  'นาย,นำเข้าหนึ่ง,ทดสอบ,ม.5,พฤหัสบดี\n';
const p3 = apiPreviewTeacherImport(T2, csvFile(csvUpdate), { updateExisting: true });
check('โหมดอัปเดต: ระบุว่าเป็นการอัปเดต', p3.data.summary.update === 1, p3.data.summary);
const commit3 = apiCommitTeacherImport(T2, { rows: p3.data.rows, updateExisting: true });
check('อัปเดตข้อมูลเดิมสำเร็จ', commit3.success === true && commit3.data.updated === 1, commit3.message);
const updated1 = readTable_(SHEETS.TEACHERS).rows
  .filter(r => str_(r['ชื่อ-นามสกุล']) === 'นายนำเข้าหนึ่ง ทดสอบ')[0];
check('ข้อมูลถูกแก้ไขจริง',
  str_(updated1['ระดับชั้นที่ปรึกษา']) === 'ม.5' && str_(updated1['เวรประจำวัน (ค่าเริ่มต้น)']) === 'พฤหัสบดี',
  [updated1['ระดับชั้นที่ปรึกษา'], updated1['เวรประจำวัน (ค่าเริ่มต้น)']]);
check('ไม่เกิดรายชื่อซ้ำหลังอัปเดต',
  readTable_(SHEETS.TEACHERS).rows.filter(r => str_(r['ชื่อ-นามสกุล']) === 'นายนำเข้าหนึ่ง ทดสอบ').length === 1);

// ไฟล์ที่มีเฉพาะคอลัมน์ "ชื่อ-นามสกุล"
const csvFullName = 'ชื่อ-นามสกุล,ระดับชั้น,เวร\nนางสาวรวมชื่อ สกุลเดียว,ม.3,พุธ\n';
const p4 = apiPreviewTeacherImport(T2, csvFile(csvFullName), {});
check('แยกคำนำหน้า/ชื่อ/นามสกุล จากคอลัมน์ชื่อเต็มได้',
  p4.data.rows[0].prefix === 'นางสาว' && p4.data.rows[0].firstName === 'รวมชื่อ' &&
  p4.data.rows[0].lastName === 'สกุลเดียว',
  [p4.data.rows[0].prefix, p4.data.rows[0].firstName, p4.data.rows[0].lastName]);
check('รองรับชื่อคอลัมน์แบบย่อ (ระดับชั้น/เวร)',
  p4.data.rows[0].level === 'ม.3' && p4.data.rows[0].day === 'พุธ');

// ไฟล์ที่ไม่มีหัวตาราง (ใช้ลำดับคอลัมน์)
const tsvNoHeader = 'นาย\tไม่มีหัว\tตาราง\tม.4\tอังคาร\t\n';
const p5 = apiPreviewTeacherImport(T2, { fileName: 'x.tsv', mimeType: 'text/tab-separated-values', base64: b64(tsvNoHeader) }, {});
check('ไฟล์ไม่มีหัวตาราง → อ่านตามลำดับคอลัมน์',
  p5.data.hasHeader === false && p5.data.rows[0].firstName === 'ไม่มีหัว' && p5.data.rows[0].level === 'ม.4',
  [p5.data.hasHeader, p5.data.rows[0].firstName, p5.data.rows[0].level]);

// ไฟล์ Excel (จำลองการแปลงผ่าน Google Drive)
mock.store.importTable = [
  ['รหัสครู', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ระดับชั้นที่ปรึกษา', 'เวรประจำวัน', 'สถานะ'],
  ['', 'นาย', 'เอกซ์เซล', 'หนึ่ง', 'ม.2', 'จันทร์', 'ใช้งาน'],
  ['', 'นาง', 'เอกซ์เซล', 'สอง', 'ม.4', 'ศุกร์', 'ไม่ใช้งาน']
];
const pXlsx = apiPreviewTeacherImport(T2, {
  fileName: 'teachers.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  base64: b64('PK-fake-xlsx-content')
}, {});
check('อ่านไฟล์ Excel ผ่านการแปลงของ Google Drive ได้', pXlsx.success === true, pXlsx.message);
check('พบข้อมูลจากไฟล์ Excel 2 แถว', pXlsx.data.summary.total === 2, pXlsx.data.summary);
const commitXlsx = apiCommitTeacherImport(T2, { rows: pXlsx.data.rows, fileName: 'teachers.xlsx' });
check('นำเข้าจากไฟล์ Excel สำเร็จ', commitXlsx.success === true && commitXlsx.data.added === 2, commitXlsx.message);
check('อ่านค่าสถานะจากไฟล์ Excel ถูกต้อง',
  readTable_(SHEETS.TEACHERS).rows.filter(r => str_(r['ชื่อ-นามสกุล']) === 'นางเอกซ์เซล สอง')
    .map(r => str_(r['สถานะ']))[0] === 'ไม่ใช้งาน');
check('บันทึกการนำเข้าลงประวัติการใช้งาน',
  readLogs_(30).some(l => l.action.indexOf('นำเข้ารายชื่อครูจากไฟล์') !== -1));

check('ไฟล์ว่าง → แจ้งเตือน', apiPreviewTeacherImport(T2, csvFile(''), {}).success === false);
check('ไม่ส่งไฟล์มา → แจ้งเตือน', apiPreviewTeacherImport(T2, null, {}).success === false);

/* ---------- 18. ตรวจสุขภาพระบบ ---------- */
section('ตรวจสุขภาพระบบ');
const health = healthCheck_();
check('ตรวจสุขภาพระบบทำงานได้', health.items.length > 0);
check('ทุกชีทมีอยู่จริง', health.items.filter(i => i.label.indexOf('ชีท') === 0).every(i => i.ok));

console.log('\n════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' รายการ / ไม่ผ่าน ' + fail + ' รายการ');
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
