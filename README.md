# Affective Slider 微表情標註工具

React + shadcn UI 風格介面，用於 MP4 微表情影片剪輯、臉部 ROI 標註、Affective Slider 兩階段動態標註，以及 LSTM 訓練用 CSV 匯出。

## 啟動

```bash
npm install
npm run dev
```

前端預設網址：

```text
http://localhost:5173/
```

後端 API：

```bash
npm run server
```

MySQL schema 位於 `server/schema.sql`。

## 操作流程

1. 上傳 MP4。
2. 在剪輯階段調整起始與結束時間，影片上會用半透明遮罩顯示捨棄區段。
3. 進入臉部位置標註，在影片上用滑鼠或 iPad 手指滑動框選臉部 ROI。ROI 會固定為正方形。
4. 進入動態標註後，先點「標註愉悅度」或「標註喚醒度」。
5. Valence 與 Arousal 分兩階段標註：一個 slider enable 時，另一個 slider disable。
6. 兩階段都完成後，按「匯出 CSV」取得 LSTM 序列資料。

## CSV 格式

每列代表一個時間序列樣本，預設取樣率為 10 FPS。欄位包含：

- `video_name`, `clip_start_sec`, `clip_end_sec`
- `frame_index`, `timestamp_sec`, `sequence_time_sec`
- `valence`, `arousal`，範圍皆為 -1 到 1，記錄至小數點後 2 位
- `roi_x`, `roi_y`, `roi_size`
- `lm1_x` 到 `lm68_y`：依使用者框選 ROI 與追蹤位置輸出的 68 點座標
- `nlm1_x` 到 `nlm68_y`：以 ROI 做幾何歸一化後的 68 點座標
- 幾何特徵：`face_width`, `eye_distance`, `left_eye_open`, `right_eye_open`, `mouth_width`, `mouth_open`, `nose_to_mouth`

CSV 已整理成固定欄位、固定時間序列步長，可直接作為 LSTM 訓練前處理輸入。

## 實作備註

目前前端在瀏覽器內完成 ROI template tracking、68 點幾何特徵估計與歸一化。若要用正式研究級臉部 landmark，可將 `src/lib/facePipeline.ts` 替換為 MediaPipe Face Landmarker、OpenFace、dlib，或後端批次特徵提取服務；CSV schema 不需要改。
