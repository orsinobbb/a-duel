# A牌對決

A牌對決是可本機或雙人連線遊玩的即時牌桌。產品版包含訪客登入、公開大廳、對局代碼、即時同步、斷線重連、伺服器端規則驗證，以及牌局與登入持久化。

## 本機開發

需求：Node.js 20 以上。

```powershell
npm install
npm run dev
```

開啟 `http://127.0.0.1:5173/`。這個指令會同時啟動前端與 API；後端預設位於 `http://127.0.0.1:8787`。

## 正式模式

```powershell
npm run build
npm start
```

開啟 `http://127.0.0.1:8787/a-duel/`。正式伺服器會直接提供已建置的前端、API 與 WebSocket。

若要在 `http://zeusseuz1.duckdns.org:3001/a-duel/` 提供服務：

```powershell
$env:A_DUEL_HOST="0.0.0.0"
$env:A_DUEL_SERVER_PORT="3001"
npm run build
npm start
```

## 資料與設定

登入及對局預設保存在 `data/a-duel.json`，此目錄不會加入 Git。可參考 `.env.example` 調整以下項目：

- `A_DUEL_HOST`：監聽位址。
- `A_DUEL_SERVER_PORT`：伺服器連接埠。
- `A_DUEL_BASE_PATH`：正式網站路徑，預設 `/a-duel`。
- `A_DUEL_DATA_FILE`：JSON 資料檔位置。
- `A_DUEL_ALLOWED_ORIGINS`：額外允許的跨來源網址，以逗號分隔。

## 指令

```powershell
npm run dev       # 同時啟動前端與 API 開發模式
npm run build     # 型別檢查並建立正式檔案
npm test          # 執行規則與線上權限測試
npm run check     # 依序執行測試與正式建置
npm start         # 提供正式網站與 API
```

完整產品方向與版本規劃見 [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md)。

## 雲端部署

專案已包含 GitHub Pages workflow、Render Blueprint，以及可選的 PostgreSQL 持久化。完整設定步驟見 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
