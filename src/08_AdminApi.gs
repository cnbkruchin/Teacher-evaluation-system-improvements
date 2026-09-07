/**
 * ============================================================================
 * ไฟล์: 08_AdminApi.gs  |  ฟังก์ชันสำหรับผู้ดูแลระบบ
 * ทุกฟังก์ชันตรวจสอบเซสชันผู้ดูแลก่อนเสมอ และบันทึกประวัติการใช้งานทุกครั้ง
 * ============================================================================
 */

// ==================== ภาพรวม / แดชบอร์ด ====================

function apiAdminOverview(token, year, semester) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) === 'all' ? '' : (str_(year) || term.year);
    const s = str_(semester) === 'all' ? '' : (str_(semester) || term.semester);

    const summary = buildSummaryRows_({ year: y, semester: s });
    const teachers = teachersWithDuty_(y || term.year, s || term.semester, true);
    const evaluators = readTable_(SHEETS.EVALUATORS).rows;

    const ratingDistribution = {};
    RATING_LABELS.forEach(function (l) { ratingDistribution[l] = 0; });
    const byLevel = {}, byDay = {}, byRole = {};

    summary.forEach(function (t) {
      if (ratingDistribution[t.rating] !== undefined) ratingDistribution[t.rating]++;
      if (t.level) {
        byLevel[t.level] = byLevel[t.level] || { sum: 0, n: 0 };
        byLevel[t.level].sum += t.average; byLevel[t.level].n++;
      }
      if (t.dutyDay) {
        byDay[t.dutyDay] = byDay[t.dutyDay] || { sum: 0, n: 0 };
        byDay[t.dutyDay].sum += t.average; byDay[t.dutyDay].n++;
      }
    });

    let totalEvaluations = 0;
    readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
      if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
      if (y && str_(r['ปีการศึกษา']) !== y) return;
      if (s && str_(r['ภาคเรียน']) !== s) return;
      totalEvaluations++;
      const role = str_(r['บทบาทผู้ประเมิน']);
      if (role) byRole[role] = (byRole[role] || 0) + 1;
    });

    const avgAll = summary.length
      ? Math.round((summary.reduce(function (a, b) { return a + b.average; }, 0) / summary.length) * 100) / 100
      : 0;

    // ความคืบหน้า: จำนวนคู่ (ผู้ประเมิน × ครูที่มีสิทธิ์) ที่ประเมินแล้ว
    const progress = evaluationProgress_(y || term.year, s || term.semester);

    return ok_({
      filters: { year: y || 'all', semester: s || 'all', years: academicYears_(), semesters: SEMESTERS },
      currentTerm: term,
      stats: {
        totalEvaluations: totalEvaluations,
        teachersEvaluated: summary.length,
        teachersTotal: teachers.filter(function (t) { return t.status !== STATUS.INACTIVE; }).length,
        evaluatorsActive: evaluators.filter(function (r) { return str_(r['สถานะ']) !== STATUS.INACTIVE && str_(r['ชื่อ-นามสกุล']); }).length,
        averageScore: avgAll,
        excellent: ratingDistribution[RATING_LABELS[0]] || 0,
        needImprove: (ratingDistribution[RATING_LABELS[3]] || 0) + (ratingDistribution[RATING_LABELS[4]] || 0)
      },
      progress: progress,
      ratingDistribution: ratingDistribution,
      byLevel: averageMap_(byLevel),
      byDay: averageMap_(byDay),
      byRole: byRole,
      topTeachers: summary.slice().sort(function (a, b) { return b.average - a.average; }).slice(0, 10),
      lowTeachers: summary.slice().sort(function (a, b) { return a.average - b.average; }).slice(0, 5),
      recentLogs: readLogs_(8)
    });
  });
}

function averageMap_(map) {
  const out = {};
  Object.keys(map).forEach(function (k) {
    out[k] = Math.round((map[k].sum / map[k].n) * 100) / 100;
  });
  return out;
}

/** ความคืบหน้าการประเมินของผู้ประเมินแต่ละคนในภาคเรียนที่เลือก */
function evaluationProgress_(year, semester) {
  const evaluators = readTable_(SHEETS.EVALUATORS).rows.filter(function (r) {
    return str_(r['ชื่อ-นามสกุล']) && str_(r['สถานะ']) !== STATUS.INACTIVE;
  });

  const doneByEvaluator = {};
  readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
    if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
    if (str_(r['ปีการศึกษา']) !== String(year) || str_(r['ภาคเรียน']) !== String(semester)) return;
    const name = str_(r['ผู้ประเมิน']);
    doneByEvaluator[name] = (doneByEvaluator[name] || 0) + 1;
  });

  const allTeachers = teachersWithDuty_(year, semester, false);
  return evaluators.map(function (r) {
    const name = str_(r['ชื่อ-นามสกุล']);
    const role = str_(r['บทบาท']);
    const scope = str_(r['ขอบเขต (ระดับชั้น/วัน)']);
    const total = teachersForEvaluator_(role, scope, year, semester, allTeachers).length;
    const done = doneByEvaluator[name] || 0;
    return {
      name: name, role: role, scope: scope,
      done: Math.min(done, total), total: total,
      percent: total ? Math.round(Math.min(done, total) / total * 100) : 0
    };
  }).sort(function (a, b) { return a.percent - b.percent; });
}

// ==================== ครูผู้รับการประเมิน ====================

function apiListTeachers(token, year, semester, includeInactive) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    return ok_(teachersWithDuty_(str_(year) || term.year, str_(semester) || term.semester, includeInactive !== false));
  });
}

function apiSaveTeacher(token, data) {
  return guard_(function () {
    requireAdmin_(token);
    const d = data || {};
    const firstName = str_(d.firstName), lastName = str_(d.lastName);
    if (!firstName || !lastName) return fail_('กรุณากรอกชื่อและนามสกุล');
    if (d.email && !isValidEmail_(d.email)) return fail_('รูปแบบอีเมลไม่ถูกต้อง');

    const fullName = str_(d.prefix) + firstName + ' ' + lastName;

    return withLock_(function () {
      const table = readTable_(SHEETS.TEACHERS);
      const codes = table.rows.map(function (r) { return str_(r['รหัสครู']); });
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสครู']) === str_(d.id)) target = r; });

      // กันชื่อซ้ำ (ชื่อ-นามสกุลใช้เป็นตัวอ้างอิงในรายงาน)
      const duplicate = table.rows.filter(function (r) {
        return str_(r['ชื่อ-นามสกุล']) === fullName && (!target || r._row !== target._row);
      });
      if (duplicate.length) return fail_('มีครูชื่อ "' + fullName + '" อยู่แล้วในระบบ');

      const record = {
        'คำนำหน้า': str_(d.prefix),
        'ชื่อ': firstName,
        'นามสกุล': lastName,
        'ชื่อ-นามสกุล': fullName,
        'กลุ่มสาระ/ฝ่าย': str_(d.department),
        'ระดับชั้นที่ปรึกษา': str_(d.level),
        'ห้องที่ปรึกษา': str_(d.room),
        'เวรประจำวัน (ค่าเริ่มต้น)': str_(d.defaultDay),
        'อีเมล': str_(d.email),
        'สถานะ': str_(d.status) || STATUS.ACTIVE
      };

      if (target) {
        const oldName = str_(target['ชื่อ-นามสกุล']);
        updateRecord_(SHEETS.TEACHERS, target._row, record);
        if (oldName && oldName !== fullName) syncTeacherName_(str_(target['รหัสครู']), fullName);
        logAction_('Admin', 'admin', 'แก้ไขข้อมูลครู', fullName);
        return ok_({ id: str_(target['รหัสครู']) }, 'บันทึกข้อมูลครูเรียบร้อย');
      }

      record['รหัสครู'] = nextCode_('TCH', codes);
      record['วันที่เพิ่ม'] = new Date();
      appendRecord_(SHEETS.TEACHERS, record);
      logAction_('Admin', 'admin', 'เพิ่มครู', fullName);
      return ok_({ id: record['รหัสครู'] }, 'เพิ่มครูเรียบร้อย');
    });
  });
}

/** อัปเดตชื่อครูในผลการประเมินและตารางเวร ให้ตรงกันทั้งระบบ */
function syncTeacherName_(teacherId, newName) {
  [SHEETS.RESULTS, SHEETS.ARCHIVE].forEach(function (sheetName) {
    readTable_(sheetName).rows.forEach(function (r) {
      if (str_(r['รหัสครู']) === teacherId && str_(r['ครูผู้รับการประเมิน']) !== newName) {
        updateRecord_(sheetName, r._row, { 'ครูผู้รับการประเมิน': newName });
      }
    });
  });
  readTable_(SHEETS.DUTY).rows.forEach(function (r) {
    if (str_(r['รหัสครู']) === teacherId && str_(r['ชื่อ-นามสกุล']) !== newName) {
      updateRecord_(SHEETS.DUTY, r._row, { 'ชื่อ-นามสกุล': newName });
    }
  });
}

function apiDeleteTeacher(token, teacherId) {
  return guard_(function () {
    requireAdmin_(token);
    return withLock_(function () {
      const used = readTable_(SHEETS.RESULTS).rows.filter(function (r) {
        return str_(r['รหัสครู']) === str_(teacherId);
      }).length;
      if (used) {
        return fail_('ครูท่านนี้มีผลการประเมินอยู่ ' + used + ' รายการ จึงลบไม่ได้\n' +
          'แนะนำให้เปลี่ยนสถานะเป็น "ไม่ใช้งาน" แทน เพื่อรักษาข้อมูลย้อนหลัง');
      }
      const table = readTable_(SHEETS.TEACHERS);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสครู']) === str_(teacherId)) target = r; });
      if (!target) return fail_('ไม่พบข้อมูลครู');

      const name = str_(target['ชื่อ-นามสกุล']);
      deleteRecord_(SHEETS.TEACHERS, target._row);
      logAction_('Admin', 'admin', 'ลบครู', name);
      return ok_(null, 'ลบข้อมูลครูเรียบร้อย');
    });
  });
}

/** นำเข้ารายชื่อครูจากข้อความ (คัดลอกจาก Excel ได้เลย) */
function apiImportTeachers(token, text) {
  return guard_(function () {
    requireAdmin_(token);
    const lines = str_(text).split('\n').map(function (l) { return l.trim(); }).filter(String);
    if (!lines.length) return fail_('ไม่พบข้อมูลที่จะนำเข้า');

    return withLock_(function () {
      const table = readTable_(SHEETS.TEACHERS);
      const codes = table.rows.map(function (r) { return str_(r['รหัสครู']); });
      const existingNames = {};
      table.rows.forEach(function (r) { existingNames[str_(r['ชื่อ-นามสกุล'])] = true; });

      const toAdd = [];
      const skipped = [];
      lines.forEach(function (line) {
        // รูปแบบ: คำนำหน้า<TAB>ชื่อ<TAB>นามสกุล<TAB>ระดับชั้น<TAB>เวรประจำวัน<TAB>อีเมล
        const cols = line.split(/\t|,|\|/).map(function (c) { return c.trim(); });
        if (cols.length < 3) { skipped.push(line + ' (ข้อมูลไม่ครบ)'); return; }
        const prefix = cols[0], firstName = cols[1], lastName = cols[2];
        const fullName = prefix + firstName + ' ' + lastName;
        if (existingNames[fullName]) { skipped.push(fullName + ' (มีอยู่แล้ว)'); return; }

        const code = nextCode_('TCH', codes);
        codes.push(code);
        existingNames[fullName] = true;
        toAdd.push({
          'รหัสครู': code, 'คำนำหน้า': prefix, 'ชื่อ': firstName, 'นามสกุล': lastName,
          'ชื่อ-นามสกุล': fullName,
          'ระดับชั้นที่ปรึกษา': cols[3] || '', 'เวรประจำวัน (ค่าเริ่มต้น)': cols[4] || '',
          'อีเมล': cols[5] || '', 'สถานะ': STATUS.ACTIVE, 'วันที่เพิ่ม': new Date()
        });
      });

      appendRecords_(SHEETS.TEACHERS, toAdd);
      logAction_('Admin', 'admin', 'นำเข้ารายชื่อครู', 'เพิ่ม ' + toAdd.length + ' คน, ข้าม ' + skipped.length + ' รายการ');
      return ok_({ added: toAdd.length, skipped: skipped },
        'นำเข้าเรียบร้อย: เพิ่ม ' + toAdd.length + ' คน' + (skipped.length ? ', ข้าม ' + skipped.length + ' รายการ' : ''));
    });
  });
}

// ==================== ผู้ประเมิน ====================

function apiListEvaluators(token) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const allTeachers = teachersWithDuty_(term.year, term.semester, false);
    const rows = readTable_(SHEETS.EVALUATORS).rows
      .filter(function (r) { return str_(r['ชื่อ-นามสกุล']); })
      .map(function (r) {
        const role = str_(r['บทบาท']);
        const scope = str_(r['ขอบเขต (ระดับชั้น/วัน)']);
        const lockUntil = r['ล็อกถึงเวลา'];
        return {
          id: str_(r['รหัสผู้ประเมิน']),
          prefix: str_(r['คำนำหน้า']),
          firstName: str_(r['ชื่อ']),
          lastName: str_(r['นามสกุล']),
          name: str_(r['ชื่อ-นามสกุล']),
          role: role,
          scope: scope,
          email: str_(r['อีเมล']),
          status: str_(r['สถานะ']) || STATUS.ACTIVE,
          mustChangePassword: str_(r['ต้องเปลี่ยนรหัสผ่าน']) === 'ใช่',
          lastLogin: formatDate_(r['เข้าสู่ระบบล่าสุด']),
          failedAttempts: num_(r['จำนวนครั้งที่ผิด']),
          locked: !!(lockUntil && new Date(lockUntil).getTime() > Date.now()),
          responsibleCount: teachersForEvaluator_(role, scope, term.year, term.semester, allTeachers).length
        };
      });
    return ok_(rows);
  });
}

function apiSaveEvaluator(token, data) {
  return guard_(function () {
    requireAdmin_(token);
    const d = data || {};
    const firstName = str_(d.firstName), lastName = str_(d.lastName), role = str_(d.role);
    if (!firstName || !lastName) return fail_('กรุณากรอกชื่อและนามสกุล');
    if (!role || !roleKey_(role)) return fail_('กรุณาเลือกบทบาทให้ถูกต้อง');

    const scope = str_(d.scope);
    const key = roleKey_(role);
    if (SCOPED_ROLES.indexOf(key) !== -1 && !scope) {
      return fail_(key === 'HEAD_LEVEL' ? 'กรุณาเลือกระดับชั้นที่รับผิดชอบ' : 'กรุณาเลือกวันเวรที่รับผิดชอบ');
    }
    if (key === 'HEAD_LEVEL' && LEVELS.indexOf(scope) === -1) return fail_('ระดับชั้นไม่ถูกต้อง');
    if (key === 'HEAD_DUTY' && DAYS.indexOf(scope) === -1) return fail_('วันเวรไม่ถูกต้อง');
    if (d.email && !isValidEmail_(d.email)) return fail_('รูปแบบอีเมลไม่ถูกต้อง');

    const fullName = str_(d.prefix) + firstName + ' ' + lastName;

    return withLock_(function () {
      const table = readTable_(SHEETS.EVALUATORS);
      const codes = table.rows.map(function (r) { return str_(r['รหัสผู้ประเมิน']); });
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสผู้ประเมิน']) === str_(d.id)) target = r; });

      const duplicate = table.rows.filter(function (r) {
        return str_(r['ชื่อ-นามสกุล']) === fullName && (!target || r._row !== target._row);
      });
      if (duplicate.length) return fail_('มีผู้ประเมินชื่อ "' + fullName + '" อยู่แล้ว');

      const record = {
        'คำนำหน้า': str_(d.prefix), 'ชื่อ': firstName, 'นามสกุล': lastName,
        'ชื่อ-นามสกุล': fullName, 'บทบาท': role,
        'ขอบเขต (ระดับชั้น/วัน)': SCOPED_ROLES.indexOf(key) !== -1 ? scope : '',
        'อีเมล': str_(d.email),
        'สถานะ': str_(d.status) || STATUS.ACTIVE
      };

      if (target) {
        const oldName = str_(target['ชื่อ-นามสกุล']);
        updateRecord_(SHEETS.EVALUATORS, target._row, record);
        if (oldName && oldName !== fullName) syncEvaluatorName_(oldName, fullName);
        logAction_('Admin', 'admin', 'แก้ไขผู้ประเมิน', fullName + ' (' + role + ')');
        return ok_({ id: str_(target['รหัสผู้ประเมิน']), name: fullName }, 'บันทึกข้อมูลผู้ประเมินเรียบร้อย');
      }

      // เพิ่มใหม่: สุ่มรหัสผ่านให้ และบังคับเปลี่ยนเมื่อเข้าใช้ครั้งแรก
      const password = generatePassword_(10);
      const pw = makePasswordRecord_(password);
      record['รหัสผู้ประเมิน'] = nextCode_('EVA', codes);
      record['รหัสผ่าน (Hash)'] = pw.hash;
      record['Salt'] = pw.salt;
      record['รอบการเข้ารหัส'] = pw.iterations;
      record['ต้องเปลี่ยนรหัสผ่าน'] = 'ใช่';
      record['จำนวนครั้งที่ผิด'] = 0;
      record['วันที่เพิ่ม'] = new Date();
      appendRecord_(SHEETS.EVALUATORS, record);

      let emailSent = false;
      if (record['อีเมล']) emailSent = sendCredentialEmail_(record['อีเมล'], fullName, password, 'บัญชีผู้ประเมินใหม่');

      logAction_('Admin', 'admin', 'เพิ่มผู้ประเมิน', fullName + ' (' + role + (scope ? ' - ' + scope : '') + ')');
      return ok_({ id: record['รหัสผู้ประเมิน'], name: fullName, password: password, emailSent: emailSent },
        'เพิ่มผู้ประเมินเรียบร้อย');
    });
  });
}

function syncEvaluatorName_(oldName, newName) {
  [SHEETS.RESULTS, SHEETS.ARCHIVE].forEach(function (sheetName) {
    readTable_(sheetName).rows.forEach(function (r) {
      if (str_(r['ผู้ประเมิน']) === oldName) {
        updateRecord_(sheetName, r._row, { 'ผู้ประเมิน': newName });
      }
    });
  });
}

function apiResetEvaluatorPassword(token, evaluatorId) {
  return guard_(function () {
    requireAdmin_(token);
    return withLock_(function () {
      const table = readTable_(SHEETS.EVALUATORS);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสผู้ประเมิน']) === str_(evaluatorId)) target = r; });
      if (!target) return fail_('ไม่พบผู้ประเมิน');

      const password = generatePassword_(10);
      const pw = makePasswordRecord_(password);
      const name = str_(target['ชื่อ-นามสกุล']);
      updateRecord_(SHEETS.EVALUATORS, target._row, {
        'รหัสผ่าน (Hash)': pw.hash, 'Salt': pw.salt, 'รอบการเข้ารหัส': pw.iterations,
        'ต้องเปลี่ยนรหัสผ่าน': 'ใช่', 'จำนวนครั้งที่ผิด': 0, 'ล็อกถึงเวลา': ''
      });
      rateLimitReset_('evaluator::' + name);

      let emailSent = false;
      const email = str_(target['อีเมล']);
      if (email) emailSent = sendCredentialEmail_(email, name, password, 'รีเซ็ตรหัสผ่าน');

      logAction_('Admin', 'admin', 'รีเซ็ตรหัสผ่านผู้ประเมิน', name);
      return ok_({ name: name, password: password, emailSent: emailSent }, 'รีเซ็ตรหัสผ่านเรียบร้อย');
    });
  });
}

function apiToggleEvaluator(token, evaluatorId) {
  return guard_(function () {
    requireAdmin_(token);
    const table = readTable_(SHEETS.EVALUATORS);
    let target = null;
    table.rows.forEach(function (r) { if (str_(r['รหัสผู้ประเมิน']) === str_(evaluatorId)) target = r; });
    if (!target) return fail_('ไม่พบผู้ประเมิน');

    const newStatus = str_(target['สถานะ']) === STATUS.ACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE;
    updateRecord_(SHEETS.EVALUATORS, target._row, { 'สถานะ': newStatus });
    logAction_('Admin', 'admin', 'เปลี่ยนสถานะผู้ประเมิน', str_(target['ชื่อ-นามสกุล']) + ' → ' + newStatus);
    return ok_({ status: newStatus }, 'เปลี่ยนสถานะเป็น "' + newStatus + '" เรียบร้อย');
  });
}

function apiUnlockEvaluator(token, evaluatorId) {
  return guard_(function () {
    requireAdmin_(token);
    const table = readTable_(SHEETS.EVALUATORS);
    let target = null;
    table.rows.forEach(function (r) { if (str_(r['รหัสผู้ประเมิน']) === str_(evaluatorId)) target = r; });
    if (!target) return fail_('ไม่พบผู้ประเมิน');

    const name = str_(target['ชื่อ-นามสกุล']);
    updateRecord_(SHEETS.EVALUATORS, target._row, { 'ล็อกถึงเวลา': '', 'จำนวนครั้งที่ผิด': 0 });
    rateLimitReset_('evaluator::' + name);
    logAction_('Admin', 'admin', 'ปลดล็อกบัญชีผู้ประเมิน', name);
    return ok_(null, 'ปลดล็อกบัญชีเรียบร้อย');
  });
}

function apiDeleteEvaluator(token, evaluatorId) {
  return guard_(function () {
    requireAdmin_(token);
    return withLock_(function () {
      const table = readTable_(SHEETS.EVALUATORS);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสผู้ประเมิน']) === str_(evaluatorId)) target = r; });
      if (!target) return fail_('ไม่พบผู้ประเมิน');

      const name = str_(target['ชื่อ-นามสกุล']);
      const used = readTable_(SHEETS.RESULTS).rows.filter(function (r) {
        return str_(r['ผู้ประเมิน']) === name;
      }).length;
      if (used) {
        return fail_('ผู้ประเมินท่านนี้มีผลการประเมินอยู่ ' + used + ' รายการ จึงลบไม่ได้\n' +
          'แนะนำให้เปลี่ยนสถานะเป็น "ไม่ใช้งาน" แทน');
      }
      deleteRecord_(SHEETS.EVALUATORS, target._row);
      logAction_('Admin', 'admin', 'ลบผู้ประเมิน', name);
      return ok_(null, 'ลบผู้ประเมินเรียบร้อย');
    });
  });
}

/** ส่งรหัสผ่านให้ผู้ประเมินทางอีเมล */
function sendCredentialEmail_(email, name, password, reason) {
  try {
    MailApp.sendEmail(email, '[' + APP.NAME + '] ข้อมูลเข้าสู่ระบบผู้ประเมิน',
      'เรียน ' + name + '\n\n' +
      'ระบบได้ดำเนินการ: ' + reason + '\n\n' +
      'ชื่อผู้ใช้: ' + name + '\n' +
      'รหัสผ่าน: ' + password + '\n\n' +
      '⚠️ กรุณาเข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านทันที และไม่เปิดเผยรหัสผ่านนี้กับผู้อื่น\n\n' +
      '— ' + APP.NAME);
    return true;
  } catch (e) {
    console.error('sendCredentialEmail_: ' + e.message);
    return false;
  }
}

// ==================== ตารางเวรประจำวันรายภาคเรียน ====================

function apiListDuty(token, year, semester) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;
    const roster = dutyRosterFor_(y, s);
    const teachers = teachersWithDuty_(y, s, false);

    const assignedIds = {};
    roster.rows.forEach(function (r) { if (r.teacherId) assignedIds[r.teacherId] = true; });

    const byDay = {};
    DAYS.forEach(function (d) { byDay[d] = 0; });
    roster.rows.forEach(function (r) { if (byDay[r.day] !== undefined) byDay[r.day]++; });

    return ok_({
      year: y, semester: s,
      years: academicYears_(), semesters: SEMESTERS,
      days: DAYS, positions: DUTY_POSITIONS, levels: LEVELS,
      rows: roster.rows.sort(function (a, b) {
        const d = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
        if (d !== 0) return d;
        const p = DUTY_POSITIONS.indexOf(a.position) - DUTY_POSITIONS.indexOf(b.position);
        return p !== 0 ? p : a.teacherName.localeCompare(b.teacherName, 'th');
      }),
      countByDay: byDay,
      unassigned: teachers.filter(function (t) { return !assignedIds[t.id]; })
        .map(function (t) { return { id: t.id, name: t.name, level: t.level, defaultDay: t.defaultDay }; })
    });
  });
}

/**
 * สร้างตารางเวรของภาคเรียนจาก "เวรประจำวัน (ค่าเริ่มต้น)" ในทะเบียนครู
 * ใช้ตอนเริ่มต้นภาคเรียนแรก หรือเมื่อเพิ่มครูใหม่เข้ามาหลายคน
 */
function apiSeedDuty(token, year, semester, overwrite) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;

    return withLock_(function () {
      if (overwrite) {
        const existing = readTable_(SHEETS.DUTY).rows.filter(function (r) {
          return str_(r['ปีการศึกษา']) === y && str_(r['ภาคเรียน']) === s;
        });
        existing.map(function (r) { return r._row; })
          .sort(function (a, b) { return b - a; })
          .forEach(function (row) { deleteRecord_(SHEETS.DUTY, row); });
      }

      const created = seedDutyRosterFromTeachers_(y, s);
      if (!created) {
        return fail_('ไม่มีรายการที่สร้างได้ — ' +
          'ตรวจสอบว่าทะเบียนครูมีการระบุ "เวรประจำวัน (ค่าเริ่มต้น)" ไว้แล้ว ' +
          'หรือภาคเรียนนี้มีตารางเวรอยู่แล้ว (เลือกเขียนทับหากต้องการสร้างใหม่)');
      }
      logAction_('Admin', 'admin', 'สร้างตารางเวรจากค่าเริ่มต้น',
        termLabel_(y, s) + ' จำนวน ' + created + ' รายการ');
      return ok_({ created: created }, 'สร้างตารางเวร ' + created + ' รายการเรียบร้อย');
    });
  });
}

function apiSaveDuty(token, data) {
  return guard_(function () {
    const session = requireAdmin_(token);
    const d = data || {};
    const year = str_(d.year), semester = str_(d.semester), teacherId = str_(d.teacherId);
    if (!year || !semester) return fail_('กรุณาระบุปีการศึกษาและภาคเรียน');
    if (!teacherId) return fail_('กรุณาเลือกครู');
    if (DAYS.indexOf(str_(d.day)) === -1) return fail_('กรุณาเลือกวันเวรให้ถูกต้อง');

    const teacherIndex = buildTeacherIndex_();
    const teacher = teacherIndex.byId[teacherId];
    if (!teacher) return fail_('ไม่พบข้อมูลครู');

    return withLock_(function () {
      const table = readTable_(SHEETS.DUTY);
      const codes = table.rows.map(function (r) { return str_(r['รหัสรายการ']); });
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสรายการ']) === str_(d.id)) target = r; });

      // ครู 1 คน มีเวรได้ 1 รายการต่อภาคเรียน
      const duplicate = table.rows.filter(function (r) {
        return str_(r['ปีการศึกษา']) === year && str_(r['ภาคเรียน']) === semester
          && str_(r['รหัสครู']) === teacherId && (!target || r._row !== target._row);
      });
      if (duplicate.length) {
        return fail_('ครูท่านนี้มีเวรใน ' + termLabel_(year, semester) + ' อยู่แล้ว กรุณาแก้ไขรายการเดิมแทน');
      }

      const record = {
        'ปีการศึกษา': year, 'ภาคเรียน': semester,
        'รหัสครู': teacherId, 'ชื่อ-นามสกุล': teacher.name,
        'เวรประจำวัน': str_(d.day),
        'บทบาทในเวร': str_(d.position) || 'กรรมการเวร',
        'จุดปฏิบัติหน้าที่': str_(d.location),
        'เวลาเริ่ม': str_(d.startTime),
        'เวลาสิ้นสุด': str_(d.endTime),
        'ระดับชั้นที่ดูแล': str_(d.level),
        'หมายเหตุ': str_(d.note),
        'สถานะ': str_(d.status) || STATUS.ACTIVE,
        'ผู้บันทึก': session.name || 'Admin',
        'วันที่บันทึก': new Date()
      };

      if (target) {
        updateRecord_(SHEETS.DUTY, target._row, record);
        logAction_('Admin', 'admin', 'แก้ไขตารางเวร', teacher.name + ' | ' + termLabel_(year, semester) + ' | ' + record['เวรประจำวัน']);
        return ok_(null, 'บันทึกตารางเวรเรียบร้อย');
      }

      record['รหัสรายการ'] = nextCode_('DUT', codes);
      appendRecord_(SHEETS.DUTY, record);
      logAction_('Admin', 'admin', 'เพิ่มตารางเวร', teacher.name + ' | ' + termLabel_(year, semester) + ' | ' + record['เวรประจำวัน']);
      return ok_(null, 'เพิ่มรายการเวรเรียบร้อย');
    });
  });
}

function apiDeleteDuty(token, dutyId) {
  return guard_(function () {
    requireAdmin_(token);
    return withLock_(function () {
      const table = readTable_(SHEETS.DUTY);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสรายการ']) === str_(dutyId)) target = r; });
      if (!target) return fail_('ไม่พบรายการเวร');

      const label = str_(target['ชื่อ-นามสกุล']) + ' | ' +
        termLabel_(str_(target['ปีการศึกษา']), str_(target['ภาคเรียน']));
      deleteRecord_(SHEETS.DUTY, target._row);
      logAction_('Admin', 'admin', 'ลบรายการเวร', label);
      return ok_(null, 'ลบรายการเวรเรียบร้อย');
    });
  });
}

/**
 * คัดลอกตารางเวรจากภาคเรียนหนึ่งไปอีกภาคเรียนหนึ่ง
 * ใช้เมื่อขึ้นภาคเรียนใหม่แล้วต้องการเริ่มจากของเดิมแล้วค่อยปรับ
 */
function apiCopyDuty(token, options) {
  return guard_(function () {
    const session = requireAdmin_(token);
    const o = options || {};
    const from = { year: str_(o.fromYear), semester: str_(o.fromSemester) };
    const to = { year: str_(o.toYear), semester: str_(o.toSemester) };
    if (!from.year || !from.semester || !to.year || !to.semester) return fail_('กรุณาระบุภาคเรียนต้นทางและปลายทาง');
    if (from.year === to.year && from.semester === to.semester) return fail_('ภาคเรียนต้นทางและปลายทางต้องไม่ซ้ำกัน');

    return withLock_(function () {
      const source = dutyRosterFor_(from.year, from.semester);
      if (!source.rows.length) return fail_('ไม่พบตารางเวรของ ' + termLabel_(from.year, from.semester));

      const table = readTable_(SHEETS.DUTY);
      const codes = table.rows.map(function (r) { return str_(r['รหัสรายการ']); });
      const existing = {};
      table.rows.forEach(function (r) {
        if (str_(r['ปีการศึกษา']) === to.year && str_(r['ภาคเรียน']) === to.semester) {
          existing[str_(r['รหัสครู'])] = r;
        }
      });

      if (Object.keys(existing).length && !o.overwrite) {
        return fail_('ปลายทาง ' + termLabel_(to.year, to.semester) + ' มีข้อมูลอยู่แล้ว ' +
          Object.keys(existing).length + ' รายการ\nกรุณาเลือก "เขียนทับข้อมูลเดิม" หากต้องการดำเนินการต่อ', 'EXISTS');
      }

      // ลบของเดิมที่ปลายทางก่อน (เรียงจากล่างขึ้นบนเพื่อไม่ให้เลขแถวเลื่อน)
      if (o.overwrite) {
        Object.keys(existing).map(function (k) { return existing[k]._row; })
          .sort(function (a, b) { return b - a; })
          .forEach(function (row) { deleteRecord_(SHEETS.DUTY, row); });
      }

      const rows = source.rows.map(function (r) {
        const code = nextCode_('DUT', codes);
        codes.push(code);
        return {
          'รหัสรายการ': code, 'ปีการศึกษา': to.year, 'ภาคเรียน': to.semester,
          'รหัสครู': r.teacherId, 'ชื่อ-นามสกุล': r.teacherName, 'เวรประจำวัน': r.day,
          'บทบาทในเวร': r.position, 'จุดปฏิบัติหน้าที่': r.location,
          'เวลาเริ่ม': r.startTime, 'เวลาสิ้นสุด': r.endTime, 'ระดับชั้นที่ดูแล': r.level,
          'หมายเหตุ': 'คัดลอกจาก ' + termLabel_(from.year, from.semester),
          'สถานะ': STATUS.ACTIVE, 'ผู้บันทึก': session.name || 'Admin', 'วันที่บันทึก': new Date()
        };
      });
      appendRecords_(SHEETS.DUTY, rows);

      logAction_('Admin', 'admin', 'คัดลอกตารางเวร',
        termLabel_(from.year, from.semester) + ' → ' + termLabel_(to.year, to.semester) + ' (' + rows.length + ' รายการ)');
      return ok_({ copied: rows.length }, 'คัดลอกตารางเวร ' + rows.length + ' รายการเรียบร้อย');
    });
  });
}

// ==================== เกณฑ์การประเมิน ====================

function apiListCriteria(token) {
  return guard_(function () {
    requireAdmin_(token);
    const rows = readTable_(SHEETS.CRITERIA).rows
      .filter(function (r) { return num_(r['ข้อที่']) > 0 && str_(r['เกณฑ์การประเมิน']); })
      .map(function (r) {
        const roleText = str_(r['ผู้มีสิทธิ์ประเมิน']);
        return {
          row: r._row,
          id: num_(r['ข้อที่']),
          name: str_(r['เกณฑ์การประเมิน']),
          roles: Object.keys(ROLES).filter(function (k) { return roleText.indexOf(ROLES[k]) !== -1; }),
          weight: num_(r['น้ำหนัก (%)']),
          description: str_(r['คำอธิบาย']),
          status: str_(r['สถานะ']) || STATUS.ACTIVE
        };
      });
    return ok_({
      criteria: rows,
      roles: Object.keys(ROLES).map(function (k) { return { key: k, name: ROLES[k] }; }),
      useWeights: getSettingBool_(SETTING_KEYS.USE_WEIGHTS, 'ไม่'),
      maxCriteria: MAX_CRITERIA
    });
  });
}

function apiSaveCriteria(token, item) {
  return guard_(function () {
    requireAdmin_(token);
    const d = item || {};
    const id = num_(d.id);
    if (!id || id < 1 || id > MAX_CRITERIA) return fail_('เลขข้อต้องอยู่ระหว่าง 1-' + MAX_CRITERIA);
    if (!str_(d.name)) return fail_('กรุณากรอกชื่อเกณฑ์');
    const roles = (d.roles || []).filter(function (k) { return ROLES[k]; });
    if (!roles.length) return fail_('กรุณาเลือกผู้มีสิทธิ์ประเมินอย่างน้อย 1 บทบาท');

    return withLock_(function () {
      const table = readTable_(SHEETS.CRITERIA);
      let target = null;
      table.rows.forEach(function (r) { if (num_(r['ข้อที่']) === id) target = r; });

      const record = {
        'ข้อที่': id,
        'เกณฑ์การประเมิน': str_(d.name),
        'ผู้มีสิทธิ์ประเมิน': roles.map(function (k) { return ROLES[k]; }).join(', '),
        'น้ำหนัก (%)': num_(d.weight) || 10,
        'คำอธิบาย': str_(d.description),
        'สถานะ': str_(d.status) || STATUS.ACTIVE
      };

      if (target) updateRecord_(SHEETS.CRITERIA, target._row, record);
      else appendRecord_(SHEETS.CRITERIA, record);

      logAction_('Admin', 'admin', 'บันทึกเกณฑ์การประเมิน', 'ข้อ ' + id + ': ' + record['เกณฑ์การประเมิน']);
      return ok_(null, 'บันทึกเกณฑ์เรียบร้อย');
    });
  });
}

// ==================== ผลการประเมิน ====================

function apiListResults(token, filters) {
  return guard_(function () {
    requireAdmin_(token);
    const f = filters || {};
    const keyword = str_(f.keyword).toLowerCase();
    const limit = Math.min(num_(f.limit) || 500, 3000);

    const rows = readTable_(SHEETS.RESULTS).rows.filter(function (r) {
      if (str_(f.year) && str_(f.year) !== 'all' && str_(r['ปีการศึกษา']) !== str_(f.year)) return false;
      if (str_(f.semester) && str_(f.semester) !== 'all' && str_(r['ภาคเรียน']) !== str_(f.semester)) return false;
      if (str_(f.role) && str_(f.role) !== 'all' && str_(r['บทบาทผู้ประเมิน']) !== str_(f.role)) return false;
      if (str_(f.level) && str_(f.level) !== 'all' && str_(r['ระดับชั้น']) !== str_(f.level)) return false;
      if (str_(f.day) && str_(f.day) !== 'all' && str_(r['เวรประจำวัน']) !== str_(f.day)) return false;
      if (keyword) {
        const hay = (str_(r['ครูผู้รับการประเมิน']) + ' ' + str_(r['ผู้ประเมิน'])).toLowerCase();
        if (hay.indexOf(keyword) === -1) return false;
      }
      return true;
    }).map(function (r) {
      return {
        id: str_(r['รหัสการประเมิน']),
        savedAt: formatDate_(r['วันที่บันทึก']),
        year: str_(r['ปีการศึกษา']),
        semester: str_(r['ภาคเรียน']),
        evaluator: str_(r['ผู้ประเมิน']),
        role: str_(r['บทบาทผู้ประเมิน']),
        teacher: str_(r['ครูผู้รับการประเมิน']),
        level: str_(r['ระดับชั้น']),
        dutyDay: str_(r['เวรประจำวัน']),
        average: num_(r['คะแนนเฉลี่ย']),
        rating: str_(r['ระดับผลการประเมิน']),
        comment: str_(r['ข้อเสนอแนะ']),
        revision: num_(r['แก้ไขครั้งที่']),
        status: str_(r['สถานะ']) || STATUS.NORMAL
      };
    });

    rows.sort(function (a, b) { return b.savedAt.localeCompare(a.savedAt); });
    return ok_({ rows: rows.slice(0, limit), total: rows.length });
  });
}

function apiGetResult(token, resultId) {
  return guard_(function () {
    requireAdmin_(token);
    const criteria = loadCriteria_();
    let target = null;
    readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
      if (str_(r['รหัสการประเมิน']) === str_(resultId)) target = r;
    });
    if (!target) return fail_('ไม่พบผลการประเมิน');

    const scores = criteria.map(function (c) {
      const v = target[CRITERIA_COL_PREFIX + c.id];
      return { id: c.id, name: c.name, score: (v === '' || v === null || v === undefined) ? null : num_(v) };
    });

    return ok_({
      id: str_(target['รหัสการประเมิน']),
      savedAt: formatDate_(target['วันที่บันทึก']),
      year: str_(target['ปีการศึกษา']),
      semester: str_(target['ภาคเรียน']),
      evaluator: str_(target['ผู้ประเมิน']),
      role: str_(target['บทบาทผู้ประเมิน']),
      teacher: str_(target['ครูผู้รับการประเมิน']),
      level: str_(target['ระดับชั้น']),
      dutyDay: str_(target['เวรประจำวัน']),
      total: num_(target['คะแนนรวม']),
      max: num_(target['คะแนนเต็ม']),
      average: num_(target['คะแนนเฉลี่ย']),
      rating: str_(target['ระดับผลการประเมิน']),
      comment: str_(target['ข้อเสนอแนะ']),
      revision: num_(target['แก้ไขครั้งที่']),
      status: str_(target['สถานะ']) || STATUS.NORMAL,
      scores: scores,
      history: archiveHistoryFor_(str_(target['รหัสการประเมิน']))
    });
  });
}

/**
 * ลบผลการประเมิน — ระบบจะย้ายเข้าคลังข้อมูลก่อนเสมอ (ไม่ลบทิ้งถาวร)
 * เพื่อให้ตรวจสอบย้อนหลังได้ตลอด
 */
function apiDeleteResult(token, resultId, reason) {
  return guard_(function () {
    const session = requireAdmin_(token);
    return withLock_(function () {
      const table = readTable_(SHEETS.RESULTS);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสการประเมิน']) === str_(resultId)) target = r; });
      if (!target) return fail_('ไม่พบผลการประเมิน');

      const label = str_(target['ครูผู้รับการประเมิน']) + ' โดย ' + str_(target['ผู้ประเมิน']);
      archiveResultRow_(target, 'ลบโดยผู้ดูแลระบบ', str_(reason) || '-', session.name || 'Admin');
      deleteRecord_(SHEETS.RESULTS, target._row);

      logAction_('Admin', 'admin', 'ลบผลการประเมิน', label + ' | เหตุผล: ' + (str_(reason) || '-'));
      return ok_(null, 'ย้ายผลการประเมินเข้าคลังข้อมูลเรียบร้อย (ยังตรวจสอบย้อนหลังได้)');
    });
  });
}

// ==================== ตั้งค่าระบบ ====================

function apiGetSettings(token) {
  return guard_(function () {
    requireAdmin_(token);
    const s = readSettings_(true);
    const recoveryEmail = str_(s[SETTING_KEYS.RECOVERY_EMAIL]);
    return ok_({
      currentYear: str_(s[SETTING_KEYS.CURRENT_YEAR]) || guessAcademicYear_(),
      currentSemester: str_(s[SETTING_KEYS.CURRENT_SEMESTER]) || guessSemester_(),
      academicYears: str_(s[SETTING_KEYS.ACADEMIC_YEARS]),
      organization: str_(s[SETTING_KEYS.ORG_NAME]),
      reportSigner: str_(s[SETTING_KEYS.REPORT_SIGNER]),
      reportSignerRole: str_(s[SETTING_KEYS.REPORT_SIGNER_ROLE]),
      recoveryEmail: recoveryEmail,
      recoveryEmailMasked: maskEmail_(recoveryEmail),
      adminAllowedEmails: str_(s[SETTING_KEYS.ADMIN_ALLOWED_EMAILS]),
      useWeights: getSettingBool_(SETTING_KEYS.USE_WEIGHTS, 'ไม่'),
      allowReevaluate: getSettingBool_(SETTING_KEYS.ALLOW_REEVALUATE, 'ใช่'),
      showEvaluatorList: getSettingBool_(SETTING_KEYS.SHOW_EVALUATOR_LIST, 'ใช่'),
      thresholds: ratingThresholds_(),
      maxLoginAttempts: getSettingNumber_(SETTING_KEYS.MAX_LOGIN_ATTEMPTS, 5),
      lockoutMinutes: getSettingNumber_(SETTING_KEYS.LOCKOUT_MINUTES, 15),
      sessionIdleMinutes: getSettingNumber_(SETTING_KEYS.SESSION_IDLE_MINUTES, 120),
      sessionMaxHours: getSettingNumber_(SETTING_KEYS.SESSION_MAX_HOURS, 8),
      passwordChangedAt: str_(s[SETTING_KEYS.ADMIN_CHANGED]),
      setupDate: str_(s[SETTING_KEYS.SETUP_DATE]),
      version: APP.VERSION,
      spreadsheetUrl: ss_().getUrl()
    });
  });
}

function apiSaveSettings(token, patch) {
  return guard_(function () {
    requireAdmin_(token);
    const p = patch || {};
    const updates = {};

    if (p.currentYear !== undefined) {
      if (!/^\d{4}$/.test(str_(p.currentYear))) return fail_('ปีการศึกษาต้องเป็นตัวเลข 4 หลัก เช่น 2568');
      updates[SETTING_KEYS.CURRENT_YEAR] = str_(p.currentYear);
    }
    if (p.currentSemester !== undefined) {
      if (SEMESTERS.indexOf(str_(p.currentSemester)) === -1) return fail_('ภาคเรียนต้องเป็น 1 หรือ 2');
      updates[SETTING_KEYS.CURRENT_SEMESTER] = str_(p.currentSemester);
    }
    if (p.academicYears !== undefined) {
      const years = str_(p.academicYears).split(',').map(function (y) { return y.trim(); }).filter(String);
      if (years.some(function (y) { return !/^\d{4}$/.test(y); })) return fail_('ปีการศึกษาต้องเป็นตัวเลข 4 หลัก คั่นด้วยเครื่องหมายจุลภาค');
      updates[SETTING_KEYS.ACADEMIC_YEARS] = years.join(',');
    }
    if (p.organization !== undefined) updates[SETTING_KEYS.ORG_NAME] = str_(p.organization);
    if (p.reportSigner !== undefined) updates[SETTING_KEYS.REPORT_SIGNER] = str_(p.reportSigner);
    if (p.reportSignerRole !== undefined) updates[SETTING_KEYS.REPORT_SIGNER_ROLE] = str_(p.reportSignerRole);

    if (p.recoveryEmail !== undefined) {
      const email = str_(p.recoveryEmail);
      if (email && !isValidEmail_(email)) return fail_('รูปแบบอีเมลกู้คืนรหัสผ่านไม่ถูกต้อง');
      updates[SETTING_KEYS.RECOVERY_EMAIL] = email;
    }
    if (p.adminAllowedEmails !== undefined) {
      const list = str_(p.adminAllowedEmails).split(',').map(function (e) { return e.trim(); }).filter(String);
      if (list.some(function (e) { return !isValidEmail_(e); })) return fail_('รายการอีเมลที่อนุญาตมีรูปแบบไม่ถูกต้อง');
      updates[SETTING_KEYS.ADMIN_ALLOWED_EMAILS] = list.join(',');
    }

    if (p.useWeights !== undefined) updates[SETTING_KEYS.USE_WEIGHTS] = p.useWeights ? 'ใช่' : 'ไม่';
    if (p.allowReevaluate !== undefined) updates[SETTING_KEYS.ALLOW_REEVALUATE] = p.allowReevaluate ? 'ใช่' : 'ไม่';
    if (p.showEvaluatorList !== undefined) updates[SETTING_KEYS.SHOW_EVALUATOR_LIST] = p.showEvaluatorList ? 'ใช่' : 'ไม่';

    if (p.thresholds) {
      const t = p.thresholds;
      const values = [Number(t.excellent), Number(t.great), Number(t.good), Number(t.fair)];
      if (values.some(function (v) { return isNaN(v) || v < 1 || v > 5; })) {
        return fail_('เกณฑ์ตัดระดับต้องเป็นตัวเลขระหว่าง 1-5');
      }
      for (let i = 1; i < values.length; i++) {
        if (values[i] >= values[i - 1]) return fail_('เกณฑ์ตัดระดับต้องเรียงจากมากไปน้อย (ดีเยี่ยม > ดีมาก > ดี > พอใช้)');
      }
      updates[SETTING_KEYS.THRESHOLDS] = JSON.stringify({
        excellent: values[0], great: values[1], good: values[2], fair: values[3]
      });
    }

    if (p.maxLoginAttempts !== undefined) {
      const v = num_(p.maxLoginAttempts);
      if (v < 3 || v > 20) return fail_('จำนวนครั้งที่อนุญาตให้กรอกผิดต้องอยู่ระหว่าง 3-20');
      updates[SETTING_KEYS.MAX_LOGIN_ATTEMPTS] = v;
    }
    if (p.lockoutMinutes !== undefined) {
      const v = num_(p.lockoutMinutes);
      if (v < 1 || v > 1440) return fail_('ระยะเวลาล็อกต้องอยู่ระหว่าง 1-1440 นาที');
      updates[SETTING_KEYS.LOCKOUT_MINUTES] = v;
    }
    if (p.sessionIdleMinutes !== undefined) {
      const v = num_(p.sessionIdleMinutes);
      if (v < 5 || v > 480) return fail_('ระยะเวลาไม่มีการใช้งานต้องอยู่ระหว่าง 5-480 นาที');
      updates[SETTING_KEYS.SESSION_IDLE_MINUTES] = v;
    }
    if (p.sessionMaxHours !== undefined) {
      const v = num_(p.sessionMaxHours);
      if (v < 1 || v > 24) return fail_('อายุสูงสุดของเซสชันต้องอยู่ระหว่าง 1-24 ชั่วโมง');
      updates[SETTING_KEYS.SESSION_MAX_HOURS] = v;
    }

    setSettings_(updates);
    logAction_('Admin', 'admin', 'บันทึกการตั้งค่าระบบ', Object.keys(updates).join(', '));
    return ok_(null, 'บันทึกการตั้งค่าเรียบร้อย');
  });
}

/** ทดสอบส่งอีเมลกู้คืนรหัสผ่าน เพื่อให้แน่ใจว่าใช้งานได้จริงก่อนเกิดเหตุ */
function apiTestRecoveryEmail(token) {
  return guard_(function () {
    requireAdmin_(token);
    const email = str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''));
    if (!email) return fail_('ยังไม่ได้ตั้งค่าอีเมลกู้คืนรหัสผ่าน');
    MailApp.sendEmail(email, '[' + APP.NAME + '] ทดสอบอีเมลกู้คืนรหัสผ่าน',
      'นี่คืออีเมลทดสอบจากระบบ\n\nหากท่านได้รับอีเมลฉบับนี้ แสดงว่าระบบกู้คืนรหัสผ่านผู้ดูแลระบบพร้อมใช้งาน\n' +
      'เวลาทดสอบ: ' + nowStamp_());
    logAction_('Admin', 'admin', 'ทดสอบอีเมลกู้คืนรหัสผ่าน', maskEmail_(email));
    return ok_(null, 'ส่งอีเมลทดสอบไปยัง ' + maskEmail_(email) + ' แล้ว');
  });
}

// ==================== ประวัติการใช้งาน ====================

/** อ่านประวัติการใช้งานเฉพาะรายการล่าสุด (อ่านเฉพาะแถวท้าย เพื่อให้เร็วแม้ log จะยาวมาก) */
function readLogs_(limit) {
  if (!sheetExists_(SHEETS.LOG)) return [];
  const sheet = getSheet_(SHEETS.LOG);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  const take = Math.min(num_(limit) || 200, lastRow - 1);
  const values = sheet.getRange(lastRow - take + 1, 1, take, lastCol).getValues();
  const at = function (row, name) {
    const idx = headers.indexOf(name);
    return idx === -1 ? '' : row[idx];
  };

  return values.map(function (row) {
    return {
      time: formatDate_(at(row, 'วันที่-เวลา')),
      user: str_(at(row, 'ผู้ใช้')),
      role: str_(at(row, 'บทบาท')),
      action: str_(at(row, 'การกระทำ')),
      detail: str_(at(row, 'รายละเอียด')),
      account: str_(at(row, 'บัญชี Google'))
    };
  }).reverse();
}

function apiListLogs(token, limit) {
  return guard_(function () {
    requireAdmin_(token);
    return ok_(readLogs_(num_(limit) || 200));
  });
}
