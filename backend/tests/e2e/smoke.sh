#!/usr/bin/env bash
set -euo pipefail
API=http://localhost:4000/api
PHONE=9$(printf "%07d" $((RANDOM*RANDOM%10000000)))
echo "тест дугаар: $PHONE"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(eval(sys.argv[1]),ensure_ascii=False))" "$1"; }

echo "=== 1. categories (public) ==="
curl -s $API/categories | j "[ (c['name'],c['productCount']) for c in d['data'] ]"

echo "=== 2. products?type=ready ==="
curl -s "$API/products?type=ready" | j "[ (p['name'],p['price'],p['type'],p['arriveFrom'][:10]) for p in d['data'] ]"

echo "=== 3. products?type=order — costPrice алга байх ёстой ==="
curl -s "$API/products?type=order&pageSize=2" | j "[ ('costPrice' in p, p['name'], p['closeAt'][:10], p['arriveFrom'][:10], p['arriveTo'][:10]) for p in d['data'] ]"

PID=$(curl -s "$API/products?type=order" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([p for p in d if p['status']=='ACTIVE' and p['sizes']][0]['id'])")
echo "=== 4. product detail $PID ==="
curl -s "$API/products/$PID" | j "(d['data']['name'],d['data']['sizes'],d['data']['colors'],len(d['data']['sizeChart']))"

echo "=== 5. auth otp + verify ==="
CODE=$(curl -s -X POST $API/auth/otp -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['devCode'])")
echo "devCode=$CODE"
echo "-- 60 сек дотор дахин илгээхийг хориглох:"
curl -s -X POST $API/auth/otp -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" | j "d['error']['message']"
echo "-- буруу код:"
curl -s -X POST $API/auth/verify -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"0000\"}" | j "d['error']['message']"
echo "-- зөв код:"
curl -s -X POST $API/auth/verify -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\",\"name\":\"Тест Хэрэглэгч\"}" | j "(d['data']['customer'],len(d['data']['token'])>50)"

echo "=== 6a. хаагдсан бараа захиалах → 409 ==="
CLOSEDID=$(curl -s "$API/products?type=order" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([p for p in d if p['status']=='CLOSED'][0]['id'])")
curl -s -X POST $API/orders -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"items\":[{\"productId\":\"$CLOSEDID\",\"qty\":1}]}" | j "d['error']['message']"

echo "=== 6b. захиалга үүсгэх (хэмжээ сонгоогүй → алдаа) ==="
curl -s -X POST $API/orders -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"items\":[{\"productId\":\"$PID\",\"qty\":1}]}" | j "(d['error']['message'],d['error'].get('details'))"

echo "=== 7. захиалга үүсгэх (зөв) ==="
ORDER=$(curl -s -X POST $API/orders -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"name\":\"Тест\",\"items\":[{\"productId\":\"$PID\",\"qty\":2,\"size\":\"M\",\"color\":\"Хар\"}]}")
echo "$ORDER" | j "d['data']"
OCODE=$(echo "$ORDER" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['code'])")

echo "=== 8. хяналт /orders/$OCODE ==="
curl -s $API/orders/$OCODE | j "(d['data']['statusLabel'],d['data']['customer'],[ (s['key'],s['status'],(s['at'] or s['estimatedAt'] or '')[:10]) for s in d['data']['timeline'] ])"

echo "=== 9. delivery slots ==="
curl -s "$API/delivery/slots?days=3" | j "(d['data']['slots'],d['data']['districts'][:3])"

echo "=== 10. store ==="
curl -s $API/store | j "(d['data']['storeName'],d['data']['workHours'],len(d['data']['deliveryFees']))"

echo "=== 11. админгүйгээр админ API — 401 ==="
curl -s $API/admin/orders | j "d['error']"

echo "=== 12. админ нэвтрэх ==="
TOKEN=$(curl -s -X POST $API/admin/auth/login -H 'content-type: application/json' -d '{"email":"admin@itgel.mn","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
AUTH="Authorization: Bearer $TOKEN"
echo "token ok: ${#TOKEN} тэмдэгт"

echo "=== 13. админ бараа — нэр, зарах үнэ ==="
curl -s -H "$AUTH" "$API/admin/products?pageSize=3" | j "[ (p['name'], p.get('currentRound') and p['currentRound'].get('sellPrice')) for p in d['data'] ]"

echo "=== 14. бараатай ангилал устгах → 409 ==="
CID=$(curl -s -H "$AUTH" $API/admin/categories | python3 -c "import sys,json;print([c for c in json.load(sys.stdin)['data'] if c['productCount']>0][0]['id'])")
curl -s -X DELETE -H "$AUTH" $API/admin/categories/$CID | j "d['error']"

echo "=== 15. буруу төлөв шилжилт → 409 ==="
OID=$(curl -s -H "$AUTH" "$API/admin/orders?status=NEW" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
curl -s -X PATCH -H "$AUTH" -H 'content-type: application/json' -d '{"status":"ARRIVED"}' $API/admin/orders/$OID/status | j "d['error']['message']"

echo "=== 15b. төлбөргүйгээр баталгаажуулах → 409 ==="
curl -s -X PATCH -H "$AUTH" -H 'content-type: application/json' -d '{"status":"CONFIRMED"}' $API/admin/orders/$OID/status | j "d['error']['message'][:50]"

echo "=== 15c. төлбөр бүртгэх ==="
DUE=$(curl -s -H "$AUTH" $API/admin/orders/$OID | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dueAmount'])")
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d "{\"amount\":$DUE,\"reference\":\"SMOKE\"}" $API/admin/orders/$OID/payments | j "(d['data']['totals']['paidAmount'],d['data']['totals']['dueAmount'])"

echo "=== 16. зөв шилжилт NEW → CONFIRMED ==="
curl -s -X PATCH -H "$AUTH" -H 'content-type: application/json' -d '{"status":"CONFIRMED"}' $API/admin/orders/$OID/status | j "(d['data']['code'],d['data']['statusLabel'],[ (s['key'],s['status']) for s in d['data']['timeline'] ][:3])"

echo "=== 17. багц үүсгэх ба ахиулах ==="
BID=$(curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d '{"name":"Тест багц","weightKg":50}' $API/admin/batches | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
for i in 1 2 3 4; do
  curl -s -X POST -H "$AUTH" $API/admin/batches/$BID/advance | j "(d['data']['stage'],d['data']['stageLabel'],d['data']['ordersMoved'])"
done

echo "=== 18. багцын дотор захиалга ARRIVED болсон эсэх ==="
curl -s -H "$AUTH" $API/admin/batches/$BID | j "[ (o['code'],o['status']) for o in d['data']['orders'] ]"

echo "=== 19. handover lookup + complete ==="
HCODE=$(curl -s -H "$AUTH" $API/admin/batches/$BID | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['orders'][0]['code'])")
curl -s -H "$AUTH" "$API/admin/handover/lookup?code=$HCODE" | j "(d['data']['code'],d['data']['canHandOver'],d['data']['dueAmount'],d['data']['blockReason'])"
HID=$(curl -s -H "$AUTH" "$API/admin/handover/lookup?code=$HCODE" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d '{}' $API/admin/handover/$HID/complete | j "(d['data']['code'],d['data']['statusLabel'],d['data']['paidAmount'],d['data']['dueAmount'])"

echo "=== 20. fulfilment сонголт (ARRIVED захиалга) ==="
ACODE=$(curl -s -H "$AUTH" "$API/admin/orders?status=ARRIVED" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
free=[o['code'] for o in d if o['fulfilment'] is None]
print(free[0] if free else '')")
if [ -z "$ACODE" ]; then
  echo "  (авах арга сонгоогүй ARRIVED захиалга алга — алгаслаа)"
else
  curl -s -X POST -H 'content-type: application/json' -d "{\"type\":\"DELIVERY\",\"district\":\"Налайх\",\"khoroo\":\"3-р хороо\",\"address\":\"Тест гудамж 1\",\"day\":\"$(date -v+2d +%Y-%m-%d)\"}" $API/orders/$ACODE/fulfilment | j "d['data']"
fi

echo "=== 21. тайлан — борлуулалт, буцаалт ==="
curl -s -H "$AUTH" "$API/admin/reports/revenue?period=6m" | j "([ (s['month'],s['sold'],s['returned'],s['orders']) for s in d['data']['series'] ], d['data']['totals'])"

echo "=== 22. тайлан — бараагаар зарагдсан / буцаасан ==="
curl -s -H "$AUTH" "$API/admin/reports/products?limit=4" | j "[ (r['name'],r['soldQty'],r['soldAmount'],r['returnedQty'],r['returnedAmount']) for r in d['data'] ]"

echo "=== 23. хэрэглэгчид ==="
curl -s -H "$AUTH" "$API/admin/customers?pageSize=3" | j "[ (c['name'],c['phone'],c['orderCount'],c['totalSpent']) for c in d['data'] ]"

echo "=== 24. хүргэлтүүд ==="
curl -s -H "$AUTH" "$API/admin/deliveries" | j "[ (x['district'],x['status'],x['fee'],x['order']['code']) for x in d['data'] ]"

echo "=== 26. presigned upload URL ==="
APID=$(curl -s -H "$AUTH" "$API/admin/products?pageSize=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d '{"contentType":"image/jpeg"}' $API/admin/products/$APID/images | j "(d['data']['method'],d['data']['key'],d['data']['expiresInSec'])"
echo "-- буруу төрөл:"
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d '{"contentType":"application/pdf"}' $API/admin/products/$APID/images | j "d['error']['message']"

echo "=== 27. audit log ==="
curl -s -H "$AUTH" "$API/admin/settings/audit?limit=5" | j "[ (a['actor'],a['action'],a['entity']) for a in d['data'] ]"

echo "=== 28. валидаци — буруу утас ==="
curl -s -X POST $API/auth/otp -H 'content-type: application/json' -d '{"phone":"123"}' | j "(d['error']['code'],d['error']['details'])"

echo "=== БҮГД АМЖИЛТТАЙ ==="
