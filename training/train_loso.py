#!/usr/bin/env python3
"""Leakage-safe LOSO training for Affective Slider schema 2 CSV files."""
from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.linear_model import Ridge
try:
    from training.loso_split import participant_folds
    from training.window_policy import oracle_previous_window_baseline, window_passes_quality
except ModuleNotFoundError:  # Allows direct execution from training/.
    from loso_split import participant_folds
    from window_policy import oracle_previous_window_baseline, window_passes_quality


GEOMETRY = ["face_width", "eye_distance", "left_eye_open", "right_eye_open", "mouth_width", "mouth_open", "nose_to_mouth"]
GROUP_KEYS = ["participant_id", "session_id", "anonymous_video_id"]


def ccc(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    x, y = y_true.astype(float), y_pred.astype(float)
    vx, vy = np.var(x), np.var(y)
    denominator = vx + vy + (np.mean(x) - np.mean(y)) ** 2
    return float(2 * np.mean((x - np.mean(x)) * (y - np.mean(y))) / denominator) if denominator else 0.0


def load_data(paths: list[Path]) -> pd.DataFrame:
    frame = pd.concat((pd.read_csv(path, dtype={"participant_id": str}) for path in paths), ignore_index=True)
    required = {"participant_id", "session_id", "anonymous_video_id", "sample_index", "valence_smoothed", "arousal_smoothed", "face_detected", "identity_match"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing schema 2 columns: {sorted(missing)}")
    duplicates = frame.duplicated(GROUP_KEYS + ["sample_index"])
    if duplicates.any():
        raise ValueError("Duplicate participant/session/video/sample_index keys found")
    return frame.sort_values(GROUP_KEYS + ["sample_index"])


def feature_columns(frame: pd.DataFrame, feature_set: str) -> list[str]:
    blendshapes = [c for c in frame.columns if c.startswith("bs_")]
    landmarks = [c for c in frame.columns if c.startswith("nlm") and c.endswith(("_x", "_y", "_z"))]
    pose = [c for c in ("head_pitch_deg", "head_yaw_deg", "head_roll_deg") if c in frame.columns]
    if feature_set == "blendshapes":
        if not blendshapes:
            raise ValueError("No MediaPipe blendshape columns found")
        columns = blendshapes + [c for c in GEOMETRY if c in frame.columns] + pose
    else:
        if not landmarks:
            raise ValueError("No normalized landmark columns found")
        columns = landmarks + [c for c in GEOMETRY if c in frame.columns] + pose
    return columns


def add_dynamics(frame: pd.DataFrame, columns: list[str]) -> tuple[pd.DataFrame, list[str]]:
    result = frame.copy()
    groups = result.groupby(GROUP_KEYS, sort=False)
    velocity = groups[columns].diff().fillna(0).add_suffix("_velocity")
    acceleration = velocity.groupby([result[key] for key in GROUP_KEYS]).diff().fillna(0).add_suffix("_acceleration")
    result = pd.concat([result, velocity, acceleration], axis=1)
    return result, columns + list(velocity.columns) + list(acceleration.columns)


@dataclass
class Standardizer:
    mean: np.ndarray
    std: np.ndarray

    @classmethod
    def fit(cls, values: np.ndarray):
        mean = np.nanmean(values, axis=0)
        std = np.nanstd(values, axis=0)
        return cls(np.nan_to_num(mean), np.where(np.isfinite(std) & (std > 1e-6), std, 1.0))

    def apply(self, values: np.ndarray):
        return np.nan_to_num((values - self.mean) / self.std)


def windows(frame: pd.DataFrame, features: list[str], length: int, stride: int,
            minimum_valid_face_rate: float, maximum_consecutive_missing: int):
    xs, ys, owners, group_ids, end_indices = [], [], [], [], []
    for keys, trial in frame.groupby(GROUP_KEYS, sort=False):
        trial = trial.sort_values("sample_index")
        x = trial[features].to_numpy(np.float32)
        valid_face = (trial["face_detected"].astype(bool) & trial["identity_match"].astype(bool)).to_numpy()
        mask = valid_face.astype(np.float32)[:, None]
        y = trial[["valence_smoothed", "arousal_smoothed"]].to_numpy(np.float32)
        sample_indices = trial["sample_index"].to_numpy(int)
        for start in range(0, len(trial) - length + 1, stride):
            stop = start + length
            if np.isnan(y[stop - 1]).any():
                continue
            window_valid = valid_face[start:stop]
            if not window_passes_quality(sample_indices[start:stop], window_valid, minimum_valid_face_rate, maximum_consecutive_missing):
                continue
            xs.append(np.concatenate([x[start:stop], mask[start:stop]], axis=1))
            ys.append(y[stop - 1])
            owners.append(keys[0])
            group_ids.append("|".join(map(str, keys)))
            end_indices.append(sample_indices[stop - 1])
    if not xs:
        raise ValueError("No windows passed the continuity and face-quality gates")
    return np.asarray(xs), np.asarray(ys), np.asarray(owners), np.asarray(group_ids), np.asarray(end_indices)


class TemporalCnnLstm(nn.Module):
    def __init__(self, features: int):
        super().__init__()
        self.conv = nn.Sequential(nn.Conv1d(features, 128, 5, padding=2), nn.ReLU(), nn.Dropout(0.2))
        self.lstm = nn.LSTM(128, 64, batch_first=True)
        self.head = nn.Linear(64, 2)

    def forward(self, x):
        x = self.conv(x.transpose(1, 2)).transpose(1, 2)
        x, _ = self.lstm(x)
        return self.head(x[:, -1])


def ccc_loss(target, prediction):
    losses = []
    for axis in range(2):
        x, y = target[:, axis], prediction[:, axis]
        covariance = torch.mean((x - x.mean()) * (y - y.mean()))
        coefficient = 2 * covariance / (x.var(unbiased=False) + y.var(unbiased=False) + (x.mean() - y.mean()).pow(2) + 1e-8)
        losses.append(1 - coefficient)
    return torch.stack(losses).mean()


def metrics(target: np.ndarray, prediction: np.ndarray):
    def pearson(a, b):
        return float(np.corrcoef(a, b)[0, 1]) if np.std(a) > 0 and np.std(b) > 0 else 0.0
    return {
        name: {
            "ccc": ccc(target[:, i], prediction[:, i]),
            "mae": float(np.mean(np.abs(target[:, i] - prediction[:, i]))),
            "rmse": float(np.sqrt(np.mean((target[:, i] - prediction[:, i]) ** 2))),
            "pearson": pearson(target[:, i], prediction[:, i]),
        } for i, name in enumerate(("valence", "arousal"))
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", nargs="+", type=Path)
    parser.add_argument("--window-seconds", type=float, default=4.0)
    parser.add_argument("--sampling-hz", type=int, default=10)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--feature-set", choices=("blendshapes", "landmarks"), default="blendshapes")
    parser.add_argument("--minimum-window-valid-face-rate", type=float, default=0.95)
    parser.add_argument("--maximum-window-consecutive-missing", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260812)
    parser.add_argument("--output", type=Path, default=Path("training/loso_results.json"))
    args = parser.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)

    frame = load_data(args.csv)
    frame, features = add_dynamics(frame, feature_columns(frame, args.feature_set))
    length = round(args.window_seconds * args.sampling_hz)
    x, y, owners, group_ids, end_indices = windows(
        frame, features, length, max(1, args.sampling_hz // 2),
        args.minimum_window_valid_face_rate, args.maximum_window_consecutive_missing,
    )
    results = []
    for train_ids, validation_id, test_id in participant_folds(owners.tolist()):
        train_mask, val_mask, test_mask = np.isin(owners, train_ids), owners == validation_id, owners == test_id
        scaler = Standardizer.fit(x[train_mask].reshape(-1, x.shape[-1]))
        transform = lambda a: scaler.apply(a.reshape(-1, a.shape[-1])).reshape(a.shape).astype(np.float32)
        train_x, val_x, test_x = transform(x[train_mask]), transform(x[val_mask]), transform(x[test_mask])
        model = TemporalCnnLstm(train_x.shape[-1])
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        loader = DataLoader(TensorDataset(torch.from_numpy(train_x), torch.from_numpy(y[train_mask])), batch_size=64, shuffle=True)
        best, best_state = math.inf, None
        for _ in range(args.epochs):
            model.train()
            for xb, yb in loader:
                prediction = model(xb); loss = nn.functional.mse_loss(prediction, yb) + ccc_loss(yb, prediction)
                optimizer.zero_grad(); loss.backward(); optimizer.step()
            model.eval()
            with torch.no_grad():
                prediction = model(torch.from_numpy(val_x))
                score = float(nn.functional.mse_loss(prediction, torch.from_numpy(y[val_mask])))
            if score < best:
                best, best_state = score, {k: v.detach().clone() for k, v in model.state_dict().items()}
        model.load_state_dict(best_state)
        model.eval()
        with torch.no_grad(): prediction = model(torch.from_numpy(test_x)).numpy()
        baseline = np.repeat(y[train_mask].mean(axis=0, keepdims=True), test_mask.sum(), axis=0)
        ridge = Ridge(alpha=1.0).fit(train_x[:, -1], y[train_mask])
        ridge_prediction = ridge.predict(test_x[:, -1])
        persistence = oracle_previous_window_baseline(y[test_mask], group_ids[test_mask], end_indices[test_mask], baseline[0])
        results.append({"testParticipant": test_id, "validationParticipant": validation_id,
                        "model": metrics(y[test_mask], prediction),
                        "globalMeanBaseline": metrics(y[test_mask], baseline),
                        "ridgeBaseline": metrics(y[test_mask], ridge_prediction),
                        "oraclePreviousWindowLabelBaseline": metrics(y[test_mask], persistence)})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"config": vars(args) | {"csv": [str(p) for p in args.csv], "output": str(args.output)}, "folds": results}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
