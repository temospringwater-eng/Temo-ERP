# Water Club: pre-salary preparation — 5 October 2026

Owner decision: every company controls its own refill price and bottle security.
No universal PKR 300 / PKR 1,200 defaults. No paid deployment, production merge
or public launch before the owner's final approval.

## Prepared in this change

- Company Admin can edit existing ERP selling prices in Water Club administration.
  Customers' next orders use the authoritative ERP price. Existing order lines
  and totals remain unchanged. Stock remains managed through ERP Inventory.
- Each company can save its bottle security amount, refund terms, delivery areas
  and delivery charges as preparation records. Unset security is null, not zero.
  These records do not create deposit transactions or add charges to checkout.
- Existing bottle balances/deposits are not recalculated when a rate changes.
- A Twilio Verify SMS adapter is prepared, disabled unless configured. It is not
  wired to public registration. Existing ERP-provisioned accounts remain usable.
- The acceptance procedure below is ready. Online results remain NOT RUN.

## Company setup procedure

1. Sign in as Company Admin; open `/water-club-admin.html`.
2. Review actual ERP products. Choose the selling unit explicitly: refill,
   individual bottle or complete carton. Stock must use that same unit.
3. Edit refill/carton selling prices; never use a sample price as approval.
4. Map qualifying products and units per reward. Security and cargo are not
   qualifying products. Do not confuse reward units with carton price conversion.
5. Save bottle security and refund terms, service areas and delivery charges.
   Use zero only when the company explicitly chooses no security.
6. Review actual stock in ERP Inventory using physical count and stock movements.
   No production inventory is changed by this preparation work.

## OTP provider preparation

Prepared integration candidate: Twilio Verify, SMS channel. No account purchase,
provider activation, real SMS, or Pakistan delivery guarantee is implied.
Official references checked 5 October 2026:
- https://www.twilio.com/docs/verify/api/verification
- https://www.twilio.com/docs/verify/api/verification-check

After salary, create a Verify service and store server-side secrets:
`SIGNUP_OTP_PROVIDER=twilio_verify`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_VERIFY_SERVICE_SID`. Never place credentials in HTML, Git or screenshots.
Trial numbers may require verification. Confirm destination permission, actual
Pakistan carrier delivery and current charges in the provider account before enabling.

Registration integration gate: keep signup disabled until the ERP stores a
challenge bound to company, normalized E.164 phone, provider verification ID,
purpose, expiry and attempts. Limit by phone, company and IP; resend cooldown
60 seconds; initial policy maximum 5 sends/hour and 5 checks/challenge. Consume
approval atomically once; refuse cross-company, expired and reused challenges.
Resolve existing customers in the selected company without duplicating records.
Use existing ERP customer/user/session creation and password policy. Do not
create a second identity store. A valid provider response alone is not signup.
Provider failures must never create an account or return success.

## Final acceptance checklist

Record build commit, device, time, company, test record IDs, expected/actual result
and screenshot for every case. Use staging test companies A/B and test customers.
All online cases below currently NOT RUN; local automated tests are separate.

| Case | Procedure | Pass criterion |
|---|---|---|
| Company isolation | A/B set different refill/security terms; customer tries B IDs | Only own company values/data; unauthorized changes rejected |
| Prices | Place order, edit price, place another; tamper client price | Old order unchanged; new order uses server price |
| Cartons and stock | Order one carton and individual bottles using configured units | Invoice, stock and reward units agree; unavailable stock rejected |
| Security accounting | New bottle, exchange, return, rate change, partial refund | Agreed charge shown before order; deposit ledger preserves historical amounts; no points on security |
| Delivery charges | In-area/out-of-area order and free-refill reward | Agreed fee shown before confirmation and persisted; no points on fees |
| Signup | Valid, wrong, expired, reused OTP; rapid resend; wrong company | One tenant-bound account, rate limits and safe failures |
| Mobile | Android widths 360/390/412; login, dashboard, logout | No hidden controls/overflow; secure session; usable keyboard/forms |
| Paid order | Customer order → assigned driver → proof/OTP → payment → dashboard | One delivery, stock movement and correct reward; status consistent |
| Payment timing | Delivery unpaid, partial paid, full paid, duplicate receipt | Points only after eligible fully paid delivery; no duplicate credits |
| Refund and rewards | Refund, cancellation, referral, redemption retry | Correct reversal/debt; no duplicate free refill; original expiry retained |
| Offline driver | Lose signal, capture allowed actions, reconnect and retry | No duplicate delivery/payment/bottle movements; conflicts visible |
| Restart | Create records/uploads, stop and restart same persistent volume | Orders, settings, sessions per policy, uploads and points survive |
| Redeploy | Deploy same database/uploads volume | No reseeding or missing customer history |
| Backup restore | Follow isolated restore drill below | Database and uploads restored; login and order/proof read succeed |

Security/deposit charging and structured delivery-fee calculation are NOT completed
by the terms editor. Confirm and implement their checkout/ledger integration before
marking the related acceptance cases passed. Existing recurring schedules retain
their stored price; rate changes do not silently amend a customer's schedule.

## Isolated backup and restore drill

1. Identify actual `DB_PATH`, upload/proof directories and persistent mounts.
2. Record row counts, recent order/point IDs and SHA-256 of a sample upload.
3. Quiesce writes/scheduler; create a consistent SQLite backup via SQLite backup
   API (or stop the process before copying all database/WAL files). Back up uploads
   at the same checkpoint. Metadata-only JSON validation is not a restore test.
4. Store database, uploads, hashes and version manifest in protected backup storage.
   Keep encryption keys/secrets in the approved secret store, not this repository.
5. Restore to a new isolated directory/database. Never overwrite the production DB.
6. Start same application version with external delivery and scheduler disabled;
   check SQLite integrity, row counts, sample upload hashes, login, order and points.
7. Record elapsed time, differences and evidence; destroy test copies securely after
   acceptance. Configure retention/off-site scheduling after hosting is selected.

## Remaining launch gates

Backend hosting and website connection; real company catalog/stock approval;
deposit/delivery checkout integration; OTP registration wiring and real delivery;
online mobile/driver flow; persistent-volume and full restore drill; owner approval.
Do not label the Water Club live or fully verified before these pass.

## Local validation result

5 October 2026: npm test reports 30/30 passed, zero failures/skips (including parent tests). Company price/terms isolation, role rejection, invalid amounts and historical order snapshots were exercised with a disposable database. OTP adapter checks use mocks; no SMS was sent. JavaScript syntax checks passed. Online/mobile and full restore drills remain NOT RUN.
