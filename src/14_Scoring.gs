/**
 * ============================================================================
 * ไฟล์: 14_Scoring.gs  |  น้ำหนักของกลุ่มผู้ประเมิน และการคิดคะแนนสุทธิ
 *
 * แนวคิด: ผู้ประเมินแต่ละกลุ่มมีความสำคัญไม่เท่ากัน ผู้ดูแลระบบจึงกำหนดได้ว่า
 * คะแนนจากแต่ละกลุ่มจะคิดเป็นกี่ % ของคะแนนรวม แล้วระบบจะประมวลผลออกมาเป็น
 * "คะแนนสุทธิ" ของครูแต่ละคน
 *
 *   คะแนนสุทธิ = Σ (คะแนนเฉลี่ยของกลุ่ม × น้ำหนักของกลุ่ม) ÷ Σ น้ำหนักที่ใช้จริง
 * ============================================================================
 */

/** ข้อมูลสำหรับหน้า "น้ำหนักกลุ่มผู้ประเมิน" */
function apiGetScoreWeights(token, year, semester) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;
    const info = scoreWeightInfo_();

    // จำนวนครูที่ได้รับการประเมินจากแต่ละกลุ่ม ใช้ประกอบการตัดสินใจตั้งน้ำหนัก
    const summary = buildSummaryRows_({ year: y, semester: s });
    const coverage = {};
    Object.keys(ROLES).forEach(function (key) { coverage[key] = 0; });
    summary.forEach(function (row) {
      (row.netBreakdown || []).forEach(function (b) {
        if (b.average !== null && b.average !== undefined) coverage[b.key]++;
      });
    });

    return ok_({
      enabled: info.enabled,
      normalize: info.normalize,
      total: info.total,
      rows: info.rows.map(function (r) {
        return { key: r.key, role: r.role, weight: r.weight, evaluatedTeachers: coverage[r.key] || 0 };
      }),
      defaults: DEFAULT_ROLE_WEIGHTS,
      year: y, semester: s,
      years: academicYears_(), semesters: semesterList_(),
      teacherCount: summary.length,
      criteriaWeighted: getSettingBool_(SETTING_KEYS.USE_WEIGHTS, 'ไม่')
    });
  });
}

/** ตรวจความถูกต้องของชุดน้ำหนักที่ส่งมา */
function validateWeights_(input) {
  const weights = {};
  let total = 0;
  Object.keys(ROLES).forEach(function (key) {
    const v = Number((input || {})[key]);
    if (isNaN(v) || v < 0 || v > 100) {
      throw new Error('น้ำหนักของ "' + ROLES[key] + '" ต้องเป็นตัวเลข 0-100');
    }
    weights[key] = Math.round(v * 10) / 10;
    total += weights[key];
  });
  if (total <= 0) throw new Error('ต้องกำหนดน้ำหนักให้อย่างน้อย 1 กลุ่มมากกว่า 0');
  return { weights: weights, total: Math.round(total * 10) / 10 };
}

/**
 * ทดลองคำนวณด้วยน้ำหนักชุดใหม่ โดยยังไม่บันทึก
 * ทำให้เห็นผลกระทบต่อคะแนนและอันดับก่อนตัดสินใจ
 */
function apiPreviewScoreWeights(token, options) {
  return guard_(function () {
    requireAdmin_(token);
    const o = options || {};
    const term = currentTerm_();
    const y = str_(o.year) || term.year;
    const s = str_(o.semester) || term.semester;
    const checked = validateWeights_(o.weights);
    const normalize = o.normalize !== false;

    const summary = buildSummaryRows_({ year: y, semester: s })
      .filter(function (r) { return r.count > 0; });

    const rows = summary.map(function (r) {
      const roleAverages = {};
      (r.netBreakdown || []).forEach(function (b) { roleAverages[b.key] = b.average; });
      const net = computeNetScore_(roleAverages, { weights: checked.weights, normalize: normalize });
      return {
        teacherId: r.teacherId, name: r.name, level: r.level, dutyDay: r.dutyDay,
        average: r.average, averageRating: r.rating,
        netScore: net.net, netRating: net.rating,
        diff: Math.round((net.net - r.average) * 100) / 100,
        breakdown: net.breakdown,
        count: r.count
      };
    });

    // จัดอันดับตามคะแนนสุทธิ และเทียบกับอันดับเดิม (เรียงตามค่าเฉลี่ยธรรมดา)
    const byAverage = rows.slice().sort(function (a, b) { return b.average - a.average; });
    const rankByAverage = {};
    byAverage.forEach(function (r, i) { rankByAverage[r.teacherId || r.name] = i + 1; });

    const byNet = rows.slice().sort(function (a, b) { return b.netScore - a.netScore; });
    byNet.forEach(function (r, i) {
      r.rank = i + 1;
      r.rankBefore = rankByAverage[r.teacherId || r.name] || null;
      r.rankChange = r.rankBefore ? (r.rankBefore - r.rank) : 0;
    });

    const distribution = {};
    RATING_LABELS.forEach(function (l) { distribution[l] = 0; });
    byNet.forEach(function (r) { if (distribution[r.netRating] !== undefined) distribution[r.netRating]++; });

    return ok_({
      year: y, semester: s,
      total: checked.total,
      normalize: normalize,
      rows: byNet,
      distribution: distribution,
      averageOfNet: byNet.length
        ? Math.round((byNet.reduce(function (a, b) { return a + b.netScore; }, 0) / byNet.length) * 100) / 100
        : 0,
      averageOfPlain: byNet.length
        ? Math.round((byNet.reduce(function (a, b) { return a + b.average; }, 0) / byNet.length) * 100) / 100
        : 0
    });
  });
}

/** บันทึกน้ำหนักกลุ่มผู้ประเมิน */
function apiSaveScoreWeights(token, options) {
  return guard_(function () {
    requireAdmin_(token);
    const o = options || {};
    const checked = validateWeights_(o.weights);

    setSettings_({
      evaluator_role_weights: JSON.stringify(checked.weights),
      use_evaluator_role_weights: o.enabled ? 'ใช่' : 'ไม่',
      normalize_role_weights: o.normalize === false ? 'ไม่' : 'ใช่'
    });

    const detail = Object.keys(ROLES).map(function (key) {
      return ROLES[key] + ' ' + checked.weights[key] + '%';
    }).join(', ') + ' | รวม ' + checked.total + '%' +
      ' | สถานะ: ' + (o.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน');
    logAction_('Admin', 'admin', 'ตั้งค่าน้ำหนักกลุ่มผู้ประเมิน', detail);

    return ok_({ total: checked.total, enabled: !!o.enabled },
      o.enabled
        ? 'บันทึกเรียบร้อย — ระบบจะคิดคะแนนสุทธิแบบถ่วงน้ำหนักตั้งแต่นี้เป็นต้นไป'
        : 'บันทึกเรียบร้อย — ปิดการถ่วงน้ำหนัก ระบบจะใช้คะแนนเฉลี่ยรวมตามปกติ');
  });
}
