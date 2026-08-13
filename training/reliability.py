#!/usr/bin/env python3
"""Compute CCC and ICC(3,1) for repeated or second-rater schema 2 exports."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

KEYS = ["participant_id", "stimulus_id", "trial_id", "sample_index"]


def ccc(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    denominator = np.var(a) + np.var(b) + (np.mean(a) - np.mean(b)) ** 2
    return float(2 * np.mean((a - np.mean(a)) * (b - np.mean(b))) / denominator) if denominator else 0.0


def icc_3_1(values):
    """Two-way mixed, consistency, single-measure ICC."""
    values = np.asarray(values, float)
    n, k = values.shape
    row_mean = values.mean(axis=1)
    grand = values.mean()
    ms_rows = k * np.sum((row_mean - grand) ** 2) / (n - 1)
    residual = values - row_mean[:, None] - values.mean(axis=0)[None, :] + grand
    ms_error = np.sum(residual ** 2) / ((n - 1) * (k - 1))
    return float((ms_rows - ms_error) / (ms_rows + (k - 1) * ms_error))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("first", type=Path)
    parser.add_argument("second", type=Path)
    parser.add_argument("--output", type=Path, default=Path("training/reliability.json"))
    args = parser.parse_args()
    first = pd.read_csv(args.first, dtype={"participant_id": str})
    second = pd.read_csv(args.second, dtype={"participant_id": str})
    merged = first.merge(second, on=KEYS, suffixes=("_first", "_second"), validate="one_to_one")
    result = {"matchedSamples": len(merged), "dimensions": {}}
    for dimension in ("valence_raw", "arousal_raw"):
        pair = merged[[f"{dimension}_first", f"{dimension}_second"]].dropna().to_numpy()
        if len(pair) < 3:
            raise ValueError(f"At least three matched {dimension} samples are required")
        result["dimensions"][dimension] = {"ccc": ccc(pair[:, 0], pair[:, 1]), "icc_3_1": icc_3_1(pair)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
