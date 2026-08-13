# Affective Slider 研究級連續情緒標註工具

以固定 10 Hz 時間軸同步回溯式 Valence/Arousal 標註與 MediaPipe Face Landmarker 真實臉部特徵，輸出可稽核的 CSV、session metadata 與 QA 報告。

## 啟動與驗證

```bash
npm install
npm run dev
npm test
npm run build
```

Face Landmarker 模型與 WASM 已固定在 `public/models`、`public/mediapipe`，資料蒐集時不需連線至 CDN。後端與 MySQL 為選用功能：

```bash
npm run server
```

## 標註流程

1. 上傳 MP4 並設定研究片段起訖點。
2. 框選初始臉部位置；正式特徵由 MediaPipe 逐幀偵測，不使用幾何假點。
3. 分兩次播放標註 Valence 與 Arousal。兩者都寫入預先建立的同一組 `sample_index`。
4. 填寫匿名 participant/session/stimulus/trial 資訊並執行 QA。
5. QA 報告一定會下載；只有時間軸與標籤完整率至少 99%、有效臉部率至少 95% 時才下載訓練 CSV。

暫停、播放、seek、slider 修改與掉幀補記均寫入 metadata 的 audit events。臉部未偵測或來源幀跳過時保留空值及原因，不以前一幀冒充有效資料。

## Schema 2 輸出

每列是一個固定 0.1 秒樣本，包含：

- 匿名識別：participant、session、stimulus、trial、anonymous video ID。
- 時間：canonical sample index/target time 與實際來源 timestamp。
- 標籤：原始 V/A、0.5 秒中央移動平均及固定先導研究延遲校正後的 V/A。
- 品質：face detected、confidence 欄位、quality flags、interpolation 與 exclusion reason。
- 特徵：478 點原始及眼距／平移／旋轉正規化的 x/y/z landmark、頭部姿態與幾何量。
- 版本：工具、模型、schema 與處理版本。

MediaPipe Web API 不公開逐幀偵測／追蹤信心分數，因此這兩個欄位目前保留空值，並以 `model_confidence_not_exposed` 明確標記；不可把模型門檻誤報為真實 confidence。

`metadata_qa.json` 保存原始檔名，應與研究資料放在同一加密資料夾，不應公開。訓練 CSV 使用匿名 ID。

## LOSO 1D CNN-LSTM

```bash
python3 -m pip install -r training/requirements.txt
python3 training/train_loso.py data/*.csv --window-seconds 4 --epochs 30
```

訓練器使用正規化 landmark、速度、加速度、幾何特徵與 face-valid mask；模型為 temporal 1D CNN + LSTM，輸出連續 V/A，損失為 MSE + CCC。外層按 participant 執行 LOSO，validation participant 也與 train/test 分離；補值與標準化只由當 fold 訓練資料估計。結果報告 CCC、MAE、RMSE、Pearson correlation 與 global-mean baseline。

重測或第二標註者完成後，可用相同 canonical keys 計算 CCC 與 ICC(3,1)：

```bash
python3 training/reliability.py first.csv repeat_or_second_rater.csv
```

預設 4 秒視窗可改為 3–5 秒。42 人 × 5 分鐘 × 10 Hz 約為 126,000 個標註樣本；原始影片若為 30 FPS 才是 378,000 個影片幀，兩者不可混稱。

## 研究限制

- 刺激情緒欄只描述實驗條件，不是離散情緒 ground truth。
- 反應延遲必須由先導研究固定，不可依測試受試者調整。
- 正式收案前須用有已知表情變化的影片驗證 landmark 變異，並安排重測或第二標註者資料，另行計算 CCC／ICC；工具不會捏造這些研究結果。
- `server/schema.sql` 同時保留原型資料表及 schema 2 的 session、timeline sample、audit event 表。
