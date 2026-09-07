/**
 * ============================================================================
 * ไฟล์: 07_EvaluatorApi.gs  |  ฟังก์ชันสำหรับผู้ประเมิน
 * ผู้ประเมินเห็นเฉพาะครูและเกณฑ์ตามสิทธิ์ของตนเองเท่านั้น
 * ============================================================================
 */

/** ข้อมูลตั้งต้นของหน้าประเมิน: ภาคเรียน, เกณฑ์, รายชื่อครู, สถานะการประเมิน */
function apiEvaluatorContext(token, year, semester) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;

    const teachers = teachersForEvaluator_(session.role, session.scope, y, s);
    const criteria = criteriaForRole_(session.role);

    // ครูที่ผู้ประเมินคนนี้ประเมินไปแล้วในภาคเรียนนี้
    const done = {};
    readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
      if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
      if (str_(r['ปีการศึกษา']) !== y || str_(r['ภาคเรียน']) !== s) return;
      if (str_(r['ผู้ประเมิน']) !== session.name) return;
      const key = str_(r['รหัสครู']) || str_(r['ครูผู้รับการประเมิน']);
      done[key] = {
        id: str_(r['รหัสการประเมิน']),
        average: num_(r['คะแนนเฉลี่ย']),
        rating: str_(r['ระดับผลการประเมิน']),
        savedAt: formatDate_(r['วันที่บันทึก'])
      };
    });

    return ok_({
      evaluator: { id: session.id, name: session.name, role: session.role, scope: session.scope },
      years: academicYears_(),
      semesters: SEMESTERS,
      year: y,
      semester: s,
      currentYear: term.year,
      currentSemester: term.semester,
      teachers: teachers,
      criteria: criteria,
      scoreMeaning: SCORE_MEANING,
      completed: done,
      allowReevaluate: getSettingBool_(SETTING_KEYS.ALLOW_REEVALUATE, 'ใช่'),
      mustChangePassword: !!session.mustChangePassword
    });
  });
}

/** ตรวจความถูกต้องของคะแนนที่ส่งมา */
function validateScores_(scores, allowedCriteria) {
  const clean = {};
  const allowedIds = allowedCriteria.map(function (c) { return c.id; });
  Object.keys(scores || {}).forEach(function (key) {
    const id = num_(key);
    if (allowedIds.indexOf(id) === -1) return; // ตัดข้อที่ไม่มีสิทธิ์ประเมินทิ้ง
    const v = scores[key];
    if (v === '' || v === null || v === undefined) return;
    const score = num_(v);
    if (score < 1 || score > 5 || score !== Math.round(score)) {
      throw new Error('คะแนนต้องเป็นจำนวนเต็ม 1-5 เท่านั้น');
    }
    clean[id] = score;
  });
  return clean;
}

/** ค้นหาผลการประเมินเดิมของคู่ (ผู้ประเมิน × ครู × ภาคเรียน) */
function findExistingResult_(evaluatorName, teacherKey, year, semester) {
  const rows = readTable_(SHEETS.RESULTS).rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (str_(r['สถานะ']) === STATUS.CANCELLED) continue;
    if (str_(r['ผู้ประเมิน']) !== evaluatorName) continue;
    if (str_(r['ปีการศึกษา']) !== String(year) || str_(r['ภาคเรียน']) !== String(semester)) continue;
    const key = str_(r['รหัสครู']) || str_(r['ครูผู้รับการประเมิน']);
    if (key === String(teacherKey)) return r;
  }
  return null;
}

/**
 * บันทึกผลการประเมิน
 * ถ้าเคยประเมินครูคนนี้ในภาคเรียนนี้แล้ว ระบบจะเก็บฉบับเดิมเข้าคลังข้อมูล
 * แล้วจึงบันทึกทับ เพื่อให้ยังตรวจสอบย้อนหลังได้ว่าเคยให้คะแนนอะไรไว้
 */
function apiSubmitEvaluation(token, payload) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const data = payload || {};

    const year = str_(data.year);
    const semester = str_(data.semester);
    const teacherId = str_(data.teacherId);
    if (!year || !semester) return fail_('กรุณาเลือกปีการศึกษาและภาคเรียน');
    if (!teacherId) return fail_('กรุณาเลือกครูผู้รับการประเมิน');

    // ตรวจสิทธิ์อีกครั้งฝั่งเซิร์ฟเวอร์ (ห้ามเชื่อข้อมูลจากหน้าเว็บ)
    const allowedTeachers = teachersForEvaluator_(session.role, session.scope, year, semester);
    let teacher = null;
    allowedTeachers.forEach(function (t) { if (t.id === teacherId) teacher = t; });
    if (!teacher) return fail_('ท่านไม่มีสิทธิ์ประเมินครูท่านนี้ในภาคเรียนที่เลือก');

    const criteria = criteriaForRole_(session.role);
    if (!criteria.length) return fail_('ไม่พบเกณฑ์การประเมินสำหรับบทบาทของท่าน');

    const scores = validateScores_(data.scores, criteria);
    if (Object.keys(scores).length < criteria.length) {
      return fail_('กรุณาให้คะแนนให้ครบทุกข้อ (' + Object.keys(scores).length + '/' + criteria.length + ')');
    }

    const comment = str_(data.comment).substring(0, 1000);
    const calc = computeScore_(scores, criteria);

    return withLock_(function () {
      const existing = findExistingResult_(session.name, teacherId, year, semester);
      if (existing && !getSettingBool_(SETTING_KEYS.ALLOW_REEVALUATE, 'ใช่')) {
        return fail_('ท่านได้ประเมินครูท่านนี้ในภาคเรียนนี้แล้ว และระบบไม่อนุญาตให้แก้ไข');
      }

      const record = {
        'ปีการศึกษา': year,
        'ภาคเรียน': semester,
        'วันที่บันทึก': new Date(),
        'รหัสผู้ประเมิน': session.id,
        'ผู้ประเมิน': session.name,
        'บทบาทผู้ประเมิน': session.role,
        'รหัสครู': teacher.id,
        'ครูผู้รับการประเมิน': teacher.name,
        'ระดับชั้น': teacher.level,
        'เวรประจำวัน': teacher.dutyDay,
        'คะแนนรวม': calc.total,
        'คะแนนเต็ม': calc.max,
        'คะแนนเฉลี่ย': calc.average,
        'ระดับผลการประเมิน': calc.rating,
        'ข้อเสนอแนะ': comment,
        'สถานะ': STATUS.NORMAL,
        'แก้ไขล่าสุด': new Date()
      };
      criteria.forEach(function (c) {
        record[CRITERIA_COL_PREFIX + c.id] = scores[c.id] !== undefined ? scores[c.id] : '';
      });

      let message;
      if (existing) {
        // เก็บฉบับเดิมไว้ในคลังก่อนบันทึกทับ
        archiveResultRow_(existing, 'ฉบับแก้ไข', 'บันทึกทับโดย ' + session.name, session.name);
        record['รหัสการประเมิน'] = str_(existing['รหัสการประเมิน']);
        record['แก้ไขครั้งที่'] = num_(existing['แก้ไขครั้งที่']) + 1;
        updateRecord_(SHEETS.RESULTS, existing._row, record);
        message = 'แก้ไขผลการประเมินเรียบร้อย (เก็บฉบับเดิมไว้ในคลังข้อมูลแล้ว)';
        logAction_(session.name, 'evaluator', 'แก้ไขผลการประเมิน',
          teacher.name + ' | ' + termLabel_(year, semester) + ' | เฉลี่ย ' + calc.average);
      } else {
        const ids = readTable_(SHEETS.RESULTS).rows.map(function (r) { return str_(r['รหัสการประเมิน']); });
        record['รหัสการประเมิน'] = nextCode_('EVR', ids);
        record['แก้ไขครั้งที่'] = 0;
        appendRecord_(SHEETS.RESULTS, record);
        message = 'บันทึกผลการประเมินเรียบร้อย';
        logAction_(session.name, 'evaluator', 'บันทึกผลการประเมิน',
          teacher.name + ' | ' + termLabel_(year, semester) + ' | เฉลี่ย ' + calc.average);
      }

      return ok_({
        teacher: teacher.name,
        average: calc.average,
        rating: calc.rating,
        isUpdate: !!existing
      }, message);
    });
  });
}

/** ประวัติการประเมินของผู้ประเมินคนนี้ */
function apiMyEvaluations(token, year, semester) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const y = str_(year);
    const s = str_(semester);

    const rows = readTable_(SHEETS.RESULTS).rows.filter(function (r) {
      if (str_(r['ผู้ประเมิน']) !== session.name) return false;
      if (y && str_(r['ปีการศึกษา']) !== y) return false;
      if (s && str_(r['ภาคเรียน']) !== s) return false;
      return true;
    }).map(function (r) {
      return {
        id: str_(r['รหัสการประเมิน']),
        year: str_(r['ปีการศึกษา']),
        semester: str_(r['ภาคเรียน']),
        teacherId: str_(r['รหัสครู']),
        teacher: str_(r['ครูผู้รับการประเมิน']),
        level: str_(r['ระดับชั้น']),
        dutyDay: str_(r['เวรประจำวัน']),
        average: num_(r['คะแนนเฉลี่ย']),
        rating: str_(r['ระดับผลการประเมิน']),
        comment: str_(r['ข้อเสนอแนะ']),
        revision: num_(r['แก้ไขครั้งที่']),
        status: str_(r['สถานะ']) || STATUS.NORMAL,
        savedAt: formatDate_(r['วันที่บันทึก'])
      };
    });

    rows.sort(function (a, b) { return b.savedAt.localeCompare(a.savedAt); });
    return ok_(rows);
  });
}

/** ดึงผลการประเมินเดิมมาแก้ไข */
function apiGetMyEvaluation(token, evaluationId) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const rows = readTable_(SHEETS.RESULTS).rows;
    let target = null;
    rows.forEach(function (r) {
      if (str_(r['รหัสการประเมิน']) === str_(evaluationId) && str_(r['ผู้ประเมิน']) === session.name) target = r;
    });
    if (!target) return fail_('ไม่พบผลการประเมิน หรือท่านไม่มีสิทธิ์เข้าถึง');

    const scores = {};
    loadCriteria_().forEach(function (c) {
      const v = target[CRITERIA_COL_PREFIX + c.id];
      if (v !== '' && v !== null && v !== undefined) scores[c.id] = num_(v);
    });

    return ok_({
      id: str_(target['รหัสการประเมิน']),
      year: str_(target['ปีการศึกษา']),
      semester: str_(target['ภาคเรียน']),
      teacherId: str_(target['รหัสครู']),
      teacher: str_(target['ครูผู้รับการประเมิน']),
      scores: scores,
      comment: str_(target['ข้อเสนอแนะ']),
      revision: num_(target['แก้ไขครั้งที่'])
    });
  });
}

/** ตารางเวรของภาคเรียนที่เลือก เฉพาะส่วนที่ผู้ประเมินเกี่ยวข้อง (ใช้ประกอบการประเมินข้อเวรประจำวัน) */
function apiEvaluatorDutyView(token, year, semester) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const roster = dutyRosterFor_(str_(year), str_(semester));
    let rows = roster.rows;
    if (session.role === ROLES.HEAD_DUTY) {
      rows = rows.filter(function (r) { return r.day === session.scope; });
    }
    rows.sort(function (a, b) {
      const d = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
      return d !== 0 ? d : a.teacherName.localeCompare(b.teacherName, 'th');
    });
    return ok_(rows);
  });
}
