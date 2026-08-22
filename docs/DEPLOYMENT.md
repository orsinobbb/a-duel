# GitHub Pages + Render 部署

這套部署會讓 GitHub Pages 提供前端，Render 提供 Node.js API 與 WebSocket。預設不需要資料庫，資料會寫入 Render 容器內的 JSON；重新部署或容器重建時資料可能清空，適合目前測試階段。

## 1. 資料儲存

目前可直接跳過資料庫設定。若未來需要長期保存帳號與歷史對局，再建立 PostgreSQL，並在 Render 設定完整連線字串：

```text
postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

後端第一次啟動時會自動建立 `a_duel_snapshots` 資料表。

## 2. 部署 Render 後端

1. 將專案推送到 GitHub。
2. 在 Render 選擇 **New > Blueprint**，連接這個 repository；Render 會讀取根目錄的 `render.yaml`。
3. `render.yaml` 已設定 GitHub Pages 的允許來源，不需再填環境變數。
4. 完成後記下網址，例如 `https://a-duel-api.onrender.com`。

可用以下網址確認後端：

```text
https://a-duel-api.onrender.com/healthz
```

## 3. 部署 GitHub Pages 前端

在 GitHub repository 開啟 **Settings > Secrets and variables > Actions > Variables**，建立：

| Name | Value |
| --- | --- |
| `A_DUEL_API_BASE` | `https://a-duel-api.onrender.com/api` |
| `A_DUEL_WS_BASE` | `wss://a-duel-api.onrender.com/ws` |

再到 **Settings > Pages**，將 Source 設為 **GitHub Actions**。推送到 `main` 或 `master` 後，workflow 會自動發布：

```text
https://YOUR_NAME.github.io/REPOSITORY_NAME/
```

## 4. 驗收

1. 開啟 GitHub Pages 網址並登入。
2. 用另一個無痕視窗登入另一名玩家。
3. 建立及加入同一房間，確認雙方即時看到選牌與戰鬥結果。
4. 重新整理雙方頁面，確認可自動重連。
5. 重新整理雙方頁面，確認仍可繼續目前對局。

Render 免費服務閒置後會休眠。第一個請求需要等待冷啟動；正式公開營運時應改用不休眠方案。
