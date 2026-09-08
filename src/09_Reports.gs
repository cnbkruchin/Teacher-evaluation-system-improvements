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
 * รวมผลการประเมินเป็นรายบุคคล — แยกคะแนนตาม "ชุดประเมิน" แล้วแปลงเป็นคะแนนที่หน่วยงานได้รับ
 *
 * ขั้นตอนการคิดคะแนนของครู 1 คน ในชุดประเมิน 1 ชุด
 *   1. เฉลี่ยคะแนนของผู้ประเมินแต่ละกลุ่ม            → คะแนนเฉลี่ยของกลุ่ม
 *   2. ถ่วงน้ำหนักกลุ่มตามสัดส่วนที่ตั้งไว้           → คะแนนสุทธิ (เต็มเท่ากับคะแนนเต็มต่อข้อ)
 *   3. เทียบบัญญัติไตรยางศ์เข้ากับคะแนนเต็มของหน่วยงาน → คะแนนที่หน่วยงานได้รับ
 *      เช่น สุทธิ 5.00 จากเต็ม 5 และหน่วยงานกำหนด 20 คะแนน → ได้ 20.00 คะแนน
 *
 * @param {Object} options {year, semester, includeArchive, teacherIds}
 */
function buildSummaryRows_(options) {
  const o = options || {};
  const year = str_(o.year);
  const semester = str_(o.semester);

  // ---- ข้อมูลชุดประเมินทั้งหมด (อ่านครั้งเดียวแล้วใช้กับครูทุกคน) ----
  const allSets = loadSets_();
  const groupMap = loadAllSetGroups_();
  const setInfo = {};
  allSets.forEach(function (st) {
    setInfo[st.id] = { set: st, groups: loadSetGroups_(st.id, groupMap), criteria: loadCriteria_(st.id) };
  });
  const mainSetId = defaultSetId_();
  const mainInfo = setInfo[mainSetId] || setInfo[allSets[0].id];
  const criteria = mainInfo ? mainInfo.criteria : loadCriteria_();

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
  const evaluatorIndex = buildEvaluatorIndex_();
  const groups = {};
  const setsWithData = {};

  rows.forEach(function (r) {
    if (str_(r['สถานะ']) === STATUS.CANCELLED) return;
    if (year && year !== 'all' && str_(r['ปีการศึกษา']) !== year) return;
    if (semester && semester !== 'all' && str_(r['ภาคเรียน']) !== semester) return;

    const teacherId = str_(r['รหัสครู']);
    const teacherName = str_(r['ครูผู้รับการประเมิน']);
    if (!teacherName) return;
    const key = teacherId || teacherName;
    if (teacherIdFilter && teacherIdFilter.indexOf(key) === -1) return;

    // ผลการประเมินที่บันทึกก่อนมีระบบชุดประเมิน ถือว่าอยู่ในชุดหลัก
    const setId = str_(r['รหัสชุด']) || mainSetId;
    const info = setInfo[setId];
    if (!info) return;              // ชุดที่ถูกลบทิ้งไปแล้ว
    setsWithData[setId] = true;

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
        byRole: {}, scores: [], count: 0, comments: [], criteriaScores: {}, evaluations: [], bySet: {}
      };
    }

    const g = groups[key];
    const average = num_(r['คะแนนเฉลี่ย']);
    const role = str_(r['บทบาทผู้ประเมิน']);
    const evaluatorName = str_(r['ผู้ประเมิน']);

    // กลุ่มผู้ประเมินของชุดนี้ (ข้อมูลเดิมที่ยังไม่ระบุกลุ่ม จะเทียบจากบทบาทให้อัตโนมัติ)
    let groupKey = str_(r['กลุ่มผู้ประเมิน']);
    if (!groupKey) {
      const known = evaluatorIndex.byName[evaluatorName] || {};
      const resolved = groupOfEvaluator_(info.groups, {
        id: str_(r['รหัสผู้ประเมิน']) || known.id,
        name: evaluatorName,
        role: role || known.role
      });
      groupKey = resolved ? resolved.key : '';
    }

    g.scores.push(average);
    g.count++;
    if (role) {
      g.byRole[role] = g.byRole[role] || [];
      g.byRole[role].push(average);
    }
    const comment = str_(r['ข้อเสนอแนะ']);
    if (comment) g.comments.push({ evaluator: evaluatorName, role: role, comment: comment, setId: setId });

    if (!g.bySet[setId]) {
      g.bySet[setId] = { scores: [], byGroup: {}, criteriaScores: {}, comments: [], count: 0 };
    }
    const bucket = g.bySet[setId];
    bucket.scores.push(average);
    bucket.count++;
    if (groupKey) {
      bucket.byGroup[groupKey] = bucket.byGroup[groupKey] || [];
      bucket.byGroup[groupKey].push(average);
    }
    if (comment) bucket.comments.push({ evaluator: evaluatorName, role: role, comment: comment });

    info.criteria.forEach(function (c) {
      const v = r[CRITERIA_COL_PREFIX + c.id];
      if (v === '' || v === null || v === undefined) return;
      bucket.criteriaScores[c.id] = bucket.criteriaScores[c.id] || [];
      bucket.criteriaScores[c.id].push(num_(v));
      if (setId === mainSetId) {
        g.criteriaScores[c.id] = g.criteriaScores[c.id] || [];
        g.criteriaScores[c.id].push(num_(v));
      }
    });

    g.evaluations.push({
      id: str_(r['รหัสการประเมิน']),
      savedAt: formatDate_(r['วันที่บันทึก']),
      year: str_(r['ปีการศึกษา']),
      semester: str_(r['ภาคเรียน']),
      setId: setId,
      setName: info.set.name,
      evaluator: evaluatorName,
      role: role,
      group: groupKey,
      average: average,
      scaleMax: info.set.scaleMax,
      rating: str_(r['ระดับผลการประเมิน']),
      comment: comment
    });
  });

  const avgOf = function (arr) {
    if (!arr || !arr.length) return null;
    return Math.round((arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) * 100) / 100;
  };

  // ชุดที่นำมาแสดงในรายงาน = ชุดที่เปิดใช้งาน + ชุดที่มีข้อมูลอยู่แล้ว
  const reportSets = allSets.filter(function (st) {
    return st.status !== STATUS.INACTIVE || setsWithData[st.id];
  });
  const fullMarksTotal = reportSets.reduce(function (a, st) { return a + (Number(st.fullMarks) || 0); }, 0);

  const out = Object.keys(groups).map(function (key) {
    const g = groups[key];
    const average = avgOf(g.scores) || 0;
    const criteriaAverages = {};
    Object.keys(g.criteriaScores).forEach(function (cid) {
      criteriaAverages[cid] = avgOf(g.criteriaScores[cid]);
    });

    // ---- คะแนนแยกตามชุดประเมิน ----
    let convertedTotal = 0;
    let mainNet = null;
    const setRows = reportSets.map(function (st) {
      const info = setInfo[st.id];
      const bucket = g.bySet[st.id];
      const groupAverages = {};
      const criteriaAvg = {};
      if (bucket) {
        Object.keys(bucket.byGroup).forEach(function (gk) { groupAverages[gk] = avgOf(bucket.byGroup[gk]); });
        Object.keys(bucket.criteriaScores).forEach(function (cid) { criteriaAvg[cid] = avgOf(bucket.criteriaScores[cid]); });
      }
      const net = computeNetScore_(groupAverages, {
        groups: info.groups, normalize: st.normalize, scaleMax: st.scaleMax
      });
      const plain = bucket ? (avgOf(bucket.scores) || 0) : 0;
      const score = st.useGroupWeights ? net.net : plain;
      const converted = bucket && bucket.count ? convertScore_(score, st) : null;
      if (converted !== null) convertedTotal += converted;
      if (st.id === mainSetId) mainNet = net;

      return {
        setId: st.id,
        setName: st.name,
        scaleMax: st.scaleMax,
        fullMarks: Number(st.fullMarks) || 0,
        weighted: st.useGroupWeights,
        count: bucket ? bucket.count : 0,
        average: bucket ? plain : null,
        net: net.net,
        score: bucket && bucket.count ? Math.round(score * 100) / 100 : null,
        converted: converted,
        rating: bucket && bucket.count ? ratingOf_(score, st.scaleMax) : '',
        breakdown: net.breakdown,
        criteriaAverages: criteriaAvg,
        comments: bucket ? bucket.comments : []
      };
    });

    // ---- คะแนนสุทธิของชุดหลัก (คงชื่อฟิลด์เดิมไว้เพื่อความเข้ากันได้กับรายงานเดิม) ----
    const mainSet = (setInfo[mainSetId] || {}).set || defaultSet_();
    const net = mainNet || computeNetScore_({}, { groups: (setInfo[mainSetId] || {}).groups, scaleMax: mainSet.scaleMax });
    const weighted = !!mainSet.useGroupWeights;

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
      rating: ratingOf_(average, mainSet.scaleMax),
      netScore: net.net,
      netRating: net.rating,
      netBreakdown: net.breakdown,
      usedWeight: net.usedWeight,
      totalWeight: net.totalWeight,
      weighted: weighted,
      // คะแนนที่ใช้เป็นทางการ: ถ้าเปิดถ่วงน้ำหนักจะใช้คะแนนสุทธิ ถ้าไม่เปิดใช้ค่าเฉลี่ยรวม
      final: weighted ? net.net : average,
      finalRating: weighted ? net.rating : ratingOf_(average, mainSet.scaleMax),
      // ---- คะแนนที่หน่วยงานได้รับ ----
      sets: setRows,
      converted: Math.round(convertedTotal * 100) / 100,
      fullMarks: fullMarksTotal,
      count: g.count,
      comments: g.comments,
      criteriaAverages: criteriaAverages,
      evaluations: g.evaluations
    };
  });

  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}

/** แถวคะแนนรายชุดของครูที่ยังไม่ได้รับการประเมิน (ใช้เติมให้โครงสร้างข้อมูลครบ) */
function emptySetRows_() {
  return activeSets_().map(function (st) {
    return {
      setId: st.id, setName: st.name, scaleMax: st.scaleMax,
      fullMarks: Number(st.fullMarks) || 0, weighted: st.useGroupWeights,
      count: 0, average: null, net: 0, score: null, converted: null,
      rating: '', breakdown: [], criteriaAverages: {}, comments: []
    };
  });
}

/** ชุดประเมินที่นำมาแสดงในรายงาน พร้อมคะแนนเต็มรวมของทุกชุด */
function reportSetInfo_() {
  const sets = activeSets_();
  return {
    sets: sets.map(function (st) {
      return {
        id: st.id, name: st.name, description: st.description,
        scaleMax: st.scaleMax, fullMarks: Number(st.fullMarks) || 0,
        weighted: st.useGroupWeights, normalize: st.normalize
      };
    }),
    fullMarksTotal: sets.reduce(function (a, st) { return a + (Number(st.fullMarks) || 0); }, 0),
    converts: sets.some(function (st) { return Number(st.fullMarks) > 0; }),
    multiple: sets.length > 1
  };
}

/** สรุปการตั้งค่าน้ำหนักกลุ่มผู้ประเมินของชุดที่ระบุ สำหรับแสดงบนหน้าจอและใส่ในรายงาน */
function scoreWeightInfo_(setId) {
  const set = resolveSet_(setId);
  const groups = loadSetGroups_(set.id);
  const rows = groups.map(function (g) {
    return {
      key: g.key, role: g.name, name: g.name, type: g.type,
      members: g.members, weight: Number(g.weight) || 0
    };
  });
  return {
    setId: set.id,
    setName: set.name,
    scaleMax: set.scaleMax,
    fullMarks: Number(set.fullMarks) || 0,
    enabled: !!set.useGroupWeights,
    normalize: !!set.normalize,
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
        weighted: defaultSet_().useGroupWeights, final: 0, finalRating: '',
        sets: emptySetRows_(), converted: 0, fullMarks: reportSetInfo_().fullMarksTotal,
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
      sets: reportSetInfo_(),
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
      weighted: defaultSet_().useGroupWeights,
      converted: rows.length
        ? Math.round(rows.reduce(function (a, b) { return a + (b.converted || 0); }, 0) * 100) / 100
        : 0,
      fullMarks: reportSetInfo_().fullMarksTotal
    };
    return ok_({
      rows: rows, stats: stats, criteria: loadCriteria_(),
      weights: scoreWeightInfo_(), sets: reportSetInfo_()
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
        weighted: defaultSet_().useGroupWeights, final: 0, finalRating: '',
        sets: emptySetRows_(), converted: 0, fullMarks: reportSetInfo_().fullMarksTotal,
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
          r.count ? r.converted : '-',
          r.fullMarks || '-',
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
  const setInfo = reportSetInfo_();
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
    useNet ? { title: 'คะแนนสุทธิ', width: 90, num: true,
      get: function (r) { return r.count ? r.netScore : '-'; } } : null,
    setInfo.converts ? {
      title: 'คะแนนที่หน่วยงานได้รับ\n(เต็ม ' + setInfo.fullMarksTotal + ')',
      width: 108, num: true, bold: true,
      get: function (r) { return r.count ? r.converted : '-'; } } : null,
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
  if (setInfo.converts) {
    headerLines.push(['คะแนนที่หน่วยงานได้รับคิดจาก: ' +
      setInfo.sets.filter(function (st) { return st.fullMarks > 0; })
        .map(function (st) { return st.name + ' เต็ม ' + st.fullMarks + ' คะแนน (มาตราข้อละ ' + st.scaleMax + ')'; })
        .join('  ·  ') +
      '   |   รวมทั้งสิ้น ' + setInfo.fullMarksTotal + ' คะแนน']);
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
  sheet.setRowHeight(headerRow, (useNet || setInfo.converts) ? 46 : 34);

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

  // ---- แผ่นงาน: คะแนนรายชุดประเมิน (แบบสรุปส่งหน่วยงาน) ----
  if (setInfo.converts || setInfo.multiple) {
    buildSetScorecardSheet_(temp, rows, year, semester, setInfo);
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
      .setValue('คะแนนสุทธิ = ผลรวมของ (คะแนนเฉลี่ยของกลุ่มผู้ประเมิน × น้ำหนักของกลุ่ม) ÷ ผลรวมน้ำหนักที่ใช้จริง' +
        (setInfo.converts
          ? '\nคะแนนที่หน่วยงานได้รับ = คะแนนสุทธิ ÷ คะแนนเต็มต่อข้อ × คะแนนเต็มที่หน่วยงานกำหนด'
          : ''))
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

// ==================== รายงานรูปแบบใหม่ ====================

/**
 * แผ่นงาน "คะแนนรายชุดประเมิน" — ตารางส่งหน่วยงาน
 * แถวคือครูแต่ละคน คอลัมน์คือชุดประเมินแต่ละชุด ช่องในตารางคือคะแนนที่หน่วยงานได้รับ
 * ปิดท้ายด้วยคอลัมน์รวมและร้อยละ เพื่อนำไปกรอกแบบประเมินของโรงเรียนได้ทันที
 */
function buildSetScorecardSheet_(spreadsheet, rows, year, semester, setInfo) {
  const sets = setInfo.sets;
  const sheet = spreadsheet.insertSheet('คะแนนรายชุดประเมิน');
  const org = str_(getSetting_(SETTING_KEYS.ORG_NAME, 'โรงเรียน'));
  const totalFull = setInfo.fullMarksTotal;

  const headers = ['ลำดับ', 'รหัสครู', 'ชื่อ-นามสกุล', 'ระดับชั้น'];
  sets.forEach(function (st) {
    headers.push(st.name + '\n(เต็ม ' + (st.fullMarks || '-') + ')');
  });
  headers.push('รวม\n(เต็ม ' + totalFull + ')');
  headers.push('ร้อยละ');
  headers.push('ระดับผลการประเมิน');

  sheet.getRange(1, 1, 1, headers.length).merge()
    .setValue(org + ' — แบบสรุปคะแนนที่หน่วยงานได้รับ ' + termLabel_(year, semester))
    .setHorizontalAlignment('center').setFontWeight('bold').setFontSize(14).setFontColor('#004d40');
  sheet.getRange(2, 1, 1, headers.length).merge()
    .setValue('คะแนนในตารางคือคะแนนหลังถ่วงน้ำหนักกลุ่มผู้ประเมินและแปลงเป็นคะแนนเต็มที่หน่วยงานกำหนดแล้ว')
    .setHorizontalAlignment('center').setFontColor('#555555').setWrap(true);

  sheet.getRange(4, 1, 1, headers.length).setValues([headers])
    .setBackground('#00695c').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(4, 46);

  const values = rows.map(function (r, i) {
    const line = [i + 1, r.teacherId || '-', r.name, r.level || '-'];
    const bySet = {};
    (r.sets || []).forEach(function (st) { bySet[st.setId] = st; });
    sets.forEach(function (st) {
      const found = bySet[st.id];
      line.push(found && found.count ? found.converted : '-');
    });
    line.push(r.count ? r.converted : '-');
    line.push((r.count && totalFull > 0) ? Math.round(r.converted / totalFull * 10000) / 100 : '-');
    line.push(r.count ? r.finalRating : 'ยังไม่ได้รับการประเมิน');
    return line;
  });

  if (values.length) {
    sheet.getRange(5, 1, values.length, headers.length).setValues(values);
    sheet.getRange(5, 5, values.length, sets.length + 2).setNumberFormat('0.00').setHorizontalAlignment('center');
    sheet.getRange(5, 4 + sets.length + 1, values.length, 1).setFontWeight('bold');
    rows.forEach(function (r, i) {
      sheet.getRange(5 + i, headers.length).setBackground(ratingColor_(r.count ? r.finalRating : ''));
    });

    // แถวสรุปค่าเฉลี่ยของทั้งกลุ่ม
    const evaluated = rows.filter(function (r) { return r.count > 0; });
    const summaryRow = 5 + values.length + 1;
    const avgLine = ['', '', 'ค่าเฉลี่ยของครูที่ได้รับการประเมิน (' + evaluated.length + ' คน)', ''];
    sets.forEach(function (st) {
      const list = evaluated.map(function (r) {
        const found = (r.sets || []).filter(function (x) { return x.setId === st.id && x.count; })[0];
        return found ? found.converted : null;
      }).filter(function (v) { return v !== null && v !== undefined; });
      avgLine.push(list.length ? Math.round(list.reduce(function (a, b) { return a + b; }, 0) / list.length * 100) / 100 : '-');
    });
    const totals = evaluated.map(function (r) { return r.converted; });
    const grand = totals.length ? Math.round(totals.reduce(function (a, b) { return a + b; }, 0) / totals.length * 100) / 100 : 0;
    avgLine.push(totals.length ? grand : '-');
    avgLine.push((totals.length && totalFull > 0) ? Math.round(grand / totalFull * 10000) / 100 : '-');
    avgLine.push('');
    sheet.getRange(summaryRow, 1, 1, headers.length).setValues([avgLine])
      .setFontWeight('bold').setBackground('#e0f2f1');
    sheet.getRange(summaryRow, 5, 1, sets.length + 2).setNumberFormat('0.00').setHorizontalAlignment('center');
  }

  sheet.setColumnWidth(1, 48);
  sheet.setColumnWidth(2, 88);
  sheet.setColumnWidth(3, 210);
  sheet.setColumnWidth(4, 72);
  for (let i = 0; i < sets.length; i++) sheet.setColumnWidth(5 + i, 130);
  sheet.setColumnWidth(5 + sets.length, 96);
  sheet.setColumnWidth(6 + sets.length, 76);
  sheet.setColumnWidth(7 + sets.length, 130);
  sheet.getRange(4, 1, values.length + 1, headers.length)
    .setBorder(true, true, true, true, true, true, '#b0bec5', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(3);
  return sheet;
}

// ==================== แบบรายงานรายบุคคล (Report Card) ====================

const MAX_TEACHER_CARDS_ = 120;

/**
 * ออกรายงานรายบุคคล — 1 คน 1 หน้า พร้อมช่องลงนาม
 * ใช้วิธีสร้าง 1 แผ่นงานต่อครู 1 คน เพราะ Google Sheets ขึ้นหน้าใหม่ทุกครั้งที่เปลี่ยนแผ่นงาน
 * จึงได้ PDF ที่แบ่งหน้าตรงตามต้องการโดยไม่ต้องพึ่งไลบรารีภายนอก
 *
 * payload: {year, semester, teacherIds[], sortBy, formats:['pdf','xlsx'], options:{note, orientation}}
 */
function apiExportTeacherCards(token, payload) {
  return guard_(function () {
    requireAdmin_(token);
    const p = payload || {};
    const rows = orderedReportRows_(p).filter(function (r) { return r.count > 0; });
    if (!rows.length) return fail_('ไม่มีครูที่มีผลการประเมินให้ออกรายงาน กรุณาเลือกอย่างน้อย 1 คน');
    if (rows.length > MAX_TEACHER_CARDS_) {
      return fail_('ออกรายงานรายบุคคลได้ครั้งละไม่เกิน ' + MAX_TEACHER_CARDS_ +
        ' คน (เลือกไว้ ' + rows.length + ' คน) กรุณาแบ่งเป็นหลายรอบ');
    }

    const term = currentTerm_();
    const year = str_(p.year) || term.year;
    const semester = str_(p.semester) || term.semester;
    const options = p.options || {};
    const formats = (p.formats && p.formats.length) ? p.formats : ['pdf'];

    const temp = buildTeacherCardsSpreadsheet_(rows, year, semester, options);
    SpreadsheetApp.flush();

    const files = [];
    try {
      const folder = getOrCreateReportFolder_();
      const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd_HHmm');
      const baseName = 'รายงานผลการประเมินรายบุคคล_' + semester + '-' + year + '_' + stamp;
      const exportOptions = { orientation: str_(options.orientation) || 'portrait' };

      if (formats.indexOf('pdf') !== -1) files.push(saveExport_(folder, temp.getId(), 'pdf', baseName, exportOptions));
      if (formats.indexOf('xlsx') !== -1) files.push(saveExport_(folder, temp.getId(), 'xlsx', baseName, exportOptions));

      logAction_('Admin', 'admin', 'ออกรายงานรายบุคคล',
        termLabel_(year, semester) + ' | ' + rows.length + ' คน');
    } finally {
      try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) { /* ไม่สำคัญ */ }
    }

    return ok_({ files: files, count: rows.length, term: termLabel_(year, semester) },
      'ออกรายงานรายบุคคลเรียบร้อย (' + rows.length + ' คน · หน้าละ 1 คน)');
  });
}

/** สร้างสเปรดชีตรายงานรายบุคคล (1 แผ่นงาน = 1 คน = 1 หน้ากระดาษ) */
function buildTeacherCardsSpreadsheet_(rows, year, semester, options) {
  const o = options || {};
  const org = str_(getSetting_(SETTING_KEYS.ORG_NAME, 'โรงเรียน'));
  const signer = str_(getSetting_(SETTING_KEYS.REPORT_SIGNER, ''));
  const signerRole = str_(getSetting_(SETTING_KEYS.REPORT_SIGNER_ROLE, ''));
  const setInfo = reportSetInfo_();
  const criteriaBySet = {};
  activeSets_().forEach(function (st) { criteriaBySet[st.id] = loadCriteria_(st.id); });

  const temp = SpreadsheetApp.create('temp_cards_' + Utilities.getUuid().substring(0, 8));
  const placeholder = temp.getSheets()[0];

  const used = {};
  rows.forEach(function (r, index) {
    // ชื่อแผ่นงานต้องไม่ซ้ำและไม่ยาวเกินไป
    let name = String(index + 1).padStart(2, '0') + ' ' + r.name.substring(0, 25);
    while (used[name]) name = name + '.';
    used[name] = true;

    const sheet = temp.insertSheet(name);
    buildTeacherCard_(sheet, r, year, semester, {
      org: org, signer: signer, signerRole: signerRole,
      setInfo: setInfo, criteriaBySet: criteriaBySet, note: str_(o.note)
    });
  });

  temp.deleteSheet(placeholder);
  return temp;
}

/** วางเนื้อหารายงาน 1 หน้าของครู 1 คน ลงในแผ่นงานที่กำหนด */
function buildTeacherCard_(sheet, r, year, semester, ctx) {
  const W = 6;                    // ความกว้างของการ์ด (คอลัมน์)
  const line = function (row, text, style) {
    const st = style || {};
    const range = sheet.getRange(row, 1, 1, W).merge().setValue(text)
      .setHorizontalAlignment(st.align || 'left').setWrap(true);
    if (st.bold) range.setFontWeight('bold');
    if (st.size) range.setFontSize(st.size);
    if (st.color) range.setFontColor(st.color);
    if (st.background) range.setBackground(st.background);
    return range;
  };

  // ---- หัวรายงาน ----
  line(1, ctx.org, { align: 'center', bold: true, size: 15, color: '#1a237e' });
  line(2, 'รายงานผลการประเมินการปฏิบัติงานครู (รายบุคคล)', { align: 'center', bold: true, size: 13, color: '#1a237e' });
  line(3, 'กลุ่มบริหารงานกิจการนักเรียน   |   ' + termLabel_(year, semester), { align: 'center', color: '#555555' });

  // ---- ข้อมูลครู ----
  sheet.getRange(5, 1, 1, W).merge().setValue('๑. ข้อมูลผู้รับการประเมิน')
    .setFontWeight('bold').setBackground('#e8eaf6').setFontColor('#1a237e');
  const info = [
    ['ชื่อ-นามสกุล', r.name, 'รหัสครู', r.teacherId || '-'],
    ['ระดับชั้นที่ปรึกษา', r.level || '-', 'กลุ่มสาระ/ฝ่าย', r.department || '-'],
    ['เวรประจำวัน', r.dutyDay || '-', 'บทบาทในเวร', r.dutyPosition || '-']
  ];
  sheet.getRange(6, 1, info.length, 4).setValues(info);
  sheet.getRange(6, 1, info.length, 1).setFontWeight('bold').setBackground('#f5f5f5');
  sheet.getRange(6, 3, info.length, 1).setFontWeight('bold').setBackground('#f5f5f5');
  sheet.getRange(6, 2, info.length, 1).setNumberFormat('@');
  sheet.getRange(6, 1, info.length, W)
    .setBorder(true, true, true, true, true, true, '#cfd8dc', SpreadsheetApp.BorderStyle.SOLID);

  let row = 6 + info.length + 1;

  // ---- คะแนนรายชุดประเมิน ----
  sheet.getRange(row, 1, 1, W).merge().setValue('๒. ผลการประเมินแยกตามชุดประเมิน')
    .setFontWeight('bold').setBackground('#e8eaf6').setFontColor('#1a237e');
  row++;

  const setHeaders = ['ชุดประเมิน', 'จำนวนผู้ประเมิน', 'คะแนนเฉลี่ย', 'คะแนนสุทธิ', 'คะแนนที่ได้รับ', 'ระดับ'];
  sheet.getRange(row, 1, 1, W).setValues([setHeaders])
    .setBackground('#3949ab').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setWrap(true);
  row++;

  const setRows = (r.sets || []).filter(function (st) { return st.count > 0 || st.fullMarks > 0; });
  const setValues = setRows.map(function (st) {
    return [
      st.setName + ' (เต็มข้อละ ' + st.scaleMax + ')',
      st.count || 0,
      st.count ? st.average : '-',
      st.count ? st.net : '-',
      st.count && st.converted !== null ? (st.converted + ' / ' + st.fullMarks) : '-',
      st.rating || 'ยังไม่ได้รับการประเมิน'
    ];
  });
  if (setValues.length) {
    sheet.getRange(row, 1, setValues.length, W).setValues(setValues);
    sheet.getRange(row, 2, setValues.length, 3).setHorizontalAlignment('center');
    sheet.getRange(row, 5, setValues.length, 2).setHorizontalAlignment('center').setFontWeight('bold');
    setRows.forEach(function (st, i) {
      sheet.getRange(row + i, 6).setBackground(ratingColor_(st.rating));
    });
    row += setValues.length;
  }

  sheet.getRange(row, 1, 1, 4).merge().setValue('รวมคะแนนที่หน่วยงานได้รับ')
    .setFontWeight('bold').setHorizontalAlignment('right').setBackground('#e8eaf6');
  sheet.getRange(row, 5, 1, 2).merge()
    .setValue(r.converted + ' / ' + (r.fullMarks || ctx.setInfo.fullMarksTotal) + ' คะแนน')
    .setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e8eaf6').setFontColor('#1a237e');
  sheet.getRange(row - setValues.length - 1, 1, setValues.length + 2, W)
    .setBorder(true, true, true, true, true, true, '#b0bec5', SpreadsheetApp.BorderStyle.SOLID);
  row += 2;

  // ---- คะแนนรายข้อ ----
  sheet.getRange(row, 1, 1, W).merge().setValue('๓. คะแนนเฉลี่ยรายข้อ')
    .setFontWeight('bold').setBackground('#e8eaf6').setFontColor('#1a237e');
  row++;
  sheet.getRange(row, 1, 1, W).setValues([['ข้อที่', 'รายการประเมิน', '', '', 'คะแนนเฉลี่ย', 'เต็ม']])
    .setBackground('#00695c').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(row, 2, 1, 3).merge().setHorizontalAlignment('left');
  row++;

  let itemCount = 0;
  (r.sets || []).forEach(function (st) {
    if (!st.count) return;
    const criteria = ctx.criteriaBySet[st.setId] || [];
    if (!criteria.length) return;
    if ((r.sets || []).filter(function (x) { return x.count; }).length > 1) {
      sheet.getRange(row, 1, 1, W).merge().setValue('▸ ' + st.setName)
        .setFontWeight('bold').setBackground('#e0f2f1').setFontColor('#004d40');
      row++;
    }
    criteria.forEach(function (c) {
      const v = st.criteriaAverages[c.id];
      sheet.getRange(row, 1).setValue(c.id).setHorizontalAlignment('center');
      sheet.getRange(row, 2, 1, 3).merge().setValue(c.name).setWrap(true);
      sheet.getRange(row, 5).setValue(v === undefined || v === null ? '-' : v)
        .setNumberFormat('0.00').setHorizontalAlignment('center');
      sheet.getRange(row, 6).setValue(st.scaleMax).setHorizontalAlignment('center');
      row++;
      itemCount++;
    });
  });
  if (!itemCount) {
    line(row, 'ไม่มีคะแนนรายข้อ', { align: 'center', color: '#777777' });
    row++;
  }
  row++;

  // ---- ข้อเสนอแนะ ----
  sheet.getRange(row, 1, 1, W).merge().setValue('๔. ข้อเสนอแนะจากผู้ประเมิน')
    .setFontWeight('bold').setBackground('#e8eaf6').setFontColor('#1a237e');
  row++;
  const comments = (r.comments || []).slice(0, 8);
  if (comments.length) {
    comments.forEach(function (c) {
      sheet.getRange(row, 1, 1, W).merge()
        .setValue('• ' + c.comment + '   (' + (c.role || c.evaluator) + ')')
        .setWrap(true).setVerticalAlignment('top');
      row++;
    });
  } else {
    line(row, '— ไม่มีข้อเสนอแนะ —', { align: 'center', color: '#777777' });
    row++;
  }
  if (str_(ctx.note)) {
    row++;
    line(row, 'หมายเหตุ: ' + ctx.note, { color: '#555555' });
    row++;
  }

  // ---- ช่องลงนาม ----
  row += 2;
  sheet.getRange(row, 4, 1, 3).merge()
    .setValue('ลงชื่อ ..................................................').setHorizontalAlignment('center');
  sheet.getRange(row + 1, 4, 1, 3).merge()
    .setValue('( ' + (ctx.signer || '.................................................') + ' )')
    .setHorizontalAlignment('center');
  sheet.getRange(row + 2, 4, 1, 3).merge()
    .setValue(ctx.signerRole || 'ผู้อำนวยการโรงเรียน').setHorizontalAlignment('center');
  sheet.getRange(row + 3, 4, 1, 3).merge()
    .setValue('วันที่ ......... / ......... / .........').setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 190);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 90);
  return sheet;
}
