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

-- Schema 2 research dataset. Legacy tables above remain readable for prototype exports.
CREATE TABLE IF NOT EXISTS dataset_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  participant_id VARCHAR(64) NOT NULL,
  stimulus_id VARCHAR(64) NOT NULL,
  trial_id VARCHAR(64) NOT NULL,
  anonymous_video_id VARCHAR(128) NOT NULL,
  biological_sex VARCHAR(32),
  stimulus_emotion VARCHAR(64),
  stimulus_order INT,
  experimental_condition VARCHAR(128),
  clip_start_sec DECIMAL(10, 6) NOT NULL,
  clip_end_sec DECIMAL(10, 6) NOT NULL,
  sampling_hz DECIMAL(6, 2) NOT NULL DEFAULT 10,
  annotation_delay_sec DECIMAL(6, 3) NOT NULL DEFAULT 0,
  smoothing_window_sec DECIMAL(6, 3) NOT NULL DEFAULT 0.5,
  tool_version VARCHAR(32) NOT NULL,
  landmark_model_version VARCHAR(128) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  processing_version VARCHAR(64) NOT NULL,
  metadata_json JSON NOT NULL,
  qa_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_anonymous_video (anonymous_video_id),
  INDEX idx_participant (participant_id)
);

CREATE TABLE IF NOT EXISTS timeline_samples (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dataset_session_id BIGINT UNSIGNED NOT NULL,
  sample_index INT NOT NULL,
  target_time_sec DECIMAL(10, 6) NOT NULL,
  source_frame_index INT,
  source_timestamp_sec DECIMAL(10, 6),
  valence_raw DECIMAL(5, 3),
  arousal_raw DECIMAL(5, 3),
  valence_smoothed DECIMAL(5, 3),
  arousal_smoothed DECIMAL(5, 3),
  face_detected BOOLEAN NOT NULL DEFAULT FALSE,
  detection_confidence DECIMAL(6, 5),
  tracking_confidence DECIMAL(6, 5),
  quality_flags_json JSON NOT NULL,
  interpolated BOOLEAN NOT NULL DEFAULT FALSE,
  exclusion_reason VARCHAR(128),
  roi_json JSON,
  landmarks_json JSON,
  normalized_landmarks_json JSON,
  head_pose_json JSON,
  geometry_json JSON,
  UNIQUE KEY uniq_session_sample (dataset_session_id, sample_index),
  CONSTRAINT fk_timeline_session FOREIGN KEY (dataset_session_id) REFERENCES dataset_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dataset_session_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  media_time_sec DECIMAL(10, 6) NOT NULL,
  mode VARCHAR(16),
  detail VARCHAR(255),
  recorded_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_audit_session FOREIGN KEY (dataset_session_id) REFERENCES dataset_sessions(id) ON DELETE CASCADE
);
