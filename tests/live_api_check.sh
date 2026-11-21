#!/usr/bin/env bash
# Live API checks for roles and the action lifecycle. Usage: bash tests/live_api_check.sh [base-url]
# Writes test events to the demo database; clear them afterwards with:
#   npx wrangler d1 execute sutra-coach --remote --command "DELETE FROM action_events; DELETE FROM actions;"
B=${1:-https://sutra-store-coach.pages.dev}; J='content-type: application/json'; T=$(mktemp -d)
curl -s -c $T/am -X POST $B/api/login -H "$J" -d '{"role":"am","id":"AM-03"}' >/dev/null
curl -s -c $T/sp -X POST $B/api/login -H "$J" -d '{"role":"sp","id":"SP1083"}' >/dev/null
curl -s -c $T/sp2 -X POST $B/api/login -H "$J" -d '{"role":"sp","id":"SP1090"}' >/dev/null
ID=$(curl -s -b $T/am "$B/api/brief?date=2026-10-31" | python -c "import sys,json;d=json.load(sys.stdin);print([i['id'] for i in d['digest']['AM-03']['issues'] if i.get('salesperson_id')=='SP1083'][0])")
fail=0
t(){ code=$(curl -s -o $T/o -w '%{http_code}' -b $T/$2 -X POST $B/api/actions/transition -H "$J" -d "$3"); [ "$code" = "$4" ] && echo "PASS $1 ($code)" || { echo "FAIL $1 expected $4 got $code: $(cat $T/o)"; fail=1; }; }
g(){ code=$(curl -s -o /dev/null -w '%{http_code}' ${2:+-b $T/$2} "$B$3"); [ "$code" = "$4" ] && echo "PASS $1 ($code)" || { echo "FAIL $1 expected $4 got $code"; fail=1; }; }
g "signed-out manager data" "" /api/stores 401
g "salesperson manager data" sp /api/brief 403
g "manager own-view endpoint" am /api/sp/me 401
t "other salesperson accepts" sp2 "{\"issue_id\":\"$ID\",\"to\":\"accepted\",\"version\":0}" 403
t "owner accepts" sp "{\"issue_id\":\"$ID\",\"to\":\"accepted\",\"version\":0}" 200
t "stale version" sp "{\"issue_id\":\"$ID\",\"to\":\"accepted\",\"version\":0}" 409
t "salesperson reviews" sp "{\"issue_id\":\"$ID\",\"to\":\"reviewed\",\"version\":1}" 403
t "invalid blocker reason" sp "{\"issue_id\":\"$ID\",\"to\":\"blocked\",\"reason\":\"lazy\",\"version\":1}" 400
t "owner attempts" sp "{\"issue_id\":\"$ID\",\"to\":\"attempted\",\"version\":1}" 200
t "manager reviews" am "{\"issue_id\":\"$ID\",\"to\":\"reviewed\",\"version\":2}" 200
t "illegal transition" am "{\"issue_id\":\"$ID\",\"to\":\"dismissed\",\"reason\":\"x\",\"version\":3}" 409
exit $fail
