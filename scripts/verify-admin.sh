#!/usr/bin/env bash
# End-to-end verification of Admin › Departments and Admin › Admissions.
# Real HTTP, real JWT cookies, real server actions.
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
export no_proxy='localhost,127.0.0.1' NO_PROXY='localhost,127.0.0.1'
CURL="curl --noproxy localhost,127.0.0.1"   # quoted: unquoted * is glob-expanded
# curl here is a native Windows binary: it cannot write to a Git-Bash /tmp
# path, and a silent write failure means an empty cookie jar and a 307 on
# every authenticated request. Normalise to a mixed path (C:/...) that both
# the shell and curl understand.
TMP="$(mktemp -d)"
if command -v cygpath >/dev/null 2>&1; then TMP="$(cygpath -m "$TMP")"; fi
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

login() {
  local regno="$1" pw="${2:-password123}" jar="$TMP/$1.jar"
  rm -f "$jar"
  local code
  code=$($CURL -s -o /dev/null -w '%{http_code}' -c "$jar" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d "{\"regno\":\"$regno\",\"password\":\"$pw\"}")
  [ "$code" = "200" ] || { echo "login $regno → $code"; return 1; }
  echo "$jar"
}

# Server action over HTTP. $1 jar  $2 path  $3 action id  $4 json body
action() {
  local body="$4" raw
  case "$body" in \[*) ;; *) body="[$body]" ;; esac   # args array, not bare object
  raw=$($CURL -s -X POST "$BASE$2" -b "$1" \
    -H "Next-Action: $3" -H 'Content-Type: application/json' -d "$body")
  # Return only the action's JSON result. On a redirect or an error Next
  # answers with a full HTML document, and dumping that into a failure line
  # makes the run unreadable.
  echo "$raw" | grep -oE '\{"ok":(true|false)[^}]*\}+' | head -1
}

# Action ids for a page, read from the build manifest (they change per build).
ids_for() {
  node -e "
const m=require('./.next/server/server-reference-manifest.json');
console.log(Object.keys(m.node).filter(k=>Object.keys(m.node[k].workers||{}).includes('$1')).join(' '));
"
}

db() { node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const f=async(prisma)=>{${1}};const out=await f(p);if(out!==undefined)console.log(out);await p.\$disconnect()})().catch(e=>{console.error('DBERR',e.message);process.exit(1)})"; }

########################################################################
head2 "0. Reset the rows this suite touches"
# Order matters: a previous run (or a mis-resolved rename) can leave a *seeded*
# department carrying a test name, so restore the seeded rows first and only
# then delete the strays by name — deleting by name first would remove dep_cse
# itself and the following update would fail.
db "
  await p.department.update({
    where: { id: 'dep_cse' },
    data: { name: 'Computer Science & Engineering', hodUserId: null },
  });
  await p.department.update({ where: { id: 'dep_ecm' }, data: { hodUserId: null } });
  await p.department.deleteMany({
    where: { name: { in: ['Mechanical Engineering', 'Mechanical & Automation'] } },
  });
  // Deactivate, do not delete. AgentActionLog.approvedBy is Restrict, and even
  // without that, deleting a user nulls the actor on their audit rows and
  // invalidates the chain. Tombstone the email so the next enrolment can reuse
  // the applicant's real address (User.email is @unique).
  const stale = await p.user.findMany({
    where: { email: 'ishaan.verma@applicant.apex.edu' },
    select: { id: true },
  });
  for (const u of stale) {
    await p.user.update({
      where: { id: u.id },
      data: { status: 'INACTIVE', email: 'retired+' + u.id + '@apex.edu' },
    });
  }
  await p.admission.updateMany({
    where: { applicantName: 'Ishaan Verma' },
    data: { status: 'PENDING', convertedToUserId: null, convertedByUserId: null },
  });
  await p.admission.updateMany({
    where: { applicantName: 'Sneha Iyer' },
    data: { status: 'APPROVED', convertedToUserId: null, convertedByUserId: null },
  });
  await p.admission.updateMany({
    where: { applicantName: 'Arjun Rao' },
    data: { status: 'PENDING', convertedToUserId: null, convertedByUserId: null },
  });
  await p.admission.updateMany({
    where: { applicantName: 'Rohan Gupta' },
    data: { status: 'REJECTED', convertedToUserId: null, convertedByUserId: null },
  });
" >/dev/null && ok "seed rows reset" || bad "reset failed"

########################################################################
head2 "1. Login"
ADM=$(login ADM001) && ok "ADM001 logged in" || bad "ADM001 login"
TCH=$(login TCH001) && ok "TCH001 logged in" || bad "TCH001 login"
HOD=$(login HOD001) && ok "HOD001 logged in" || bad "HOD001 login"

########################################################################
head2 "2. Pages reachable for ADMIN"
for path in departments admissions; do
  code=$($CURL -s -o "$TMP/$path.html" -w '%{http_code}' -b "$ADM" "$BASE/dashboard/admin/$path")
  [ "$code" = "200" ] && ok "GET /dashboard/admin/$path → 200" || bad "/$path → $code"
done
grep -q "Departments" "$TMP/departments.html" && ok "departments renders" || bad "departments body missing"
grep -q "Admissions" "$TMP/admissions.html" && ok "admissions renders" || bad "admissions body missing"
grep -q "Ishaan Verma" "$TMP/admissions.html" && ok "seeded applicant listed" || bad "applicant missing"
grep -q "Computer Science" "$TMP/departments.html" && ok "seeded department listed" || bad "department missing"

########################################################################
head2 "3. Guard rails (Tier 2)"
# HOD holds department.view but NOT department.manage — must still be bounced.
for who in TCH001 HOD001; do
  jar="$TMP/$who.jar"
  for path in departments admissions; do
    code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/dashboard/admin/$path")
    [ "$code" = "307" ] && ok "$who → /$path 307" || bad "$who → /$path $code"
  done
done
code=$($CURL -s -o /dev/null -w '%{http_code}' "$BASE/dashboard/admin/departments")
[ "$code" = "307" ] && ok "anonymous → departments 307" || bad "anonymous → $code"

########################################################################
head2 "4. Resolve action ids"
D_IDS=$(ids_for 'app/dashboard/admin/departments/page')
A_IDS=$(ids_for 'app/dashboard/admin/admissions/page')
echo "  departments: $D_IDS"
echo "  admissions : $A_IDS"

DEPT_PATH=/dashboard/admin/departments
ADM_PATH=/dashboard/admin/admissions
CSE=$(db "const d=await p.department.findFirst({where:{name:{contains:'Computer Science'}}});return d.id")
ECM=$(db "const d=await p.department.findFirst({where:{name:{contains:'Electronics'}}});return d.id")
TCHID=$(db "const u=await p.user.findUnique({where:{regno:'TCH001'}});return u.id")
STUID=$(db "const u=await p.user.findUnique({where:{regno:'STU001'}});return u.id")
echo "  cse=$CSE ecm=$ECM"

# ── departments ──────────────────────────────────────────────────────────────
# create: no `name` → "Name is too short"; the other two fail on the bogus id.
# One probe, three distinct answers, no side effects:
#   {id: <real dept>, name: <that dept's current name>, hodUserId: bogus}
#   renameDepartment → name unchanged, early-returns ok (writes nothing)
#   createDepartment → ignores id, name collides → "already exists"
#   assignHod        → rejects the bogus person → "Only teaching staff"
# Probing with an empty payload is NOT safe: rename and create both answer
# "Name is too short", and assignHod with an undefined id would match the
# first department and clear its HOD.
D_CREATE=""; D_RENAME=""; D_HOD=""
CSE_NAME=$(db "const d=await p.department.findUnique({where:{id:'$CSE'}});return d.name")
for id in $D_IDS; do
  r=$(action "$ADM" "$DEPT_PATH" "$id" "{\"id\":\"$CSE\",\"name\":\"$CSE_NAME\",\"hodUserId\":\"__probe__\"}")
  if   echo "$r" | grep -q 'Only teaching staff'; then D_HOD=$id
  elif echo "$r" | grep -q '"ok":true';          then D_RENAME=$id
  elif echo "$r" | grep -q 'already exists';     then D_CREATE=$id
  fi
done
[ -n "$D_CREATE" ] && ok "createDepartment id (${D_CREATE:0:10}…)" || bad "createDepartment not resolved"
[ -n "$D_RENAME" ] && ok "renameDepartment id (${D_RENAME:0:10}…)" || bad "renameDepartment not resolved"
[ -n "$D_HOD" ]    && ok "assignHod id (${D_HOD:0:10}…)"         || bad "assignHod not resolved"

# ── admissions ───────────────────────────────────────────────────────────────
A_DECIDE=""; A_CONVERT=""
ISH=$(db "const a=await p.admission.findFirst({where:{applicantName:'Ishaan Verma'}});return a.id")
for id in $A_IDS; do
  r=$(action "$ADM" "$ADM_PATH" "$id" "{\"id\":\"$ISH\",\"decision\":\"BOGUS\"}")
  if echo "$r" | grep -q 'Unknown decision'; then A_DECIDE=$id; else A_CONVERT=$id; fi
done
[ -n "$A_DECIDE" ]  && ok "decideAdmission id (${A_DECIDE:0:10}…)"  || bad "decideAdmission not resolved"
[ -n "$A_CONVERT" ] && ok "convertAdmission id (${A_CONVERT:0:10}…)" || bad "convertAdmission not resolved"

########################################################################
head2 "5. Departments lifecycle"
r=$(action "$ADM" "$DEPT_PATH" "$D_CREATE" '{"name":"Mechanical Engineering"}')
echo "$r" | grep -q '"ok":true' && ok "create department" || bad "create: $r"

r=$(action "$ADM" "$DEPT_PATH" "$D_CREATE" '{"name":"Mechanical Engineering"}')
echo "$r" | grep -q 'already exists' && ok "duplicate name refused" || bad "duplicate: $r"

r=$(action "$ADM" "$DEPT_PATH" "$D_CREATE" '{"name":"A"}')
echo "$r" | grep -q 'too short' && ok "too-short name refused" || bad "short name: $r"

NEWID=$(db "const d=await p.department.findFirst({where:{name:'Mechanical Engineering'}});return d.id")
r=$(action "$ADM" "$DEPT_PATH" "$D_RENAME" "{\"id\":\"$NEWID\",\"name\":\"Mechanical & Automation\"}")
echo "$r" | grep -q '"ok":true' && ok "rename department" || bad "rename: $r"
NAME_NOW=$(db "const d=await p.department.findUnique({where:{id:'$NEWID'}});return d.name")
[ "$NAME_NOW" = "Mechanical & Automation" ] && ok "rename persisted" || bad "name is $NAME_NOW"

r=$(action "$ADM" "$DEPT_PATH" "$D_HOD" "{\"id\":\"$CSE\",\"hodUserId\":\"$TCHID\"}")
echo "$r" | grep -q '"ok":true' && ok "appoint HOD (TCH001 → CSE)" || bad "appoint: $r"

r=$(action "$ADM" "$DEPT_PATH" "$D_HOD" "{\"id\":\"$ECM\",\"hodUserId\":\"$TCHID\"}")
echo "$r" | grep -q 'already heads' && ok "HOD cannot head two departments" || bad "double-HOD: $r"

r=$(action "$ADM" "$DEPT_PATH" "$D_HOD" "{\"id\":\"$ECM\",\"hodUserId\":\"$STUID\"}")
echo "$r" | grep -q 'Only teaching staff' && ok "student cannot be HOD" || bad "student HOD: $r"

r=$(action "$ADM" "$DEPT_PATH" "$D_HOD" '{"id":"nope","hodUserId":"'"$TCHID"'"}')
echo "$r" | grep -q 'Department not found' && ok "unknown department refused" || bad "unknown dept: $r"

r=$(action "$ADM" "$DEPT_PATH" "$D_HOD" "{\"id\":\"$CSE\",\"hodUserId\":null}")
echo "$r" | grep -q '"ok":true' && ok "clear HOD" || bad "clear: $r"

########################################################################
head2 "6. Admissions lifecycle"
SNEHA=$(db "const a=await p.admission.findFirst({where:{applicantName:'Sneha Iyer'}});return a.id")

# convert before approving → refused
r=$(action "$ADM" "$ADM_PATH" "$A_CONVERT" "{\"id\":\"$ISH\"}")
echo "$r" | grep -q 'Approve the application' && ok "cannot enrol a PENDING applicant" || bad "early convert: $r"

# approve
r=$(action "$ADM" "$ADM_PATH" "$A_DECIDE" "{\"id\":\"$ISH\",\"decision\":\"APPROVED\"}")
echo "$r" | grep -q '"ok":true' && ok "approve application" || bad "approve: $r"

# double approve
r=$(action "$ADM" "$ADM_PATH" "$A_DECIDE" "{\"id\":\"$ISH\",\"decision\":\"APPROVED\"}")
echo "$r" | grep -q 'Already approved' && ok "duplicate approval refused" || bad "double approve: $r"

# convert → creates a student account
r=$(action "$ADM" "$ADM_PATH" "$A_CONVERT" "{\"id\":\"$ISH\"}")
echo "$r" | grep -q '"ok":true' && ok "enrol applicant" || bad "convert: $r"

NEWREG=$(db "const u=await p.user.findUnique({where:{email:'ishaan.verma@applicant.apex.edu'}});return u?u.regno:'NONE'")
[ "$NEWREG" != "NONE" ] && ok "student account created ($NEWREG)" || bad "no student account"

STATUS=$(db "const a=await p.admission.findUnique({where:{id:'$ISH'}});return a.status")
[ "$STATUS" = "CONVERTED" ] && ok "status CONVERTED" || bad "status is $STATUS"

# the new account can log in with its temporary password
code=$(login "$NEWREG" "Welcome@$NEWREG" >/dev/null 2>&1 && echo 200 || echo no)
[ "$code" = "200" ] && ok "$NEWREG logs in with Welcome@$NEWREG" || bad "new student cannot log in"

# converted is terminal
r=$(action "$ADM" "$ADM_PATH" "$A_DECIDE" "{\"id\":\"$ISH\",\"decision\":\"REJECTED\"}")
echo "$r" | grep -q 'closed' && ok "converted application is terminal" || bad "terminal: $r"
r=$(action "$ADM" "$ADM_PATH" "$A_CONVERT" "{\"id\":\"$ISH\"}")
echo "$r" | grep -q 'Already converted' && ok "double enrolment refused" || bad "double convert: $r"

# reject path
ARJUN=$(db "const a=await p.admission.findFirst({where:{applicantName:'Arjun Rao'}});return a.id")
r=$(action "$ADM" "$ADM_PATH" "$A_DECIDE" "{\"id\":\"$ARJUN\",\"decision\":\"REJECTED\"}")
echo "$r" | grep -q '"ok":true' && ok "reject application" || bad "reject: $r"
r=$(action "$ADM" "$ADM_PATH" "$A_DECIDE" "{\"id\":\"$ARJUN\",\"decision\":\"APPROVED\"}")
echo "$r" | grep -q 'was rejected' && ok "rejected application cannot be approved" || bad "reopen: $r"

# unknown id
r=$(action "$ADM" "$ADM_PATH" "$A_DECIDE" '{"id":"nope","decision":"APPROVED"}')
echo "$r" | grep -q 'Application not found' && ok "unknown application refused" || bad "unknown: $r"

########################################################################
head2 "7. Audit chain"
npx tsx scripts/audit-chain-report.ts > "$TMP/audit.txt" 2>&1
sed 's/^/  /' "$TMP/audit.txt"
grep -q '"valid": true' "$TMP/audit.txt" && ok "hash chain valid" || bad "audit chain broken"
RECENT=$(db "const r=await p.agentActionLog.findMany({orderBy:[{timestamp:'desc'},{id:'desc'}],take:12,select:{actionType:true}});return r.map(x=>x.actionType).join(',')")
echo "  recent: $RECENT"
for t in DEPARTMENT_CREATE DEPARTMENT_RENAME DEPARTMENT_HOD_ASSIGN ADMISSION_APPROVED ADMISSION_CONVERT; do
  echo "$RECENT" | grep -q "$t" && ok "$t audited" || bad "$t not audited"
done

########################################################################
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
