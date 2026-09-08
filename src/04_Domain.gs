/**
 * ============================================================================
 * ไฟล์: 04_Domain.gs  |  ตรรกะหลักของระบบ
 *  - ชุดประเมิน (แยกเกณฑ์/คะแนน/ผู้ประเมินออกเป็นชุด ๆ ได้อย่างอิสระ)
 *  - เกณฑ์การประเมิน (โหลดจากชีท แก้ไขได้โดยไม่ต้องแก้โค้ด)
 *  - การคำนวณคะแนน (ถ่วงน้ำหนัก + แปลงเป็นคะแนนที่หน่วยงานได้รับ)
 *  - ปีการศึกษา/ภาคเรียน
 *  - ตารางเวรประจำวันแยกอิสระตามภาคเรียน
 * ============================================================================
 */

// ==================== ชุดประเมิน (Assessment Set) ====================

/**
 * "ชุดประเมิน" คือกล่องที่บรรจุเกณฑ์การประเมิน มาตราคะแนน และกลุ่มผู้ประเมินของตัวเอง
 * โรงเรียนจึงกำหนดได้อิสระ เช่น
 *   • ชุดกิจการนักเรียน  เกณฑ์ 10 ข้อ เต็มข้อละ 5  แปลงเป็น 20 คะแนนของกลุ่มบริหารงานกิจการนักเรียน
 *   • ชุดงานวิชาการ      เกณฑ์  8 ข้อ เต็มข้อละ 4  แปลงเป็น 30 คะแนนของกลุ่มบริหารงานวิชาการ
 * ผู้ประเมินของแต่ละชุดกำหนดเป็น "กลุ่ม" ได้ทั้งแบบอิงบทบาท และแบบเลือกรายบุคคล
 */

/** อ่านค่า ใช่/ไม่ จากชีท (ช่องว่าง = ใช้ค่าตั้งต้น) */
function yes_(v, fallback) {
  const t = str_(v);
  if (!t) return !!fallback;
  return t === 'ใช่' || t === 'ใช้งาน' || t === 'true' || t === 'TRUE' || t === '1';
}

function yesNo_(b) { return b ? 'ใช่' : 'ไม่'; }

/** ชุดประเมินที่สังเคราะห์จากการตั้งค่าเดิม ใช้เมื่อยังไม่มีชีท "ชุดประเมิน" (ระบบรุ่นก่อน 3.3) */
function fallbackSet_() {
  return {
    id: DEFAULT_SET.id,
    name: DEFAULT_SET.name,
    description: DEFAULT_SET.description,
    scaleMax: DEFAULT_SET.scaleMax,
    fullMarks: DEFAULT_SET.fullMarks,
    useCriteriaWeights: getSettingBool_(SETTING_KEYS.USE_WEIGHTS, 'ไม่'),
    useGroupWeights: getSettingBool_(SETTING_KEYS.USE_ROLE_WEIGHTS, 'ไม่'),
    normalize: getSettingBool_(SETTING_KEYS.NORMALIZE_ROLE_WEIGHTS, 'ใช่'),
    order: 1,
    status: STATUS.ACTIVE,
    note: '',
    synthetic: true
  };
}

/** ชุดประเมินทั้งหมด (รวมชุดที่ปิดใช้งาน) เรียงตามลำดับที่ผู้ดูแลกำหนด */
function loadSets_() {
  if (MEMO_.derived.sets) return MEMO_.derived.sets;

  let rows = [];
  try { rows = readTable_(SHEETS.SETS).rows; } catch (e) { rows = []; }

  const list = [];
  const seen = {};
  rows.forEach(function (r) {
    const id = str_(r['รหัสชุด']);
    const name = str_(r['ชื่อชุดประเมิน']);
    if (!id || !name || seen[id]) return;
    seen[id] = true;
    const scaleMax = num_(r['คะแนนเต็มต่อข้อ']) || SET_DEFAULT_SCALE_MAX;
    list.push({
      id: id,
      name: name,
      description: str_(r['คำอธิบาย']),
      scaleMax: scaleMax,
      fullMarks: num_(r['คะแนนที่หน่วยงานได้รับ']) || 0,
      useCriteriaWeights: yes_(r['ถ่วงน้ำหนักรายข้อ'], false),
      useGroupWeights: yes_(r['ถ่วงน้ำหนักกลุ่มผู้ประเมิน'], false),
      normalize: yes_(r['ปรับสัดส่วนอัตโนมัติ'], true),
      order: num_(r['ลำดับ']) || 99,
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      note: str_(r['หมายเหตุ']),
      _row: r._row
    });
  });

  if (!list.length) {
    MEMO_.derived.sets = [fallbackSet_()];
    return MEMO_.derived.sets;
  }
  list.sort(function (a, b) { return (a.order - b.order) || a.id.localeCompare(b.id); });
  MEMO_.derived.sets = list;
  return list;
}

/** เฉพาะชุดที่เปิดใช้งาน */
function activeSets_() {
  return loadSets_().filter(function (s) { return s.status !== STATUS.INACTIVE; });
}

function setById_(setId) {
  const id = str_(setId);
  const found = loadSets_().filter(function (s) { return s.id === id; });
  return found.length ? found[0] : null;
}

/** ชุดหลักของระบบ (ชุดแรกที่เปิดใช้งาน) */
function defaultSet_() {
  const active = activeSets_();
  return active.length ? active[0] : fallbackSet_();
}

function defaultSetId_() {
  return defaultSet_().id;
}

/** ชุดที่ใช้จริง — คืนชุดที่ระบุ ถ้าไม่พบให้ใช้ชุดหลัก */
function resolveSet_(setId) {
  return (setId ? setById_(setId) : null) || defaultSet_();
}

// ==================== กลุ่มผู้ประเมินของแต่ละชุด ====================

/** กลุ่มเริ่มต้น = บทบาททั้ง 4 พร้อมน้ำหนักจากการตั้งค่ากลาง (ใช้กับชุดที่ยังไม่กำหนดกลุ่มเอง) */
function fallbackGroups_(setId) {
  const weights = roleWeights_();
  return Object.keys(ROLES).map(function (key, i) {
    return {
      setId: setId,
      key: key,
      name: ROLES[key],
      type: GROUP_TYPES.ROLE,
      members: [ROLES[key]],
      weight: Number(weights[key]) || 0,
      order: i + 1,
      status: STATUS.ACTIVE,
      synthetic: true
    };
  });
}

function parseMembers_(text) {
  return str_(text).split(/[,;|\n]/).map(function (x) { return x.trim(); }).filter(String);
}

/** กลุ่มผู้ประเมินของทุกชุด (อ่านและแปลงครั้งเดียวต่อการทำงาน 1 รอบ) */
function loadAllSetGroups_() {
  if (MEMO_.derived.setGroups) return MEMO_.derived.setGroups;

  let rows = [];
  try { rows = readTable_(SHEETS.SET_GROUPS).rows; } catch (e) { rows = []; }

  const map = {};
  rows.forEach(function (r) {
    const setId = str_(r['รหัสชุด']);
    const key = str_(r['รหัสกลุ่ม']);
    const name = str_(r['ชื่อกลุ่มผู้ประเมิน']);
    if (!setId || !key || !name) return;
    if (str_(r['สถานะ']) === STATUS.INACTIVE) return;
    const type = str_(r['ประเภท']) === GROUP_TYPES.PERSON ? GROUP_TYPES.PERSON : GROUP_TYPES.ROLE;
    map[setId] = map[setId] || [];
    if (map[setId].some(function (g) { return g.key === key; })) return; // กันกลุ่มซ้ำ
    map[setId].push({
      setId: setId,
      key: key,
      name: name,
      type: type,
      members: parseMembers_(r['สมาชิก']),
      weight: num_(r['น้ำหนัก (%)']) || 0,
      order: num_(r['ลำดับ']) || 99,
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      _row: r._row
    });
  });

  Object.keys(map).forEach(function (setId) {
    map[setId].sort(function (a, b) { return (a.order - b.order) || a.key.localeCompare(b.key); });
  });
  MEMO_.derived.setGroups = map;
  return map;
}

/** กลุ่มผู้ประเมินของชุดที่ระบุ (ถ้ายังไม่กำหนดเอง จะใช้บทบาทมาตรฐาน 4 กลุ่ม) */
function loadSetGroups_(setId, precomputed) {
  const map = precomputed || loadAllSetGroups_();
  const list = map[str_(setId)];
  return (list && list.length) ? list : fallbackGroups_(str_(setId));
}

/**
 * หากลุ่มของผู้ประเมินในชุดนี้
 * กลุ่มแบบ "รายบุคคล" มีสิทธิ์เหนือกว่ากลุ่มแบบ "บทบาท" เพื่อให้กำหนดรายคนทับได้
 */
function groupOfEvaluator_(groups, evaluator) {
  const id = str_(evaluator.id), name = str_(evaluator.name), role = str_(evaluator.role);
  let found = null;
  groups.forEach(function (g) {
    if (found || g.type !== GROUP_TYPES.PERSON) return;
    if ((id && g.members.indexOf(id) !== -1) || (name && g.members.indexOf(name) !== -1)) found = g;
  });
  if (found) return found;
  groups.forEach(function (g) {
    if (found || g.type !== GROUP_TYPES.ROLE) return;
    if (role && g.members.indexOf(role) !== -1) found = g;
  });
  return found;
}

/** ชุดประเมินทั้งหมดที่ผู้ประเมินคนนี้มีสิทธิ์ทำ พร้อมกลุ่มที่สังกัดในแต่ละชุด */
function setsForEvaluator_(evaluator) {
  const groupMap = loadAllSetGroups_();
  const out = [];
  activeSets_().forEach(function (s) {
    const groups = loadSetGroups_(s.id, groupMap);
    const group = groupOfEvaluator_(groups, evaluator);
    if (group) out.push({ set: s, group: group, groups: groups });
  });
  return out;
}

// ==================== เกณฑ์การประเมิน ====================

/**
 * แปลงข้อความ "ผู้มีสิทธิ์ประเมิน" เป็นรายการกลุ่มที่ประเมินข้อนี้ได้
 * รองรับทั้งชื่อกลุ่ม รหัสกลุ่ม และชื่อบทบาทเดิม เพื่อให้ข้อมูลเก่ายังใช้ได้
 */
function resolveCriteriaGroups_(text, groups) {
  const raw = str_(text);
  const tokens = parseMembers_(raw);
  const keys = [];
  const add = function (key) { if (key && keys.indexOf(key) === -1) keys.push(key); };

  if (!tokens.length) {
    groups.forEach(function (g) { add(g.key); });
    return keys;
  }

  tokens.forEach(function (token) {
    groups.forEach(function (g) {
      if (g.name === token || g.key === token) add(g.key);
      else if (g.type === GROUP_TYPES.ROLE && g.members.indexOf(token) !== -1) add(g.key);
    });
  });

  // ข้อความอิสระที่ไม่ตรงตัว — เทียบแบบมีชื่อกลุ่ม/บทบาทอยู่ในข้อความ
  if (!keys.length) {
    groups.forEach(function (g) {
      if (raw.indexOf(g.name) !== -1) add(g.key);
      else if (g.members.some(function (m) { return m && raw.indexOf(m) !== -1; })) add(g.key);
    });
  }
  if (!keys.length) groups.forEach(function (g) { add(g.key); });
  return keys;
}

/**
 * โหลดเกณฑ์การประเมินของชุดที่ระบุ (ถ้าไม่ระบุจะใช้ชุดหลัก)
 * แถวที่ไม่ได้กรอกรหัสชุดถือว่าอยู่ในชุดหลัก เพื่อให้ข้อมูลเดิมใช้งานได้ทันที
 */
function loadCriteria_(setId) {
  const target = setId ? str_(setId) : defaultSetId_();
  const mainId = defaultSetId_();
  const groups = loadSetGroups_(target);

  let rows = [];
  try {
    rows = readTable_(SHEETS.CRITERIA).rows;
  } catch (e) {
    rows = [];
  }

  const list = [];
  const seen = {};
  rows.forEach(function (r) {
    const rowSet = str_(r['รหัสชุด']) || mainId;
    if (rowSet !== target) return;

    const id = num_(r['ข้อที่']);
    const name = str_(r['เกณฑ์การประเมิน']);
    if (!id || !name || id > MAX_CRITERIA || id !== Math.round(id)) return;
    if (str_(r['สถานะ']) === STATUS.INACTIVE) return;
    if (seen[id]) return; // กันข้อซ้ำ ใช้แถวแรกที่พบ
    seen[id] = true;

    const roleText = str_(r['ผู้มีสิทธิ์ประเมิน']);
    const groupKeys = resolveCriteriaGroups_(roleText, groups);

    // รายชื่อบทบาทที่เกี่ยวข้อง เก็บไว้เพื่อความเข้ากันได้กับส่วนที่ยังอ้างอิงบทบาท
    const roleKeys = [];
    groups.forEach(function (g) {
      if (groupKeys.indexOf(g.key) === -1) return;
      g.members.forEach(function (m) {
        const key = roleKey_(m);
        if (key && roleKeys.indexOf(key) === -1) roleKeys.push(key);
      });
    });

    list.push({
      id: id,
      setId: target,
      name: name,
      groups: groupKeys,
      roles: roleKeys.length ? roleKeys : Object.keys(ROLES),
      weight: num_(r['น้ำหนัก (%)']) || 10,
      description: str_(r['คำอธิบาย'])
    });
  });

  // ชุดหลักที่ยังไม่เคยตั้งเกณฑ์ ให้ใช้เกณฑ์เริ่มต้นในโค้ดไปก่อน
  if (!list.length && target === mainId) {
    return DEFAULT_CRITERIA.map(function (c) {
      return {
        id: c.id, setId: target, name: c.name, roles: c.roles, weight: c.weight, description: '',
        groups: resolveCriteriaGroups_(c.roles.map(function (r) { return ROLES[r]; }).join(', '), groups)
      };
    });
  }
  list.sort(function (a, b) { return a.id - b.id; });
  return list;
}

/** เกณฑ์ที่บทบาทนั้นมีสิทธิ์ประเมิน (ใช้กับชุดหลัก — คงไว้เพื่อความเข้ากันได้) */
function criteriaForRole_(roleName, setId) {
  const key = roleKey_(roleName);
  if (!key) return [];
  return loadCriteria_(setId).filter(function (c) { return c.roles.indexOf(key) !== -1; });
}

/** เกณฑ์ที่ผู้ประเมินคนนี้ต้องให้คะแนนในชุดที่ระบุ */
function criteriaForGroup_(setId, groupKey) {
  return loadCriteria_(setId).filter(function (c) {
    return !groupKey || c.groups.indexOf(groupKey) !== -1;
  });
}

// ==================== การคำนวณคะแนน ====================

function ratingThresholds_() {
  try {
    const parsed = JSON.parse(str_(getSetting_(SETTING_KEYS.THRESHOLDS, JSON.stringify(DEFAULT_THRESHOLDS))));
    return {
      excellent: Number(parsed.excellent) || DEFAULT_THRESHOLDS.excellent,
      great: Number(parsed.great) || DEFAULT_THRESHOLDS.great,
      good: Number(parsed.good) || DEFAULT_THRESHOLDS.good,
      fair: Number(parsed.fair) || DEFAULT_THRESHOLDS.fair
    };
  } catch (e) {
    return DEFAULT_THRESHOLDS;
  }
}

/**
 * แปลงคะแนนเฉลี่ยเป็นระดับผลการประเมิน
 * ชุดที่ใช้มาตราคะแนนอื่น (เช่น เต็มข้อละ 4 หรือ 10) จะถูกเทียบกลับเป็นมาตรา 5 ก่อนตัดระดับ
 * เกณฑ์ตัดระดับจึงใช้ชุดเดียวกันได้ทุกชุดประเมิน
 */
function ratingOf_(average, scaleMax) {
  const t = ratingThresholds_();
  const max = Number(scaleMax) || 5;
  const a = (Number(average) || 0) * (5 / max);
  if (a >= t.excellent) return RATING_LABELS[0];
  if (a >= t.great) return RATING_LABELS[1];
  if (a >= t.good) return RATING_LABELS[2];
  if (a >= t.fair) return RATING_LABELS[3];
  return RATING_LABELS[4];
}

/**
 * คำนวณคะแนนจาก map {criteriaId: score}
 * นับเฉพาะข้อที่ให้คะแนนแล้ว และรองรับการถ่วงน้ำหนักรายข้อ
 * @param {Object} [options] {scaleMax, useWeights}
 */
function computeScore_(scores, criteria, options) {
  const o = options || {};
  const list = criteria || loadCriteria_();
  const scaleMax = Number(o.scaleMax) || SET_DEFAULT_SCALE_MAX;
  const useWeights = (o.useWeights === undefined)
    ? getSettingBool_(SETTING_KEYS.USE_WEIGHTS, 'ไม่')
    : !!o.useWeights;
  let total = 0, count = 0, weightedSum = 0, weightTotal = 0;

  list.forEach(function (c) {
    const raw = scores[c.id];
    if (raw === undefined || raw === null || raw === '') return;
    const score = Number(raw);
    if (isNaN(score) || score < 1 || score > scaleMax) return;
    total += score;
    count++;
    const w = Number(c.weight) || 0;
    weightedSum += score * w;
    weightTotal += w;
  });

  if (!count) return { total: 0, max: 0, average: 0, rating: '', count: 0, scaleMax: scaleMax };

  const average = (useWeights && weightTotal > 0) ? (weightedSum / weightTotal) : (total / count);
  const rounded = Math.round(average * 100) / 100;
  return {
    total: total,
    max: count * scaleMax,
    average: rounded,
    rating: ratingOf_(rounded, scaleMax),
    count: count,
    scaleMax: scaleMax
  };
}

/**
 * แปลง "คะแนนสุทธิหลังถ่วงน้ำหนัก" เป็น "คะแนนที่หน่วยงานได้รับ"
 *
 *   คะแนนที่หน่วยงานได้รับ = คะแนนสุทธิ ÷ คะแนนเต็มต่อข้อ × คะแนนเต็มที่หน่วยงานกำหนด
 *
 * ตัวอย่าง: ชุดกำหนดคะแนนเต็มต่อข้อ 5 และคะแนนที่หน่วยงานได้รับ 20
 *   คะแนนสุทธิ 5.00 → 20.00 คะแนน      คะแนนสุทธิ 4.25 → 17.00 คะแนน
 *
 * @return {number|null} null เมื่อชุดนั้นไม่ได้กำหนดคะแนนเต็มของหน่วยงาน
 */
function convertScore_(net, set) {
  const s = set || defaultSet_();
  const full = Number(s.fullMarks) || 0;
  const scaleMax = Number(s.scaleMax) || SET_DEFAULT_SCALE_MAX;
  if (full <= 0 || scaleMax <= 0) return null;
  const value = (Number(net) || 0) / scaleMax * full;
  return Math.round(value * 100) / 100;
}

/** ความหมายของระดับคะแนนตามมาตราของชุด (ชุดมาตรา 5 ใช้คำอธิบายมาตรฐาน) */
function scaleMeaning_(scaleMax) {
  const max = Number(scaleMax) || SET_DEFAULT_SCALE_MAX;
  if (max === 5) return SCORE_MEANING;
  const out = [];
  for (let v = max; v >= 1; v--) {
    const equivalent = v * 5 / max;
    const found = SCORE_MEANING.filter(function (m) { return m.score === Math.round(equivalent); })[0]
      || SCORE_MEANING[SCORE_MEANING.length - 1];
    out.push({ score: v, label: found.label, desc: found.desc });
  }
  return out;
}

// ==================== น้ำหนักของกลุ่มผู้ประเมิน (คะแนนสุทธิ) ====================

/** อ่านน้ำหนัก % ของแต่ละบทบาทจากการตั้งค่ากลาง (ใช้เป็นค่าตั้งต้นของกลุ่มในชุดประเมิน) */
function roleWeights_() {
  const weights = {};
  Object.keys(DEFAULT_ROLE_WEIGHTS).forEach(function (k) { weights[k] = DEFAULT_ROLE_WEIGHTS[k]; });
  try {
    const parsed = JSON.parse(str_(getSetting_(SETTING_KEYS.ROLE_WEIGHTS, JSON.stringify(DEFAULT_ROLE_WEIGHTS))));
    Object.keys(weights).forEach(function (k) {
      const v = Number(parsed[k]);
      if (!isNaN(v) && v >= 0) weights[k] = v;
    });
  } catch (e) { /* ใช้ค่าเริ่มต้นเมื่อข้อมูลเสียหาย */ }
  return weights;
}

function useRoleWeights_() {
  return getSettingBool_(SETTING_KEYS.USE_ROLE_WEIGHTS, 'ไม่');
}

function normalizeRoleWeights_() {
  return getSettingBool_(SETTING_KEYS.NORMALIZE_ROLE_WEIGHTS, 'ใช่');
}

/**
 * คำนวณ "คะแนนสุทธิ" ของครู 1 คน จากคะแนนเฉลี่ยของกลุ่มผู้ประเมินแต่ละกลุ่ม
 *
 *   คะแนนสุทธิ = ผลรวมของ (คะแนนเฉลี่ยของกลุ่ม × น้ำหนักของกลุ่ม) ÷ ผลรวมน้ำหนักที่ใช้จริง
 *
 * - ถ้าเปิด "ปรับสัดส่วนอัตโนมัติ" จะหารด้วยผลรวมน้ำหนักเฉพาะกลุ่มที่มีการประเมินจริง
 *   (ครูที่ขาดการประเมินจากบางกลุ่มจึงไม่เสียเปรียบ)
 * - ถ้าปิด จะหารด้วยผลรวมน้ำหนักทั้งหมด (กลุ่มที่ไม่มีคะแนนถือเป็น 0)
 *
 * @param {Object} averagesByKey เช่น {VICE_DIRECTOR: 4.5, HEAD_LEVEL: 4.0} หรือคีย์กลุ่มของชุดประเมิน
 * @param {Object} [options] {groups, weights, normalize, scaleMax}
 * @return {{net: number, rating: string, totalWeight: number, usedWeight: number,
 *           breakdown: Array, enabled: boolean}}
 */
function computeNetScore_(averagesByKey, options) {
  const o = options || {};
  const averages = averagesByKey || {};
  const scaleMax = Number(o.scaleMax) || SET_DEFAULT_SCALE_MAX;

  // ไม่ระบุกลุ่มมา = ใช้บทบาทมาตรฐาน 4 กลุ่มพร้อมน้ำหนักจากการตั้งค่ากลาง
  let groups = o.groups;
  if (!groups) {
    const weights = o.weights || roleWeights_();
    groups = Object.keys(ROLES).map(function (key) {
      return { key: key, name: ROLES[key], weight: Number(weights[key]) || 0 };
    });
  }
  const normalize = (o.normalize === undefined) ? normalizeRoleWeights_() : !!o.normalize;

  let weightedSum = 0, usedWeight = 0, totalWeight = 0;
  const breakdown = [];

  groups.forEach(function (g) {
    const weight = Number(g.weight) || 0;
    totalWeight += weight;
    const average = averages[g.key];
    const hasScore = (average !== null && average !== undefined && !isNaN(average));
    if (hasScore && weight > 0) {
      weightedSum += Number(average) * weight;
      usedWeight += weight;
    }
    breakdown.push({
      key: g.key,
      role: g.name,      // ชื่อกลุ่ม (ชื่อเดิมของฟิลด์ คงไว้เพื่อความเข้ากันได้)
      name: g.name,
      type: g.type || GROUP_TYPES.ROLE,
      weight: weight,
      average: hasScore ? Number(average) : null,
      counted: hasScore && weight > 0
    });
  });

  const divisor = normalize ? usedWeight : totalWeight;
  const net = divisor > 0 ? Math.round((weightedSum / divisor) * 100) / 100 : 0;

  // เติมสัดส่วนที่ใช้จริงของแต่ละกลุ่ม เพื่อให้แสดงที่มาของคะแนนได้
  breakdown.forEach(function (b) {
    b.effectiveWeight = (divisor > 0 && b.counted)
      ? Math.round((b.weight / divisor) * 1000) / 10
      : 0;
    b.contribution = b.counted && divisor > 0
      ? Math.round((b.average * b.weight / divisor) * 100) / 100
      : 0;
  });

  return {
    net: net,
    rating: ratingOf_(net, scaleMax),
    totalWeight: totalWeight,
    usedWeight: usedWeight,
    normalized: normalize,
    breakdown: breakdown,
    enabled: true
  };
}

// ==================== ปีการศึกษา / ภาคเรียน ====================

function academicYears_() {
  const raw = str_(getSetting_(SETTING_KEYS.ACADEMIC_YEARS, ''));
  let years = raw.split(',').map(function (y) { return y.trim(); }).filter(String);
  if (!years.length) years = [guessAcademicYear_()];

  // รวมปีที่ปรากฏในข้อมูลจริงเข้าไปด้วย เพื่อให้ค้นย้อนหลังได้เสมอ
  try {
    readTable_(SHEETS.RESULTS).rows.forEach(function (r) {
      const y = str_(r['ปีการศึกษา']);
      if (y && years.indexOf(y) === -1) years.push(y);
    });
  } catch (e) { /* ไม่มีชีทผลการประเมิน */ }

  years.sort(function (a, b) { return Number(b) - Number(a); });
  return years;
}

/** ภาคเรียนที่เปิดใช้งาน (ตั้งค่าได้อย่างอิสระ) */
function semesterList_() {
  const raw = str_(getSetting_(SETTING_KEYS.SEMESTERS, DEFAULT_SEMESTERS.join(',')));
  const allowed = ALL_SEMESTERS.map(function (s) { return s.value; });
  const list = raw.split(',').map(function (v) { return v.trim(); })
    .filter(function (v) { return allowed.indexOf(v) !== -1; });
  return list.length ? list : DEFAULT_SEMESTERS.slice();
}

/** ชื่อภาคเรียนที่อ่านง่าย */
function semesterLabel_(value) {
  const found = ALL_SEMESTERS.filter(function (s) { return s.value === String(value); })[0];
  return found ? found.label : 'ภาคเรียนที่ ' + value;
}

/** รายการภาคเรียนพร้อมสถานะเปิด/ปิด สำหรับหน้าตั้งค่า */
function semesterOptions_() {
  const enabled = semesterList_();
  return ALL_SEMESTERS.map(function (s) {
    return { value: s.value, label: s.label, enabled: enabled.indexOf(s.value) !== -1 };
  });
}

function currentTerm_() {
  return {
    year: str_(getSetting_(SETTING_KEYS.CURRENT_YEAR, guessAcademicYear_())),
    semester: str_(getSetting_(SETTING_KEYS.CURRENT_SEMESTER, guessSemester_()))
  };
}

function termLabel_(year, semester) {
  return semesterLabel_(semester) + '/' + year;
}

/** คีย์ของภาคเรียนที่ใช้ในรายการภาคเรียนที่ปิดแล้ว เช่น "1/2568" */
function termKey_(year, semester) {
  return String(semester) + '/' + String(year);
}

/** ภาคเรียนที่ผู้ดูแลปิดการแก้ไขแล้ว (ล็อกข้อมูลไม่ให้ผู้ประเมินบันทึกเพิ่ม) */
function lockedTerms_() {
  return str_(getSetting_(SETTING_KEYS.LOCKED_TERMS, ''))
    .split(',').map(function (x) { return x.trim(); }).filter(String);
}

function isTermLocked_(year, semester) {
  return lockedTerms_().indexOf(termKey_(year, semester)) !== -1;
}

/** แปลงข้อความวันที่ yyyy-MM-dd เป็น Date (คืน null เมื่อรูปแบบไม่ถูกต้อง) */
function parseDateOnly_(text) {
  const t = str_(text);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * ตรวจว่าขณะนี้เปิดให้บันทึกผลการประเมินหรือไม่
 * ใช้ทั้งสวิตช์เปิด/ปิด ช่วงวันที่ที่กำหนด และการล็อกภาคเรียนที่ปิดแล้ว
 * @return {{open: boolean, reason: string, start: string, end: string, locked: boolean}}
 */
function evaluationWindow_(year, semester) {
  const start = str_(getSetting_(SETTING_KEYS.EVALUATION_START, ''));
  const end = str_(getSetting_(SETTING_KEYS.EVALUATION_END, ''));
  const info = { open: true, reason: '', start: start, end: end, locked: false };

  if (year && semester && isTermLocked_(year, semester)) {
    info.open = false;
    info.locked = true;
    info.reason = 'ภาคเรียนนี้ปิดการประเมินถาวรแล้ว (' + termLabel_(year, semester) + ')';
    return info;
  }
  if (!getSettingBool_(SETTING_KEYS.EVALUATION_OPEN, 'ใช่')) {
    info.open = false;
    info.reason = 'ขณะนี้ผู้ดูแลระบบปิดการบันทึกผลการประเมินชั่วคราว';
    return info;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = parseDateOnly_(start);
  const endDate = parseDateOnly_(end);
  if (startDate && today < startDate) {
    info.open = false;
    info.reason = 'ยังไม่ถึงวันเปิดให้ประเมิน (เริ่ม ' + formatDate_(startDate, 'd MMMM yyyy') + ')';
  } else if (endDate && today > endDate) {
    info.open = false;
    info.reason = 'หมดกำหนดการประเมินแล้ว (สิ้นสุด ' + formatDate_(endDate, 'd MMMM yyyy') + ')';
  }
  return info;
}

// ==================== ตารางเวรประจำวันรายภาคเรียน ====================

/**
 * อ่านตารางเวรของภาคเรียนที่ระบุ — ข้อมูลของแต่ละภาคเรียนแยกกันอย่างสมบูรณ์
 * @return {{byTeacherId: Object, byTeacherName: Object, rows: Array}}
 */
function dutyRosterFor_(year, semester) {
  const rows = readTable_(SHEETS.DUTY).rows.filter(function (r) {
    return str_(r['ปีการศึกษา']) === String(year)
      && str_(r['ภาคเรียน']) === String(semester)
      && str_(r['สถานะ']) !== STATUS.INACTIVE;
  });

  const byTeacherId = {}, byTeacherName = {};
  const list = rows.map(function (r) {
    const item = {
      id: str_(r['รหัสรายการ']),
      year: str_(r['ปีการศึกษา']),
      semester: str_(r['ภาคเรียน']),
      teacherId: str_(r['รหัสครู']),
      teacherName: str_(r['ชื่อ-นามสกุล']),
      day: str_(r['เวรประจำวัน']),
      position: str_(r['บทบาทในเวร']),
      location: str_(r['จุดปฏิบัติหน้าที่']),
      startTime: str_(r['เวลาเริ่ม']),
      endTime: str_(r['เวลาสิ้นสุด']),
      level: str_(r['ระดับชั้นที่ดูแล']),
      note: str_(r['หมายเหตุ']),
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      updatedBy: str_(r['ผู้บันทึก']),
      updatedAt: formatDate_(r['วันที่บันทึก']),
      _row: r._row
    };
    if (item.teacherId) byTeacherId[item.teacherId] = item;
    if (item.teacherName) byTeacherName[item.teacherName] = item;
    return item;
  });

  return { byTeacherId: byTeacherId, byTeacherName: byTeacherName, rows: list };
}

/** เวรประจำวันของครูในภาคเรียนที่ระบุ (ถ้าไม่มีในตารางเวร จะใช้ค่าเริ่มต้นจากทะเบียนครู) */
function dutyOfTeacher_(teacher, roster) {
  const entry = (teacher.id && roster.byTeacherId[teacher.id]) || roster.byTeacherName[teacher.name];
  if (entry) return entry;
  return {
    day: teacher.defaultDay || '',
    position: '',
    location: '',
    startTime: '',
    endTime: '',
    level: teacher.level || '',
    note: '',
    fallback: true
  };
}

/** รายชื่อครูที่ยังใช้งานอยู่ พร้อมข้อมูลเวรของภาคเรียนที่เลือก */
function teachersWithDuty_(year, semester, includeInactive) {
  const index = buildTeacherIndex_();
  const roster = dutyRosterFor_(year, semester);
  const out = [];

  index.list.forEach(function (r) {
    const teacher = {
      id: str_(r['รหัสครู']),
      name: str_(r['ชื่อ-นามสกุล']),
      level: str_(r['ระดับชั้นที่ปรึกษา']),
      room: str_(r['ห้องที่ปรึกษา']),
      department: str_(r['กลุ่มสาระ/ฝ่าย']),
      email: str_(r['อีเมล']),
      defaultDay: str_(r['เวรประจำวัน (ค่าเริ่มต้น)']),
      status: str_(r['สถานะ']) || STATUS.ACTIVE,
      _row: r._row
    };
    if (!teacher.name) return;
    if (!includeInactive && teacher.status === STATUS.INACTIVE) return;

    const duty = dutyOfTeacher_(teacher, roster);
    teacher.dutyDay = duty.day;
    teacher.dutyPosition = duty.position;
    teacher.dutyLocation = duty.location;
    teacher.dutyTime = duty.startTime && duty.endTime ? (duty.startTime + ' - ' + duty.endTime) : '';
    teacher.dutyLevel = duty.level;
    teacher.dutyNote = duty.note;
    teacher.dutyFromRoster = !duty.fallback;
    out.push(teacher);
  });

  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}

/**
 * ครูที่ผู้ประเมินคนนี้มีสิทธิ์ประเมินในภาคเรียนที่เลือก
 * - รอง ผอ. / หัวหน้ากลุ่มกิจการนักเรียน: ประเมินได้ทุกคน
 * - หัวหน้าระดับชั้น: เฉพาะครูในระดับชั้นที่รับผิดชอบ
 * - หัวหน้าเวรประจำวัน: เฉพาะครูที่อยู่เวรวันเดียวกัน "ตามตารางเวรของภาคเรียนนั้น"
 * @param {Array} [precomputed] รายชื่อครูพร้อมข้อมูลเวรที่คำนวณไว้แล้ว (ใช้เมื่อเรียกซ้ำหลายรอบ)
 */
function teachersForEvaluator_(role, scope, year, semester, precomputed) {
  const all = precomputed || teachersWithDuty_(year, semester, false);
  if (role === ROLES.VICE_DIRECTOR || role === ROLES.HEAD_AFFAIRS) return all;
  if (role === ROLES.HEAD_LEVEL) {
    return all.filter(function (t) { return t.level === scope; });
  }
  if (role === ROLES.HEAD_DUTY) {
    return all.filter(function (t) { return t.dutyDay === scope; });
  }
  return [];
}
