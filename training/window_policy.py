"""Pure quality gates and within-video baselines used by LOSO training."""
from __future__ import annotations

import numpy as np


def longest_missing_run(valid: np.ndarray) -> int:
    longest = current = 0
    for present in valid:
        current = 0 if present else current + 1
        longest = max(longest, current)
    return longest


def window_passes_quality(sample_indices: np.ndarray, valid_face: np.ndarray,
                          minimum_valid_face_rate: float, maximum_consecutive_missing: int) -> bool:
    return (
        len(sample_indices) > 0
        and np.all(np.diff(sample_indices) == 1)
        and valid_face.mean() >= minimum_valid_face_rate
        and longest_missing_run(valid_face) <= maximum_consecutive_missing
    )


def oracle_previous_window_baseline(target: np.ndarray, group_ids: np.ndarray,
                                    end_indices: np.ndarray, fallback: np.ndarray):
    """Uses the previous observed test label, but never crosses a video boundary."""
    prediction = np.empty_like(target)
    for group_id in np.unique(group_ids):
        positions = np.flatnonzero(group_ids == group_id)
        positions = positions[np.argsort(end_indices[positions])]
        prediction[positions[0]] = fallback
        if len(positions) > 1:
            prediction[positions[1:]] = target[positions[:-1]]
    return prediction
