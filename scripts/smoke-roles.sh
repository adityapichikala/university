#!/usr/bin/env bash
# Full-app smoke: every seeded role logs in and reaches its own dashboard.
set -uo pipefail
BASE="${BASE:-http://localhost:3000}"
export no_proxy='localhost,127.0.0.1' NO_PROXY='localhost,127.0.0.1'
CURL="curl --noproxy localhost,127.0.0.1"
# curl here is a native Windows binary: it cannot write to a Git-Bash /tmp
# path, and a silent write failure means an empty cookie jar and a 307 on
# every authenticated request. Normalise to a mixed path (C:/...) that both
# the shell and curl understand.
TMP="$(mktemp -d)"
if command -v cygpath >/dev/null 2>&1; then TMP="$(cygpath -m "$TMP")"; fi
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

# regno : dashboard path
ROLES="ADM001:dashboard/admin HOD001:dashboard/hod HOD002:dashboard/hod HR001:dashboard/hr \
PLA001:dashboard/placement REG001:dashboard/registrar FIN001:dashboard/finance \
LIB001:dashboard/librarian WDN001:dashboard/warden PAR001:dashboard/parent \
STU001:dashboard/student TCH001:dashboard/teacher TCH004:dashboard/teacher"

printf '\033[1mRole logins + own dashboard\033[0m\n'
for pair in $ROLES; do
  regno="${pair%%:*}"; path="${pair##*:}"
  jar="$TMP/$regno.jar"; rm -f "$jar"
  code=$($CURL -s -o /dev/null -w '%{http_code}' -c "$jar" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d "{\"regno\":\"$regno\",\"password\":\"password123\"}")
  if [ "$code" != "200" ]; then bad "$regno login → $code"; continue; fi
  dcode=$($CURL -s -o "$TMP/$regno.html" -w '%{http_code}' -b "$jar" "$BASE/$path")
  [ "$dcode" = "200" ] && ok "$regno login 200 · /$path 200" || bad "$regno login 200 but /$path → $dcode"
done

printf '\n\033[1mStudent nav wiring\033[0m\n'
jar="$TMP/STU001.jar"
for link in "/dashboard/student/courses" "/dashboard/student/placements"; do
  code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE$link")
  [ "$code" = "200" ] && ok "STU001 $link → 200" || bad "STU001 $link → $code"
done
if grep -q 'dashboard/student/courses' "$TMP/STU001.html"; then ok "sidebar links My Courses"; else bad "My Courses link missing from sidebar"; fi
if grep -q 'dashboard/student/placements' "$TMP/STU001.html"; then ok "sidebar links Placements"; else bad "Placements link missing from sidebar"; fi
if grep -q '>Soon<' "$TMP/STU001.html"; then bad "student sidebar still has a 'Soon' chip"; else ok "no 'Soon' placeholders left for student"; fi

printf '\n\033[1mStudents stay on the student route\033[0m\n'
# A student hitting another role's dashboard must be bounced.
code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/dashboard/admin")
[ "$code" = "307" ] && ok "STU001 → /dashboard/admin 307" || bad "STU001 → /dashboard/admin $code"

printf '\n\033[1mShared self-service route\033[0m\n'
for r in TCH001 HOD001 HR001 REG001; do
  code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$TMP/$r.jar" "$BASE/dashboard/leave")
  [ "$code" = "200" ] && ok "$r reaches /dashboard/leave" || bad "$r → /dashboard/leave $code"
done

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
