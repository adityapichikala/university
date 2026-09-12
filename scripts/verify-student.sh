#!/usr/bin/env bash
# End-to-end verification of the student Courses + Placements screens.
# Talks to a running production server over real HTTP with real JWT cookies.
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
# This box exports an HTTP proxy; localhost must bypass it or curl gets a 502
# from the proxy instead of talking to the dev server.
export no_proxy='localhost,127.0.0.1' NO_PROXY='localhost,127.0.0.1'
# Quoted: an unquoted * would be glob-expanded into filenames by the shell.
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

# Invoke a Next.js server action over HTTP.
# $1 cookie jar  $2 page path  $3 action id  $4 json body
action() {
  # A server action body is the *arguments array*, not a bare object.
  local body="$4"
  case "$body" in \[*) ;; *) body="[$body]" ;; esac
  $CURL -s -X POST "$BASE$2" \
    -b "$1" \
    -H "Next-Action: $3" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)$1)}catch(e){console.log('PARSE_ERR:'+s.slice(0,200))}})"; }

########################################################################
head2 "1. Login"
STU1=$(login STU001) && ok "STU001 logged in" || bad "STU001 login"
STU2=$(login STU002) && ok "STU002 logged in" || bad "STU002 login"
TCH1=$(login TCH001) && ok "TCH001 logged in" || bad "TCH001 login"

########################################################################
head2 "2. Student Courses — reachable & scoped"
code=$($CURL -s -o "$TMP/courses.html" -w '%{http_code}' -b "$STU1" "$BASE/dashboard/student/courses")
[ "$code" = "200" ] && ok "GET /dashboard/student/courses → 200" || bad "courses → $code"

if grep -q "My Courses" "$TMP/courses.html"; then ok "renders the My Courses heading"; else bad "heading missing"; fi
if grep -qE "Enrolled|Credits" "$TMP/courses.html"; then ok "KPI bento present"; else bad "KPIs missing"; fi
if grep -q "No courses yet" "$TMP/courses.html"; then bad "STU001 shows empty state (seed lost enrolments)"; else ok "course rows rendered (not empty state)"; fi

# Courses is read-only: there must be no mutating affordance.
if grep -qE "Delete|Remove|Enrol now" "$TMP/courses.html"; then bad "courses page exposes a mutation control"; else ok "no mutation controls (read-only)"; fi

########################################################################
head2 "3. Student Placements — reachable"
code=$($CURL -s -o "$TMP/placements.html" -w '%{http_code}' -b "$STU1" "$BASE/dashboard/student/placements")
[ "$code" = "200" ] && ok "GET /dashboard/student/placements → 200" || bad "placements → $code"

if grep -q "Kestrel Robotics" "$TMP/placements.html"; then ok "open drive 'Kestrel Robotics' listed"; else bad "Kestrel Robotics missing"; fi
if grep -q "Meridian Bank" "$TMP/placements.html"; then ok "closed drive 'Meridian Bank' listed"; else bad "Meridian Bank missing"; fi
if grep -q "Apply" "$TMP/placements.html"; then ok "Apply control rendered"; else bad "Apply control missing"; fi

# Tier 3: another student must never appear on this page.
leak=$(grep -oE "STU00[1-9]" "$TMP/placements.html" | sort -u | grep -v STU001 || true)
if [ -z "$leak" ]; then ok "no other student identity on the page (Tier 3)"; else bad "leaked: $leak"; fi

########################################################################
head2 "4. Server action wiring"
# Read the action ids out of the build manifest rather than hardcoding them —
# they change on every rebuild.
read -r A_APPLY A_WITHDRAW <<<"$(node -e "
const m = require('./.next/server/server-reference-manifest.json');
const ids = Object.keys(m.node).filter(k =>
  Object.keys(m.node[k].workers || {}).includes('app/dashboard/student/placements/page'));
console.log(ids.join(' '));
")"
echo "  candidate action ids: $A_APPLY $A_WITHDRAW"

KESTREL=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.placementDrive.findFirst({where:{companyName:'Kestrel Robotics'},select:{id:true}}).then(d=>{console.log(d.id);return p.\$disconnect()})")
MERIDIAN=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.placementDrive.findFirst({where:{companyName:'Meridian Bank'},select:{id:true}}).then(d=>{console.log(d.id);return p.\$disconnect()})")
echo "  kestrel=$KESTREL meridian=$MERIDIAN"

# Tell the two ids apart without touching data: send an id that exists in
# neither table. Whichever handler answers names itself in its error.
# (Probing with a real drive would mutate state and break on a re-run.)
PROBE='{"driveId":"__probe__","applicationId":"__probe__"}'
probe=$(action "$STU1" /dashboard/student/placements "$A_APPLY" "$PROBE")
echo "  probe → $(echo "$probe" | grep -oE '\{"ok":[^}]*' | head -1)"
if echo "$probe" | grep -q 'Drive not found'; then
  APPLY=$A_APPLY; WITHDRAW=$A_WITHDRAW; ok "action ids resolved (apply=${A_APPLY:0:10}…)"
elif echo "$probe" | grep -q 'Application not found'; then
  APPLY=$A_WITHDRAW; WITHDRAW=$A_APPLY; ok "action ids resolved (apply=${A_WITHDRAW:0:10}…)"
else
  bad "could not resolve action ids"; APPLY=$A_APPLY; WITHDRAW=$A_WITHDRAW
fi

########################################################################
head2 "5. Apply / withdraw lifecycle"
# reset: make sure STU001 has no Kestrel application before the happy path
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.findUnique({where:{regno:'STU001'},select:{id:true}}).then(async u=>{await p.placementApplication.deleteMany({where:{studentId:u.id,driveId:'$KESTREL'}});await p.\$disconnect()})"

r=$(action "$STU1" /dashboard/student/placements "$APPLY" "{\"driveId\":\"$KESTREL\"}")
echo "$r" | grep -q '"ok":true' && ok "apply to open drive accepted" || bad "apply rejected: $(echo "$r" | grep -oE '\{"ok":[^}]*' | head -1)"

APPID=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.findUnique({where:{regno:'STU001'},select:{id:true}}).then(async u=>{const a=await p.placementApplication.findFirst({where:{studentId:u.id,driveId:'$KESTREL'},select:{id:true,status:true}});console.log(a?a.id+' '+a.status:'NONE');await p.\$disconnect()})")
[ "${APPID%% *}" != "NONE" ] && ok "application row created ($APPID)" || bad "no application row"
[ "${APPID##* }" = "APPLIED" ] && ok "initial status APPLIED" || bad "status is ${APPID##* }"

# duplicate
r=$(action "$STU1" /dashboard/student/placements "$APPLY" "{\"driveId\":\"$KESTREL\"}")
echo "$r" | grep -q 'already applied' && ok "duplicate apply refused" || bad "duplicate apply: $r"

# closed drive
r=$(action "$STU1" /dashboard/student/placements "$APPLY" "{\"driveId\":\"$MERIDIAN\"}")
echo "$r" | grep -q 'closed' && ok "apply to closed drive refused" || bad "closed drive: $r"

# cross-tenant / unknown id
r=$(action "$STU1" /dashboard/student/placements "$APPLY" "{\"driveId\":\"drv_does_not_exist\"}")
echo "$r" | grep -q 'not found' && ok "unknown drive id refused" || bad "unknown drive: $r"

# withdraw someone else's application → must not be found
r=$(action "$STU2" /dashboard/student/placements "$WITHDRAW" "{\"applicationId\":\"${APPID%% *}\"}")
echo "$r" | grep -q 'not found' && ok "STU002 cannot withdraw STU001's application" || bad "cross-student withdraw: $r"

# withdraw own
r=$(action "$STU1" /dashboard/student/placements "$WITHDRAW" "{\"applicationId\":\"${APPID%% *}\"}")
echo "$r" | grep -q '"ok":true' && ok "withdraw own application accepted" || bad "withdraw: $r"

STATUS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.placementApplication.findUnique({where:{id:'${APPID%% *}'},select:{status:true}}).then(a=>{console.log(a.status);return p.\$disconnect()})")
[ "$STATUS" = "WITHDRAWN" ] && ok "status now WITHDRAWN" || bad "status is $STATUS"

# double withdraw
r=$(action "$STU1" /dashboard/student/placements "$WITHDRAW" "{\"applicationId\":\"${APPID%% *}\"}")
echo "$r" | grep -q 'Already withdrawn' && ok "double withdraw refused" || bad "double withdraw: $r"

########################################################################
head2 "6. Guard rails"
# teacher has no placement.apply → redirected off the student route
code=$($CURL -s -o /dev/null -w '%{http_code}' -b "$TCH1" "$BASE/dashboard/student/placements")
[ "$code" = "307" ] && ok "TCH001 → /dashboard/student/placements 307" || bad "TCH001 got $code (expected 307)"

code=$($CURL -s -o /dev/null -w '%{http_code}' "$BASE/dashboard/student/placements")
[ "$code" = "307" ] && ok "anonymous → 307" || bad "anonymous got $code"

########################################################################
head2 "7. Audit chain still valid"
# Use the app's own verifier — it walks (timestamp, id), which is the order
# audit() actually links in. Re-deriving by createdAt instead reports false
# positives around the legacy pre-chain rows.
npx tsx scripts/audit-chain-report.ts > "$TMP/audit.txt" 2>&1
cat "$TMP/audit.txt" | sed 's/^/  /'
if grep -q '"valid": true' "$TMP/audit.txt"; then ok "hash chain valid (app verifier)"; else bad "audit chain broken"; fi
if grep -q 'PLACEMENT_APPLY\|PLACEMENT_WITHDRAW' "$TMP/audit.txt"; then :; fi

# The new mutations must have been audited.
RECENT=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.agentActionLog.findMany({orderBy:[{timestamp:'desc'},{id:'desc'}],take:8,select:{actionType:true}}).then(r=>{console.log(r.map(x=>x.actionType).join(','));return p.\$disconnect()})")
echo "  recent: $RECENT"
echo "$RECENT" | grep -q 'PLACEMENT_APPLY' && ok "PLACEMENT_APPLY audited" || bad "PLACEMENT_APPLY not audited"
echo "$RECENT" | grep -q 'PLACEMENT_WITHDRAW' && ok "PLACEMENT_WITHDRAW audited" || bad "PLACEMENT_WITHDRAW not audited"

########################################################################
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
