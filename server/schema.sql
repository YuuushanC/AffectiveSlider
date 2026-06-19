CREATE DATABASE IF NOT EXISTS affective_slider CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE affective_slider;

CREATE TABLE IF NOT EXISTS videos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(512),
  duration_sec DECIMAL(10, 3),
  clip_start_sec DECIMAL(10, 3) NOT NULL DEFAULT 0,
  clip_end_sec DECIMAL(10, 3) NOT NULL DEFAULT 0,
  roi_x DECIMAL(12, 5),
  roi_y DECIMAL(12, 5),
  roi_size DECIMAL(12, 5),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS annotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  frame_index INT NOT NULL,
  timestamp_sec DECIMAL(10, 3) NOT NULL,
  valence DECIMAL(4, 2),
  arousal DECIMAL(4, 2),
  roi_json JSON NOT NULL,
  landmarks_json JSON NOT NULL,
  normalized_landmarks_json JSON NOT NULL,
  geometry_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_video_frame (video_id, frame_index),
  CONSTRAINT fk_annotations_video FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
