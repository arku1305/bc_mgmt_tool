# 第二階段 LINE 串接：本機測試說明

更新：2026-10-04。此版本尚未部署，尚未以真實 LINE 官方帳號／群組驗證。

## 目前可測

開啟 `http://127.0.0.1:8769/?registration&as=leader`，在報名管理裡找到「LINE 群組管理」。本機模擬器用目前選擇的虛構團長身分；所有回覆只顯示在網頁，不連 LINE。測試狀態保存於 `/private/tmp/bc-club-preview-state.json`，重新啟動不會清除。

1. 以團長甲預覽，私訊指令保留「綁定團長」，按「模擬私訊與驗證」。顯示已綁定。
2. 選虛構群組 A，群內指令填「加入揪凱」，按「模擬群內訊息」。群組顯示可使用。
3. 選甲自己的球團和活動，按「連結本場活動到此群」。只建立關聯，公告顯示等待群內指令。
4. 將畫面提供的完整「發布揪凱 xxxxxxxxxxxx」指令貼入群內指令，按模擬群內訊息。顯示公告、本場報名連結，以及已送出。
5. 切換團長乙，同樣綁定並在 A 輸入「加入揪凱」。顯示等待原登錄團長同意，不能發布。
6. 切回甲，按重新整理群組與申請，看到乙的虛構 Email；同意／拒絕申請。核准後乙可使用同一群，但其球團清單仍只有自己的資料。
7. 乙可以建立自己的球團活動，再連結群 A。甲不能讀乙的球團，平台 Admin 也不能讀。
8. 同一活動可再連結群 B；必須在 B 再輸入其對應指令。A 的指令不能拿到 B 使用。
9. 暫停活動報名、停止單群活動連結、解除團長 LINE 綁定，均會阻擋該公告操作，不刪球團、報名或排點資料。

已測試的甲／乙可能已綁定、群組 A 已核准，這是既有虛構測試結果。可改用群 B測待審流程。模擬器不提供真實綁定捷徑；它只存在 tests/preview 伺服器。

## 正式串接的流程與設定

團長加官方帳號好友後，私訊「綁定團長」。Bot 向 LINE 取得一次性 link token，以當次 reply 回覆平台連結。團長登入 Google，按確認；後端產生 nonce，跳轉官方 accountLink 頁。僅簽章有效且 result=ok、來源 LINE userId 符合、nonce 未過期未使用的回呼能完成對應。同一 LINE／平台帳號不可被另一帳號覆寫。可在後台或私訊「解除團長綁定」；即使停用報名管理，私訊解除仍可使用。

依據：[LINE 官方帳號連結文件](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)。不另建 LINE Login channel，也不以團長輸入的 Email、姓名或 LINE ID 授權。

正式發布前須取得汝婷對具體版本、資料權限與專用測試群的授權。下列設定尚未套用正式環境：

- 既有 Firebase Auth、RTDB、LINE Channel 與後台授權設定。
- `REGISTRATION_V2=true`、`LINE_INTEGRATION_V2=true`（後端）及同名前端旗標。新版啟用時 webhook 不再回到舊單群 current 名單，避免寫錯活動。旗標須與後台一起發布，不能只切換 webhook。
- `RANKING_PAGE_URL` 設為完整後台網址（含路徑），`RANKING_ORIGIN` 維持原本 CORS 授權來源。
- `SIGNUP_PAGE_URL` 設為完整報名頁網址。本機設為 localhost，正式不能使用 localhost。
- 新增的私有 `lineIntegrationV2` 必須拒絕瀏覽器直接讀寫；資料只透過受驗證 API／簽章 webhook 存取。正式 Firebase 規則未變更。
- 過期綁定嘗試、訊息去重紀錄的清理與使用量監測需在正式發布前安排。此本機版本保留紀錄供測試。

## 實際過渡資料結構

`lineIntegrationV2` 中有 links／users（LINE 與平台對應）、attempts（link token hash、nonce hash、UID、期限、結果）、groups（真實 groupId 私有、名稱、原登錄者、members、requests）、publications（clubId、eventId、groupKey、指令碼、是否啟用、公告結果）、processed（發布指令去重）。綁定与群組資格／審核用這一小範圍交易維持一致，不改 RTDB、不遷移舊資料。

群組清單只回傳目前團長可使用或曾申請的群；申請者 Email 僅原登錄者可讀。Admin 沒有越權查看或代審權。群組分享不等於球團共享。當 LINE 群指令執行時重新查 Firebase 帳號與 accessV1，舊綁定不能繞過停用權限。

Publication 是獨立關聯，目前存於 lineIntegrationV2，不複製活動名單。每次公告讀取原有 clubsV2 的本場快照，只 reply 到當次群組，不 push。送出成功才記 sent；失敗不記成功，請團長重新輸入一則指令。相同 webhookEventId 不重複送。sending 未取得結果時維持「尚未確認」，不能當作成功。

## 尚未完成

第三階段才把群內「小明+2」、請假／恢復、查名單、多活動選場接至新版活動。第二階段不接受群內姓名報名；目前先用公告中的本場網頁連結報名。真實 LINE 帳號連結、群名查詢與 webhook 網路來回仍待專用測試群驗證。
