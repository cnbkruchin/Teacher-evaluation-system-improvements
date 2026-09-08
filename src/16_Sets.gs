/**
 * ============================================================================
 * ไฟล์: 16_Sets.gs  |  ชุดประเมิน (Assessment Set)
 *
 * ชุดประเมินคือกล่องที่บรรจุ "เกณฑ์ + มาตราคะแนน + กลุ่มผู้ประเมิน" ของตัวเอง
 * ทำให้โรงเรียนแยกการประเมินออกเป็นชุด ๆ ได้อย่างอิสระ เช่น
 *   • ชุดกิจการนักเรียน  เกณฑ์ 10 ข้อ เต็มข้อละ 5  แปลงเป็น 20 คะแนนของกลุ่มบริหารงานกิจการนักเรียน
 *   • ชุดงานวิชาการ      เกณฑ์  8 ข้อ เต็มข้อละ 4  แปลงเป็น 30 คะแนนของกลุ่มบริหารงานวิชาการ
 *
 * ผู้ประเมินของแต่ละชุดกำหนดเป็น "กลุ่ม" ได้ 2 แบบ
 *   • แบบบทบาท    — ทุกคนที่มีบทบาทนั้นเป็นผู้ประเมินของกลุ่ม
 *   • แบบรายบุคคล — เลือกผู้ประเมินรายคน (มีสิทธิ์เหนือกว่าแบบบทบาท)
 * ============================================================================
 */

/** สร้างรหัสชุดถัดไป */
function nextSetId_() {
  const codes = readTable_(SHEETS.SETS).rows.map(function (r) { return str_(r['รหัสชุด']); });
  return nextCode_('SET', codes);
}

/** สร้างรหัสกลุ่มถัดไปของชุด (กลุ่มที่ผู้ดูแลสร้างเองใช้รูปแบบ GRP-xxxx) */
function nextGroupKey_(existingKeys) {
  return nextCode_('GRP', existingKeys || []);
}

/** จำนวนผลการประเมินที่อ้างถึงชุดนี้ (ใช้กันการลบชุดที่มีข้อมูลแล้ว) */
function setUsageCount_(setId) {
  const mainId = defaultSetId_();
  const id = str_(setId);
  let count = 0;
  [SHEETS.RESULTS, SHEETS.ARCHIVE].forEach(function (sheetName) {
    try {
      readTable_(sheetName).rows.forEach(function (r) {
        if ((str_(r['รหัสชุด']) || mainId) === id) count++;
      });
    } catch (e) { /* ไม่มีชีทนั้น */ }
  });
  return count;
}

/** จำนวนเกณฑ์ของแต่ละชุด */
function criteriaCountBySet_() {
  const mainId = defaultSetId_();
  const counts = {};
  readTable_(SHEETS.CRITERIA).rows.forEach(function (r) {
    if (!num_(r['ข้อที่']) || !str_(r['เกณฑ์การประเมิน'])) return;
    if (str_(r['สถานะ']) === STATUS.INACTIVE) return;
    const id = str_(r['รหัสชุด']) || mainId;
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

// ==================== อ่านรายการชุดประเมิน ====================

/** ข้อมูลทั้งหมดของหน้า "ชุดประเมิน" */
function apiListSets(token) {
  return guard_(function () {
    requireAdmin_(token);
    const groupMap = loadAllSetGroups_();
    const counts = criteriaCountBySet_();
    const evaluators = readTable_(SHEETS.EVALUATORS).rows
      .filter(function (r) { return str_(r['สถานะ']) !== STATUS.INACTIVE && str_(r['ชื่อ-นามสกุล']); })
      .map(function (r) {
        return {
          id: str_(r['รหัสผู้ประเมิน']),
          name: str_(r['ชื่อ-นามสกุล']),
          role: str_(r['บทบาท']),
          scope: str_(r['ขอบเขต (ระดับชั้น/วัน)'])
        };
      });

    const sets = loadSets_().map(function (st) {
      const groups = loadSetGroups_(st.id, groupMap);
      const members = {};
      evaluators.forEach(function (e) {
        const g = groupOfEvaluator_(groups, e);
        if (g) members[g.key] = (members[g.key] || 0) + 1;
      });
      return {
        id: st.id,
        name: st.name,
        description: st.description,
        scaleMax: st.scaleMax,
        fullMarks: st.fullMarks,
        useCriteriaWeights: st.useCriteriaWeights,
        useGroupWeights: st.useGroupWeights,
        normalize: st.normalize,
        order: st.order,
        status: st.status,
        note: st.note,
        criteriaCount: counts[st.id] || 0,
        resultCount: setUsageCount_(st.id),
        isMain: st.id === defaultSetId_(),
        customGroups: !groups.length || !groups[0].synthetic,
        groups: groups.map(function (g) {
          return {
            key: g.key, name: g.name, type: g.type, members: g.members,
            weight: g.weight, order: g.order, status: g.status,
            evaluatorCount: members[g.key] || 0
          };
        }),
        weightTotal: groups.reduce(function (a, g) { return a + (Number(g.weight) || 0); }, 0)
      };
    });

    return ok_({
      sets: sets,
      roles: Object.keys(ROLES).map(function (k) { return { key: k, name: ROLES[k] }; }),
      evaluators: evaluators,
      groupTypes: GROUP_TYPES,
      maxSets: MAX_SETS,
      maxCriteria: MAX_CRITERIA,
      fullMarksTotal: sets.filter(function (s) { return s.status !== STATUS.INACTIVE; })
        .reduce(function (a, s) { return a + (Number(s.fullMarks) || 0); }, 0)
    });
  });
}

// ==================== บันทึกชุดประเมิน ====================

function validateSetInput_(d) {
  const name = str_(d.name);
  if (!name) throw new Error('กรุณากรอกชื่อชุดประเมิน');

  const scaleMax = num_(d.scaleMax) || SET_DEFAULT_SCALE_MAX;
  if (scaleMax < 2 || scaleMax > 100 || scaleMax !== Math.round(scaleMax)) {
    throw new Error('คะแนนเต็มต่อข้อต้องเป็นจำนวนเต็ม 2-100');
  }
  const fullMarks = num_(d.fullMarks) || 0;
  if (fullMarks < 0 || fullMarks > 1000) {
    throw new Error('คะแนนที่หน่วยงานได้รับต้องอยู่ระหว่าง 0-1000 (0 = ไม่แปลงคะแนน)');
  }
  return {
    name: name,
    description: str_(d.description).substring(0, 500),
    scaleMax: scaleMax,
    fullMarks: Math.round(fullMarks * 100) / 100,
    useCriteriaWeights: !!d.useCriteriaWeights,
    useGroupWeights: !!d.useGroupWeights,
    normalize: d.normalize !== false,
    order: num_(d.order) || 99,
    status: str_(d.status) === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE,
    note: str_(d.note).substring(0, 500)
  };
}

/** สร้างหรือแก้ไขชุดประเมิน */
function apiSaveSet(token, data) {
  return guard_(function () {
    requireAdmin_(token);
    const d = data || {};
    const clean = validateSetInput_(d);
    const setId = str_(d.id);

    return withLock_(function () {
      const table = readTable_(SHEETS.SETS);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสชุด']) === setId) target = r; });

      const duplicate = table.rows.filter(function (r) {
        return str_(r['ชื่อชุดประเมิน']) === clean.name && str_(r['รหัสชุด']) !== setId;
      });
      if (duplicate.length) return fail_('มีชุดประเมินชื่อนี้อยู่แล้ว');

      if (!target && table.rows.length >= MAX_SETS) {
        return fail_('สร้างชุดประเมินได้สูงสุด ' + MAX_SETS + ' ชุด');
      }

      const record = {
        'ชื่อชุดประเมิน': clean.name,
        'คำอธิบาย': clean.description,
        'คะแนนเต็มต่อข้อ': clean.scaleMax,
        'คะแนนที่หน่วยงานได้รับ': clean.fullMarks,
        'ถ่วงน้ำหนักรายข้อ': yesNo_(clean.useCriteriaWeights),
        'ถ่วงน้ำหนักกลุ่มผู้ประเมิน': yesNo_(clean.useGroupWeights),
        'ปรับสัดส่วนอัตโนมัติ': yesNo_(clean.normalize),
        'ลำดับ': clean.order,
        'สถานะ': clean.status,
        'หมายเหตุ': clean.note
      };

      let id = setId;
      if (target) {
        updateRecord_(SHEETS.SETS, target._row, record);
      } else {
        id = nextSetId_();
        record['รหัสชุด'] = id;
        record['วันที่สร้าง'] = new Date();
        appendRecord_(SHEETS.SETS, record);
        invalidateTable_(SHEETS.SETS);
        // ชุดใหม่ได้กลุ่มผู้ประเมินมาตรฐาน 4 กลุ่มไว้ก่อน ผู้ดูแลปรับได้ภายหลัง
        seedSetGroups_(id, roleWeights_());
      }
      invalidateTable_(SHEETS.SETS);

      logAction_('Admin', 'admin', target ? 'แก้ไขชุดประเมิน' : 'สร้างชุดประเมิน',
        id + ' · ' + clean.name + ' | เต็มข้อละ ' + clean.scaleMax +
        ' | คะแนนหน่วยงาน ' + (clean.fullMarks || '-'));
      return ok_({ id: id }, target ? 'บันทึกชุดประเมินเรียบร้อย' : 'สร้างชุดประเมิน "' + clean.name + '" เรียบร้อย');
    });
  });
}

/** เปิด/ปิดการใช้งานชุดประเมิน */
function apiToggleSet(token, setId) {
  return guard_(function () {
    requireAdmin_(token);
    return withLock_(function () {
      const table = readTable_(SHEETS.SETS);
      let target = null;
      table.rows.forEach(function (r) { if (str_(r['รหัสชุด']) === str_(setId)) target = r; });
      if (!target) return fail_('ไม่พบชุดประเมิน');

      const next = str_(target['สถานะ']) === STATUS.INACTIVE ? STATUS.ACTIVE : STATUS.INACTIVE;
      const active = readTable_(SHEETS.SETS).rows.filter(function (r) {
        return str_(r['สถานะ']) !== STATUS.INACTIVE;
      });
      if (next === STATUS.INACTIVE && active.length <= 1) {
        return fail_('ต้องมีชุดประเมินที่เปิดใช้งานอย่างน้อย 1 ชุด');
      }

      updateRecord_(SHEETS.SETS, target._row, { 'สถานะ': next });
      invalidateTable_(SHEETS.SETS);
      logAction_('Admin', 'admin', 'เปลี่ยนสถานะชุดประเมิน',
        str_(target['ชื่อชุดประเมิน']) + ' → ' + next);
      return ok_({ status: next }, next === STATUS.ACTIVE ? 'เปิดใช้งานชุดประเมินแล้ว' : 'ปิดใช้งานชุดประเมินแล้ว');
    });
  });
}

/** ลบชุดประเมิน (ทำได้เฉพาะชุดที่ยังไม่มีผลการประเมิน) */
function apiDeleteSet(token, setId) {
  return guard_(function () {
    requireAdmin_(token);
    const id = str_(setId);

    return withLock_(function () {
      const sets = readTable_(SHEETS.SETS).rows;
      if (sets.length <= 1) return fail_('ต้องมีชุดประเมินอย่างน้อย 1 ชุด');

      let target = null;
      sets.forEach(function (r) { if (str_(r['รหัสชุด']) === id) target = r; });
      if (!target) return fail_('ไม่พบชุดประเมิน');

      const used = setUsageCount_(id);
      if (used) {
        return fail_('ชุดนี้มีผลการประเมินแล้ว ' + used + ' รายการ จึงลบไม่ได้ — ' +
          'หากไม่ต้องการใช้ต่อ ให้เปลี่ยนสถานะเป็น "ไม่ใช้งาน" แทน');
      }

      const name = str_(target['ชื่อชุดประเมิน']);

      // ลบเกณฑ์และกลุ่มผู้ประเมินของชุดนี้ไปพร้อมกัน เพื่อไม่ให้เหลือข้อมูลค้าง
      const criteriaRows = readTable_(SHEETS.CRITERIA).rows
        .filter(function (r) { return str_(r['รหัสชุด']) === id; })
        .map(function (r) { return r._row; });
      if (criteriaRows.length) deleteRecords_(SHEETS.CRITERIA, criteriaRows);

      const groupRows = readTable_(SHEETS.SET_GROUPS).rows
        .filter(function (r) { return str_(r['รหัสชุด']) === id; })
        .map(function (r) { return r._row; });
      if (groupRows.length) deleteRecords_(SHEETS.SET_GROUPS, groupRows);

      deleteRecord_(SHEETS.SETS, target._row);
      invalidateTable_(SHEETS.SETS);

      logAction_('Admin', 'admin', 'ลบชุดประเมิน', id + ' · ' + name);
      return ok_(null, 'ลบชุดประเมิน "' + name + '" เรียบร้อย');
    });
  });
}

/** คัดลอกชุดประเมินพร้อมเกณฑ์และกลุ่มผู้ประเมิน */
function apiCopySet(token, setId, newName) {
  return guard_(function () {
    requireAdmin_(token);
    const source = setById_(setId);
    if (!source) return fail_('ไม่พบชุดประเมินต้นทาง');

    const name = str_(newName) || (source.name + ' (สำเนา)');

    return withLock_(function () {
      const table = readTable_(SHEETS.SETS);
      if (table.rows.length >= MAX_SETS) return fail_('สร้างชุดประเมินได้สูงสุด ' + MAX_SETS + ' ชุด');
      if (table.rows.some(function (r) { return str_(r['ชื่อชุดประเมิน']) === name; })) {
        return fail_('มีชุดประเมินชื่อนี้อยู่แล้ว');
      }

      const id = nextSetId_();
      appendRecord_(SHEETS.SETS, {
        'รหัสชุด': id,
        'ชื่อชุดประเมิน': name,
        'คำอธิบาย': source.description,
        'คะแนนเต็มต่อข้อ': source.scaleMax,
        'คะแนนที่หน่วยงานได้รับ': source.fullMarks,
        'ถ่วงน้ำหนักรายข้อ': yesNo_(source.useCriteriaWeights),
        'ถ่วงน้ำหนักกลุ่มผู้ประเมิน': yesNo_(source.useGroupWeights),
        'ปรับสัดส่วนอัตโนมัติ': yesNo_(source.normalize),
        'ลำดับ': (Number(source.order) || 1) + 1,
        'สถานะ': STATUS.ACTIVE,
        'หมายเหตุ': 'คัดลอกจาก ' + source.id,
        'วันที่สร้าง': new Date()
      });
      invalidateTable_(SHEETS.SETS);

      // กลุ่มผู้ประเมิน
      const groups = loadSetGroups_(source.id);
      appendRecords_(SHEETS.SET_GROUPS, groups.map(function (g) {
        return {
          'รหัสชุด': id,
          'รหัสกลุ่ม': g.key,
          'ชื่อกลุ่มผู้ประเมิน': g.name,
          'ประเภท': g.type,
          'สมาชิก': g.members.join(', '),
          'น้ำหนัก (%)': g.weight,
          'ลำดับ': g.order,
          'สถานะ': STATUS.ACTIVE
        };
      }));
      invalidateTable_(SHEETS.SET_GROUPS);

      // เกณฑ์
      const criteria = loadCriteria_(source.id);
      appendRecords_(SHEETS.CRITERIA, criteria.map(function (c) {
        return {
          'รหัสชุด': id,
          'ข้อที่': c.id,
          'เกณฑ์การประเมิน': c.name,
          'ผู้มีสิทธิ์ประเมิน': c.groups.map(function (k) {
            const found = groups.filter(function (g) { return g.key === k; })[0];
            return found ? found.name : k;
          }).join(', '),
          'น้ำหนัก (%)': c.weight,
          'คำอธิบาย': c.description,
          'สถานะ': STATUS.ACTIVE
        };
      }));
      invalidateTable_(SHEETS.CRITERIA);

      logAction_('Admin', 'admin', 'คัดลอกชุดประเมิน', source.id + ' → ' + id + ' · ' + name);
      return ok_({ id: id },
        'คัดลอกเป็นชุด "' + name + '" เรียบร้อย (เกณฑ์ ' + criteria.length + ' ข้อ, กลุ่มผู้ประเมิน ' + groups.length + ' กลุ่ม)');
    });
  });
}

// ==================== กลุ่มผู้ประเมินของชุด ====================

/** ตรวจความถูกต้องของรายการกลุ่มผู้ประเมิน */
function validateGroups_(input, evaluatorIndex) {
  const list = (input || []).filter(function (g) { return str_(g.name); });
  if (!list.length) throw new Error('ต้องมีกลุ่มผู้ประเมินอย่างน้อย 1 กลุ่ม');
  if (list.length > 12) throw new Error('กำหนดกลุ่มผู้ประเมินได้สูงสุด 12 กลุ่มต่อชุด');

  const names = {}, keys = {};
  let total = 0;
  const clean = list.map(function (g, i) {
    const name = str_(g.name).substring(0, 120);
    if (names[name]) throw new Error('ชื่อกลุ่ม "' + name + '" ซ้ำกัน');
    names[name] = true;

    const weight = num_(g.weight);
    if (isNaN(weight) || weight < 0 || weight > 100) {
      throw new Error('น้ำหนักของกลุ่ม "' + name + '" ต้องเป็นตัวเลข 0-100');
    }
    total += weight;

    const type = str_(g.type) === GROUP_TYPES.PERSON ? GROUP_TYPES.PERSON : GROUP_TYPES.ROLE;
    let members = (g.members || []).map(function (m) { return str_(m); }).filter(String);
    if (type === GROUP_TYPES.ROLE) {
      members = members.filter(function (m) { return roleKey_(m) || ROLES[m]; })
        .map(function (m) { return ROLES[m] || m; });
      if (!members.length) throw new Error('กลุ่ม "' + name + '" ยังไม่ได้เลือกบทบาทผู้ประเมิน');
    } else {
      members = members.filter(function (m) { return evaluatorIndex.byId[m] || evaluatorIndex.byName[m]; })
        .map(function (m) { return (evaluatorIndex.byId[m] || {}).id || (evaluatorIndex.byName[m] || {}).id || m; });
      if (!members.length) throw new Error('กลุ่ม "' + name + '" ยังไม่ได้เลือกผู้ประเมิน');
    }

    let key = str_(g.key);
    if (!key || keys[key]) key = nextGroupKey_(Object.keys(keys));
    keys[key] = true;

    return {
      key: key, name: name, type: type, members: members,
      weight: Math.round(weight * 10) / 10, order: i + 1,
      status: str_(g.status) === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE
    };
  });

  if (total <= 0) throw new Error('ต้องกำหนดน้ำหนักให้อย่างน้อย 1 กลุ่มมากกว่า 0');
  return { groups: clean, total: Math.round(total * 10) / 10 };
}

/**
 * บันทึกกลุ่มผู้ประเมินของชุด (เขียนทับรายการเดิมทั้งชุด)
 * กลุ่มที่หายไปจะถูกลบ แต่ผลการประเมินเดิมยังคงอยู่ครบ
 */
function apiSaveSetGroups(token, setId, groups) {
  return guard_(function () {
    requireAdmin_(token);
    const set = setById_(setId);
    if (!set) return fail_('ไม่พบชุดประเมิน');

    const evaluatorIndex = buildEvaluatorIndex_();
    const checked = validateGroups_(groups, evaluatorIndex);

    return withLock_(function () {
      const oldRows = readTable_(SHEETS.SET_GROUPS).rows
        .filter(function (r) { return str_(r['รหัสชุด']) === set.id; })
        .map(function (r) { return r._row; });
      if (oldRows.length) deleteRecords_(SHEETS.SET_GROUPS, oldRows);

      appendRecords_(SHEETS.SET_GROUPS, checked.groups.map(function (g) {
        return {
          'รหัสชุด': set.id,
          'รหัสกลุ่ม': g.key,
          'ชื่อกลุ่มผู้ประเมิน': g.name,
          'ประเภท': g.type,
          'สมาชิก': g.members.join(', '),
          'น้ำหนัก (%)': g.weight,
          'ลำดับ': g.order,
          'สถานะ': g.status
        };
      }));
      invalidateTable_(SHEETS.SET_GROUPS);

      // ชุดหลักที่ยังใช้กลุ่มมาตรฐาน 4 บทบาท ให้ซิงก์น้ำหนักกลับไปที่การตั้งค่ากลางด้วย
      syncRoleWeightsFromGroups_(set.id, checked.groups);

      logAction_('Admin', 'admin', 'ตั้งค่ากลุ่มผู้ประเมินของชุด',
        set.name + ' | ' + checked.groups.map(function (g) { return g.name + ' ' + g.weight + '%'; }).join(', ') +
        ' | รวม ' + checked.total + '%');
      return ok_({ total: checked.total, groups: checked.groups },
        'บันทึกกลุ่มผู้ประเมินเรียบร้อย (รวมน้ำหนัก ' + checked.total + '%)');
    });
  });
}

/**
 * ซิงก์น้ำหนักกลุ่มของชุดหลักกลับไปยังการตั้งค่ากลาง
 * เพื่อให้ส่วนของระบบที่ยังอ้างอิงน้ำหนักตามบทบาทได้ค่าตรงกันเสมอ
 */
function syncRoleWeightsFromGroups_(setId, groups) {
  if (str_(setId) !== defaultSetId_()) return false;
  const weights = {};
  let matched = 0;
  Object.keys(ROLES).forEach(function (key) { weights[key] = 0; });
  groups.forEach(function (g) {
    if (g.type !== GROUP_TYPES.ROLE) return;
    g.members.forEach(function (m) {
      const key = roleKey_(m);
      if (!key) return;
      weights[key] = Number(g.weight) || 0;
      matched++;
    });
  });
  if (!matched) return false;
  setSetting_(SETTING_KEYS.ROLE_WEIGHTS, JSON.stringify(weights));
  return true;
}
