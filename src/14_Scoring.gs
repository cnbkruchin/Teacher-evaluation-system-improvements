/**
 * ============================================================================
 * ไฟล์: 14_Scoring.gs  |  น้ำหนักของกลุ่มผู้ประเมิน คะแนนสุทธิ และการแปลงคะแนน
 *
 * แนวคิด: ผู้ประเมินแต่ละกลุ่มมีความสำคัญไม่เท่ากัน ผู้ดูแลระบบจึงกำหนดได้ว่า
 * คะแนนจากแต่ละกลุ่มจะคิดเป็นกี่ % ของคะแนนรวม แล้วระบบจะประมวลผลเป็น
 * "คะแนนสุทธิ" และแปลงต่อเป็น "คะแนนที่หน่วยงานได้รับ" ของครูแต่ละคน
 *
 *   คะแนนสุทธิ           = Σ (คะแนนเฉลี่ยของกลุ่ม × น้ำหนักของกลุ่ม) ÷ Σ น้ำหนักที่ใช้จริง
 *   คะแนนที่หน่วยงานได้รับ = คะแนนสุทธิ ÷ คะแนนเต็มต่อข้อ × คะแนนเต็มที่หน่วยงานกำหนด
 *
 * ตัวอย่าง ชุดกำหนดคะแนนเต็มต่อข้อ 5 และหน่วยงานให้ 20 คะแนน
 *   คะแนนสุทธิ 5.00 → 20.00 คะแนน   |   คะแนนสุทธิ 4.25 → 17.00 คะแนน
 * ============================================================================
 */

/** ข้อมูลสำหรับหน้า "น้ำหนักผู้ประเมิน" ของชุดที่เลือก */
function apiGetScoreWeights(token, year, semester, setId) {
  return guard_(function () {
    requireAdmin_(token);
    const term = currentTerm_();
    const y = str_(year) || term.year;
    const s = str_(semester) || term.semester;
    const set = resolveSet_(setId);
    const info = scoreWeightInfo_(set.id);

    // จำนวนครูที่ได้รับการประเมินจากแต่ละกลุ่ม ใช้ประกอบการตัดสินใจตั้งน้ำหนัก
    const summary = buildSummaryRows_({ year: y, semester: s });
    const coverage = {};
    info.rows.forEach(function (r) { coverage[r.key] = 0; });
    let evaluatedInSet = 0;
    summary.forEach(function (row) {
      const setRow = (row.sets || []).filter(function (x) { return x.setId === set.id; })[0];
      if (!setRow) return;
      if (setRow.count) evaluatedInSet++;
      (setRow.breakdown || []).forEach(function (b) {
        if (b.average !== null && b.average !== undefined) coverage[b.key] = (coverage[b.key] || 0) + 1;
      });
    });

    return ok_({
      setId: set.id,
      setName: set.name,
      scaleMax: set.scaleMax,
      fullMarks: Number(set.fullMarks) || 0,
      sets: activeSets_().map(function (st) {
        return { id: st.id, name: st.name, scaleMax: st.scaleMax, fullMarks: Number(st.fullMarks) || 0 };
      }),
      enabled: info.enabled,
      normalize: info.normalize,
      total: info.total,
      rows: info.rows.map(function (r) {
        return {
          key: r.key, role: r.role, name: r.name, type: r.type, members: r.members,
          weight: r.weight, evaluatedTeachers: coverage[r.key] || 0
        };
      }),
      defaults: DEFAULT_ROLE_WEIGHTS,
      year: y, semester: s,
      years: academicYears_(), semesters: semesterList_(),
      teacherCount: summary.length,
      evaluatedInSet: evaluatedInSet,
      criteriaWeighted: !!set.useCriteriaWeights
    });
  });
}

/**
 * ตรวจความถูกต้องของชุดน้ำหนักที่ส่งมา
 * รับได้ทั้งแบบ {คีย์กลุ่ม: น้ำหนัก} ของชุดนั้น และแบบเดิมที่ใช้คีย์บทบาท
 */
function validateWeights_(input, groups) {
  const list = groups || Object.keys(ROLES).map(function (key) {
    return { key: key, name: ROLES[key] };
  });
  const weights = {};
  let total = 0;
  list.forEach(function (g) {
    const v = Number((input || {})[g.key]);
    if (isNaN(v) || v < 0 || v > 100) {
      throw new Error('น้ำหนักของ "' + (g.name || g.key) + '" ต้องเป็นตัวเลข 0-100');
    }
    weights[g.key] = Math.round(v * 10) / 10;
    total += weights[g.key];
  });
  if (total <= 0) throw new Error('ต้องกำหนดน้ำหนักให้อย่างน้อย 1 กลุ่มมากกว่า 0');
  return { weights: weights, total: Math.round(total * 10) / 10 };
}

/**
 * ทดลองคำนวณด้วยน้ำหนักชุดใหม่ โดยยังไม่บันทึก
 * ทำให้เห็นผลกระทบต่อคะแนน คะแนนที่หน่วยงานได้รับ และอันดับ ก่อนตัดสินใจ
 */
function apiPreviewScoreWeights(token, options) {
  return guard_(function () {
    requireAdmin_(token);
    const o = options || {};
    const term = currentTerm_();
    const y = str_(o.year) || term.year;
    const s = str_(o.semester) || term.semester;
    const set = resolveSet_(o.setId);
    const groups = loadSetGroups_(set.id);
    const checked = validateWeights_(o.weights, groups);
    const normalize = o.normalize !== false;
    const fullMarks = (o.fullMarks === undefined || o.fullMarks === null || o.fullMarks === '')
      ? (Number(set.fullMarks) || 0)
      : (num_(o.fullMarks) || 0);
    const previewSet = { scaleMax: set.scaleMax, fullMarks: fullMarks };

    // ใส่น้ำหนักชุดใหม่ลงในรายการกลุ่ม เพื่อทดลองคำนวณ
    const trialGroups = groups.map(function (g) {
      return { key: g.key, name: g.name, type: g.type, weight: checked.weights[g.key] || 0 };
    });

    const summary = buildSummaryRows_({ year: y, semester: s })
      .map(function (r) {
        const setRow = (r.sets || []).filter(function (x) { return x.setId === set.id; })[0];
        return setRow && setRow.count ? { row: r, setRow: setRow } : null;
      })
      .filter(Boolean);

    const rows = summary.map(function (item) {
      const groupAverages = {};
      (item.setRow.breakdown || []).forEach(function (b) { groupAverages[b.key] = b.average; });
      const net = computeNetScore_(groupAverages, {
        groups: trialGroups, normalize: normalize, scaleMax: set.scaleMax
      });
      const plain = item.setRow.average || 0;
      return {
        teacherId: item.row.teacherId, name: item.row.name,
        level: item.row.level, dutyDay: item.row.dutyDay,
        average: plain, averageRating: ratingOf_(plain, set.scaleMax),
        netScore: net.net, netRating: net.rating,
        converted: convertScore_(net.net, previewSet),
        convertedBefore: convertScore_(plain, previewSet),
        diff: Math.round((net.net - plain) * 100) / 100,
        breakdown: net.breakdown,
        count: item.setRow.count
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
      setId: set.id, setName: set.name,
      scaleMax: set.scaleMax, fullMarks: fullMarks,
      total: checked.total,
      normalize: normalize,
      rows: byNet,
      distribution: distribution,
      averageOfNet: byNet.length
        ? Math.round((byNet.reduce(function (a, b) { return a + b.netScore; }, 0) / byNet.length) * 100) / 100
        : 0,
      averageOfPlain: byNet.length
        ? Math.round((byNet.reduce(function (a, b) { return a + b.average; }, 0) / byNet.length) * 100) / 100
        : 0,
      averageOfConverted: (byNet.length && fullMarks > 0)
        ? Math.round((byNet.reduce(function (a, b) { return a + (b.converted || 0); }, 0) / byNet.length) * 100) / 100
        : 0
    });
  });
}

/** บันทึกน้ำหนักกลุ่มผู้ประเมินและการแปลงคะแนนของชุดที่เลือก */
function apiSaveScoreWeights(token, options) {
  return guard_(function () {
    requireAdmin_(token);
    const o = options || {};
    const set = resolveSet_(o.setId);
    const groups = loadSetGroups_(set.id);
    const checked = validateWeights_(o.weights, groups);

    const fullMarks = (o.fullMarks === undefined || o.fullMarks === null || o.fullMarks === '')
      ? Number(set.fullMarks) || 0
      : num_(o.fullMarks) || 0;
    if (fullMarks < 0 || fullMarks > 1000) {
      return fail_('คะแนนที่หน่วยงานได้รับต้องอยู่ระหว่าง 0-1000 (0 = ไม่แปลงคะแนน)');
    }

    return withLock_(function () {
      // 1) น้ำหนักของแต่ละกลุ่ม
      const table = readTable_(SHEETS.SET_GROUPS);
      const existing = table.rows.filter(function (r) { return str_(r['รหัสชุด']) === set.id; });
      if (existing.length) {
        const updates = [];
        existing.forEach(function (r) {
          const key = str_(r['รหัสกลุ่ม']);
          if (checked.weights[key] === undefined) return;
          updates.push({ row: r._row, patch: { 'น้ำหนัก (%)': checked.weights[key] } });
        });
        updateRecords_(SHEETS.SET_GROUPS, updates);
      } else {
        // ชุดที่ยังใช้กลุ่มมาตรฐาน — สร้างแถวจริงพร้อมน้ำหนักที่กำหนด
        appendRecords_(SHEETS.SET_GROUPS, groups.map(function (g, i) {
          return {
            'รหัสชุด': set.id,
            'รหัสกลุ่ม': g.key,
            'ชื่อกลุ่มผู้ประเมิน': g.name,
            'ประเภท': g.type,
            'สมาชิก': g.members.join(', '),
            'น้ำหนัก (%)': checked.weights[g.key] || 0,
            'ลำดับ': i + 1,
            'สถานะ': STATUS.ACTIVE
          };
        }));
      }
      invalidateTable_(SHEETS.SET_GROUPS);

      // 2) การตั้งค่าของชุด
      const setTable = readTable_(SHEETS.SETS);
      let setRow = null;
      setTable.rows.forEach(function (r) { if (str_(r['รหัสชุด']) === set.id) setRow = r; });
      if (setRow) {
        updateRecord_(SHEETS.SETS, setRow._row, {
          'ถ่วงน้ำหนักกลุ่มผู้ประเมิน': yesNo_(!!o.enabled),
          'ปรับสัดส่วนอัตโนมัติ': yesNo_(o.normalize !== false),
          'คะแนนที่หน่วยงานได้รับ': fullMarks
        });
        invalidateTable_(SHEETS.SETS);
      }

      // 3) ซิงก์กลับไปที่การตั้งค่ากลาง เพื่อให้ระบบส่วนที่อ้างอิงบทบาทได้ค่าตรงกัน
      if (set.id === defaultSetId_()) {
        const roleWeights = {};
        Object.keys(ROLES).forEach(function (key) { roleWeights[key] = 0; });
        let matched = false;
        groups.forEach(function (g) {
          if (g.type !== GROUP_TYPES.ROLE) return;
          g.members.forEach(function (m) {
            const key = roleKey_(m);
            if (!key) return;
            roleWeights[key] = checked.weights[g.key] || 0;
            matched = true;
          });
        });
        setSettings_({
          evaluator_role_weights: matched ? JSON.stringify(roleWeights) : JSON.stringify(roleWeights_()),
          use_evaluator_role_weights: o.enabled ? 'ใช่' : 'ไม่',
          normalize_role_weights: o.normalize === false ? 'ไม่' : 'ใช่'
        });
      }

      const detail = groups.map(function (g) {
        return g.name + ' ' + (checked.weights[g.key] || 0) + '%';
      }).join(', ') + ' | รวม ' + checked.total + '%' +
        ' | คะแนนหน่วยงาน ' + (fullMarks || '-') +
        ' | สถานะ: ' + (o.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน');
      logAction_('Admin', 'admin', 'ตั้งค่าน้ำหนักกลุ่มผู้ประเมิน', set.name + ' | ' + detail);

      return ok_({ total: checked.total, enabled: !!o.enabled, fullMarks: fullMarks, setId: set.id },
        o.enabled
          ? 'บันทึกเรียบร้อย — ระบบจะคิดคะแนนสุทธิแบบถ่วงน้ำหนักของชุด "' + set.name + '" ตั้งแต่นี้เป็นต้นไป'
          : 'บันทึกเรียบร้อย — ปิดการถ่วงน้ำหนักของชุด "' + set.name + '" ระบบจะใช้คะแนนเฉลี่ยรวมตามปกติ');
    });
  });
}
