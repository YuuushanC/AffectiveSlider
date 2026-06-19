import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import mysql from "mysql2/promise";

const app = express();
const upload = multer({ dest: process.env.UPLOAD_DIR ?? "uploads/" });
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "affective_slider",
  waitForConnections: true,
  connectionLimit: 10,
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/videos", upload.single("video"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "video file is required" });
    const [result] = await pool.execute(
      "INSERT INTO videos (original_name, storage_path, duration_sec, clip_start_sec, clip_end_sec) VALUES (?, ?, ?, ?, ?)",
      [
        file.originalname,
        file.path,
        Number(req.body.duration_sec ?? 0),
        Number(req.body.clip_start_sec ?? 0),
        Number(req.body.clip_end_sec ?? 0),
      ],
    );
    res.status(201).json({ id: result.insertId, originalName: file.originalname });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/videos/:id/roi", async (req, res, next) => {
  try {
    const { x, y, size } = req.body;
    await pool.execute("UPDATE videos SET roi_x = ?, roi_y = ?, roi_size = ? WHERE id = ?", [x, y, size, req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/annotations", async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const samples = Array.isArray(req.body.samples) ? req.body.samples : [];
    await connection.beginTransaction();
    for (const sample of samples) {
      await connection.execute(
        `INSERT INTO annotations
        (video_id, frame_index, timestamp_sec, valence, arousal, roi_json, landmarks_json, normalized_landmarks_json, geometry_json)
        VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE
          timestamp_sec = VALUES(timestamp_sec),
          valence = VALUES(valence),
          arousal = VALUES(arousal),
          roi_json = VALUES(roi_json),
          landmarks_json = VALUES(landmarks_json),
          normalized_landmarks_json = VALUES(normalized_landmarks_json),
          geometry_json = VALUES(geometry_json)`,
        [
          req.params.id,
          sample.frameIndex,
          sample.timestamp,
          sample.valence,
          sample.arousal,
          JSON.stringify(sample.roi),
          JSON.stringify(sample.landmarks),
          JSON.stringify(sample.normalizedLandmarks),
          JSON.stringify(sample.geometry),
        ],
      );
    }
    await connection.commit();
    res.status(201).json({ inserted: samples.length });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "internal server error" });
});

app.listen(port, () => {
  console.log(`Affective Slider API listening on http://localhost:${port}`);
});
