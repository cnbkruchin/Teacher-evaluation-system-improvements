#!/bin/bash
# รันชุดทดสอบทั้งหมด (ต้องมี Node.js 18 ขึ้นไป)
cd "$(dirname "$0")"
set -e
echo "════════ ทดสอบการทำงานของระบบ ════════"
node test-system.js
echo
echo "════════ ทดสอบการย้ายข้อมูลจากระบบเดิม (v2 → v3) ════════"
node test-migration.js
