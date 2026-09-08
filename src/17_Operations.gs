/**
 * ============================================================================
 * ไฟล์: 17_Operations.gs  |  งานบริหารจัดการรอบการประเมิน (Operations)
 *
 * ฟังก์ชันที่ทำให้การประเมินเดินเป็นระบบแบบมืออาชีพ
 *   1. ติดตามความคืบหน้า  — ใครประเมินครบแล้ว ใครยังค้าง แยกตามชุดประเมิน
 *   2. แจ้งเตือนทางอีเมล   — ส่งเตือนเฉพาะผู้ประเมินที่ยังทำไม่ครบ
 *   3. ตรวจคุณภาพการประเมิน — จับพฤติกรรมให้คะแนนที่ผิดปกติก่อนสรุปผล
 *   4. เปิด/ปิดรอบการประเมิน — กำหนดช่วงเวลา และล็อกภาคเรียนที่สรุปผลแล้ว
 * ============================================================================
 */

// ==================== 1. ความคืบหน้าการประเมิน ====================

/**
 * ความคืบหน้าของผู้ประเมินแต่ละคน แยกตามชุดประเมินที่ได้รับมอบหมาย
 * @return {Array} [{id, name, role, scope, email, done, total, percent, sets:[...]}]
 */
function evaluationProgress_(year, semester) {
  const y = String(year), s = String(semester);
  const evaluators = readTable_(SHEETS.EVALUATORS).rows.filter(function (r) {
    return str_(r['ชื่อ-นามสกุล']) && str_(r['สถานะ']) !== STATUS.INACTIVE;
  });

  const mainSetId = defaultSetId_();
  const doneByKey = {};   // "ชื่อผู้ประเมิน|รหัสชุด" → จำนวนครูที่ประเมินแล้ว
  readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
    if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
    if (str_(r['ปีการศึกษา']) !== y || str_(r['ภาคเรียน']) !== s) return;
    const key = str_(r['ผู้ประเมิน']) + '|' + (str_(r['รหัสชุด']) || mainSetId);
    doneByKey[key] = (doneByKey[key] || 0) + 1;
  });

  const allTeachers = teachersWithDuty_(y, s, false);

  return evaluators.map(function (r) {
    const evaluator = {
      id: str_(r['รหัสผู้ประเมิน']),
      name: str_(r['ชื่อ-นามสกุล']),
      role: str_(r['บทบาท']),
      scope: str_(r['ขอบเขต (ระดับชั้น/วัน)']),
      email: str_(r['อีเมล'])
    };
    const scopeTotal = teachersForEvaluator_(evaluator.role, evaluator.scope, y, s, allTeachers).length;

    const sets = setsForEvaluator_(evaluator).map(function (a) {
      const done = Math.min(doneByKey[evaluator.name + '|' + a.set.id] || 0, scopeTotal);
      return {
        setId: a.set.id,
        setName: a.set.name,
        group: a.group.name,
        done: done,
        total: scopeTotal,
        percent: scopeTotal ? Math.round(done / scopeTotal * 100) : 0,
        remaining: Math.max(scopeTotal - done, 0)
      };
    });

    const done = sets.reduce(function (a, b) { return a + b.done; }, 0);
    const total = sets.reduce(function (a, b) { return a + b.total; }, 0);
    return {
      id: evaluator.id,
      name: evaluator.name,
      role: evaluator.role,
      scope: evaluator.scope,
      email: evaluator.email,
      hasEmail: !!evaluator.email,
      sets: sets,
      done: done,
      total: total,
      remaining: Math.max(total - done, 0),
      percent: total ? Math.round(done / total * 100) : 0
    };
  }).sort(function (a, b) { return a.percent - b.percent; });
}

/** หน้า "ติดตามความคืบหน้า" — ภาพรวมของทั้งรอบการประเมิน */
function apiEvaluationProgress(token, year, semester) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;

    const rows = evaluationProgress_(y, s);
    const done = rows.reduce(function (a, b) { return a + b.done; }, 0);
    const total = rows.reduce(function (a, b) { return a + b.total; }, 0);

    // ความครบถ้วนของครูแต่ละคน: ได้รับการประเมินจากกลุ่มที่มีน้ำหนักครบหรือยัง
    const summary = buildSummaryRows_({ year: y, semester: s });
    const summaryByKey = {};
    summary.forEach(function (r) { summaryByKey[r.teacherId || r.name] = r; });

    const teachers = teachersWithDuty_(y, s, false).map(function (t) {
      const found = summaryByKey[t.id] || summaryByKey[t.name];
      const sets = (found ? found.sets : []).map(function (st) {
        const missing = (st.breakdown || []).filter(function (b) {
          return b.weight > 0 && (b.average === null || b.average === undefined);
        }).map(function (b) { return b.name || b.role; });
        return {
          setId: st.setId, setName: st.setName, count: st.count,
          score: st.score, converted: st.converted, fullMarks: st.fullMarks,
          missing: missing, complete: st.count > 0 && !missing.length
        };
      });
      return {
        teacherId: t.id, name: t.name, level: t.level, dutyDay: t.dutyDay,
        count: found ? found.count : 0,
        converted: found ? found.converted : 0,
        fullMarks: found ? found.fullMarks : 0,
        sets: sets,
        complete: sets.length > 0 && sets.every(function (x) { return x.complete; })
      };
    });

    return ok_({
      year: y, semester: s,
      years: academicYears_(), semesters: semesterList_(),
      window: evaluationWindow_(y, s),
      evaluators: rows,
      teachers: teachers,
      stats: {
        done: done,
        total: total,
        percent: total ? Math.round(done / total * 100) : 0,
        evaluatorsDone: rows.filter(function (r) { return r.total > 0 && r.done >= r.total; }).length,
        evaluatorsPending: rows.filter(function (r) { return r.total > 0 && r.done < r.total; }).length,
        evaluatorsNoEmail: rows.filter(function (r) { return !r.hasEmail; }).length,
        teachersComplete: teachers.filter(function (t) { return t.complete; }).length,
        teachersTotal: teachers.length
      }
    });
  });
}

// ==================== 2. แจ้งเตือนผู้ประเมินทางอีเมล ====================

const MAX_REMINDERS_PER_CALL_ = 50;

/**
 * ส่งอีเมลแจ้งเตือนผู้ประเมินที่ยังทำไม่ครบ
 * @param {Object} options {year, semester, evaluatorIds[], note}
 */
function apiSendReminders(token, options) {
  return guard_(function () {
    requireAdmin_(token);
    const o = options || {};
    const term = currentTerm_();
    const y = str_(o.year) || term.year;
    const s = str_(o.semester) || term.semester;
    const note = str_(o.note).substring(0, 500);
    const only = (o.evaluatorIds || []).map(String);

    const pending = evaluationProgress_(y, s).filter(function (r) {
      if (r.total <= 0 || r.done >= r.total) return false;
      if (only.length && only.indexOf(r.id) === -1 && only.indexOf(r.name) === -1) return false;
      return true;
    });

    if (!pending.length) return fail_('ไม่มีผู้ประเมินที่ค้างงานในภาคเรียนนี้');

    const withEmail = pending.filter(function (r) { return r.hasEmail; });
    if (!withEmail.length) {
      return fail_('ผู้ประเมินที่ค้างงาน ' + pending.length + ' คน ยังไม่ได้บันทึกอีเมลไว้ในระบบ');
    }
    if (withEmail.length > MAX_REMINDERS_PER_CALL_) {
      return fail_('ส่งได้ครั้งละไม่เกิน ' + MAX_REMINDERS_PER_CALL_ + ' คน กรุณาเลือกเฉพาะบางส่วน');
    }

    const org = str_(getSetting_(SETTING_KEYS.ORG_NAME, 'โรงเรียน'));
    const url = webAppUrl_();
    const windowInfo = evaluationWindow_(y, s);
    const deadline = windowInfo.end ? thaiDateText_(parseDateOnly_(windowInfo.end)) : '';

    const sent = [], failed = [];
    withEmail.forEach(function (r) {
      const lines = r.sets.filter(function (x) { return x.remaining > 0; }).map(function (x) {
        return '  • ' + x.setName + ' — เหลืออีก ' + x.remaining + ' คน (ทำแล้ว ' + x.done + '/' + x.total + ')';
      });
      const body =
        'เรียน ' + r.name + '\n\n' +
        'ระบบประเมินผลการปฏิบัติงานครู ' + org + ' ขอแจ้งว่าท่านยังบันทึกผลการประเมินไม่ครบ\n' +
        'รอบการประเมิน: ' + termLabel_(y, s) + '\n' +
        'ความคืบหน้าของท่าน: ' + r.done + '/' + r.total + ' รายการ (' + r.percent + '%)\n\n' +
        (lines.length ? 'รายการที่ยังค้าง\n' + lines.join('\n') + '\n\n' : '') +
        (deadline ? 'กำหนดส่งภายในวันที่ ' + deadline + '\n\n' : '') +
        (note ? note + '\n\n' : '') +
        (url ? 'เข้าสู่ระบบเพื่อบันทึกผล: ' + url + '\n\n' : '') +
        'ขอขอบคุณในความร่วมมือ\nกลุ่มบริหารงานกิจการนักเรียน';

      try {
        MailApp.sendEmail({
          to: r.email,
          subject: '[แจ้งเตือน] ประเมินผลการปฏิบัติงานครู ' + termLabel_(y, s) + ' — เหลืออีก ' + r.remaining + ' รายการ',
          body: body
        });
        sent.push(r.name);
      } catch (e) {
        failed.push(r.name);
      }
    });

    logAction_('Admin', 'admin', 'แจ้งเตือนผู้ประเมิน',
      termLabel_(y, s) + ' | ส่งสำเร็จ ' + sent.length + ' คน' +
      (failed.length ? ' | ส่งไม่สำเร็จ ' + failed.length + ' คน' : ''));

    return ok_({
      sent: sent, failed: failed,
      noEmail: pending.filter(function (r) { return !r.hasEmail; }).map(function (r) { return r.name; })
    }, 'ส่งอีเมลแจ้งเตือนแล้ว ' + sent.length + ' คน' +
      (failed.length ? ' (ส่งไม่สำเร็จ ' + failed.length + ' คน)' : ''));
  });
}

// ==================== 3. ตรวจคุณภาพการประเมิน ====================

function stdDev_(values) {
  if (!values || values.length < 2) return 0;
  const mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  const variance = values.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

/**
 * ตรวจคุณภาพของผลการประเมินก่อนสรุปผล
 * มองหา 4 สัญญาณที่มักทำให้ผลไม่สะท้อนความจริง
 *   1. ให้คะแนนเท่ากันทุกข้อ (straight-lining)
 *   2. ผู้ประเมินที่ให้คะแนนสูง/ต่ำกว่าค่าเฉลี่ยของระบบอย่างชัดเจน
 *   3. ผู้ประเมินที่ให้คะแนนแทบไม่ต่างกันเลยระหว่างครูแต่ละคน
 *   4. ครูที่ยังขาดการประเมินจากกลุ่มที่มีน้ำหนัก
 */
function apiQualityCheck(token, year, semester) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;

    const mainSetId = defaultSetId_();
    const criteriaBySet = {};
    loadSets_().forEach(function (st) { criteriaBySet[st.id] = loadCriteria_(st.id); });

    const rows = readTable_(SHEETS.RESULTS).rows.filter(function (r) {
      if (str_(r['สถานะ']) === STATUS.CANCELLED) return false;
      return str_(r['ปีการศึกษา']) === y && str_(r['ภาคเรียน']) === s;
    });

    const flat = [];       // การประเมินที่ให้คะแนนเท่ากันทุกข้อ
    const noComment = [];
    const byEvaluator = {};

    rows.forEach(function (r) {
      const setId = str_(r['รหัสชุด']) || mainSetId;
      const criteria = criteriaBySet[setId] || [];
      const evaluator = str_(r['ผู้ประเมิน']);
      const average = num_(r['คะแนนเฉลี่ย']);

      const values = [];
      criteria.forEach(function (c) {
        const v = r[CRITERIA_COL_PREFIX + c.id];
        if (v === '' || v === null || v === undefined) return;
        values.push(num_(v));
      });

      const allSame = values.length > 2 && values.every(function (v) { return v === values[0]; });
      if (allSame) {
        flat.push({
          evaluator: evaluator, role: str_(r['บทบาทผู้ประเมิน']),
          teacher: str_(r['ครูผู้รับการประเมิน']), setName: str_(r['ชุดประเมิน']) || '',
          score: values[0], savedAt: formatDate_(r['วันที่บันทึก'])
        });
      }
      if (!str_(r['ข้อเสนอแนะ'])) {
        noComment.push({ evaluator: evaluator, teacher: str_(r['ครูผู้รับการประเมิน']) });
      }

      byEvaluator[evaluator] = byEvaluator[evaluator] || {
        name: evaluator, role: str_(r['บทบาทผู้ประเมิน']),
        averages: [], flat: 0, comments: 0, count: 0
      };
      const e = byEvaluator[evaluator];
      e.averages.push(average);
      e.count++;
      if (allSame) e.flat++;
      if (str_(r['ข้อเสนอแนะ'])) e.comments++;
    });

    const overall = rows.length
      ? Math.round((rows.reduce(function (a, r) { return a + num_(r['คะแนนเฉลี่ย']); }, 0) / rows.length) * 100) / 100
      : 0;

    const evaluators = Object.keys(byEvaluator).map(function (name) {
      const e = byEvaluator[name];
      const mean = Math.round((e.averages.reduce(function (a, b) { return a + b; }, 0) / e.averages.length) * 100) / 100;
      const spread = stdDev_(e.averages);
      const bias = Math.round((mean - overall) * 100) / 100;
      const flags = [];
      if (Math.abs(bias) >= 0.5) flags.push(bias > 0 ? 'ให้คะแนนสูงกว่าค่าเฉลี่ยของระบบ' : 'ให้คะแนนต่ำกว่าค่าเฉลี่ยของระบบ');
      if (e.count >= 3 && spread <= 0.05) flags.push('ให้คะแนนครูทุกคนเกือบเท่ากัน');
      if (e.flat > 0) flags.push('ให้คะแนนเท่ากันทุกข้อ ' + e.flat + ' รายการ');
      if (e.count >= 3 && e.comments === 0) flags.push('ไม่ได้เขียนข้อเสนอแนะเลย');
      return {
        name: name, role: e.role, count: e.count,
        average: mean, bias: bias, spread: spread,
        flatCount: e.flat, commentRate: e.count ? Math.round(e.comments / e.count * 100) : 0,
        flags: flags
      };
    }).sort(function (a, b) { return b.flags.length - a.flags.length || Math.abs(b.bias) - Math.abs(a.bias); });

    // ครูที่ยังขาดการประเมินจากกลุ่มที่มีน้ำหนัก
    const incomplete = [];
    buildSummaryRows_({ year: y, semester: s }).forEach(function (t) {
      (t.sets || []).forEach(function (st) {
        if (!st.count) return;
        const missing = (st.breakdown || []).filter(function (b) {
          return b.weight > 0 && (b.average === null || b.average === undefined);
        }).map(function (b) { return b.name || b.role; });
        if (missing.length) {
          incomplete.push({ name: t.name, level: t.level, setName: st.setName, missing: missing });
        }
      });
    });

    return ok_({
      year: y, semester: s,
      years: academicYears_(), semesters: semesterList_(),
      overallAverage: overall,
      totalEvaluations: rows.length,
      evaluators: evaluators,
      flat: flat.slice(0, 100),
      incomplete: incomplete.slice(0, 100),
      stats: {
        flatCount: flat.length,
        flatPercent: rows.length ? Math.round(flat.length / rows.length * 100) : 0,
        noCommentCount: noComment.length,
        noCommentPercent: rows.length ? Math.round(noComment.length / rows.length * 100) : 0,
        incompleteCount: incomplete.length,
        flaggedEvaluators: evaluators.filter(function (e) { return e.flags.length; }).length
      }
    });
  });
}

// ==================== 4. เปิด/ปิดรอบการประเมิน ====================

/** ข้อมูลของหน้า "รอบการประเมิน" */
function apiGetEvaluationWindow(token) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const locked = lockedTerms_();
    const terms = [];
    academicYears_().forEach(function (yy) {
      semesterList_().forEach(function (ss) {
        terms.push({
          year: yy, semester: ss, key: termKey_(yy, ss),
          label: termLabel_(yy, ss),
          locked: locked.indexOf(termKey_(yy, ss)) !== -1,
          current: yy === term.year && ss === term.semester
        });
      });
    });
    return ok_({
      open: getSettingBool_(SETTING_KEYS.EVALUATION_OPEN, 'ใช่'),
      start: str_(getSetting_(SETTING_KEYS.EVALUATION_START, '')),
      end: str_(getSetting_(SETTING_KEYS.EVALUATION_END, '')),
      currentTerm: term,
      window: evaluationWindow_(term.year, term.semester),
      terms: terms,
      lockedTerms: locked
    });
  });
}

/** บันทึกช่วงเวลาเปิด-ปิดการประเมิน และรายการภาคเรียนที่ล็อก */
function apiSaveEvaluationWindow(token, patch) {
  return guard_(function () {
    requireAdmin_(token);
    const p = patch || {};
    const start = str_(p.start);
    const end = str_(p.end);

    if (start && !parseDateOnly_(start)) return fail_('รูปแบบวันเริ่มต้องเป็น ปี-เดือน-วัน เช่น 2026-05-16');
    if (end && !parseDateOnly_(end)) return fail_('รูปแบบวันสิ้นสุดต้องเป็น ปี-เดือน-วัน เช่น 2026-09-30');
    if (start && end && parseDateOnly_(start) > parseDateOnly_(end)) {
      return fail_('วันเริ่มต้องไม่หลังวันสิ้นสุด');
    }

    const locked = (p.lockedTerms || []).map(String)
      .filter(function (t) { return /^[0-9]+\/[0-9]{4}$/.test(t); });

    setSettings_({
      evaluation_open: p.open === false ? 'ไม่' : 'ใช่',
      evaluation_start: start,
      evaluation_end: end,
      locked_terms: locked.join(',')
    });

    logAction_('Admin', 'admin', 'ตั้งค่ารอบการประเมิน',
      (p.open === false ? 'ปิดรับผล' : 'เปิดรับผล') +
      (start || end ? ' | ช่วง ' + (start || '-') + ' ถึง ' + (end || '-') : '') +
      (locked.length ? ' | ล็อก ' + locked.join(', ') : ''));

    return ok_({ open: p.open !== false, start: start, end: end, lockedTerms: locked },
      'บันทึกรอบการประเมินเรียบร้อย');
  });
}
