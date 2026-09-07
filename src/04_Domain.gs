/**
 * ============================================================================
 * ไฟล์: 04_Domain.gs  |  ตรรกะหลักของระบบ
 *  - เกณฑ์การประเมิน (โหลดจากชีท แก้ไขได้โดยไม่ต้องแก้โค้ด)
 *  - การคำนวณคะแนน (รองรับถ่วงน้ำหนัก)
 *  - ปีการศึกษา/ภาคเรียน
 *  - ตารางเวรประจำวันแยกอิสระตามภาคเรียน
 * ============================================================================
 */

// ==================== เกณฑ์การประเมิน ====================

/** โหลดเกณฑ์การประเมินจากชีท (ถ้าชีทว่างจะใช้ค่าเริ่มต้นในโค้ด) */
function loadCriteria_() {
  let rows = [];
  try {
    rows = readTable_(SHEETS.CRITERIA).rows;
  } catch (e) {
    rows = [];
  }

  const list = [];
  const seen = {};
  rows.forEach(function (r) {
    const id = num_(r['ข้อที่']);
    const name = str_(r['เกณฑ์การประเมิน']);
    if (!id || !name || id > MAX_CRITERIA || id !== Math.round(id)) return;
    if (str_(r['สถานะ']) === STATUS.INACTIVE) return;
    if (seen[id]) return; // กันข้อซ้ำ ใช้แถวแรกที่พบ
    seen[id] = true;

    // อ่านรายชื่อบทบาทแบบตรงตัวก่อน (คั่นด้วย , ) แล้วจึงเทียบแบบมีคำนั้นอยู่ในข้อความเป็นทางเลือกสำรอง
    const roleText = str_(r['ผู้มีสิทธิ์ประเมิน']);
    const parts = roleText.split(/[,;|]/).map(function (x) { return x.trim(); }).filter(String);
    const roleKeys = [];
    Object.keys(ROLES).forEach(function (key) {
      const name = ROLES[key];
      const matched = parts.length ? parts.indexOf(name) !== -1 : false;
      if (matched || (!parts.length && roleText.indexOf(name) !== -1)) roleKeys.push(key);
    });
    if (!roleKeys.length && roleText) {
      Object.keys(ROLES).forEach(function (key) {
        if (roleText.indexOf(ROLES[key]) !== -1) roleKeys.push(key);
      });
    }

    list.push({
      id: id,
      name: name,
      roles: roleKeys.length ? roleKeys : Object.keys(ROLES),
      weight: num_(r['น้ำหนัก (%)']) || 10,
      description: str_(r['คำอธิบาย'])
    });
  });

  if (!list.length) {
    return DEFAULT_CRITERIA.map(function (c) {
      return { id: c.id, name: c.name, roles: c.roles, weight: c.weight, description: '' };
    });
  }
  list.sort(function (a, b) { return a.id - b.id; });
  return list;
}

/** เกณฑ์ที่บทบาทนั้นมีสิทธิ์ประเมิน */
function criteriaForRole_(roleName) {
  const key = roleKey_(roleName);
  if (!key) return [];
  return loadCriteria_().filter(function (c) { return c.roles.indexOf(key) !== -1; });
}

// ==================== การคำนวณคะแนน ====================

function ratingThresholds_() {
  try {
    const parsed = JSON.parse(str_(getSetting_(SETTING_KEYS.THRESHOLDS, JSON.stringify(DEFAULT_THRESHOLDS))));
    return {
      excellent: Number(parsed.excellent) || DEFAULT_THRESHOLDS.excellent,
      great: Number(parsed.great) || DEFAULT_THRESHOLDS.great,
      good: Number(parsed.good) || DEFAULT_THRESHOLDS.good,
      fair: Number(parsed.fair) || DEFAULT_THRESHOLDS.fair
    };
  } catch (e) {
    return DEFAULT_THRESHOLDS;
  }
}

/** แปลงคะแนนเฉลี่ยเป็นระดับผลการประเมิน */
function ratingOf_(average) {
  const t = ratingThresholds_();
  const a = Number(average) || 0;
  if (a >= t.excellent) return RATING_LABELS[0];
  if (a >= t.great) return RATING_LABELS[1];
  if (a >= t.good) return RATING_LABELS[2];
  if (a >= t.fair) return RATING_LABELS[3];
  return RATING_LABELS[4];
}

/**
 * คำนวณคะแนนจาก map {criteriaId: score}
 * นับเฉพาะข้อที่ให้คะแนนแล้ว และรองรับการถ่วงน้ำหนักตามการตั้งค่า
 */
function computeScore_(scores, criteria) {
  const list = criteria || loadCriteria_();
  const useWeights = getSettingBool_(SETTING_KEYS.USE_WEIGHTS, 'ไม่');
  let total = 0, count = 0, weightedSum = 0, weightTotal = 0;

  list.forEach(function (c) {
    const raw = scores[c.id];
    if (raw === undefined || raw === null || raw === '') return;
    const score = Number(raw);
    if (isNaN(score) || score < 1 || score > 5) return;
    total += score;
    count++;
    const w = Number(c.weight) || 0;
    weightedSum += score * w;
    weightTotal += w;
  });

  if (!count) return { total: 0, max: 0, average: 0, rating: '', count: 0 };

  const average = (useWeights && weightTotal > 0) ? (weightedSum / weightTotal) : (total / count);
  const rounded = Math.round(average * 100) / 100;
  return {
    total: total,
    max: count * 5,
    average: rounded,
    rating: ratingOf_(rounded),
    count: count
  };
}

// ==================== น้ำหนักของกลุ่มผู้ประเมิน (คะแนนสุทธิ) ====================

/** อ่านน้ำหนัก % ของแต่ละกลุ่มผู้ประเมินจากการตั้งค่า */
function roleWeights_() {
  const weights = {};
  Object.keys(DEFAULT_ROLE_WEIGHTS).forEach(function (k) { weights[k] = DEFAULT_ROLE_WEIGHTS[k]; });
  try {
    const parsed = JSON.parse(str_(getSetting_(SETTING_KEYS.ROLE_WEIGHTS, JSON.stringify(DEFAULT_ROLE_WEIGHTS))));
    Object.keys(weights).forEach(function (k) {
      const v = Number(parsed[k]);
      if (!isNaN(v) && v >= 0) weights[k] = v;
    });
  } catch (e) { /* ใช้ค่าเริ่มต้นเมื่อข้อมูลเสียหาย */ }
  return weights;
}

function useRoleWeights_() {
  return getSettingBool_(SETTING_KEYS.USE_ROLE_WEIGHTS, 'ไม่');
}

function normalizeRoleWeights_() {
  return getSettingBool_(SETTING_KEYS.NORMALIZE_ROLE_WEIGHTS, 'ใช่');
}

/**
 * คำนวณ "คะแนนสุทธิ" ของครู 1 คน จากคะแนนเฉลี่ยของแต่ละกลุ่มผู้ประเมิน
 *
 *   คะแนนสุทธิ = ผลรวมของ (คะแนนเฉลี่ยของกลุ่ม × น้ำหนักของกลุ่ม) ÷ ผลรวมน้ำหนักที่ใช้จริง
 *
 * - ถ้าเปิด "ปรับสัดส่วนอัตโนมัติ" จะหารด้วยผลรวมน้ำหนักเฉพาะกลุ่มที่มีการประเมินจริง
 *   (ครูที่ขาดการประเมินจากบางกลุ่มจึงไม่เสียเปรียบ)
 * - ถ้าปิด จะหารด้วยผลรวมน้ำหนักทั้งหมด (กลุ่มที่ไม่มีคะแนนถือเป็น 0)
 *
 * @param {Object} averagesByRoleKey เช่น {VICE_DIRECTOR: 4.5, HEAD_LEVEL: 4.0}
 * @return {{net: number, rating: string, totalWeight: number, usedWeight: number,
 *           breakdown: Array, enabled: boolean}}
 */
function computeNetScore_(averagesByRoleKey, options) {
  const o = options || {};
  const weights = o.weights || roleWeights_();
  const normalize = (o.normalize === undefined) ? normalizeRoleWeights_() : !!o.normalize;

  let weightedSum = 0, usedWeight = 0, totalWeight = 0;
  const breakdown = [];

  Object.keys(ROLES).forEach(function (key) {
    const weight = Number(weights[key]) || 0;
    totalWeight += weight;
    const average = averagesByRoleKey[key];
    const hasScore = (average !== null && average !== undefined && !isNaN(average));
    if (hasScore && weight > 0) {
      weightedSum += Number(average) * weight;
      usedWeight += weight;
    }
    breakdown.push({
      key: key,
      role: ROLES[key],
      weight: weight,
      average: hasScore ? Number(average) : null,
      counted: hasScore && weight > 0
    });
  });

  const divisor = normalize ? usedWeight : totalWeight;
  const net = divisor > 0 ? Math.round((weightedSum / divisor) * 100) / 100 : 0;

  // เติมสัดส่วนที่ใช้จริงของแต่ละกลุ่ม เพื่อให้แสดงที่มาของคะแนนได้
  breakdown.forEach(function (b) {
    b.effectiveWeight = (divisor > 0 && b.counted)
      ? Math.round((b.weight / divisor) * 1000) / 10
      : 0;
    b.contribution = b.counted && divisor > 0
      ? Math.round((b.average * b.weight / divisor) * 100) / 100
      : 0;
  });

  return {
    net: net,
    rating: ratingOf_(net),
    totalWeight: totalWeight,
    usedWeight: usedWeight,
    normalized: normalize,
    breakdown: breakdown,
    enabled: true
  };
}

// ==================== ปีการศึกษา / ภาคเรียน ====================

function academicYears_() {
  const raw = str_(getSetting_(SETTING_KEYS.ACADEMIC_YEARS, ''));
  let years = raw.split(',').map(function (y) { return y.trim(); }).filter(String);
  if (!years.length) years = [guessAcademicYear_()];

  // รวมปีที่ปรากฏในข้อมูลจริงเข้าไปด้วย เพื่อให้ค้นย้อนหลังได้เสมอ
  try {
    readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
      const y = str_(r['ปีการศึกษา']);
      if (y && years.indexOf(y) === -1) years.push(y);
    });
  } catch (e) { /* ไม่มีชีทผลการประเมิน */ }

  years.sort(function (a, b) { return Number(b) - Number(a); });
  return years;
}

/** ภาคเรียนที่เปิดใช้งาน (ตั้งค่าได้อย่างอิสระ) */
function semesterList_() {
  const raw = str_(getSetting_(SETTING_KEYS.SEMESTERS, DEFAULT_SEMESTERS.join(',')));
  const allowed = ALL_SEMESTERS.map(function (s) { return s.value; });
  const list = raw.split(',').map(function (v) { return v.trim(); })
    .filter(function (v) { return allowed.indexOf(v) !== -1; });
  return list.length ? list : DEFAULT_SEMESTERS.slice();
}

/** ชื่อภาคเรียนที่อ่านง่าย */
function semesterLabel_(value) {
  const found = ALL_SEMESTERS.filter(function (s) { return s.value === String(value); })[0];
  return found ? found.label : 'ภาคเรียนที่ ' + value;
}

/** รายการภาคเรียนพร้อมสถานะเปิด/ปิด สำหรับหน้าตั้งค่า */
function semesterOptions_() {
  const enabled = semesterList_();
  return ALL_SEMESTERS.map(function (s) {
    return { value: s.value, label: s.label, enabled: enabled.indexOf(s.value) !== -1 };
  });
}

function currentTerm_() {
  return {
    year: str_(getSetting_(SETTING_KEYS.CURRENT_YEAR, guessAcademicYear_())),
    semester: str_(getSetting_(SETTING_KEYS.CURRENT_SEMESTER, guessSemester_()))
  };
}

function termLabel_(year, semester) {
  return semesterLabel_(semester) + '/' + year;
}

// ==================== ตารางเวรประจำวันรายภาคเรียน ====================

/**
 * อ่านตารางเวรของภาคเรียนที่ระบุ — ข้อมูลของแต่ละภาคเรียนแยกกันอย่างสมบูรณ์
 * @return {{byTeacherId: Object, byTeacherName: Object, rows: Array}}
 */
function dutyRosterFor_(year, semester) {
  const rows = readTable_(SHEETS.DUTY).rows.filter(function (r) {
    return str_(r['ปีการศึกษา']) === String(year)
      && str_(r['ภาคเรียน']) === String(semester)
      && str_(r['สถานะ']) !== STATUS.INACTIVE;
  });

  const byTeacherId = {}, byTeacherName = {};
  const list = rows.map(function (r) {
    const item = {
      id: str_(r['รหัสรายการ']),
      year: str_(r['ปีการศึกษา']),
      semester: str_(r['ภาคเรียน']),
      teacherId: str_(r['รหัสครู']),
      teacherName: str_(r['ชื่อ-นามสกุล']),
      day: str_(r['เวรประจำวัน']),
      position: str_(r['บทบาทในเวร']),
      location: str_(r['จุดปฏิบัติหน้าที่']),
      startTime: str_(r['เวลาเริ่ม']),
      endTime: str_(r['เวลาสิ้นสุด']),
      level: str_(r['ระดับชั้นที่ดูแล']),
      note: str_(r['หมายเหตุ']),
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      updatedBy: str_(r['ผู้บันทึก']),
      updatedAt: formatDate_(r['วันที่บันทึก']),
      _row: r._row
    };
    if (item.teacherId) byTeacherId[item.teacherId] = item;
    if (item.teacherName) byTeacherName[item.teacherName] = item;
    return item;
  });

  return { byTeacherId: byTeacherId, byTeacherName: byTeacherName, rows: list };
}

/** เวรประจำวันของครูในภาคเรียนที่ระบุ (ถ้าไม่มีในตารางเวร จะใช้ค่าเริ่มต้นจากทะเบียนครู) */
function dutyOfTeacher_(teacher, roster) {
  const entry = (teacher.id && roster.byTeacherId[teacher.id]) || roster.byTeacherName[teacher.name];
  if (entry) return entry;
  return {
    day: teacher.defaultDay || '',
    position: '',
    location: '',
    startTime: '',
    endTime: '',
    level: teacher.level || '',
    note: '',
    fallback: true
  };
}

/** รายชื่อครูที่ยังใช้งานอยู่ พร้อมข้อมูลเวรของภาคเรียนที่เลือก */
function teachersWithDuty_(year, semester, includeInactive) {
  const index = buildTeacherIndex_();
  const roster = dutyRosterFor_(year, semester);
  const out = [];

  index.list.forEach(function (r) {
    const teacher = {
      id: str_(r['รหัสครู']),
      name: str_(r['ชื่อ-นามสกุล']),
      level: str_(r['ระดับชั้นที่ปรึกษา']),
      room: str_(r['ห้องที่ปรึกษา']),
      department: str_(r['กลุ่มสาระ/ฝ่าย']),
      email: str_(r['อีเมล']),
      defaultDay: str_(r['เวรประจำวัน (ค่าเริ่มต้น)']),
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      _row: r._row
    };
    if (!teacher.name) return;
    if (!includeInactive && teacher.status === STATUS.INACTIVE) return;

    const duty = dutyOfTeacher_(teacher, roster);
    teacher.dutyDay = duty.day;
    teacher.dutyPosition = duty.position;
    teacher.dutyLocation = duty.location;
    teacher.dutyTime = duty.startTime && duty.endTime ? (duty.startTime + ' - ' + duty.endTime) : '';
    teacher.dutyLevel = duty.level;
    teacher.dutyNote = duty.note;
    teacher.dutyFromRoster = !duty.fallback;
    out.push(teacher);
  });

  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}

/**
 * ครูที่ผู้ประเมินคนนี้มีสิทธิ์ประเมินในภาคเรียนที่เลือก
 * - รอง ผอ. / หัวหน้ากลุ่มกิจการนักเรียน: ประเมินได้ทุกคน
 * - หัวหน้าระดับชั้น: เฉพาะครูในระดับชั้นที่รับผิดชอบ
 * - หัวหน้าเวรประจำวัน: เฉพาะครูที่อยู่เวรวันเดียวกัน "ตามตารางเวรของภาคเรียนนั้น"
 * @param {Array} [precomputed] รายชื่อครูพร้อมข้อมูลเวรที่คำนวณไว้แล้ว (ใช้เมื่อเรียกซ้ำหลายรอบ)
 */
function teachersForEvaluator_(role, scope, year, semester, precomputed) {
  const all = precomputed || teachersWithDuty_(year, semester, false);
  if (role === ROLES.VICE_DIRECTOR || role === ROLES.HEAD_AFFAIRS) return all;
  if (role === ROLES.HEAD_LEVEL) {
    return all.filter(function (t) { return t.level === scope; });
  }
  if (role === ROLES.HEAD_DUTY) {
    return all.filter(function (t) { return t.dutyDay === scope; });
  }
  return [];
}
