# 整版正式發布

2026-10-04 核定：舊測試資料原地保留，新版從空白球團開始。LINE 驗證群：揪凱test。

## 同版部署設定

- GitHub Pages：ranking/index.html 啟用 REGISTRATION_V2、LINE_INTEGRATION_V2。
- Vercel Production：REGISTRATION_V2=true、LINE_INTEGRATION_V2=true。
- RANKING_PAGE_URL=https://arku1305.github.io/bc_mgmt_tool/ranking/
- SIGNUP_PAGE_URL=https://badminton-signup-bot.vercel.app/
- Admin 沿用 arku1305@gmail.com，團長沿用 blackcatk1989@gmail.com。
- Firebase 私有路徑僅後端 Admin SDK 存取；保留原 badminton 與其他既有資料規則，rankingV1 改為拒絕直接存取。規則片段見 ranking-rules.example.json。
- Vercel 每日 UTC 01:00（台灣 09:00）排程沿用；新版不繼續更新舊 V1 測試活動。

## 正式驗收

確認 GitHub Pages 與 Vercel 都完成部署後，登入查看空白球團、權限管理及 LINE 群組管理。官方帳號加入測試群後，團長私訊「綁定團長」，經 Google 登入確認綁定，再群內「加入揪凱」。建立活動並連結群組，貼上本場發布指令，測試同名拒絕、小明+2、取消及網頁名單一致、團長手動匯入排點。

部署成功與真實 LINE 測試成功分開記錄；不可只看到部署 Ready 就宣稱 LINE 已通過。

## 回復

必要時將前端與後端兩旗標一起關閉並重新部署，保留 V2 資料。不得刪除球團或更改公開分享代碼。新版及 V1 API 都使用後端授權，不需恢復舊 rankingV1 瀏覽器直讀權限。

## 2026-10-11 發布範圍

汝婷已核准本次調整一起正式發布：獨立帳務與 Admin 權限、兩個來源頁的活動收入匯入及逐人確認後合併入帳、手動收入／支出／退款及誤植刪除、每週迄日與系列請假統計、並排名單／刪除與複製圖示、報名成功提示及排點讀寫順序修正、標題「揪凱JOKAI⎟球團管家」。

99 項本機測試通過；Firebase 正式規則已唯讀核對，根層無較寬鬆授權，`$other` 拒絕讀寫，新增 accountingV1 亦受保護，匿名測試為 HTTP 401。無須修改原 badminton 規則或正式資料。

發布使用 main 的 GitHub Pages／Vercel 自動部署。發布後核對兩個平台對應提交皆成功、正式靜態檔及未登入 API 拒絕；不新增正式測試活動或款項、不送 LINE 訊息。實際團長入帳與退款需由團長使用自己的活動核對。
