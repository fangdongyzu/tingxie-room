# 聽寫室（Firebase 版）

以 Google 帳號登入的中文聽寫系統。老師建立測驗並提供六位代碼，學生現場聽寫後交卷，老師可在批改中心輸入成績、訂正和評語。

## 功能

- Firebase Authentication Google 登入
- Cloud Firestore 儲存測驗、交卷與批改
- 老師建立／關閉測驗及查看所有答案
- 學生只能查看自己的交卷與成績
- 禁止貼上、姓名與裝置代碼浮水印、離開畫面紀錄
- 老師儲存批改後，學生即時看到成績、訂正與評語
- 介面可切換中文、英文、越南文與泰文，並記住裝置上的選擇

## 第一次設定 Firebase

### 1. 啟用 Google 登入

1. 開啟 [Firebase Console](https://console.firebase.google.com/project/tingxie-76b20/authentication/providers)。
2. 到 **Authentication → Sign-in method**。
3. 啟用 **Google**，選擇支援電子郵件並儲存。
4. 到 **Authentication → Settings → Authorized domains**。
5. 加入 `fangdongyzu.github.io`。

### 2. 建立 Firestore

1. 到 **Firestore Database**。
2. 按 **Create database**。
3. 選擇離台灣較近的區域。
4. 建立後部署本專案的 `firestore.rules`。

若已安裝 Firebase CLI：

```bash
firebase login
firebase deploy --only firestore:rules
```

也可以在 Firebase Console 的 **Firestore Database → Rules** 貼上 `firestore.rules` 的內容並按 **Publish**。

### 3. 設定第一位老師

1. 在 `firebase-config.js` 的 `teacherEmails` 加入老師的完整 Google 電子郵件地址。
2. 在 `firestore.rules` 的 `admins` 建立條件加入相同地址並重新發布規則。
3. 使用該 Google 帳號首次登入時，系統會安全建立老師權限並進入老師控制台。

`admins` 文件不能由網站自行建立，因此學生無法把自己改成老師。

## 上課流程

### 老師

1. Google 登入。
2. 在「測驗管理」建立聽寫，取得六位代碼。
3. 把代碼提供給學生。
4. 學生交卷後，到「批改中心」查看答案。
5. 輸入成績、正確答案／訂正和評語，按「儲存並傳送給學生」。

### 學生

1. Google 登入。
2. 輸入老師提供的六位代碼及交卷姓名。
3. 聽老師播放或朗讀並親手輸入。
4. 交卷後到「我的成績」等待批改結果。

## 檔案

- `firebase-config.js`：Firebase 專案設定
- `firestore.rules`：Firestore 後端權限
- `firebase.json`、`.firebaserc`：Firebase CLI 設定
- `app.js`：登入、學生作答及老師批改介面
- `styles.css`：網站樣式

Firebase Web API key 會公開在前端，這是 Firebase Web App 的正常設計；真正的資料保護由 Authentication 與 `firestore.rules` 負責。
