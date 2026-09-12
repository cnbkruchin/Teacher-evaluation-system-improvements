/**
 * ============================================================================
 * ระบบประเมินผลการปฏิบัติงานครู - กลุ่มบริหารงานกิจการนักเรียน
 * ไฟล์: 00_Config.gs  |  ค่าคงที่และการตั้งค่ากลางของระบบทั้งหมด
 * ============================================================================
 */

const APP = {
  NAME: 'ระบบประเมินผลการปฏิบัติงานครู',
  SUBTITLE: 'กลุ่มบริหารงานกิจการนักเรียน',
  VERSION: '3.4.2',
  TIMEZONE: 'Asia/Bangkok'
};

/** ชื่อชีททั้งหมดที่ระบบใช้ */
const SHEETS = {
  SETTINGS: 'ตั้งค่าระบบ',
  TEACHERS: 'รายชื่อครู',
  EVALUATORS: 'ผู้ประเมิน',
  ROLES: 'บทบาทผู้ประเมิน',
  SETS: 'ชุดประเมิน',
  SET_GROUPS: 'กลุ่มผู้ประเมินของชุด',
  CRITERIA: 'เกณฑ์การประเมิน',
  DUTY: 'เวรประจำวันรายภาคเรียน',
  RESULTS: 'ผลการประเมิน',
  ARCHIVE: 'คลังผลการประเมิน',
  SUMMARY: 'สรุปผลการประเมิน',
  LOG: 'ประวัติการใช้งาน'
};

/** ชื่อชีทประวัติการใช้งานของระบบเดิม (v2) ที่ถูกเก็บรักษาไว้หลังอัปเกรด */
const LEGACY_LOG_SHEET_ = 'ประวัติการใช้งาน (ระบบเดิม)';

/** ชีทที่ต้องซ่อนเสมอ เพราะมีข้อมูลอ่อนไหว */
const PROTECTED_SHEETS = [SHEETS.SETTINGS, SHEETS.EVALUATORS];

/**
 * บทบาทของผู้ประเมินที่ติดตั้งมาให้ (key ภายใน → ชื่อที่แสดง)
 * ผู้ดูแลระบบเพิ่มบทบาทใหม่เองได้ในชีท "บทบาทผู้ประเมิน" หรือหน้าจอ "ผู้ประเมิน"
 * ค่าคงที่ชุดนี้ใช้เป็นค่าตั้งต้นและเป็นตัวสำรองเมื่อยังไม่มีชีทบทบาท
 */
const ROLES = {
  VICE_DIRECTOR: 'รองผู้อำนวยการฝ่ายกิจการนักเรียน',
  HEAD_AFFAIRS: 'หัวหน้ากลุ่มบริหารงานกิจการนักเรียน',
  HEAD_LEVEL: 'หัวหน้าระดับชั้น',
  HEAD_DUTY: 'หัวหน้าเวรประจำวัน'
};

/**
 * ประเภทขอบเขตของบทบาท — กำหนดว่าบทบาทนั้นประเมินครูกลุ่มใดได้บ้าง
 *   ทุกคน          ประเมินครูได้ทุกคน ไม่ต้องระบุขอบเขต
 *   ระดับชั้น       ประเมินเฉพาะครูในระดับชั้นที่รับผิดชอบ
 *   เวรประจำวัน     ประเมินเฉพาะครูที่อยู่เวรวันเดียวกัน (อิงตารางเวรของภาคเรียนนั้น)
 *   กลุ่มสาระ/ฝ่าย  ประเมินเฉพาะครูในกลุ่มสาระหรือฝ่ายเดียวกัน
 *   เลือกครูเอง     ผู้ดูแลระบุรายชื่อครูที่ประเมินได้เป็นรายคน
 */
const SCOPE_TYPES = {
  ALL: 'ทุกคน',
  LEVEL: 'ระดับชั้น',
  DAY: 'เวรประจำวัน',
  DEPARTMENT: 'กลุ่มสาระ/ฝ่าย',
  TEACHERS: 'เลือกครูเอง'
};

/** บทบาทเริ่มต้นที่ระบบสร้างให้เมื่อติดตั้ง (แก้ไข เพิ่ม และปิดใช้งานได้ภายหลัง) */
const DEFAULT_ROLE_LIST = [
  { key: 'VICE_DIRECTOR', name: ROLES.VICE_DIRECTOR, scopeType: SCOPE_TYPES.ALL,
    description: 'ประเมินครูได้ทุกคนในโรงเรียน' },
  { key: 'HEAD_AFFAIRS', name: ROLES.HEAD_AFFAIRS, scopeType: SCOPE_TYPES.ALL,
    description: 'ประเมินครูได้ทุกคนในโรงเรียน' },
  { key: 'HEAD_LEVEL', name: ROLES.HEAD_LEVEL, scopeType: SCOPE_TYPES.LEVEL,
    description: 'ประเมินเฉพาะครูในระดับชั้นที่รับผิดชอบ' },
  { key: 'HEAD_DUTY', name: ROLES.HEAD_DUTY, scopeType: SCOPE_TYPES.DAY,
    description: 'ประเมินเฉพาะครูที่อยู่เวรวันเดียวกันตามตารางเวรของภาคเรียนนั้น' }
];

/** จำนวนบทบาทสูงสุดที่สร้างได้ */
const MAX_ROLES = 30;

const LEVELS = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
const PREFIXES = ['นาย', 'นาง', 'นางสาว', 'ว่าที่ ร.ต.', 'ว่าที่ ร.ต.หญิง', 'ดร.'];
const DUTY_POSITIONS = ['หัวหน้าเวร', 'รองหัวหน้าเวร', 'กรรมการเวร'];
/** ภาคเรียนที่ระบบรองรับ (ผู้ดูแลระบบเลือกเปิด/ปิดได้ในเมนู "ปีการศึกษาและภาคเรียน") */
const ALL_SEMESTERS = [
  { value: '1', label: 'ภาคเรียนที่ 1' },
  { value: '2', label: 'ภาคเรียนที่ 2' },
  { value: '3', label: 'ภาคฤดูร้อน' }
];
const DEFAULT_SEMESTERS = ['1', '2'];

/** เกณฑ์การประเมินเริ่มต้น (ผู้ดูแลระบบแก้ไข/เพิ่มได้ภายหลังผ่านชีท "เกณฑ์การประเมิน") */
const DEFAULT_CRITERIA = [
  { id: 1,  name: 'คัดกรองนักเรียนรายบุคคล', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 2,  name: 'การออกเยี่ยมบ้านนักเรียน', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 3,  name: 'SDQ/EQ / ระบบ School Health Hero', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 4,  name: 'ประชุมผู้ปกครองสัมพันธ์ (Classroom Meeting)', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 5,  name: 'ติดตามแก้ไขนักเรียนกลุ่มเสี่ยงสารเสพติด', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 6,  name: 'ติดตามแก้ไขนักเรียนกลุ่มเสี่ยงผิดระเบียบ', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 7,  name: 'การปฏิบัติหน้าที่เวรประจำวัน', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_DUTY'], weight: 10 },
  { id: 8,  name: 'การโฮมรูม / เช็คสถิติเข้าแถวหน้าเสาธง', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 },
  { id: 9,  name: 'การให้ความร่วมมือกลุ่มบริหารงานกิจการนักเรียน', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS'], weight: 10 },
  { id: 10, name: 'โรงเรียนคุณธรรม / กิจกรรมห้องเรียนสีขาว', roles: ['VICE_DIRECTOR', 'HEAD_AFFAIRS', 'HEAD_LEVEL'], weight: 10 }
];

/** จำนวนคอลัมน์คะแนนที่จองไว้ในชีทผลการประเมิน (รองรับเกณฑ์สูงสุด 20 ข้อ "ต่อชุดประเมิน") */
const MAX_CRITERIA = 20;
const CRITERIA_COL_PREFIX = 'ข้อ ';

/**
 * ==================== ชุดประเมิน (Assessment Set) ====================
 * ระบบรองรับการแยกเกณฑ์และคะแนนออกเป็น "ชุด" ได้อย่างอิสระ เช่น
 *   ชุดที่ 1 งานกิจการนักเรียน (เต็ม 20 คะแนน)
 *   ชุดที่ 2 งานวิชาการ (เต็ม 30 คะแนน)
 * แต่ละชุดมีเกณฑ์ของตัวเอง กำหนดกลุ่มผู้ประเมินและน้ำหนักของแต่ละกลุ่มได้เอง
 * และแปลงคะแนนเฉลี่ยถ่วงน้ำหนัก (เต็ม "คะแนนเต็มต่อข้อ") เป็นคะแนนที่หน่วยงานได้รับ
 */
const MAX_SETS = 20;

/** ประเภทของกลุ่มผู้ประเมินในแต่ละชุด */
const GROUP_TYPES = { ROLE: 'บทบาท', PERSON: 'รายบุคคล' };

/** ชุดประเมินเริ่มต้น — สร้างให้อัตโนมัติจากเกณฑ์เดิมเมื่ออัปเกรดระบบ */
const DEFAULT_SET = {
  id: 'SET-0001',
  name: 'การปฏิบัติงานกลุ่มบริหารงานกิจการนักเรียน',
  description: 'ชุดเกณฑ์มาตรฐานของกลุ่มบริหารงานกิจการนักเรียน',
  scaleMax: 5,
  fullMarks: 20
};

/** ค่าเริ่มต้นเมื่อสร้างชุดใหม่ */
const SET_DEFAULT_SCALE_MAX = 5;
const SET_DEFAULT_FULL_MARKS = 20;

/** ระดับผลการประเมินเริ่มต้น (ผู้ดูแลระบบปรับเกณฑ์คะแนนได้ในหน้าตั้งค่า) */
const DEFAULT_THRESHOLDS = { excellent: 4.5, great: 3.5, good: 2.5, fair: 1.5 };

/**
 * น้ำหนักของกลุ่มผู้ประเมินแต่ละกลุ่ม (หน่วยเป็น %)
 * ใช้คำนวณ "คะแนนสุทธิ" ของครูแต่ละคน โดยนำคะแนนเฉลี่ยของแต่ละกลุ่มมาถ่วงน้ำหนักรวมกัน
 * ผู้ดูแลระบบปรับได้เองในเมนู "น้ำหนักกลุ่มผู้ประเมิน"
 */
const DEFAULT_ROLE_WEIGHTS = {
  VICE_DIRECTOR: 40,
  HEAD_AFFAIRS: 30,
  HEAD_LEVEL: 20,
  HEAD_DUTY: 10
};
const RATING_LABELS = ['ดีเยี่ยม', 'ดีมาก', 'ดี', 'พอใช้', 'ปรับปรุง'];

const SCORE_MEANING = [
  { score: 5, label: 'ดีเยี่ยม',  desc: 'ปฏิบัติได้ครบถ้วนสมบูรณ์ เป็นแบบอย่างที่ดี' },
  { score: 4, label: 'ดีมาก',    desc: 'ปฏิบัติได้ครบถ้วน มีคุณภาพดี' },
  { score: 3, label: 'ดี',       desc: 'ปฏิบัติได้ตามมาตรฐาน' },
  { score: 2, label: 'พอใช้',    desc: 'ปฏิบัติได้บางส่วน ต้องปรับปรุง' },
  { score: 1, label: 'ปรับปรุง', desc: 'ปฏิบัติได้น้อย ต้องปรับปรุงอย่างเร่งด่วน' }
];

const STATUS = {
  ACTIVE: 'ใช้งาน',
  INACTIVE: 'ไม่ใช้งาน',
  NORMAL: 'ปกติ',
  CANCELLED: 'ยกเลิก'
};

/** ค่าเริ่มต้นของการตั้งค่าระบบ (เก็บในชีท "ตั้งค่าระบบ") */
const SETTING_KEYS = {
  ADMIN_HASH: 'admin_password_hash',
  ADMIN_SALT: 'admin_password_salt',
  ADMIN_ITER: 'admin_password_iterations',
  ADMIN_CHANGED: 'admin_password_changed_at',
  RECOVERY_EMAIL: 'admin_recovery_email',
  ADMIN_ALLOWED_EMAILS: 'admin_allowed_emails',
  CURRENT_YEAR: 'current_academic_year',
  CURRENT_SEMESTER: 'current_semester',
  ACADEMIC_YEARS: 'academic_years',
  SEMESTERS: 'semesters',
  USE_WEIGHTS: 'use_criteria_weights',
  ROLE_WEIGHTS: 'evaluator_role_weights',
  USE_ROLE_WEIGHTS: 'use_evaluator_role_weights',
  NORMALIZE_ROLE_WEIGHTS: 'normalize_role_weights',
  THRESHOLDS: 'rating_thresholds',
  PASSWORD_ITERATIONS: 'password_iterations',
  MAX_LOGIN_ATTEMPTS: 'max_login_attempts',
  LOCKOUT_MINUTES: 'lockout_minutes',
  SESSION_IDLE_MINUTES: 'session_idle_minutes',
  SESSION_MAX_HOURS: 'session_max_hours',
  ALLOW_REEVALUATE: 'allow_reevaluate',
  EVALUATION_OPEN: 'evaluation_open',
  EVALUATION_START: 'evaluation_start',
  EVALUATION_END: 'evaluation_end',
  LOCKED_TERMS: 'locked_terms',
  SHOW_EVALUATOR_LIST: 'login_show_evaluator_list',
  ORG_NAME: 'organization_name',
  REPORT_SIGNER: 'report_signer',
  REPORT_SIGNER_ROLE: 'report_signer_role',
  SETUP_DATE: 'setup_date',
  VERSION: 'system_version'
};

const SETTING_DEFAULTS = {
  admin_password_iterations: '4096',
  admin_recovery_email: '',
  admin_allowed_emails: '',
  current_academic_year: '',
  current_semester: '1',
  academic_years: '',
  semesters: '1,2',
  use_criteria_weights: 'ไม่',
  evaluator_role_weights: JSON.stringify(DEFAULT_ROLE_WEIGHTS),
  use_evaluator_role_weights: 'ไม่',
  normalize_role_weights: 'ใช่',
  rating_thresholds: JSON.stringify(DEFAULT_THRESHOLDS),
  password_iterations: '4096',
  max_login_attempts: '5',
  lockout_minutes: '15',
  session_idle_minutes: '120',
  session_max_hours: '8',
  allow_reevaluate: 'ใช่',
  evaluation_open: 'ใช่',
  evaluation_start: '',
  evaluation_end: '',
  locked_terms: '',
  login_show_evaluator_list: 'ใช่',
  organization_name: 'โรงเรียน',
  report_signer: '',
  report_signer_role: 'รองผู้อำนวยการฝ่ายกิจการนักเรียน',
  system_version: APP.VERSION
};

/** คำอธิบายของแต่ละคีย์ในชีทตั้งค่า (แสดงให้ผู้ดูแลระบบเข้าใจง่าย) */
const SETTING_DESCRIPTIONS = {
  admin_password_hash: 'ค่าแฮชรหัสผ่านผู้ดูแลระบบ (ห้ามแก้ไขด้วยมือ)',
  admin_password_salt: 'ค่า salt ของรหัสผ่านผู้ดูแลระบบ (ห้ามแก้ไขด้วยมือ)',
  admin_password_iterations: 'จำนวนรอบการเข้ารหัสรหัสผ่านผู้ดูแลระบบ',
  admin_password_changed_at: 'วันที่เปลี่ยนรหัสผ่านผู้ดูแลระบบล่าสุด',
  admin_recovery_email: 'อีเมลสำหรับกู้คืนรหัสผ่านผู้ดูแลระบบ (ใช้รับรหัส OTP)',
  admin_allowed_emails: 'จำกัดบัญชี Google ที่เข้าสู่ระบบผู้ดูแลได้ (คั่นด้วย , เว้นว่าง = ไม่จำกัด)',
  current_academic_year: 'ปีการศึกษาปัจจุบัน เช่น 2568',
  current_semester: 'ภาคเรียนปัจจุบัน (1 หรือ 2)',
  academic_years: 'ปีการศึกษาที่เปิดใช้งาน คั่นด้วย , เช่น 2567,2568,2569',
  semesters: 'ภาคเรียนที่เปิดใช้งาน คั่นด้วย , (1=ภาคเรียนที่ 1, 2=ภาคเรียนที่ 2, 3=ภาคฤดูร้อน)',
  use_criteria_weights: 'คิดคะแนนแบบถ่วงน้ำหนักตามคอลัมน์น้ำหนักหรือไม่ (ใช่/ไม่)',
  evaluator_role_weights: 'น้ำหนัก % ของผู้ประเมินแต่ละกลุ่ม ใช้คิดคะแนนสุทธิ (JSON)',
  use_evaluator_role_weights: 'คิดคะแนนสุทธิแบบถ่วงน้ำหนักตามกลุ่มผู้ประเมินหรือไม่ (ใช่/ไม่)',
  normalize_role_weights: 'ปรับสัดส่วนน้ำหนักอัตโนมัติเมื่อครูไม่ได้รับการประเมินจากบางกลุ่ม (ใช่/ไม่)',
  rating_thresholds: 'เกณฑ์ตัดระดับผลการประเมิน (JSON)',
  password_iterations: 'จำนวนรอบการเข้ารหัสรหัสผ่านผู้ประเมิน',
  max_login_attempts: 'จำนวนครั้งที่กรอกรหัสผ่านผิดได้ก่อนถูกล็อก',
  lockout_minutes: 'ระยะเวลาล็อกบัญชี (นาที)',
  session_idle_minutes: 'ระยะเวลาไม่มีการใช้งานก่อนออกจากระบบอัตโนมัติ (นาที)',
  session_max_hours: 'อายุสูงสุดของเซสชัน (ชั่วโมง)',
  allow_reevaluate: 'อนุญาตให้ผู้ประเมินแก้ไข/ประเมินครูคนเดิมซ้ำในภาคเรียนเดียวกันหรือไม่',
  evaluation_open: 'เปิดให้ผู้ประเมินบันทึกผลได้หรือไม่ (ไม่ = ปิดระบบประเมินชั่วคราว)',
  evaluation_start: 'วันเริ่มเปิดให้ประเมิน (yyyy-MM-dd เว้นว่าง = ไม่จำกัด)',
  evaluation_end: 'วันสุดท้ายที่ให้ประเมิน (yyyy-MM-dd เว้นว่าง = ไม่จำกัด)',
  locked_terms: 'ภาคเรียนที่ปิดการแก้ไขถาวรแล้ว คั่นด้วย , เช่น 1/2568,2/2568',
  login_show_evaluator_list: 'แสดงรายชื่อผู้ประเมินให้เลือกในหน้าเข้าสู่ระบบหรือไม่ (ไม่ = ต้องพิมพ์ชื่อเอง ปลอดภัยกว่า)',
  organization_name: 'ชื่อสถานศึกษาที่แสดงบนรายงาน',
  report_signer: 'ชื่อผู้ลงนามในรายงาน',
  report_signer_role: 'ตำแหน่งผู้ลงนามในรายงาน',
  setup_date: 'วันที่ติดตั้งระบบ',
  system_version: 'เวอร์ชันของระบบ'
};

/** โครงสร้างหัวตารางของแต่ละชีท */
const TEACHER_HEADERS = ['รหัสครู', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อ-นามสกุล', 'กลุ่มสาระ/ฝ่าย',
  'ระดับชั้นที่ปรึกษา', 'ห้องที่ปรึกษา', 'เวรประจำวัน (ค่าเริ่มต้น)', 'อีเมล', 'สถานะ', 'วันที่เพิ่ม'];

const EVALUATOR_HEADERS = ['รหัสผู้ประเมิน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อ-นามสกุล', 'บทบาท',
  'ขอบเขต (ระดับชั้น/วัน)', 'อีเมล', 'รหัสผ่าน (Hash)', 'Salt', 'รอบการเข้ารหัส', 'ต้องเปลี่ยนรหัสผ่าน',
  'สถานะ', 'เข้าสู่ระบบล่าสุด', 'จำนวนครั้งที่ผิด', 'ล็อกถึงเวลา', 'วันที่เพิ่ม'];

const CRITERIA_HEADERS = ['รหัสชุด', 'ข้อที่', 'เกณฑ์การประเมิน', 'ผู้มีสิทธิ์ประเมิน', 'น้ำหนัก (%)',
  'คำอธิบาย', 'สถานะ'];

const SET_HEADERS = ['รหัสชุด', 'ชื่อชุดประเมิน', 'คำอธิบาย', 'คะแนนเต็มต่อข้อ', 'คะแนนที่หน่วยงานได้รับ',
  'ถ่วงน้ำหนักรายข้อ', 'ถ่วงน้ำหนักกลุ่มผู้ประเมิน', 'ปรับสัดส่วนอัตโนมัติ', 'ลำดับ', 'สถานะ',
  'หมายเหตุ', 'วันที่สร้าง'];

const SET_GROUP_HEADERS = ['รหัสชุด', 'รหัสกลุ่ม', 'ชื่อกลุ่มผู้ประเมิน', 'ประเภท', 'สมาชิก',
  'น้ำหนัก (%)', 'ลำดับ', 'สถานะ'];

const ROLE_HEADERS = ['รหัสบทบาท', 'ชื่อบทบาท', 'ประเภทขอบเขต', 'ตัวเลือกขอบเขต',
  'คำอธิบาย', 'ลำดับ', 'สถานะ'];

const DUTY_HEADERS = ['รหัสรายการ', 'ปีการศึกษา', 'ภาคเรียน', 'รหัสครู', 'ชื่อ-นามสกุล', 'เวรประจำวัน',
  'บทบาทในเวร', 'จุดปฏิบัติหน้าที่', 'เวลาเริ่ม', 'เวลาสิ้นสุด', 'ระดับชั้นที่ดูแล', 'หมายเหตุ',
  'สถานะ', 'ผู้บันทึก', 'วันที่บันทึก'];

const RESULT_BASE_HEADERS = ['รหัสการประเมิน', 'วันที่บันทึก', 'ปีการศึกษา', 'ภาคเรียน',
  'รหัสชุด', 'ชุดประเมิน', 'รหัสผู้ประเมิน', 'ผู้ประเมิน', 'บทบาทผู้ประเมิน', 'กลุ่มผู้ประเมิน',
  'รหัสครู', 'ครูผู้รับการประเมิน', 'ระดับชั้น', 'เวรประจำวัน'];

const RESULT_TAIL_HEADERS = ['คะแนนรวม', 'คะแนนเต็ม', 'คะแนนเฉลี่ย', 'คะแนนเต็มต่อข้อ',
  'ระดับผลการประเมิน', 'ข้อเสนอแนะ', 'สถานะ', 'แก้ไขครั้งที่', 'แก้ไขล่าสุด'];

const ARCHIVE_EXTRA_HEADERS = ['รหัสชุดจัดเก็บ', 'ประเภทการจัดเก็บ', 'วันที่จัดเก็บ', 'ผู้จัดเก็บ', 'หมายเหตุ'];

const SUMMARY_HEADERS = ['ลำดับ', 'รหัสครู', 'ชื่อ-นามสกุล', 'ระดับชั้น', 'เวรประจำวัน', 'ปีการศึกษา', 'ภาคเรียน',
  'คะแนน รอง ผอ.', 'คะแนน หน.กิจการนักเรียน', 'คะแนน หน.ระดับชั้น', 'คะแนน หน.เวรประจำวัน',
  'คะแนนเฉลี่ยรวม', 'คะแนนสุทธิ (ถ่วงน้ำหนัก)', 'คะแนนที่หน่วยงานได้รับ', 'คะแนนเต็มที่หน่วยงานกำหนด',
  'ระดับผลการประเมิน', 'จำนวนครั้งที่ถูกประเมิน'];

const LOG_HEADERS = ['วันที่-เวลา', 'ผู้ใช้', 'บทบาท', 'การกระทำ', 'รายละเอียด', 'บัญชี Google'];

/** สร้างหัวตารางของชีทผลการประเมิน (ฐาน + คอลัมน์คะแนนรายข้อ + ท้ายตาราง) */
function resultHeaders_() {
  const scoreCols = [];
  for (let i = 1; i <= MAX_CRITERIA; i++) scoreCols.push(CRITERIA_COL_PREFIX + i);
  return RESULT_BASE_HEADERS.concat(scoreCols).concat(RESULT_TAIL_HEADERS);
}

function archiveHeaders_() {
  return resultHeaders_().concat(ARCHIVE_EXTRA_HEADERS);
}

/** ปีการศึกษาปัจจุบันโดยประมาณจากวันที่ (พ.ศ.) — ภาคเรียน 1 เริ่มพฤษภาคม */
function guessAcademicYear_() {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  return String(now.getMonth() + 1 >= 4 ? buddhistYear : buddhistYear - 1);
}

function guessSemester_() {
  const m = new Date().getMonth() + 1;
  return (m >= 5 && m <= 10) ? '1' : '2';
}
