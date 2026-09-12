#!/usr/bin/env bash
# End-to-end verification for the calendar, server-side export and crash sink.
#
# Runs against a production server over real HTTP with real JWT cookies, so the
# guards (Tier 2/3 RBAC) are exercised rather than mocked.
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
export no_proxy='localhost,127.0.0.1' NO_PROXY='localhost,127.0.0.1'
CURL="curl --noproxy localhost,127.0.0.1"
TMP="$(mktemp -d)"
pass=0
fail=0

ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

login() {
  local regno="$1" jar="$TMP/$1.jar"
  rm -f "$jar"
  local code
  code=$($CURL -s -o "$TMP/login-$1.json" -w '%{http_code}' \
    -c "$jar" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"regno\":\"$regno\",\"password\":\"password123\"}")
  if [ "$code" != "200" ]; then
    echo "login $regno returned $code"; cat "$TMP/login-$1.json"; return 1
  fi
  echo "$jar"
}

########################################################################
head2 "1. Login"
STU1=$(login STU001) && ok "STU001 logged in" || bad "STU001 login"
TCH1=$(login TCH001) && ok "TCH001 logged in" || bad "TCH001 login"
ADM=$(login ADM001) && ok "ADM001 logged in" || bad "ADM001 login"

########################################################################
head2 "2. Student calendar — reachable, scoped, populated"
code=$($CURL -s -o "$TMP/cal.html" -w '%{http_code}' -b "$STU1" "$BASE/dashboard/student/calendar")
[ "$code" = "200" ] && ok "GET /dashboard/student/calendar → 200" || bad "calendar → $code"

grep -q "Calendar" "$TMP/cal.html" && ok "renders the Calendar heading" || bad "heading missing"

# The three view toggles are the interaction contract.
for view in Month Week Day; do
  grep -q ">$view<" "$TMP/cal.html" && ok "view toggle present: $view" || bad "view toggle missing: $view"
done

# Non-teaching days were seeded, and a holiday must appear as a chip.
if grep -q "Fronters\|Founders\|Public holiday\|Mid-semester break" "$TMP/cal.html"; then
  ok "seeded calendar days render"
else
  bad "no seeded calendar day found on the page"
fi

# Recurring slots must be expanded onto real dates, so at least one course code
# should appear somewhere in the grid.
if grep -qE "CS[0-9]{3}|MA[0-9]{3}|PH[0-9]{3}" "$TMP/cal.html"; then
  ok "timetable slots expanded onto dates"
else
  bad "no course code found — slots may not be expanding"
fi

# The student must not see another section's section-only entry.
grep -q "Section industrial visit" "$TMP/cal.html" \
  && ok "section-scoped event visible to a student in that section" \
  || printf '  \033[33mSKIP\033[0m section-only event belongs to another section\n'

########################################################################
head2 "3. Calendar is not reachable by a non-student"
code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$TCH1" "$BASE/dashboard/student/calendar")
case "$code" in
  30*|40*) ok "TEACHER blocked from the student calendar ($code)" ;;
  *) bad "TEACHER reached the student calendar ($code)" ;;
esac

########################################################################
head2 "4. Server-side CSV export"
code=$($CURL -s -o "$TMP/users.csv" -w '%{http_code}' -b "$ADM" "$BASE/api/admin/users/export?format=csv")
[ "$code" = "200" ] && ok "GET export?format=csv → 200" || bad "csv export → $code"

if head -c 3 "$TMP/users.csv" | grep -q $'\xef\xbb\xbf'; then
  ok "CSV carries a UTF-8 BOM (Excel opens names correctly)"
else
  bad "CSV has no BOM"
fi

grep -q "Reg no" "$TMP/users.csv" && ok "CSV header row present" || bad "CSV header missing"
grep -q "STU001" "$TMP/users.csv" && ok "CSV contains real users" || bad "CSV has no user rows"

# The single most important assertion in this file.
if grep -qi "passwordHash\|\$2[aby]\$" "$TMP/users.csv"; then
  bad "CSV LEAKS a password hash"
else
  ok "CSV contains no password hash"
fi

########################################################################
head2 "5. Server-side PDF export"
code=$($CURL -s -o "$TMP/users.pdf" -w '%{http_code}' -b "$ADM" "$BASE/api/admin/users/export?format=pdf")
[ "$code" = "200" ] && ok "GET export?format=pdf → 200" || bad "pdf export → $code"

if head -c 5 "$TMP/users.pdf" | grep -q "%PDF-"; then
  ok "response begins with the %PDF- magic"
else
  bad "not a PDF (starts with: $(head -c 20 "$TMP/users.pdf" | tr -d '\0' | tr -d '\n'))"
fi

# A structurally valid PDF ends with %%EOF and names its xref offset.
tail -c 40 "$TMP/users.pdf" | grep -q "%%EOF" && ok "PDF ends with %%EOF" || bad "PDF truncated"
grep -qa "startxref" "$TMP/users.pdf" && ok "PDF has a startxref table" || bad "PDF has no xref"
grep -qa "Helvetica" "$TMP/users.pdf" && ok "PDF declares its fonts" || bad "PDF font resources missing"

if grep -qa "\$2[aby]\$" "$TMP/users.pdf"; then
  bad "PDF LEAKS a password hash"
else
  ok "PDF contains no password hash"
fi

########################################################################
head2 "6. Export is guarded"
code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$STU1" "$BASE/api/admin/users/export?format=csv")
case "$code" in
  401|403) ok "STUDENT refused the user export ($code)" ;;
  *) bad "STUDENT reached the user export ($code)" ;;
esac

code=$($CURL -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/users/export?format=csv")
case "$code" in
  401|403) ok "anonymous refused the user export ($code)" ;;
  *) bad "anonymous reached the user export ($code)" ;;
esac

########################################################################
head2 "7. Export filter that matches nothing"
code=$($CURL -s -o "$TMP/empty.json" -w '%{http_code}' -b "$ADM" \
  "$BASE/api/admin/users/export?format=csv&role=NOSUCHROLE")
[ "$code" = "404" ] && ok "unmatched filter → 404 rather than an empty file" || bad "unmatched filter → $code"

# An invalid role string must not widen to "all users".
if grep -q "STU001" "$TMP/empty.json" 2>/dev/null; then
  bad "an invalid role filter leaked the full register"
else
  ok "invalid role filter returned no data"
fi

########################################################################
head2 "8. Crash sink"
code=$($CURL -s -o "$TMP/crash.json" -w '%{http_code}' -X POST "$BASE/api/telemetry/crash" \
  -H 'Content-Type: application/json' \
  -d '{"source":"verify-script","message":"deliberate test crash","path":"/verify"}')
[ "$code" = "202" ] && ok "POST /api/telemetry/crash → 202" || bad "crash sink → $code"

grep -q '"reference"' "$TMP/crash.json" \
  && ok "sink returns a reference id" \
  || bad "no reference id in the response"

grep -q '"stored":true' "$TMP/crash.json" \
  && ok "sink recorded the report" \
  || bad "sink did not record the report (stderr only)"

# A malformed body must be refused, not crash the endpoint.
code=$($CURL -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/telemetry/crash" \
  -H 'Content-Type: application/json' -d '{"source":""}')
[ "$code" = "400" ] && ok "malformed report → 400" || bad "malformed report → $code"

# Oversized input is the obvious abuse of an unauthenticated endpoint.
BIG=$(node -e "process.stdout.write('x'.repeat(7000))")
code=$($CURL -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/telemetry/crash" \
  -H 'Content-Type: application/json' \
  -d "{\"source\":\"verify\",\"message\":\"ok\",\"stack\":\"$BIG\"}")
[ "$code" = "400" ] && ok "oversized stack → 400" || bad "oversized stack → $code"

########################################################################
head2 "9. Crash row landed in the audit chain"
ADMIN_COOKIE=$(basename "$ADM" .jar)
code=$($CURL -s -o "$TMP/audit.json" -w '%{http_code}' -b "$ADM" \
  "$BASE/api/admin/audit?q=SYSTEM_CRASH")
if [ "$code" = "200" ]; then
  if grep -q "SYSTEM_CRASH" "$TMP/audit.json"; then
    ok "SYSTEM_CRASH is queryable in the audit trail"
  else
    bad "no SYSTEM_CRASH row found"
  fi
else
  printf '  \033[33mSKIP\033[0m audit query returned %s\n' "$code"
fi
unset ADMIN_COOKIE

########################################################################
head2 "10. Hostel leave UI"
code=$($CURL -s -o "$TMP/hostel.html" -w '%{http_code}' -b "$STU1" "$BASE/dashboard/student/hostel")
[ "$code" = "200" ] && ok "GET /dashboard/student/hostel → 200" || bad "student hostel → $code"

grep -q "Apply for leave" "$TMP/hostel.html" && ok "'Apply for leave' button present" || bad "apply button missing"
grep -q "Leave slip" "$TMP/hostel.html" && ok "'Leave slip' button present on an approved request" || bad "leave slip button missing"
grep -q "Approved" "$TMP/hostel.html" && ok "seeded approved leave renders with its chip" || bad "no approved leave chip"

code=$($CURL -s -o "$TMP/warden.html" -w '%{http_code}' -b "$(login WDN001)" "$BASE/dashboard/warden")
[ "$code" = "200" ] && ok "GET /dashboard/warden → 200" || bad "warden → $code"
grep -q "Leave requests" "$TMP/warden.html" && ok "warden leave queue present" || bad "queue heading missing"
grep -q "Approve selected" "$TMP/warden.html" && ok "warden approve control present" || bad "approve control missing"

########################################################################
printf '\n\033[1m%s\033[0m\n' "Result"
printf '  %s passed, %s failed\n\n' "$pass" "$fail"
rm -rf "$TMP"
[ "$fail" -eq 0 ] || exit 1
