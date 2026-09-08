/**
 * ============================================================================
 * ไฟล์: 07_EvaluatorApi.gs  |  ฟังก์ชันสำหรับผู้ประเมิน
 * ผู้ประเมินเห็นเฉพาะครูและเกณฑ์ตามสิทธิ์ของตนเองเท่านั้น
 * ============================================================================
 */

/** ข้อมูลตั้งต้นของหน้าประเมิน: ชุดประเมิน, ภาคเรียน, เกณฑ์, รายชื่อครู, สถานะการประเมิน */
function apiEvaluatorContext(token, year, semester, setId) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;

    // ชุดประเมินที่ผู้ประเมินคนนี้ได้รับมอบหมาย (กำหนดได้อิสระในหน้า "ชุดประเมิน")
    const assignments = setsForEvaluator_(session);
    if (!assignments.length) {
      return fail_('ยังไม่ได้กำหนดให้ท่านเป็นผู้ประเมินในชุดประเมินใด กรุณาติดต่อผู้ดูแลระบบ');
    }
    const wanted = str_(setId);
    const current = assignments.filter(function (a) { return a.set.id === wanted; })[0] || assignments[0];

    const teachers = teachersForEvaluator_(session.role, session.scope, y, s);
    const criteria = criteriaForGroup_(current.set.id, current.group.key);

    // ครูที่ผู้ประเมินคนนี้ประเมินไปแล้วในภาคเรียนนี้ (แยกตามชุดประเมิน)
    const done = {};
    const doneCountBySet = {};
    const mainSetId = defaultSetId_();
    readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
      if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
      if (str_(r['ปีการศึกษา']) !== y || str_(r['ภาคเรียน']) !== s) return;
      if (str_(r['ผู้ประเมิน']) !== session.name) return;
      const rowSet = str_(r['รหัสชุด']) || mainSetId;
      doneCountBySet[rowSet] = (doneCountBySet[rowSet] || 0) + 1;
      if (rowSet !== current.set.id) return;
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
      semesters: semesterList_(),
      year: y,
      semester: s,
      currentYear: term.year,
      currentSemester: term.semester,
      teachers: teachers,
      criteria: criteria,
      scoreMeaning: scaleMeaning_(current.set.scaleMax),
      completed: done,
      // ---- ชุดประเมิน ----
      sets: assignments.map(function (a) {
        return {
          id: a.set.id, name: a.set.name, description: a.set.description,
          scaleMax: a.set.scaleMax, fullMarks: a.set.fullMarks,
          group: a.group.name, groupKey: a.group.key,
          criteriaCount: criteriaForGroup_(a.set.id, a.group.key).length,
          completed: doneCountBySet[a.set.id] || 0
        };
      }),
      setId: current.set.id,
      setName: current.set.name,
      setDescription: current.set.description,
      scaleMax: current.set.scaleMax,
      fullMarks: current.set.fullMarks,
      groupName: current.group.name,
      window: evaluationWindow_(y, s),
      allowReevaluate: getSettingBool_(SETTING_KEYS.ALLOW_REEVALUATE, 'ใช่'),
      mustChangePassword: !!session.mustChangePassword
    });
  });
}

/** ตรวจความถูกต้องของคะแนนที่ส่งมา */
function validateScores_(scores, allowedCriteria, scaleMax) {
  const clean = {};
  const max = Number(scaleMax) || SET_DEFAULT_SCALE_MAX;
  const allowedIds = allowedCriteria.map(function (c) { return c.id; });
  Object.keys(scores || {}).forEach(function (key) {
    const id = num_(key);
    if (allowedIds.indexOf(id) === -1) return; // ตัดข้อที่ไม่มีสิทธิ์ประเมินทิ้ง
    const v = scores[key];
    if (v === '' || v === null || v === undefined) return;
    const score = num_(v);
    if (score < 1 || score > max || score !== Math.round(score)) {
      throw new Error('คะแนนต้องเป็นจำนวนเต็ม 1-' + max + ' เท่านั้น');
    }
    clean[id] = score;
  });
  return clean;
}

/** ค้นหาผลการประเมินเดิมของคู่ (ผู้ประเมิน × ครู × ชุดประเมิน × ภาคเรียน) */
function findExistingResult_(evaluatorName, teacherKey, year, semester, setId) {
  const rows = readTable_(SHEETS.RESULTS).rows;
  const mainSetId = defaultSetId_();
  const wanted = str_(setId) || mainSetId;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (str_(r['สถานะ']) === STATUS.CANCELLED) continue;
    if (str_(r['ผู้ประเมิน']) !== evaluatorName) continue;
    if (str_(r['ปีการศึกษา']) !== String(year) || str_(r['ภาคเรียน']) !== String(semester)) continue;
    if ((str_(r['รหัสชุด']) || mainSetId) !== wanted) continue;
    const key = str_(r['รหัสครู']) || str_(r['ครูผู้รับการประเมิน']);
    if (key === String(teacherKey)) return r;
  }
  return null;
}

/**
 * บันทึกผลการประเมิน
 * ถ้าเคยประเมินครูคนนี้ในชุด/ภาคเรียนนี้แล้ว ระบบจะเก็บฉบับเดิมเข้าคลังข้อมูล
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

    // ช่วงเวลาที่เปิดให้ประเมิน (ตรวจฝั่งเซิร์ฟเวอร์เสมอ)
    const windowInfo = evaluationWindow_(year, semester);
    if (!windowInfo.open) return fail_(windowInfo.reason || 'ขณะนี้ยังไม่เปิดให้บันทึกผลการประเมิน');

    // ตรวจสิทธิ์ในชุดประเมินที่เลือก (ห้ามเชื่อข้อมูลจากหน้าเว็บ)
    const assignments = setsForEvaluator_(session);
    const wanted = str_(data.setId);
    const current = wanted
      ? assignments.filter(function (a) { return a.set.id === wanted; })[0]
      : assignments[0];
    if (!current) return fail_('ท่านไม่มีสิทธิ์ประเมินในชุดประเมินที่เลือก');
    const set = current.set;

    // ตรวจสิทธิ์ประเมินครูคนนี้อีกครั้งฝั่งเซิร์ฟเวอร์
    const allowedTeachers = teachersForEvaluator_(session.role, session.scope, year, semester);
    let teacher = null;
    allowedTeachers.forEach(function (t) { if (t.id === teacherId) teacher = t; });
    if (!teacher) return fail_('ท่านไม่มีสิทธิ์ประเมินครูท่านนี้ในภาคเรียนที่เลือก');

    const criteria = criteriaForGroup_(set.id, current.group.key);
    if (!criteria.length) return fail_('ไม่พบเกณฑ์การประเมินสำหรับกลุ่มของท่านในชุด "' + set.name + '"');

    const scores = validateScores_(data.scores, criteria, set.scaleMax);
    if (Object.keys(scores).length < criteria.length) {
      return fail_('กรุณาให้คะแนนให้ครบทุกข้อ (' + Object.keys(scores).length + '/' + criteria.length + ')');
    }

    const comment = str_(data.comment).substring(0, 1000);
    const calc = computeScore_(scores, criteria, {
      scaleMax: set.scaleMax,
      useWeights: set.useCriteriaWeights
    });

    return withLock_(function () {
      const existing = findExistingResult_(session.name, teacherId, year, semester, set.id);
      if (existing && !getSettingBool_(SETTING_KEYS.ALLOW_REEVALUATE, 'ใช่')) {
        return fail_('ท่านได้ประเมินครูท่านนี้ในภาคเรียนนี้แล้ว และระบบไม่อนุญาตให้แก้ไข');
      }

      const record = {
        'ปีการศึกษา': year,
        'ภาคเรียน': semester,
        'รหัสชุด': set.id,
        'ชุดประเมิน': set.name,
        'วันที่บันทึก': new Date(),
        'รหัสผู้ประเมิน': session.id,
        'ผู้ประเมิน': session.name,
        'บทบาทผู้ประเมิน': session.role,
        'กลุ่มผู้ประเมิน': current.group.key,
        'รหัสครู': teacher.id,
        'ครูผู้รับการประเมิน': teacher.name,
        'ระดับชั้น': teacher.level,
        'เวรประจำวัน': teacher.dutyDay,
        'คะแนนรวม': calc.total,
        'คะแนนเต็ม': calc.max,
        'คะแนนเฉลี่ย': calc.average,
        'คะแนนเต็มต่อข้อ': set.scaleMax,
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
          teacher.name + ' | ' + set.name + ' | ' + termLabel_(year, semester) + ' | เฉลี่ย ' + calc.average);
      } else {
        record['รหัสการประเมิน'] = nextCodeFromSheet_(SHEETS.RESULTS, 'รหัสการประเมิน', 'EVR');
        record['แก้ไขครั้งที่'] = 0;
        appendRecord_(SHEETS.RESULTS, record);
        message = 'บันทึกผลการประเมินเรียบร้อย';
        logAction_(session.name, 'evaluator', 'บันทึกผลการประเมิน',
          teacher.name + ' | ' + set.name + ' | ' + termLabel_(year, semester) + ' | เฉลี่ย ' + calc.average);
      }

      return ok_({
        teacher: teacher.name,
        setId: set.id,
        setName: set.name,
        average: calc.average,
        scaleMax: set.scaleMax,
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
        setId: str_(r['รหัสชุด']),
        setName: str_(r['ชุดประเมิน']),
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

    const setId = str_(target['รหัสชุด']) || defaultSetId_();
    const scores = {};
    loadCriteria_(setId).forEach(function (c) {
      const v = target[CRITERIA_COL_PREFIX + c.id];
      if (v !== '' && v !== null && v !== undefined) scores[c.id] = num_(v);
    });

    return ok_({
      id: str_(target['รหัสการประเมิน']),
      year: str_(target['ปีการศึกษา']),
      semester: str_(target['ภาคเรียน']),
      setId: setId,
      setName: str_(target['ชุดประเมิน']),
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
