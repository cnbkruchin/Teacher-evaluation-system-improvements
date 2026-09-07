/**
 * ============================================================================
 * ไฟล์: 10_Archive.gs  |  คลังข้อมูลการประเมินย้อนหลัง
 *
 * ข้อมูลการประเมินจะไม่ถูกลบทิ้งถาวร แต่จะย้ายเข้าคลังพร้อมระบุว่า
 * ถูกจัดเก็บด้วยเหตุผลใด ใครเป็นผู้ทำ และเมื่อใด ทำให้ตรวจสอบย้อนหลังได้เสมอ
 *
 * ประเภทการจัดเก็บ:
 *  - "ฉบับแก้ไข"        : ผู้ประเมินบันทึกทับผลเดิม (เก็บฉบับก่อนหน้าไว้)
 *  - "ลบโดยผู้ดูแลระบบ" : ผู้ดูแลลบรายการออกจากตารางหลัก
 *  - "จัดเก็บภาคเรียน"  : ปิดภาคเรียนแล้วย้ายทั้งภาคเรียนเข้าคลัง
 * ============================================================================
 */

/** ย้ายข้อมูล 1 แถวเข้าคลัง (ไม่ลบออกจากตารางหลัก — ผู้เรียกเป็นผู้ตัดสินใจ) */
function archiveResultRow_(row, type, note, actor) {
  const headers = resultHeaders_();
  const record = {};
  headers.forEach(function (h) {
    if (row[h] !== undefined) record[h] = row[h];
  });

  const batchIds = readTable_(SHEETS.ARCHIVE).rows.map(function (r) { return str_(r['รหัสชุดจัดเก็บ']); });
  record['รหัสชุดจัดเก็บ'] = nextCode_('ARC', batchIds);
  record['ประเภทการจัดเก็บ'] = type || 'ไม่ระบุ';
  record['วันที่จัดเก็บ'] = new Date();
  record['ผู้จัดเก็บ'] = actor || 'ระบบ';
  record['หมายเหตุ'] = note || '';
  appendRecord_(SHEETS.ARCHIVE, record);
  return record['รหัสชุดจัดเก็บ'];
}

/** ประวัติการแก้ไขของผลการประเมินหนึ่งรายการ */
function archiveHistoryFor_(resultId) {
  if (!resultId) return [];
  return readTable_(SHEETS.ARCHIVE).rows
    .filter(function (r) { return str_(r['รหัสการประเมิน']) === str_(resultId); })
    .map(function (r) {
      return {
        batchId: str_(r['รหัสชุดจัดเก็บ']),
        type: str_(r['ประเภทการจัดเก็บ']),
        archivedAt: formatDate_(r['วันที่จัดเก็บ']),
        archivedBy: str_(r['ผู้จัดเก็บ']),
        note: str_(r['หมายเหตุ']),
        average: num_(r['คะแนนเฉลี่ย']),
        rating: str_(r['ระดับผลการประเมิน']),
        comment: str_(r['ข้อเสนอแนะ']),
        revision: num_(r['แก้ไขครั้งที่'])
      };
    })
    .sort(function (a, b) { return b.archivedAt.localeCompare(a.archivedAt); });
}

/** ค้นหาข้อมูลในคลัง */
function apiListArchive(token, filters) {
  return guard_(function () {
    requireAdmin_(token);
    const f = filters || {};
    const keyword = str_(f.keyword).toLowerCase();

    const rows = readTable_(SHEETS.ARCHIVE).rows.filter(function (r) {
      if (str_(f.year) && str_(f.year) !== 'all' && str_(r['ปีการศึกษา']) !== str_(f.year)) return false;
      if (str_(f.semester) && str_(f.semester) !== 'all' && str_(r['ภาคเรียน']) !== str_(f.semester)) return false;
      if (str_(f.type) && str_(f.type) !== 'all' && str_(r['ประเภทการจัดเก็บ']) !== str_(f.type)) return false;
      if (keyword) {
        const hay = (str_(r['ครูผู้รับการประเมิน']) + ' ' + str_(r['ผู้ประเมิน'])).toLowerCase();
        if (hay.indexOf(keyword) === -1) return false;
      }
      return true;
    }).map(function (r) {
      return {
        batchId: str_(r['รหัสชุดจัดเก็บ']),
        resultId: str_(r['รหัสการประเมิน']),
        type: str_(r['ประเภทการจัดเก็บ']),
        year: str_(r['ปีการศึกษา']),
        semester: str_(r['ภาคเรียน']),
        teacher: str_(r['ครูผู้รับการประเมิน']),
        evaluator: str_(r['ผู้ประเมิน']),
        role: str_(r['บทบาทผู้ประเมิน']),
        average: num_(r['คะแนนเฉลี่ย']),
        rating: str_(r['ระดับผลการประเมิน']),
        comment: str_(r['ข้อเสนอแนะ']),
        savedAt: formatDate_(r['วันที่บันทึก']),
        archivedAt: formatDate_(r['วันที่จัดเก็บ']),
        archivedBy: str_(r['ผู้จัดเก็บ']),
        note: str_(r['หมายเหตุ'])
      };
    });

    rows.sort(function (a, b) { return b.archivedAt.localeCompare(a.archivedAt); });

    const summary = {};
    rows.forEach(function (r) {
      const key = r.year + '/' + r.semester;
      summary[key] = (summary[key] || 0) + 1;
    });

    return ok_({
      rows: rows.slice(0, num_(f.limit) || 1000),
      total: rows.length,
      byTerm: summary,
      types: ['ฉบับแก้ไข', 'ลบโดยผู้ดูแลระบบ', 'จัดเก็บภาคเรียน'],
      years: academicYears_(),
      semesters: SEMESTERS
    });
  });
}

/**
 * ปิดภาคเรียน: ย้ายผลการประเมินของภาคเรียนนั้นทั้งหมดเข้าคลัง
 * ใช้เมื่อสิ้นภาคเรียนเพื่อเริ่มภาคเรียนใหม่ด้วยตารางที่สะอาด
 * โดยข้อมูลเดิมยังค้นย้อนหลังและนำมาออกรายงานได้
 */
function apiArchiveTerm(token, year, semester, note) {
  return guard_(function () {
    const session = requireAdmin_(token);
    const y = str_(year), s = str_(semester);
    if (!y || !s) return fail_('กรุณาระบุปีการศึกษาและภาคเรียนที่ต้องการจัดเก็บ');

    return withLock_(function () {
      const table = readTable_(SHEETS.RESULTS);
      const targets = table.rows.filter(function (r) {
        return str_(r['ปีการศึกษา']) === y && str_(r['ภาคเรียน']) === s;
      });
      if (!targets.length) return fail_('ไม่พบผลการประเมินของ ' + termLabel_(y, s));

      const headers = resultHeaders_();
      const batchIds = readTable_(SHEETS.ARCHIVE).rows.map(function (r) { return str_(r['รหัสชุดจัดเก็บ']); });
      const archivedAt = new Date();

      const records = targets.map(function (row) {
        const record = {};
        headers.forEach(function (h) { if (row[h] !== undefined) record[h] = row[h]; });
        const id = nextCode_('ARC', batchIds);
        batchIds.push(id);
        record['รหัสชุดจัดเก็บ'] = id;
        record['ประเภทการจัดเก็บ'] = 'จัดเก็บภาคเรียน';
        record['วันที่จัดเก็บ'] = archivedAt;
        record['ผู้จัดเก็บ'] = session.name || 'Admin';
        record['หมายเหตุ'] = str_(note) || ('ปิด' + termLabel_(y, s));
        return record;
      });
      appendRecords_(SHEETS.ARCHIVE, records);

      // ลบจากตารางหลักจากล่างขึ้นบน เพื่อไม่ให้เลขแถวเลื่อน
      targets.map(function (r) { return r._row; })
        .sort(function (a, b) { return b - a; })
        .forEach(function (row) { deleteRecord_(SHEETS.RESULTS, row); });

      logAction_('Admin', 'admin', 'จัดเก็บภาคเรียนเข้าคลัง',
        termLabel_(y, s) + ' จำนวน ' + records.length + ' รายการ');
      return ok_({ archived: records.length },
        'จัดเก็บ ' + termLabel_(y, s) + ' เข้าคลังเรียบร้อย ' + records.length + ' รายการ');
    });
  });
}

/** นำข้อมูลจากคลังกลับเข้าตารางหลัก (กรณีจัดเก็บผิด) */
function apiRestoreArchive(token, batchIds) {
  return guard_(function () {
    const session = requireAdmin_(token);
    const ids = (batchIds || []).map(String);
    if (!ids.length) return fail_('กรุณาเลือกรายการที่ต้องการกู้คืน');

    return withLock_(function () {
      const headers = resultHeaders_();
      const archive = readTable_(SHEETS.ARCHIVE);
      const targets = archive.rows.filter(function (r) { return ids.indexOf(str_(r['รหัสชุดจัดเก็บ'])) !== -1; });
      if (!targets.length) return fail_('ไม่พบรายการในคลังข้อมูล');

      // ป้องกันการกู้คืนซ้ำกับรายการที่มีอยู่แล้วในตารางหลัก
      const existingIds = {};
      readTable_(SHEETS.RESULTS).rows.forEach(function (r) { existingIds[str_(r['รหัสการประเมิน'])] = true; });

      const restore = [];
      const skipped = [];
      targets.forEach(function (row) {
        const resultId = str_(row['รหัสการประเมิน']);
        if (existingIds[resultId]) { skipped.push(resultId); return; }
        const record = {};
        headers.forEach(function (h) { if (row[h] !== undefined) record[h] = row[h]; });
        restore.push(record);
        existingIds[resultId] = true;
      });

      appendRecords_(SHEETS.RESULTS, restore);
      targets.filter(function (row) { return skipped.indexOf(str_(row['รหัสการประเมิน'])) === -1; })
        .map(function (r) { return r._row; })
        .sort(function (a, b) { return b - a; })
        .forEach(function (row) { deleteRecord_(SHEETS.ARCHIVE, row); });

      logAction_('Admin', 'admin', 'กู้คืนข้อมูลจากคลัง',
        'กู้คืน ' + restore.length + ' รายการ โดย ' + (session.name || 'Admin'));
      return ok_({ restored: restore.length, skipped: skipped.length },
        'กู้คืนข้อมูล ' + restore.length + ' รายการเรียบร้อย' +
        (skipped.length ? ' (ข้าม ' + skipped.length + ' รายการที่มีอยู่แล้ว)' : ''));
    });
  });
}

/** เปรียบเทียบคะแนนของครูข้ามภาคเรียน (ใช้ข้อมูลทั้งตารางหลักและคลัง) */
function apiTeacherHistory(token, teacherKey) {
  return guard_(function () {
    requireAdmin_(token);
    const key = str_(teacherKey);
    if (!key) return fail_('กรุณาระบุครูที่ต้องการดูประวัติ');

    const collect = function (rows, source) {
      return rows.filter(function (r) {
        if (str_(r['สถานะ']) === STATUS.CANCELLED) return false;
        return str_(r['รหัสครู']) === key || str_(r['ครูผู้รับการประเมิน']) === key;
      }).map(function (r) {
        return {
          source: source,
          year: str_(r['ปีการศึกษา']),
          semester: str_(r['ภาคเรียน']),
          evaluator: str_(r['ผู้ประเมิน']),
          role: str_(r['บทบาทผู้ประเมิน']),
          dutyDay: str_(r['เวรประจำวัน']),
          average: num_(r['คะแนนเฉลี่ย']),
          rating: str_(r['ระดับผลการประเมิน']),
          comment: str_(r['ข้อเสนอแนะ']),
          savedAt: formatDate_(r['วันที่บันทึก']),
          archiveType: str_(r['ประเภทการจัดเก็บ'])
        };
      });
    };

    const current = collect(readTable_(SHEETS.RESULTS).rows, 'ปัจจุบัน');
    const archived = collect(readTable_(SHEETS.ARCHIVE).rows, 'คลังข้อมูล');
    const all = current.concat(archived);
    if (!all.length) return fail_('ไม่พบประวัติการประเมินของครูท่านนี้');

    // สรุปคะแนนเฉลี่ยรายภาคเรียน (นับเฉพาะข้อมูลปัจจุบันและที่จัดเก็บทั้งภาคเรียน)
    const byTerm = {};
    all.forEach(function (r) {
      if (r.source === 'คลังข้อมูล' && r.archiveType !== 'จัดเก็บภาคเรียน') return;
      const k = r.year + '/' + r.semester;
      byTerm[k] = byTerm[k] || { year: r.year, semester: r.semester, scores: [], dutyDay: r.dutyDay };
      byTerm[k].scores.push(r.average);
    });

    const trend = Object.keys(byTerm).map(function (k) {
      const t = byTerm[k];
      const avg = t.scores.reduce(function (a, b) { return a + b; }, 0) / t.scores.length;
      return {
        term: k,
        label: termLabel_(t.year, t.semester),
        year: t.year, semester: t.semester,
        dutyDay: t.dutyDay,
        average: Math.round(avg * 100) / 100,
        rating: ratingOf_(avg),
        count: t.scores.length
      };
    }).sort(function (a, b) {
      return (a.year + a.semester).localeCompare(b.year + b.semester);
    });

    const name = all[0] ? (readTable_(SHEETS.RESULTS).rows.concat(readTable_(SHEETS.ARCHIVE).rows)
      .filter(function (r) { return str_(r['รหัสครู']) === key || str_(r['ครูผู้รับการประเมิน']) === key; })
      .map(function (r) { return str_(r['ครูผู้รับการประเมิน']); })[0] || key) : key;

    return ok_({
      teacher: name,
      trend: trend,
      records: all.sort(function (a, b) { return b.savedAt.localeCompare(a.savedAt); })
    });
  });
}
