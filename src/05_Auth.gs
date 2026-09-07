/**
 * ============================================================================
 * ไฟล์: 05_Auth.gs  |  การเข้าสู่ระบบ / ออกจากระบบ / เปลี่ยนรหัสผ่าน
 * ฟังก์ชันที่ขึ้นต้นด้วย api* คือฟังก์ชันที่หน้าเว็บเรียกใช้ได้
 * ============================================================================
 */

/** ข้อมูลเริ่มต้นสำหรับหน้าเข้าสู่ระบบ (ไม่มีข้อมูลอ่อนไหว) */
function apiBootstrap() {
  return guard_(function () {
    const installed = sheetExists_(SHEETS.SETTINGS) && !!str_(getSetting_(SETTING_KEYS.ADMIN_HASH, ''));
    const term = installed ? currentTerm_() : { year: guessAcademicYear_(), semester: guessSemester_() };
    const data = {
      appName: APP.NAME,
      subtitle: APP.SUBTITLE,
      version: APP.VERSION,
      organization: installed ? str_(getSetting_(SETTING_KEYS.ORG_NAME, 'โรงเรียน')) : 'โรงเรียน',
      installed: installed,
      currentYear: term.year,
      currentSemester: term.semester,
      recoveryConfigured: installed ? !!str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, '')) : false,
      showEvaluatorList: installed ? getSettingBool_(SETTING_KEYS.SHOW_EVALUATOR_LIST, 'ใช่') : true,
      evaluators: []
    };

    if (installed && data.showEvaluatorList) {
      data.evaluators = readTable_(SHEETS.EVALUATORS).rows
        .filter(function (r) { return str_(r['ชื่อ-นามสกุล']) && str_(r['สถานะ']) !== STATUS.INACTIVE; })
        .map(function (r) {
          return {
            name: str_(r['ชื่อ-นามสกุล']),
            role: str_(r['บทบาท']),
            scope: str_(r['ขอบเขต (ระดับชั้น/วัน)'])
          };
        })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
    }
    return ok_(data);
  });
}

// ==================== ผู้ดูแลระบบ ====================

/**
 * เข้าสู่ระบบผู้ดูแล
 * @param {string} password รหัสผ่าน
 * @param {string} clientId รหัสอุปกรณ์ที่หน้าเว็บสุ่มไว้ ใช้จำกัดจำนวนครั้งการลองผิดรายเครื่อง
 */
function apiAdminLogin(password, clientId) {
  return guard_(function () {
    const deviceBucket = 'admin::' + str_(clientId || 'unknown');
    const globalBucket = 'admin::global';

    const deviceStatus = rateLimitStatus_(deviceBucket);
    if (deviceStatus.blocked) {
      return fail_('กรอกรหัสผ่านผิดหลายครั้งเกินไป กรุณารออีก ' + deviceStatus.retryInMinutes + ' นาที', 'LOCKED');
    }
    // กันการยิงรหัสผ่านจากหลายเครื่องพร้อมกัน (ตั้งเพดานสูงกว่าเพื่อไม่ให้ผู้ใช้จริงถูกล็อกง่าย)
    const globalStatus = rateLimitStatus_(globalBucket);
    if (globalStatus.blocked) {
      return fail_('ระบบตรวจพบการพยายามเข้าสู่ระบบผิดปกติ กรุณารออีก ' + globalStatus.retryInMinutes + ' นาที', 'LOCKED');
    }

    if (!adminEmailAllowed_()) {
      logAction_('-', 'admin', 'ปฏิเสธการเข้าสู่ระบบ', 'บัญชี Google ไม่อยู่ในรายการที่อนุญาต: ' + activeUserEmail_());
      return fail_('บัญชี Google นี้ไม่ได้รับอนุญาตให้เข้าสู่ระบบผู้ดูแล');
    }

    const storedHash = str_(getSetting_(SETTING_KEYS.ADMIN_HASH, ''));
    if (!storedHash) return fail_('ยังไม่ได้ติดตั้งระบบ กรุณาสั่งติดตั้งจากเมนู "🏫 ระบบประเมินผล"');

    const salt = str_(getSetting_(SETTING_KEYS.ADMIN_SALT, ''));
    const iterations = getSettingNumber_(SETTING_KEYS.ADMIN_ITER, 4096);
    const check = verifyPassword_(password, storedHash, salt, iterations);

    if (!check.valid) {
      rateLimitFail_(deviceBucket);
      rateLimitFail_(globalBucket, getSettingNumber_(SETTING_KEYS.MAX_LOGIN_ATTEMPTS, 5) * 10, 5);
      logAction_('-', 'admin', 'เข้าสู่ระบบไม่สำเร็จ', 'รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง');
      return fail_('รหัสผ่านไม่ถูกต้อง');
    }

    // รหัสผ่านจากระบบเดิม → อัปเกรดเป็นรูปแบบใหม่ที่ปลอดภัยกว่าโดยอัตโนมัติ
    if (check.needsUpgrade) {
      const rec = makePasswordRecord_(password, iterations);
      setSettings_({
        admin_password_hash: rec.hash,
        admin_password_salt: rec.salt,
        admin_password_iterations: rec.iterations
      });
      logAction_('Admin', 'admin', 'อัปเกรดการเข้ารหัสรหัสผ่าน', 'ย้ายรหัสผ่านผู้ดูแลระบบมาใช้ salt เฉพาะราย');
    }

    rateLimitReset_(deviceBucket);
    const created = createSession_({ kind: 'admin', name: 'ผู้ดูแลระบบ', role: 'ผู้ดูแลระบบ' });
    logAction_('Admin', 'admin', 'เข้าสู่ระบบ', 'เข้าสู่ระบบผู้ดูแลระบบสำเร็จ');

    return ok_({
      token: created.token,
      kind: 'admin',
      name: 'ผู้ดูแลระบบ',
      version: APP.VERSION,
      recoveryConfigured: !!str_(getSetting_(SETTING_KEYS.RECOVERY_EMAIL, ''))
    });
  });
}

/** เปลี่ยนรหัสผ่านผู้ดูแลระบบ (ต้องยืนยันรหัสผ่านเดิม) */
function apiAdminChangePassword(token, oldPassword, newPassword) {
  return guard_(function () {
    requireAdmin_(token);

    const storedHash = str_(getSetting_(SETTING_KEYS.ADMIN_HASH, ''));
    const salt = str_(getSetting_(SETTING_KEYS.ADMIN_SALT, ''));
    const iterations = getSettingNumber_(SETTING_KEYS.ADMIN_ITER, 4096);
    if (!verifyPassword_(oldPassword, storedHash, salt, iterations).valid) {
      logAction_('Admin', 'admin', 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'รหัสผ่านเดิมไม่ถูกต้อง');
      return fail_('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    const policy = checkPasswordPolicy_(newPassword);
    if (!policy.ok) return fail_(policy.message);
    if (String(newPassword) === String(oldPassword)) return fail_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');

    const rec = makePasswordRecord_(newPassword, iterations);
    setSettings_({
      admin_password_hash: rec.hash,
      admin_password_salt: rec.salt,
      admin_password_iterations: rec.iterations,
      admin_password_changed_at: nowStamp_()
    });

    // เปลี่ยนรหัสผ่านแล้วให้ทุกเซสชันผู้ดูแลเดิมหมดสิทธิ์ทันที
    destroyAllSessions_('admin');
    logAction_('Admin', 'admin', 'เปลี่ยนรหัสผ่าน', 'เปลี่ยนรหัสผ่านผู้ดูแลระบบสำเร็จ');
    return ok_(null, 'เปลี่ยนรหัสผ่านเรียบร้อย กรุณาเข้าสู่ระบบใหม่');
  });
}

// ==================== ผู้ประเมิน ====================

function apiEvaluatorLogin(evaluatorName, password) {
  return guard_(function () {
    const name = str_(evaluatorName);
    if (!name) return fail_('กรุณาระบุชื่อผู้ประเมิน');

    const bucket = 'evaluator::' + name;
    const status = rateLimitStatus_(bucket);
    if (status.blocked) {
      return fail_('บัญชีนี้ถูกล็อกชั่วคราวเนื่องจากกรอกรหัสผ่านผิดหลายครั้ง กรุณารออีก ' +
        status.retryInMinutes + ' นาที หรือติดต่อผู้ดูแลระบบ', 'LOCKED');
    }

    const table = readTable_(SHEETS.EVALUATORS);
    let target = null;
    table.rows.forEach(function (r) {
      if (str_(r['ชื่อ-นามสกุล']) === name) target = r;
    });

    const generic = 'ชื่อผู้ประเมินหรือรหัสผ่านไม่ถูกต้อง';
    if (!target) {
      rateLimitFail_(bucket);
      return fail_(generic);
    }
    if (str_(target['สถานะ']) === STATUS.INACTIVE) {
      return fail_('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    }

    const lockUntil = target['ล็อกถึงเวลา'];
    if (lockUntil && new Date(lockUntil).getTime() > Date.now()) {
      return fail_('บัญชีนี้ถูกล็อกชั่วคราว กรุณาติดต่อผู้ดูแลระบบ', 'LOCKED');
    }

    const check = verifyPassword_(password, str_(target['รหัสผ่าน (Hash)']),
      str_(target['Salt']), num_(target['รอบการเข้ารหัส']) || getSettingNumber_(SETTING_KEYS.PASSWORD_ITERATIONS, 4096));

    if (!check.valid) {
      const rl = rateLimitFail_(bucket);
      const fails = num_(target['จำนวนครั้งที่ผิด']) + 1;
      const patch = { 'จำนวนครั้งที่ผิด': fails };
      if (rl.locked) {
        patch['ล็อกถึงเวลา'] = new Date(Date.now() + getSettingNumber_(SETTING_KEYS.LOCKOUT_MINUTES, 15) * 60000);
      }
      updateRecord_(SHEETS.EVALUATORS, target._row, patch);
      logAction_(name, 'evaluator', 'เข้าสู่ระบบไม่สำเร็จ', 'รหัสผ่านไม่ถูกต้อง (ครั้งที่ ' + fails + ')');
      return fail_(generic);
    }

    // อัปเกรดรหัสผ่านรูปแบบเดิมให้ปลอดภัยขึ้นโดยผู้ใช้ไม่ต้องทำอะไร
    if (check.needsUpgrade) {
      const rec = makePasswordRecord_(password);
      updateRecord_(SHEETS.EVALUATORS, target._row, {
        'รหัสผ่าน (Hash)': rec.hash, 'Salt': rec.salt, 'รอบการเข้ารหัส': rec.iterations
      });
    }

    rateLimitReset_(bucket);
    updateRecord_(SHEETS.EVALUATORS, target._row, {
      'เข้าสู่ระบบล่าสุด': new Date(), 'จำนวนครั้งที่ผิด': 0, 'ล็อกถึงเวลา': ''
    });

    const created = createSession_({
      kind: 'evaluator',
      id: str_(target['รหัสผู้ประเมิน']),
      name: name,
      role: str_(target['บทบาท']),
      scope: str_(target['ขอบเขต (ระดับชั้น/วัน)']),
      mustChangePassword: str_(target['ต้องเปลี่ยนรหัสผ่าน']) === 'ใช่'
    });

    logAction_(name, 'evaluator', 'เข้าสู่ระบบ', 'บทบาท: ' + str_(target['บทบาท']));
    return ok_({
      token: created.token,
      kind: 'evaluator',
      id: created.session.id,
      name: name,
      role: created.session.role,
      scope: created.session.scope,
      mustChangePassword: created.session.mustChangePassword,
      version: APP.VERSION
    });
  });
}

function apiEvaluatorChangePassword(token, oldPassword, newPassword) {
  return guard_(function () {
    const session = requireEvaluator_(token);
    const table = readTable_(SHEETS.EVALUATORS);
    let target = null;
    table.rows.forEach(function (r) {
      if (str_(r['ชื่อ-นามสกุล']) === session.name) target = r;
    });
    if (!target) return fail_('ไม่พบบัญชีผู้ประเมิน');

    const check = verifyPassword_(oldPassword, str_(target['รหัสผ่าน (Hash)']), str_(target['Salt']),
      num_(target['รอบการเข้ารหัส']) || getSettingNumber_(SETTING_KEYS.PASSWORD_ITERATIONS, 4096));
    if (!check.valid) return fail_('รหัสผ่านเดิมไม่ถูกต้อง');

    const policy = checkPasswordPolicy_(newPassword);
    if (!policy.ok) return fail_(policy.message);
    if (String(newPassword) === String(oldPassword)) return fail_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');

    const rec = makePasswordRecord_(newPassword);
    updateRecord_(SHEETS.EVALUATORS, target._row, {
      'รหัสผ่าน (Hash)': rec.hash, 'Salt': rec.salt, 'รอบการเข้ารหัส': rec.iterations,
      'ต้องเปลี่ยนรหัสผ่าน': 'ไม่'
    });
    logAction_(session.name, 'evaluator', 'เปลี่ยนรหัสผ่าน', 'ผู้ประเมินเปลี่ยนรหัสผ่านด้วยตนเอง');
    return ok_(null, 'เปลี่ยนรหัสผ่านเรียบร้อย');
  });
}

// ==================== เซสชัน ====================

/** ตรวจสอบเซสชันปัจจุบัน ใช้ตอนรีเฟรชหน้าเว็บ */
function apiSession(token) {
  return guard_(function () {
    const session = readSession_(token);
    if (!session) return fail_('ไม่มีเซสชัน', 'NO_SESSION');
    return ok_({
      kind: session.kind,
      id: session.id || '',
      name: session.name,
      role: session.role || '',
      scope: session.scope || '',
      mustChangePassword: !!session.mustChangePassword,
      expiresInMinutes: Math.max(0, Math.round((session.expiresAt - Date.now()) / 60000))
    });
  });
}

function apiLogout(token) {
  return guard_(function () {
    const session = readSession_(token);
    if (session) logAction_(session.name, session.kind, 'ออกจากระบบ', '');
    destroySession_(token);
    return ok_(null, 'ออกจากระบบเรียบร้อย');
  });
}
