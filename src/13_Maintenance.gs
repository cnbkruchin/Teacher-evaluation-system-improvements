/**
 * ============================================================================
 * ไฟล์: 13_Maintenance.gs  |  จัดการปีการศึกษา/ภาคเรียน และเคลียร์ข้อมูลการประเมิน
 *
 *  1) ตั้งค่าปีการศึกษาและภาคเรียนได้อย่างอิสระ
 *     - เพิ่ม/ลบปีการศึกษา, เปิด-ปิดภาคเรียน (รวมภาคฤดูร้อน)
 *     - เลือกปีการศึกษาปัจจุบันและภาคเรียนปัจจุบันแยกจากกัน
 *  2) เคลียร์ผลการประเมินรายภาคเรียนหรือรายปีการศึกษา
 *     - ย้ายเข้าคลัง (ปลอดภัย กู้คืนได้) หรือลบถาวร
 *     - สำรองเป็นไฟล์ Excel ก่อนลบได้
 *     - ต้องพิมพ์ข้อความยืนยันให้ตรง จึงจะดำเนินการ
 * ============================================================================
 */

// ==================== ปีการศึกษาและภาคเรียน ====================

/** นับจำนวนข้อมูลของแต่ละภาคเรียน เพื่อให้ผู้ดูแลเห็นภาพก่อนตัดสินใจ */
function termStatistics_() {
  const stats = {};
  const touch = function (year, semester) {
    const key = year + '/' + semester;
    if (!stats[key]) {
      stats[key] = { year: year, semester: semester, results: 0, archived: 0, duty: 0, teachers: {}, evaluators: {} };
    }
    return stats[key];
  };

  readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
    const y = str_(r['ปีการศึกษา']), s = str_(r['ภาคเรียน']);
    if (!y || !s) return;
    const item = touch(y, s);
    item.results++;
    const t = str_(r['ครูผู้รับการประเมิน']);
    const e = str_(r['ผู้ประเมิน']);
    if (t) item.teachers[t] = true;
    if (e) item.evaluators[e] = true;
  });

  readTable_(SHEETS.ARCHIVE).rows.forEach(function (r) {
    const y = str_(r['ปีการศึกษา']), s = str_(r['ภาคเรียน']);
    if (!y || !s) return;
    touch(y, s).archived++;
  });

  readTable_(SHEETS.DUTY).rows.forEach(function (r) {
    const y = str_(r['ปีการศึกษา']), s = str_(r['ภาคเรียน']);
    if (!y || !s) return;
    touch(y, s).duty++;
  });

  return stats;
}

/** ข้อมูลทั้งหมดของหน้า "ปีการศึกษาและภาคเรียน" */
function apiTermOverview(token) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const years = academicYears_();
    const semesters = semesterList_();
    const stats = termStatistics_();

    // รวมภาคเรียนทั้งหมดที่ตั้งค่าไว้ และที่พบในข้อมูลจริง
    const rows = {};
    years.forEach(function (y) {
      semesters.forEach(function (s) { rows[y + '/' + s] = { year: y, semester: s }; });
    });
    Object.keys(stats).forEach(function (key) {
      if (!rows[key]) rows[key] = { year: stats[key].year, semester: stats[key].semester, extra: true };
    });

    const list = Object.keys(rows).map(function (key) {
      const base = rows[key];
      const stat = stats[key] || { results: 0, archived: 0, duty: 0, teachers: {}, evaluators: {} };
      return {
        key: key,
        year: base.year,
        semester: base.semester,
        label: termLabel_(base.year, base.semester),
        isCurrent: base.year === term.year && base.semester === term.semester,
        outsideSettings: !!base.extra,
        results: stat.results,
        archived: stat.archived,
        duty: stat.duty,
        teachers: Object.keys(stat.teachers).length,
        evaluators: Object.keys(stat.evaluators).length
      };
    }).sort(function (a, b) {
      if (a.year !== b.year) return Number(b.year) - Number(a.year);
      return Number(a.semester) - Number(b.semester);
    });

    return ok_({
      currentYear: term.year,
      currentSemester: term.semester,
      years: years,
      configuredYears: str_(getSetting_(SETTING_KEYS.ACADEMIC_YEARS, '')).split(',')
        .map(function (y) { return y.trim(); }).filter(String),
      semesterOptions: semesterOptions_(),
      terms: list,
      suggestedYear: guessAcademicYear_()
    });
  });
}

/**
 * บันทึกการตั้งค่าปีการศึกษา/ภาคเรียน
 * ทุกฟิลด์เป็นอิสระต่อกัน ส่งมาเฉพาะสิ่งที่ต้องการเปลี่ยนได้
 * @param {Object} patch {currentYear, currentSemester, years: [], semesters: []}
 */
function apiSaveTermSettings(token, patch) {
  return guard_(function () {
    requireAdmin_(token);
    const p = patch || {};
    const updates = {};
    const notes = [];

    if (p.years !== undefined) {
      const years = (p.years || []).map(function (y) { return str_(y); }).filter(String);
      if (!years.length) return fail_('ต้องมีปีการศึกษาอย่างน้อย 1 ปี');
      if (years.some(function (y) { return !/^\d{4}$/.test(y); })) {
        return fail_('ปีการศึกษาต้องเป็นตัวเลข 4 หลัก เช่น 2568');
      }
      const unique = [];
      years.forEach(function (y) { if (unique.indexOf(y) === -1) unique.push(y); });
      unique.sort(function (a, b) { return Number(a) - Number(b); });
      updates[SETTING_KEYS.ACADEMIC_YEARS] = unique.join(',');
      notes.push('ปีการศึกษาที่เปิดใช้งาน');
    }

    if (p.semesters !== undefined) {
      const allowed = ALL_SEMESTERS.map(function (s) { return s.value; });
      const list = (p.semesters || []).map(String).filter(function (v) { return allowed.indexOf(v) !== -1; });
      if (!list.length) return fail_('ต้องเปิดใช้งานภาคเรียนอย่างน้อย 1 ภาคเรียน');
      list.sort();
      updates[SETTING_KEYS.SEMESTERS] = list.join(',');
      notes.push('ภาคเรียนที่เปิดใช้งาน');
    }

    if (p.currentYear !== undefined) {
      const year = str_(p.currentYear);
      if (!/^\d{4}$/.test(year)) return fail_('ปีการศึกษาปัจจุบันต้องเป็นตัวเลข 4 หลัก');
      updates[SETTING_KEYS.CURRENT_YEAR] = year;
      notes.push('ปีการศึกษาปัจจุบัน → ' + year);

      // เพิ่มเข้ารายการปีที่เปิดใช้งานให้อัตโนมัติ ถ้ายังไม่มี
      const configured = (updates[SETTING_KEYS.ACADEMIC_YEARS] !== undefined
        ? updates[SETTING_KEYS.ACADEMIC_YEARS]
        : str_(getSetting_(SETTING_KEYS.ACADEMIC_YEARS, ''))).split(',')
        .map(function (y) { return y.trim(); }).filter(String);
      if (configured.indexOf(year) === -1) {
        configured.push(year);
        configured.sort(function (a, b) { return Number(a) - Number(b); });
        updates[SETTING_KEYS.ACADEMIC_YEARS] = configured.join(',');
      }
    }

    if (p.currentSemester !== undefined) {
      const semester = str_(p.currentSemester);
      const enabled = (updates[SETTING_KEYS.SEMESTERS] !== undefined
        ? updates[SETTING_KEYS.SEMESTERS].split(',')
        : semesterList_());
      if (enabled.indexOf(semester) === -1) {
        return fail_('ภาคเรียนที่เลือกยังไม่ได้เปิดใช้งาน กรุณาเปิดใช้งานก่อน');
      }
      updates[SETTING_KEYS.CURRENT_SEMESTER] = semester;
      notes.push('ภาคเรียนปัจจุบัน → ' + semesterLabel_(semester));
    }

    if (!Object.keys(updates).length) return fail_('ไม่มีข้อมูลที่ต้องบันทึก');

    setSettings_(updates);
    logAction_('Admin', 'admin', 'ตั้งค่าปีการศึกษา/ภาคเรียน', notes.join(' | '));

    const term = currentTerm_();
    return ok_({ currentYear: term.year, currentSemester: term.semester },
      'บันทึกเรียบร้อย — ปัจจุบันคือ ' + termLabel_(term.year, term.semester));
  });
}

/** ลบปีการศึกษาออกจากรายการที่เปิดใช้งาน (ไม่ลบข้อมูลการประเมิน) */
function apiRemoveAcademicYear(token, year) {
  return guard_(function () {
    requireAdmin_(token);
    const y = str_(year);
    const term = currentTerm_();
    if (y === term.year) return fail_('ลบปีการศึกษาปัจจุบันไม่ได้ กรุณาเปลี่ยนปีการศึกษาปัจจุบันก่อน');

    const configured = str_(getSetting_(SETTING_KEYS.ACADEMIC_YEARS, '')).split(',')
      .map(function (v) { return v.trim(); }).filter(String);
    const remain = configured.filter(function (v) { return v !== y; });
    if (remain.length === configured.length) return fail_('ไม่พบปีการศึกษานี้ในรายการ');
    if (!remain.length) return fail_('ต้องมีปีการศึกษาอย่างน้อย 1 ปี');

    setSetting_(SETTING_KEYS.ACADEMIC_YEARS, remain.join(','));
    logAction_('Admin', 'admin', 'ลบปีการศึกษาออกจากรายการ', y);
    return ok_(null, 'ลบปีการศึกษา ' + y + ' ออกจากรายการเรียบร้อย ' +
      '(ข้อมูลการประเมินของปีนี้ยังอยู่ครบ หากต้องการลบข้อมูลให้ใช้เมนู "เคลียร์ข้อมูลการประเมิน")');
  });
}

// ==================== เคลียร์ข้อมูลการประเมิน ====================

/** สร้างเงื่อนไขคัดกรองตามขอบเขตที่เลือก */
function clearScopeMatcher_(options) {
  const scope = str_(options.scope) || 'term';
  const year = str_(options.year);
  const semester = str_(options.semester);

  if (scope === 'all') {
    return { label: 'ข้อมูลการประเมินทั้งหมด', phrase: 'ลบทั้งหมด',
      match: function () { return true; } };
  }
  if (scope === 'year') {
    if (!year) throw new Error('กรุณาเลือกปีการศึกษา');
    return { label: 'ปีการศึกษา ' + year, phrase: year,
      match: function (r) { return str_(r['ปีการศึกษา']) === year; } };
  }
  if (!year || !semester) throw new Error('กรุณาเลือกปีการศึกษาและภาคเรียน');
  return {
    label: termLabel_(year, semester),
    phrase: year + '/' + semester,
    match: function (r) {
      return str_(r['ปีการศึกษา']) === year && str_(r['ภาคเรียน']) === semester;
    }
  };
}

/** ดูจำนวนข้อมูลที่จะได้รับผลกระทบ ก่อนตัดสินใจ */
function apiClearPreview(token, options) {
  return guard_(function () {
    requireAdmin_(token);
    const o = options || {};
    const matcher = clearScopeMatcher_(o);
    const target = str_(o.target) || 'results';

    const results = readTable_(SHEETS.RESULTS).rows.filter(matcher.match);
    const archived = readTable_(SHEETS.ARCHIVE).rows.filter(matcher.match);

    const teachers = {}, evaluators = {};
    results.forEach(function (r) {
      teachers[str_(r['ครูผู้รับการประเมิน'])] = true;
      evaluators[str_(r['ผู้ประเมิน'])] = true;
    });

    return ok_({
      label: matcher.label,
      phrase: matcher.phrase,
      target: target,
      results: results.length,
      archived: archived.length,
      affected: (target === 'archive' ? 0 : results.length) + (target === 'results' ? 0 : archived.length),
      teachers: Object.keys(teachers).filter(String).length,
      evaluators: Object.keys(evaluators).filter(String).length
    });
  });
}

/**
 * เคลียร์ข้อมูลการประเมินตามขอบเขตที่เลือก
 * @param {Object} options {scope:'term'|'year'|'all', year, semester,
 *                          target:'results'|'archive'|'both',
 *                          mode:'archive'|'delete', backup:boolean, confirm:string, note:string}
 */
function apiClearResults(token, options) {
  return guard_(function () {
    const session = requireAdmin_(token);
    const o = options || {};
    const matcher = clearScopeMatcher_(o);
    const target = str_(o.target) || 'results';
    const mode = str_(o.mode) || 'archive';

    if (str_(o.confirm) !== matcher.phrase) {
      return fail_('ข้อความยืนยันไม่ถูกต้อง กรุณาพิมพ์ "' + matcher.phrase + '" ให้ตรงทุกตัวอักษร');
    }
    if (mode === 'archive' && target !== 'results') {
      return fail_('การย้ายเข้าคลังใช้ได้กับข้อมูลในตารางผลการประเมินเท่านั้น');
    }

    return withLock_(function () {
      const resultRows = (target === 'archive') ? []
        : readTable_(SHEETS.RESULTS).rows.filter(matcher.match);
      const archiveRows = (target === 'results') ? []
        : readTable_(SHEETS.ARCHIVE).rows.filter(matcher.match);

      if (!resultRows.length && !archiveRows.length) {
        return fail_('ไม่พบข้อมูลของ' + matcher.label + ' ที่ตรงกับเงื่อนไขที่เลือก');
      }

      // สำรองเป็นไฟล์ Excel ก่อนดำเนินการ (แนะนำอย่างยิ่งเมื่อเลือกลบถาวร)
      let backupFile = null;
      if (o.backup) {
        backupFile = backupRowsToXlsx_(
          'สำรองข้อมูลการประเมิน_' + matcher.phrase.replace('/', '-'),
          [
            { sheetName: 'ผลการประเมิน', headers: resultHeaders_(), rows: resultRows },
            { sheetName: 'คลังผลการประเมิน', headers: archiveHeaders_(), rows: archiveRows }
          ]
        );
      }

      let archivedCount = 0, deletedResults = 0, deletedArchive = 0;

      if (mode === 'archive') {
        const headers = resultHeaders_();
        const firstCode = nextCodeFromSheet_(SHEETS.ARCHIVE, 'รหัสชุดจัดเก็บ', 'ARC');
        let counter = parseInt(firstCode.split('-')[1], 10);
        const now = new Date();

        const records = resultRows.map(function (row) {
          const record = {};
          headers.forEach(function (h) { if (row[h] !== undefined) record[h] = row[h]; });
          record['รหัสชุดจัดเก็บ'] = 'ARC-' + ('0000' + (counter++)).slice(-4);
          record['ประเภทการจัดเก็บ'] = 'จัดเก็บภาคเรียน';
          record['วันที่จัดเก็บ'] = now;
          record['ผู้จัดเก็บ'] = session.name || 'Admin';
          record['หมายเหตุ'] = str_(o.note) || ('เคลียร์ข้อมูล ' + matcher.label);
          return record;
        });
        appendRecords_(SHEETS.ARCHIVE, records);
        archivedCount = records.length;
        deletedResults = deleteRecords_(SHEETS.RESULTS, resultRows.map(function (r) { return r._row; }));
      } else {
        if (resultRows.length) {
          deletedResults = deleteRecords_(SHEETS.RESULTS, resultRows.map(function (r) { return r._row; }));
        }
        if (archiveRows.length) {
          deletedArchive = deleteRecords_(SHEETS.ARCHIVE, archiveRows.map(function (r) { return r._row; }));
        }
      }

      const detail = matcher.label +
        ' | รูปแบบ: ' + (mode === 'archive' ? 'ย้ายเข้าคลัง' : 'ลบถาวร') +
        ' | ผลการประเมิน ' + deletedResults + ' รายการ' +
        (deletedArchive ? ' | คลังข้อมูล ' + deletedArchive + ' รายการ' : '') +
        (backupFile ? ' | สำรองไฟล์: ' + backupFile.name : '') +
        (str_(o.note) ? ' | หมายเหตุ: ' + str_(o.note) : '');
      logAction_('Admin', 'admin',
        mode === 'archive' ? 'เคลียร์ข้อมูล (ย้ายเข้าคลัง)' : 'เคลียร์ข้อมูล (ลบถาวร)', detail);

      const message = mode === 'archive'
        ? 'ย้ายข้อมูล ' + archivedCount + ' รายการของ' + matcher.label + ' เข้าคลังเรียบร้อย (กู้คืนได้)'
        : 'ลบข้อมูลถาวรเรียบร้อย: ผลการประเมิน ' + deletedResults + ' รายการ' +
          (deletedArchive ? ', คลังข้อมูล ' + deletedArchive + ' รายการ' : '');

      return ok_({
        archived: archivedCount,
        deletedResults: deletedResults,
        deletedArchive: deletedArchive,
        backup: backupFile
      }, message);
    });
  });
}

/**
 * สำรองข้อมูลเป็นไฟล์ Excel เก็บไว้ใน Google Drive
 * @param {string} name ชื่อไฟล์
 * @param {Array} sheets [{sheetName, headers, rows}]
 */
function backupRowsToXlsx_(name, sheets) {
  const useful = (sheets || []).filter(function (s) { return s.rows && s.rows.length; });
  if (!useful.length) return null;

  const temp = SpreadsheetApp.create('temp_backup_' + Utilities.getUuid().substring(0, 8));
  try {
    useful.forEach(function (spec, index) {
      const sheet = index === 0 ? temp.getSheets()[0] : temp.insertSheet();
      sheet.setName(spec.sheetName);
      const headers = spec.headers;
      const values = spec.rows.map(function (row) {
        return headers.map(function (h) {
          const v = row[h];
          return (v === undefined || v === null) ? '' : v;
        });
      });
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
      sheet.getRange(2, 1, values.length, headers.length).setValues(values);
      sheet.setFrozenRows(1);
    });
    SpreadsheetApp.flush();

    const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd_HHmm');
    const fileName = name + '_' + stamp + '.xlsx';
    const blob = exportBlob_(temp.getId(), 'xlsx', {});
    const file = getOrCreateReportFolder_().createFile(blob.setName(fileName));

    return {
      name: fileName,
      url: file.getUrl(),
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
      rows: useful.reduce(function (a, s) { return a + s.rows.length; }, 0)
    };
  } finally {
    try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) { /* ไม่สำคัญ */ }
  }
}
