#!/usr/bin/env bash
set -euo pipefail
API=http://localhost:4000/api
PHONE=9$(printf "%07d" $((RANDOM*RANDOM%10000000)))
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(eval(sys.argv[1]),ensure_ascii=False))" "$1"; }

TOKEN=$(curl -s -X POST $API/admin/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@itgel.mn","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
AUTH="Authorization: Bearer $TOKEN"

# Хэмжээтэй, идэвхтэй захиалгын бараа
PID=$(curl -s "$API/products?type=order" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([p for p in d if p['status']=='ACTIVE' and p['sizes']][0]['id'])")

echo "=== 1. Захиалга үүсгэх — мөнгө ОРООГҮЙ байх ёстой ==="
ORD=$(curl -s -X POST $API/orders -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"name\":\"Төлбөр тест\",\"items\":[{\"productId\":\"$PID\",\"qty\":2,\"size\":\"M\",\"color\":\"Хар\"}]}")
echo "$ORD" | j "(d['data']['code'], 'дүн', d['data']['subtotal'], '| үлдэгдэл', d['data']['dueAmount'])"
CODE=$(echo "$ORD" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['code'])")
OID=$(curl -s -H "$AUTH" "$API/admin/orders?q=$CODE" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")

echo
echo "=== 2. Төлбөргүйгээр баталгаажуулах → 409 байх ёстой ==="
curl -s -X PATCH -H "$AUTH" -H 'content-type: application/json' -d '{"status":"CONFIRMED"}' \
  $API/admin/orders/$OID/status | j "(d['error']['code'], d['error']['message'][:60], d['error']['details'])"

echo
echo "=== 3. Дутуу төлбөр бүртгэх → хэсэгчилсэн ==="
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amount":100000,"method":"BANK_TRANSFER","reference":"TXN-001"}' \
  $API/admin/orders/$OID/payments | j "('төлсөн', d['data']['totals']['paidAmount'], '| үлдэгдэл', d['data']['totals']['dueAmount'])"
curl -s -H "$AUTH" $API/admin/orders/$OID/payments | j "(d['data']['paymentState'], d['data']['paymentStateLabel'])"

echo
echo "=== 4. Дутуу байхад баталгаажуулах → дахин 409 ==="
curl -s -X PATCH -H "$AUTH" -H 'content-type: application/json' -d '{"status":"CONFIRMED"}' \
  $API/admin/orders/$OID/status | j "d['error']['details']"

echo
echo "=== 5. Үлдсэнийг төлөх → бүрэн ==="
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amount":298000,"reference":"TXN-002"}' \
  $API/admin/orders/$OID/payments | j "('төлсөн', d['data']['totals']['paidAmount'], '| үлдэгдэл', d['data']['totals']['dueAmount'])"

echo
echo "=== 6. Одоо баталгаажина ==="
curl -s -X PATCH -H "$AUTH" -H 'content-type: application/json' -d '{"status":"CONFIRMED"}' \
  $API/admin/orders/$OID/status | j "(d['data']['code'], d['data']['statusLabel'], d['data']['paymentStateLabel'])"

echo
echo "=== 7. Хэт их буцаах → 409 ==="
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d '{"amount":999999}' \
  $API/admin/orders/$OID/payments/refunds | j "(d['error']['code'], d['error']['details'])"

echo
echo "=== 8. Мөр цуцлах (2 ширхэгийн нэг мөр) → автомат буцаалт ==="
ITEM=$(curl -s -H "$AUTH" $API/admin/orders/$OID | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['items'][0]['id'])")
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' -d '{"reason":"Нийлүүлэгч дээр дууссан"}' \
  $API/admin/orders/$OID/payments/items/$ITEM/cancel | j "('буцаасан', d['data']['refunded'], '| захиалга цуцлагдсан', d['data']['orderCancelled'], '| дүн', d['data']['totals']['subtotal'])"

echo
echo "=== 9. Эцсийн байдал — дэвтэр бүтнээрээ ==="
curl -s -H "$AUTH" $API/admin/orders/$OID/payments | j "[ (p['createdAt'][:10], p['kind'], p['signedAmount'], p['note'] or p['reference'] or '') for p in d['data']['payments'] ]"
curl -s -H "$AUTH" $API/admin/orders/$OID/payments | j "d['data']['totals']"
curl -s -H "$AUTH" $API/admin/orders/$OID | j "(d['data']['statusLabel'], d['data']['paymentStateLabel'], '| ашиг', d['data']['profit'])"

echo
echo "=== БҮГД ДУУСЛАА ==="
