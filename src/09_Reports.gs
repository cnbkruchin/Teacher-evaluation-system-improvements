/**
 * ============================================================================
 * ไฟล์: 09_Reports.gs  |  การประมวลผลและออกรายงาน
 *  - รวมคะแนนรายบุคคลตามภาคเรียน
 *  - เลือกและจัดลำดับผู้ถูกประเมินก่อนประมวลผล
 *  - ส่งออกเป็น Excel (.xlsx) และ PDF
 * ============================================================================
 */

const REPORT_FOLDER_NAME_ = 'รายงานผลการประเมินครู';
const MAX_INLINE_DOWNLOAD_ = 7 * 1024 * 1024; // 7 MB — ใหญ่กว่านี้ให้ดาวน์โหลดผ่านลิงก์ Google Drive

/**
 * รวมผลการประเมินเป็นรายบุคคล
 * @param {Object} options {year, semester, includeArchive, teacherIds}
 */
function buildSummaryRows_(options) {
  const o = options || {};
  const year = str_(o.year);
  const semester = str_(o.semester);
  const criteria = loadCriteria_();

  let rows = readTable_(SHEETS.RESULTS).rows;
  if (o.includeArchive) {
    // นับเฉพาะรายการที่ถูกลบออกจากตารางหลัก ไม่นับ "ฉบับแก้ไข" เพื่อไม่ให้คะแนนซ้ำซ้อน
    const archived = readTable_(SHEETS.ARCHIVE).rows.filter(function (r) {
      return str_(r['ประเภทการจัดเก็บ']) === 'จัดเก็บภาคเรียน';
    });
    rows = rows.concat(archived);
  }

  const teacherIdFilter = (o.teacherIds && o.teacherIds.length) ? o.teacherIds : null;
  const roster = (year && semester) ? dutyRosterFor_(year, semester) : { byTeacherId: {}, byTeacherName: {}, rows: [] };
  const teacherIndex = buildTeacherIndex_();
  const groups = {};

  rows.forEach(function (r) {
    if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
    if (year && year !== 'all' && str_(r['ปีการศึกษา']) !== year) return;
    if (semester && semester !== 'all' && str_(r['ภาคเรียน']) !== semester) return;

    const teacherId = str_(r['รหัสครู']);
    const teacherName = str_(r['ครูผู้รับการประเมิน']);
    if (!teacherName) return;
    const key = teacherId || teacherName;
    if (teacherIdFilter && teacherIdFilter.indexOf(key) === -1) return;

    if (!groups[key]) {
      const master = teacherIndex.byId[teacherId] || teacherIndex.byName[teacherName] || {};
      const duty = roster.byTeacherId[teacherId] || roster.byTeacherName[teacherName] || {};
      groups[key] = {
        teacherId: teacherId || '',
        name: teacherName,
        level: duty.level || master.level || str_(r['ระดับชั้น']),
        department: master.department || '',
        dutyDay: duty.day || str_(r['เวรประจำวัน']) || master.defaultDay || '',
        dutyPosition: duty.position || '',
        dutyLocation: duty.location || '',
        dutyTime: (duty.startTime && duty.endTime) ? (duty.startTime + ' - ' + duty.endTime) : '',
        byRole: {}, scores: [], count: 0, comments: [], criteriaScores: {}, evaluations: []
      };
    }

    const g = groups[key];
    const average = num_(r['คะแนนเฉลี่ย']);
    const role = str_(r['บทบาทผู้ประเมิน']);
    g.scores.push(average);
    g.count++;
    if (role) {
      g.byRole[role] = g.byRole[role] || [];
      g.byRole[role].push(average);
    }
    const comment = str_(r['ข้อเสนอแนะ']);
    if (comment) g.comments.push({ evaluator: str_(r['ผู้ประเมิน']), role: role, comment: comment });

    criteria.forEach(function (c) {
      const v = r[CRITERIA_COL_PREFIX + c.id];
      if (v === '' || v === null || v === undefined) return;
      g.criteriaScores[c.id] = g.criteriaScores[c.id] || [];
      g.criteriaScores[c.id].push(num_(v));
    });

    g.evaluations.push({
      id: str_(r['รหัสการประเมิน']),
      savedAt: formatDate_(r['วันที่บันทึก']),
      year: str_(r['ปีการศึกษา']),
      semester: str_(r['ภาคเรียน']),
      evaluator: str_(r['ผู้ประเมิน']),
      role: role,
      average: average,
      rating: str_(r['ระดับผลการประเมิน']),
      comment: comment
    });
  });

  const avgOf = function (arr) {
    if (!arr || !arr.length) return null;
    return Math.round((arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) * 100) / 100;
  };

  // ตั้งค่าน้ำหนักกลุ่มผู้ประเมิน อ่านครั้งเดียวแล้วใช้กับทุกคน
  const weighted = useRoleWeights_();
  const weights = roleWeights_();
  const normalize = normalizeRoleWeights_();

  const out = Object.keys(groups).map(function (key) {
    const g = groups[key];
    const average = avgOf(g.scores) || 0;
    const criteriaAverages = {};
    Object.keys(g.criteriaScores).forEach(function (cid) {
      criteriaAverages[cid] = avgOf(g.criteriaScores[cid]);
    });

    // คะแนนสุทธิ: ถ่วงน้ำหนักตามกลุ่มผู้ประเมิน
    const roleAverages = {
      VICE_DIRECTOR: avgOf(g.byRole[ROLES.VICE_DIRECTOR]),
      HEAD_AFFAIRS: avgOf(g.byRole[ROLES.HEAD_AFFAIRS]),
      HEAD_LEVEL: avgOf(g.byRole[ROLES.HEAD_LEVEL]),
      HEAD_DUTY: avgOf(g.byRole[ROLES.HEAD_DUTY])
    };
    const net = computeNetScore_(roleAverages, { weights: weights, normalize: normalize });

    return {
      key: key,
      teacherId: g.teacherId,
      name: g.name,
      level: g.level,
      department: g.department,
      dutyDay: g.dutyDay,
      dutyPosition: g.dutyPosition,
      dutyLocation: g.dutyLocation,
      dutyTime: g.dutyTime,
      viceDirector: avgOf(g.byRole[ROLES.VICE_DIRECTOR]),
      headAffairs: avgOf(g.byRole[ROLES.HEAD_AFFAIRS]),
      headLevel: avgOf(g.byRole[ROLES.HEAD_LEVEL]),
      headDuty: avgOf(g.byRole[ROLES.HEAD_DUTY]),
      average: average,
      rating: ratingOf_(average),
      netScore: net.net,
      netRating: net.rating,
      netBreakdown: net.breakdown,
      usedWeight: net.usedWeight,
      totalWeight: net.totalWeight,
      weighted: weighted,
      // คะแนนที่ใช้เป็นทางการ: ถ้าเปิดถ่วงน้ำหนักจะใช้คะแนนสุทธิ ถ้าไม่เปิดใช้ค่าเฉลี่ยรวม
      final: weighted ? net.net : average,
      finalRating: weighted ? net.rating : ratingOf_(average),
      count: g.count,
      comments: g.comments,
      criteriaAverages: criteriaAverages,
      evaluations: g.evaluations
    };
  });

  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}

/** สรุปการตั้งค่าน้ำหนักกลุ่มผู้ประเมิน สำหรับแสดงบนหน้าจอและใส่ในรายงาน */
function scoreWeightInfo_() {
  const weights = roleWeights_();
  const enabled = useRoleWeights_();
  const rows = Object.keys(ROLES).map(function (key) {
    return { key: key, role: ROLES[key], weight: Number(weights[key]) || 0 };
  });
  return {
    enabled: enabled,
    normalize: normalizeRoleWeights_(),
    total: rows.reduce(function (a, b) { return a + b.weight; }, 0),
    rows: rows
  };
}

/** รายชื่อผู้ถูกประเมินทั้งหมดของภาคเรียน พร้อมสถานะ เพื่อให้ผู้ดูแลเลือกก่อนส่งออก */
function apiExportCandidates(token, year, semester) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;

    const summary = buildSummaryRows_({ year: y, semester: s });
    const summaryByKey = {};
    summary.forEach(function (r) {
      summaryByKey[r.teacherId || r.name] = r;
    });

    // รวมครูที่ยังไม่ถูกประเมินเข้าไปด้วย เพื่อให้เห็นภาพรวมและเลือกได้ครบ
    const candidates = teachersWithDuty_(y, s, false).map(function (t) {
      const found = summaryByKey[t.id] || summaryByKey[t.name];
      if (found) { found.evaluated = true; return found; }
      return {
        key: t.id || t.name,
        teacherId: t.id,
        name: t.name,
        level: t.level,
        department: t.department,
        dutyDay: t.dutyDay,
        dutyPosition: t.dutyPosition,
        dutyLocation: t.dutyLocation,
        dutyTime: t.dutyTime,
        viceDirector: null, headAffairs: null, headLevel: null, headDuty: null,
        average: 0, rating: '', netScore: 0, netRating: '', netBreakdown: [],
        weighted: useRoleWeights_(), final: 0, finalRating: '',
        count: 0, comments: [], criteriaAverages: {}, evaluations: [],
        evaluated: false
      };
    });

    // ครูที่มีผลประเมินแต่ไม่อยู่ในทะเบียนครูแล้ว (เช่น ย้ายออก) ก็ยังต้องส่งออกได้
    const listedKeys = {};
    candidates.forEach(function (c) { listedKeys[c.key] = true; });
    summary.forEach(function (r) {
      if (!listedKeys[r.key]) { r.evaluated = true; r.retired = true; candidates.push(r); }
    });

    return ok_({
      year: y, semester: s,
      years: academicYears_(), semesters: semesterList_(),
      levels: LEVELS, days: DAYS,
      criteria: loadCriteria_(),
      weights: scoreWeightInfo_(),
      candidates: candidates
    });
  });
}

/** ประมวลผลตามรายการและลำดับที่เลือก เพื่อให้ตรวจสอบก่อนส่งออกจริง */
function apiPreviewExport(token, payload) {
  return guard_(function () {
    requireAdmin_(token);
    const p = payload || {};
    const rows = orderedReportRows_(p);
    const stats = {
      selected: rows.length,
      evaluated: rows.filter(function (r) { return r.count > 0; }).length,
      notEvaluated: rows.filter(function (r) { return r.count === 0; }).length,
      average: rows.length
        ? Math.round((rows.reduce(function (a, b) { return a + (b.final || 0); }, 0) / rows.length) * 100) / 100
        : 0,
      weighted: useRoleWeights_()
    };
    return ok_({
      rows: rows, stats: stats, criteria: loadCriteria_(),
      weights: scoreWeightInfo_()
    });
  });
}

/** จัดเรียงรายการตามที่ผู้ดูแลเลือก (ลำดับเอง / ชื่อ / คะแนน / ระดับชั้น / วันเวร) */
function orderedReportRows_(payload) {
  const p = payload || {};
  const term = currentTerm_();
  const year = str_(p.year) || term.year;
  const semester = str_(p.semester) || term.semester;
  const ids = (p.teacherIds || []).map(String);

  const all = buildSummaryRows_({ year: year, semester: semester, includeArchive: !!p.includeArchive });
  const byKey = {};
  all.forEach(function (r) { byKey[r.key] = r; });

  // เติมครูที่ถูกเลือกแต่ยังไม่มีผลประเมิน เพื่อให้รายงานแสดงว่า "ยังไม่ได้รับการประเมิน"
  const teacherIndex = buildTeacherIndex_();
  const roster = dutyRosterFor_(year, semester);
  let rows;

  if (ids.length) {
    rows = ids.map(function (key) {
      if (byKey[key]) return byKey[key];
      const t = teacherIndex.byId[key];
      if (!t) return null;
      const duty = roster.byTeacherId[key] || {};
      return {
        key: key, teacherId: t.id, name: t.name, level: duty.level || t.level, department: t.department,
        dutyDay: duty.day || t.defaultDay || '', dutyPosition: duty.position || '',
        dutyLocation: duty.location || '', dutyTime: '',
        viceDirector: null, headAffairs: null, headLevel: null, headDuty: null,
        average: 0, rating: '', netScore: 0, netRating: '', netBreakdown: [],
        weighted: useRoleWeights_(), final: 0, finalRating: '',
        count: 0, comments: [], criteriaAverages: {}, evaluations: []
      };
    }).filter(Boolean);
  } else {
    rows = all.slice();
  }

  const sortBy = str_(p.sortBy) || 'custom';
  if (sortBy === 'name') rows.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  else if (sortBy === 'scoreDesc') rows.sort(function (a, b) { return (b.final || 0) - (a.final || 0); });
  else if (sortBy === 'scoreAsc') rows.sort(function (a, b) { return (a.final || 0) - (b.final || 0); });
  else if (sortBy === 'level') {
    rows.sort(function (a, b) {
      const d = LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'th');
    });
  } else if (sortBy === 'dutyDay') {
    rows.sort(function (a, b) {
      const d = DAYS.indexOf(a.dutyDay) - DAYS.indexOf(b.dutyDay);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'th');
    });
  }
  // sortBy === 'custom' → คงลำดับตามที่ผู้ดูแลจัดไว้เอง

  return rows;
}

// ==================== สรุปผลลงชีท "สรุปผลการประเมิน" ====================

function apiGenerateSummary(token, payload) {
  return guard_(function () {
    requireAdmin_(token);
    const p = payload || {};
    const term = currentTerm_();
    const year = str_(p.year) || term.year;
    const semester = str_(p.semester) || term.semester;
    const rows = orderedReportRows_(p);
    if (!rows.length) return fail_('ไม่มีข้อมูลสำหรับสรุปผล');

    return withLock_(function () {
      clearBody_(SHEETS.SUMMARY);
      const sheet = getSheet_(SHEETS.SUMMARY);
      const values = rows.map(function (r, i) {
        return [
          i + 1, r.teacherId, r.name, r.level, r.dutyDay, year, semester,
          r.viceDirector === null ? '-' : r.viceDirector,
          r.headAffairs === null ? '-' : r.headAffairs,
          r.headLevel === null ? '-' : r.headLevel,
          r.headDuty === null ? '-' : r.headDuty,
          r.count ? r.average : '-',
          r.count ? (r.weighted ? r.netScore : '-') : '-',
          r.count ? r.finalRating : 'ยังไม่ได้รับการประเมิน',
          r.count
        ];
      });
      sheet.getRange(2, 1, values.length, SUMMARY_HEADERS.length).setValues(values);

      // ระบายสีระดับผลการประเมินให้อ่านง่าย
      const ratingCol = SUMMARY_HEADERS.indexOf('ระดับผลการประเมิน') + 1;
      rows.forEach(function (r, i) {
        sheet.getRange(i + 2, ratingCol).setBackground(ratingColor_(r.count ? r.finalRating : ''));
      });
      sheet.autoResizeColumns(1, SUMMARY_HEADERS.length);

      logAction_('Admin', 'admin', 'สรุปผลการประเมิน',
        termLabel_(year, semester) + ' จำนวน ' + rows.length + ' คน');
      return ok_({ count: rows.length, sheetName: SHEETS.SUMMARY },
        'สรุปผลเรียบร้อย ' + rows.length + ' คน (ดูได้ที่ชีท "' + SHEETS.SUMMARY + '")');
    });
  });
}

function ratingColor_(rating) {
  switch (rating) {
    case RATING_LABELS[0]: return '#c8e6c9';
    case RATING_LABELS[1]: return '#dcedc8';
    case RATING_LABELS[2]: return '#fff9c4';
    case RATING_LABELS[3]: return '#ffe0b2';
    case RATING_LABELS[4]: return '#ffcdd2';
    default: return '#eceff1';
  }
}

// ==================== ส่งออก Excel / PDF ====================

/**
 * ส่งออกรายงานตามรายการและลำดับที่เลือกไว้
 * payload: {year, semester, teacherIds[], sortBy, formats:['xlsx','pdf'],
 *           options:{detail, comments, rawList, orientation, title, note}}
 */
function apiExportReport(token, payload) {
  return guard_(function () {
    requireAdmin_(token);
    const p = payload || {};
    const formats = (p.formats && p.formats.length) ? p.formats : ['xlsx'];
    const rows = orderedReportRows_(p);
    if (!rows.length) return fail_('ไม่มีข้อมูลสำหรับส่งออก กรุณาเลือกผู้ถูกประเมินอย่างน้อย 1 คน');

    const term = currentTerm_();
    const year = str_(p.year) || term.year;
    const semester = str_(p.semester) || term.semester;
    const options = p.options || {};

    const temp = buildReportSpreadsheet_(rows, year, semester, options);
    SpreadsheetApp.flush();

    const files = [];
    try {
      const folder = getOrCreateReportFolder_();
      const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd_HHmm');
      const baseName = 'รายงานผลการประเมินครู_' + semester + '-' + year + '_' + stamp;

      if (formats.indexOf('xlsx') !== -1) {
        files.push(saveExport_(folder, temp.getId(), 'xlsx', baseName, options));
      }
      if (formats.indexOf('pdf') !== -1) {
        files.push(saveExport_(folder, temp.getId(), 'pdf', baseName, options));
      }
      logAction_('Admin', 'admin', 'ส่งออกรายงาน',
        termLabel_(year, semester) + ' | ' + rows.length + ' คน | รูปแบบ: ' + formats.join(', '));
    } finally {
      // ลบไฟล์ชั่วคราวเสมอ แม้การส่งออกจะล้มเหลว
      try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) { /* ไม่สำคัญ */ }
    }

    return ok_({ files: files, count: rows.length, term: termLabel_(year, semester) },
      'ส่งออกรายงานเรียบร้อย (' + rows.length + ' คน)');
  });
}

function getOrCreateReportFolder_() {
  const folders = DriveApp.getFoldersByName(REPORT_FOLDER_NAME_);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(REPORT_FOLDER_NAME_);
}

/** ดึงไฟล์ export จาก Google Sheets แล้วบันทึกลง Drive */
function saveExport_(folder, spreadsheetId, format, baseName, options) {
  const blob = exportBlob_(spreadsheetId, format, options);
  const fileName = baseName + (format === 'xlsx' ? '.xlsx' : '.pdf');
  const file = folder.createFile(blob.setName(fileName));

  const size = blob.getBytes().length;
  const result = {
    name: fileName,
    format: format,
    url: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    size: size,
    sizeText: (size / 1024 / 1024).toFixed(2) + ' MB',
    mimeType: format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf'
  };
  // ไฟล์ขนาดไม่ใหญ่ ส่ง base64 กลับไปให้ดาวน์โหลดได้ทันทีโดยไม่ต้องเปิด Drive
  if (size <= MAX_INLINE_DOWNLOAD_) result.base64 = Utilities.base64Encode(blob.getBytes());
  return result;
}

/** เรียก Google Sheets export API ด้วยสิทธิ์ของสคริปต์ */
function exportBlob_(spreadsheetId, format, options) {
  const o = options || {};
  let url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=' + format;
  if (format === 'pdf') {
    url += '&size=A4' +
      '&portrait=' + (str_(o.orientation) === 'portrait' ? 'true' : 'false') +
      '&fitw=true&gridlines=false&printtitle=false&sheetnames=false' +
      '&pagenumbers=true&attachment=true' +
      '&top_margin=0.5&bottom_margin=0.5&left_margin=0.4&right_margin=0.4';
  }
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('ส่งออกไฟล์ไม่สำเร็จ (รหัส ' + response.getResponseCode() + ') กรุณาลองใหม่อีกครั้ง');
  }
  return response.getBlob();
}

/** สร้างสเปรดชีตชั่วคราวที่จัดหน้าเรียบร้อยสำหรับส่งออก */
function buildReportSpreadsheet_(rows, year, semester, options) {
  const o = options || {};
  const criteria = loadCriteria_();
  const org = str_(getSetting_(SETTING_KEYS.ORG_NAME, 'โรงเรียน'));
  const title = str_(o.title) || 'รายงานผลการประเมินการปฏิบัติงานครู';

  const temp = SpreadsheetApp.create('temp_report_' + Utilities.getUuid().substring(0, 8));
  const sheet = temp.getSheets()[0];
  sheet.setName('สรุปผลการประเมิน');

  // ---- กำหนดคอลัมน์ของตารางสรุป (เพิ่มคอลัมน์คะแนนสุทธิเมื่อเปิดใช้การถ่วงน้ำหนัก) ----
  const weightInfo = scoreWeightInfo_();
  const useNet = weightInfo.enabled;
  const dash = function (v) { return (v === null || v === undefined) ? '-' : v; };
  const weightTag = function (key) {
    if (!useNet) return '';
    const found = weightInfo.rows.filter(function (r) { return r.key === key; })[0];
    return found ? '\n(' + found.weight + '%)' : '';
  };

  const columns = [
    { title: 'ลำดับ', width: 45, align: 'center', get: function (r, i) { return i + 1; } },
    { title: 'ชื่อ-นามสกุล', width: 205, get: function (r) { return r.name; } },
    { title: 'ระดับชั้น', width: 72, align: 'center', get: function (r) { return r.level || '-'; } },
    { title: 'เวรประจำวัน', width: 92, align: 'center', get: function (r) { return r.dutyDay || '-'; } },
    { title: 'บทบาทในเวร', width: 92, align: 'center', get: function (r) { return r.dutyPosition || '-'; } },
    { title: 'รอง ผอ.' + weightTag('VICE_DIRECTOR'), width: 78, num: true,
      get: function (r) { return dash(r.viceDirector); } },
    { title: 'หน.กิจการฯ' + weightTag('HEAD_AFFAIRS'), width: 84, num: true,
      get: function (r) { return dash(r.headAffairs); } },
    { title: 'หน.ระดับชั้น' + weightTag('HEAD_LEVEL'), width: 84, num: true,
      get: function (r) { return dash(r.headLevel); } },
    { title: 'หน.เวรฯ' + weightTag('HEAD_DUTY'), width: 76, num: true,
      get: function (r) { return dash(r.headDuty); } },
    { title: 'คะแนนเฉลี่ย', width: 84, num: true,
      get: function (r) { return r.count ? r.average : '-'; } },
    useNet ? { title: 'คะแนนสุทธิ', width: 90, num: true, bold: true,
      get: function (r) { return r.count ? r.netScore : '-'; } } : null,
    { title: 'ระดับผลการประเมิน', width: 118, align: 'center', rating: true,
      get: function (r) { return r.count ? r.finalRating : 'ยังไม่ได้รับการประเมิน'; } },
    { title: 'จำนวนครั้งที่ประเมิน', width: 82, align: 'center',
      get: function (r) { return r.count; } }
  ].filter(Boolean);

  const headers = columns.map(function (c) { return c.title; });

  // ---- ส่วนหัวรายงาน ----
  const headerLines = [
    [org],
    [title],
    [termLabel_(year, semester) + '   |   กลุ่มบริหารงานกิจการนักเรียน'],
    ['จำนวนผู้ถูกประเมิน ' + rows.length + ' คน   |   ออกรายงานเมื่อ ' + formatDate_(new Date(), 'd MMMM yyyy HH:mm') + ' น.']
  ];
  if (useNet) {
    headerLines.push(['คะแนนสุทธิคิดจากน้ำหนักผู้ประเมิน: ' +
      weightInfo.rows.filter(function (r) { return r.weight > 0; })
        .map(function (r) { return r.role + ' ' + r.weight + '%'; }).join('  ·  ') +
      (weightInfo.normalize ? '   (ปรับสัดส่วนอัตโนมัติเมื่อขาดกลุ่มผู้ประเมิน)' : '')]);
  }
  if (str_(o.note)) headerLines.push([str_(o.note)]);

  headerLines.forEach(function (line, i) {
    sheet.getRange(i + 1, 1, 1, headers.length).merge().setValue(line[0])
      .setHorizontalAlignment('center')
      .setFontWeight(i <= 1 ? 'bold' : 'normal')
      .setFontSize(i === 0 ? 16 : (i === 1 ? 14 : 10))
      .setFontColor(i <= 1 ? '#1a237e' : '#555555')
      .setWrap(true);
  });

  const headerRow = headerLines.length + 2;
  sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers])
    .setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(headerRow, useNet ? 46 : 34);

  const values = rows.map(function (r, i) {
    return columns.map(function (c) { return c.get(r, i); });
  });
  if (values.length) sheet.getRange(headerRow + 1, 1, values.length, headers.length).setValues(values);

  // จัดรูปแบบตามชนิดของแต่ละคอลัมน์
  const dataRange = sheet.getRange(headerRow, 1, values.length + 1, headers.length);
  dataRange.setBorder(true, true, true, true, true, true, '#b0bec5', SpreadsheetApp.BorderStyle.SOLID);

  columns.forEach(function (c, index) {
    sheet.setColumnWidth(index + 1, c.width);
    if (!values.length) return;
    const range = sheet.getRange(headerRow + 1, index + 1, values.length, 1);
    if (c.num) range.setNumberFormat('0.00').setHorizontalAlignment('center');
    else if (c.align) range.setHorizontalAlignment(c.align);
    if (c.bold) range.setFontWeight('bold');
    if (c.rating) {
      rows.forEach(function (r, i) {
        sheet.getRange(headerRow + 1 + i, index + 1)
          .setBackground(ratingColor_(r.count ? r.finalRating : ''));
      });
    }
  });
  sheet.setFrozenRows(headerRow);

  // ---- ช่องลงนาม ----
  const signer = str_(getSetting_(SETTING_KEYS.REPORT_SIGNER, ''));
  if (signer) {
    const signRow = headerRow + values.length + 3;
    sheet.getRange(signRow, 8, 1, 4).merge().setValue('ลงชื่อ ..................................................').setHorizontalAlignment('center');
    sheet.getRange(signRow + 1, 8, 1, 4).merge().setValue('( ' + signer + ' )').setHorizontalAlignment('center');
    sheet.getRange(signRow + 2, 8, 1, 4).merge()
      .setValue(str_(getSetting_(SETTING_KEYS.REPORT_SIGNER_ROLE, ''))).setHorizontalAlignment('center');
  }

  // ---- แผ่นงาน: คะแนนรายข้อ ----
  if (o.detail !== false) {
    const detailSheet = temp.insertSheet('คะแนนรายข้อ');
    const detailHeaders = ['ลำดับ', 'ชื่อ-นามสกุล'].concat(criteria.map(function (c) { return 'ข้อ ' + c.id; })).concat(['เฉลี่ย']);
    detailSheet.getRange(1, 1, 1, 2).merge().setValue('คะแนนเฉลี่ยรายข้อ — ' + termLabel_(year, semester))
      .setFontWeight('bold').setFontSize(12);
    detailSheet.getRange(2, 1, 1, detailHeaders.length).setValues([detailHeaders])
      .setBackground('#00695c').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');

    const detailValues = rows.map(function (r, i) {
      const line = [i + 1, r.name];
      criteria.forEach(function (c) {
        const v = r.criteriaAverages[c.id];
        line.push(v === undefined || v === null ? '-' : v);
      });
      line.push(r.count ? r.average : '-');
      return line;
    });
    if (detailValues.length) {
      detailSheet.getRange(3, 1, detailValues.length, detailHeaders.length).setValues(detailValues);
      detailSheet.getRange(3, 3, detailValues.length, criteria.length + 1)
        .setNumberFormat('0.00').setHorizontalAlignment('center');
    }
    // คำอธิบายเลขข้อ ไว้ท้ายแผ่นงาน
    const legendRow = detailValues.length + 5;
    detailSheet.getRange(legendRow, 1).setValue('คำอธิบายเกณฑ์การประเมิน').setFontWeight('bold');
    criteria.forEach(function (c, i) {
      detailSheet.getRange(legendRow + 1 + i, 1).setValue('ข้อ ' + c.id);
      detailSheet.getRange(legendRow + 1 + i, 2, 1, 6).merge().setValue(c.name);
    });
    detailSheet.setColumnWidth(1, 60);
    detailSheet.setColumnWidth(2, 200);
    detailSheet.setFrozenRows(2);
  }

  // ---- แผ่นงาน: วิธีคิดคะแนนสุทธิ (แสดงเมื่อเปิดใช้การถ่วงน้ำหนัก) ----
  if (useNet) {
    const ws = temp.insertSheet('วิธีคิดคะแนนสุทธิ');
    ws.getRange(1, 1, 1, 4).merge().setValue('วิธีคิดคะแนนสุทธิของครูแต่ละคน')
      .setFontWeight('bold').setFontSize(14).setFontColor('#1a237e');
    ws.getRange(2, 1, 1, 4).merge()
      .setValue('คะแนนสุทธิ = ผลรวมของ (คะแนนเฉลี่ยของกลุ่มผู้ประเมิน × น้ำหนักของกลุ่ม) ÷ ผลรวมน้ำหนักที่ใช้จริง')
      .setWrap(true);
    ws.getRange(3, 1, 1, 4).merge()
      .setValue(weightInfo.normalize
        ? 'หมายเหตุ: ระบบปรับสัดส่วนอัตโนมัติ — หากครูไม่ได้รับการประเมินจากกลุ่มใด จะหารด้วยผลรวมน้ำหนักเฉพาะกลุ่มที่ประเมินจริง'
        : 'หมายเหตุ: หารด้วยผลรวมน้ำหนักทั้งหมด กลุ่มที่ไม่มีคะแนนถือเป็น 0 คะแนน')
      .setWrap(true).setFontColor('#555555');

    ws.getRange(5, 1, 1, 2).setValues([['กลุ่มผู้ประเมิน', 'น้ำหนัก (%)']])
      .setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    const weightRows = weightInfo.rows.map(function (r) { return [r.role, r.weight]; });
    ws.getRange(6, 1, weightRows.length, 2).setValues(weightRows);
    ws.getRange(6 + weightRows.length, 1, 1, 2).setValues([['รวม', weightInfo.total]])
      .setFontWeight('bold').setBackground('#eceff1');
    ws.setColumnWidth(1, 320);
    ws.setColumnWidth(2, 110);

    // ตัวอย่างการคำนวณของคนแรกที่มีคะแนน เพื่อให้ตรวจสอบที่มาได้
    const sample = rows.filter(function (r) { return r.count > 0 && r.netBreakdown && r.netBreakdown.length; })[0];
    if (sample) {
      const startRow = 8 + weightRows.length;
      ws.getRange(startRow, 1, 1, 4).merge()
        .setValue('ตัวอย่างการคำนวณ: ' + sample.name).setFontWeight('bold').setFontSize(12);
      ws.getRange(startRow + 1, 1, 1, 4)
        .setValues([['กลุ่มผู้ประเมิน', 'คะแนนเฉลี่ยของกลุ่ม', 'น้ำหนักที่ใช้จริง (%)', 'ส่งผลต่อคะแนนสุทธิ']])
        .setBackground('#eceff1').setFontWeight('bold');
      const sampleRows = sample.netBreakdown.map(function (b) {
        return [b.role, b.average === null ? 'ไม่มีการประเมิน' : b.average,
          b.counted ? b.effectiveWeight : 0, b.contribution];
      });
      ws.getRange(startRow + 2, 1, sampleRows.length, 4).setValues(sampleRows);
      ws.getRange(startRow + 2 + sampleRows.length, 1, 1, 4)
        .setValues([['คะแนนสุทธิ', '', '', sample.netScore]])
        .setFontWeight('bold').setBackground('#e8eaf6');
      ws.getRange(startRow + 2, 2, sampleRows.length + 1, 3).setNumberFormat('0.00');
      ws.setColumnWidth(3, 160);
      ws.setColumnWidth(4, 160);
    }
  }

  // ---- แผ่นงาน: ข้อเสนอแนะ ----
  if (o.comments !== false) {
    const commentRows = [];
    rows.forEach(function (r) {
      r.comments.forEach(function (c) {
        commentRows.push([r.name, c.evaluator, c.role, c.comment]);
      });
    });
    if (commentRows.length) {
      const cs = temp.insertSheet('ข้อเสนอแนะ');
      cs.getRange(1, 1, 1, 4).setValues([['ครูผู้รับการประเมิน', 'ผู้ประเมิน', 'บทบาท', 'ข้อเสนอแนะ']])
        .setBackground('#e65100').setFontColor('#ffffff').setFontWeight('bold');
      cs.getRange(2, 1, commentRows.length, 4).setValues(commentRows).setWrap(true);
      cs.setColumnWidth(1, 180); cs.setColumnWidth(2, 180); cs.setColumnWidth(3, 200); cs.setColumnWidth(4, 420);
      cs.setFrozenRows(1);
    }
  }

  // ---- แผ่นงาน: รายการประเมินทั้งหมด ----
  if (o.rawList) {
    const rawRows = [];
    rows.forEach(function (r) {
      r.evaluations.forEach(function (e) {
        rawRows.push([e.savedAt, r.name, e.evaluator, e.role, e.average, e.rating, e.comment]);
      });
    });
    if (rawRows.length) {
      const rs = temp.insertSheet('รายการประเมินทั้งหมด');
      rs.getRange(1, 1, 1, 7).setValues([['วันที่บันทึก', 'ครู', 'ผู้ประเมิน', 'บทบาท', 'คะแนนเฉลี่ย', 'ระดับ', 'ข้อเสนอแนะ']])
        .setBackground('#37474f').setFontColor('#ffffff').setFontWeight('bold');
      rs.getRange(2, 1, rawRows.length, 7).setValues(rawRows);
      rs.getRange(2, 5, rawRows.length, 1).setNumberFormat('0.00');
      rs.setColumnWidth(1, 140); rs.setColumnWidth(2, 180); rs.setColumnWidth(3, 180);
      rs.setColumnWidth(4, 200); rs.setColumnWidth(7, 320);
      rs.setFrozenRows(1);
    }
  }

  return temp;
}
