# Affective Slider 研究級連續情緒標註工具

以固定 10 Hz 時間軸同步回溯式 Valence/Arousal 標註與 MediaPipe Face Landmarker 真實臉部特徵。正式輸出是一個含 CSV、session metadata、QA 與 SHA-256 checksum 的 ZIP。

## 平板使用條件

- 受試者以平板「橫向」操作；直向時可預覽，但 ROI、特徵提取及 V/A 播放會被阻擋。
- 使用已更新的 Safari、Chrome 或 Edge，並關閉瀏覽器的自動翻譯、閱讀模式與省電限制。
- 網址必須是 HTTPS。工具會在上傳前檢查 WebAssembly、精確影片影格 callback、IndexedDB 與 SHA-256；缺少任一必要能力即阻擋正式收案。
- 中文字體 `Noto Sans TC Variable`、Face Landmarker 模型及 MediaPipe WASM 都封裝在網站內，不會向 Google Fonts 或 CDN 傳送請求。
- 原始影片只由受試者在平板選取，不會上傳到伺服器。進度及衍生特徵會暫存在該瀏覽器的 IndexedDB；重新開啟網站後須再選同一支影片才能恢復。
- QA 通過後會下載 ZIP 到平板的「下載項目／檔案」。研究人員仍需現場確認並以核准的加密方式收回檔案；這個純前端版本不會自動把研究資料傳到網路。

正式收案前至少要在預定使用的每一種實體平板／瀏覽器完整跑一支最長正式影片，確認沒有重新載入、過熱、儲存空間不足或下載失敗。桌面瀏覽器的平板尺寸模擬不能取代這項驗收。

## 本機啟動與驗證

需要 Node.js 24（見 `.nvmrc`）：

請勿在 Finder 直接雙擊 `index.html`；`file://` 無法載入 Vite 模組、WASM 與模型，必須透過開發伺服器或 HTTPS 部署網址開啟。

```bash
npm ci
npm run dev
npm test
npm run build
```

## 網址部署（建議純靜態託管）

以 Cloudflare Pages、Vercel 或其他支援 HTTPS 與自訂 response headers 的靜態主機部署 `dist/`：

1. Build command：`npm ci && npm run build`
2. Output directory：`dist`
3. Node version：24
4. 不設定後端、資料庫、API key 或影片上傳目錄。
5. 部署後確認根目錄的 `_headers` 生效，尤其是 CSP、禁止 iframe、MIME sniffing、權限限制與 `noindex`。
6. 使用正式網址重新執行平板驗收；`vite preview` 只用於部署前的本機檢查。

`server/` 是早期可選原型，不屬於目前的資料蒐集部署，請勿在公開主機啟動 `npm run server`。若未來要集中上傳研究資料，必須先另行完成登入授權、傳輸／靜態加密、伺服器端完整性驗證、備份與 REC 核准，不能直接沿用原型 server。

## 標註流程

1. 上傳 MP4 並設定研究片段起訖點。
2. 框選受試者臉部；工具只在該 ROI 裁切畫面內偵測，避免選到刺激影片中的人物。
3. 工具依固定 10 Hz canonical timestamps seek、解碼並完成一次特徵提取，隨後鎖定特徵。
4. 分兩次播放標註 Valence 與 Arousal。滑桿事件以 causal zero-order hold 對齊同一組 `sample_index`，不使用未來值回填。
5. 填寫匿名 participant/session/stimulus/trial 資訊並執行 QA。
6. QA 未通過時，ZIP 只含報告與拒絕原因；通過時才包含 `dataset.csv`。
7. 在平板「檔案」中確認 ZIP 存在後再按「結束 session」，此時才清除本機暫存。

暫停、播放、seek、slider 修改與掉幀補記均寫入 metadata 的 audit events。臉部未偵測或來源幀跳過時保留空值及原因，不以前一幀冒充有效資料。

## ZIP 與 Schema 2.2

通過 QA 的 ZIP 包含：

- `dataset.csv`：固定 0.1 秒一列的標籤、品質、478 點真實／正規化 landmark、頭部姿態、幾何量與 52 個 blendshape。
- `metadata_qa.json`：匿名 session 條件、clip 範圍、工具／模型／protocol 版本、粗略瀏覽器環境、audit events 與完整 QA。
- `manifest.json`：每個檔案的 byte 數與 SHA-256 checksum。

輸出不保存原始影片檔名，只保存匿名影片 ID、影片長度與檔案大小。MediaPipe Web API 不公開逐幀偵測／追蹤信心，因此欄位維持空值並標記 `model_confidence_not_exposed`。瀏覽器也沒有可靠的容器原始 frame index，`source_frame_index` 維持空值；不可用播放累計幀冒充。

標註延遲、平滑視窗與 QA 門檻集中在 `src/protocol.ts`。先導研究決定延遲後必須更新 protocol version，不可逐參與者或逐 fold 修改。

## LOSO 1D CNN-LSTM

```bash
python3 -m pip install -r training/requirements.txt
python3 training/train_loso.py data/*.csv --window-seconds 4 --epochs 30
```

訓練器預設使用 52 個 blendshape、速度、加速度、幾何特徵、頭部姿態與 face-valid mask；可用 `--feature-set landmarks` 做對照。模型為 temporal 1D CNN + LSTM，輸出連續 V/A，損失為 MSE + CCC。外層按 participant 執行 LOSO，validation participant 也與 train/test 分離；補值與標準化只由當 fold 訓練資料估計。結果報告 CCC、MAE、RMSE、Pearson correlation、global-mean、ridge，以及明確標成 oracle 的 previous-label baseline。

重測或第二標註者完成後，可用相同 canonical keys 計算 CCC 與 ICC(3,1)：

```bash
python3 training/reliability.py first.csv repeat_or_second_rater.csv
```

42 人 × 5 分鐘 × 10 Hz 約為 126,000 個標註樣本；原始影片若為 30 FPS 才是 378,000 個影片幀，兩者不可混稱。

## 研究與資料治理限制

- 刺激情緒欄只描述實驗條件，不是離散情緒 ground truth。
- 目前 10 Hz 管線研究的是連續情緒軌跡，不支援 25–200 ms 微表情辨識主張。
- landmark 與 blendshape 仍屬可連結個人的生物特徵資料，應與原始臉部影片同級加密、限權及到期銷毀，不可宣稱完全匿名化。
- 正式收案前須用已知表情變化影片驗證 landmark 變異，並安排重測或第二標註者資料，另行計算 CCC／ICC。
- 網址、平板型號、OS、瀏覽器版本、影片編碼規格、下載／移交方式、留存期限與異常處置 SOP 應固定寫進資料蒐集作業手冊及 REC 文件。
