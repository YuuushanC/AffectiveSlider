import unittest

import numpy as np

from training.window_policy import oracle_previous_window_baseline, window_passes_quality


class WindowPolicyTest(unittest.TestCase):
    def test_rejects_discontinuous_or_locally_missing_windows(self):
        indices = np.arange(40)
        self.assertTrue(window_passes_quality(indices, np.ones(40, dtype=bool), 0.95, 2))
        discontinuous = indices.copy(); discontinuous[20:] += 1
        self.assertFalse(window_passes_quality(discontinuous, np.ones(40, dtype=bool), 0.95, 2))
        too_many_missing = np.ones(40, dtype=bool); too_many_missing[10:13] = False
        self.assertFalse(window_passes_quality(indices, too_many_missing, 0.95, 2))

    def test_oracle_baseline_resets_at_every_video_boundary(self):
        target = np.array([[1.0, 1.0], [2.0, 2.0], [-1.0, -1.0], [-2.0, -2.0]])
        groups = np.array(["video-a", "video-a", "video-b", "video-b"])
        result = oracle_previous_window_baseline(target, groups, np.array([10, 20, 10, 20]), np.array([0.0, 0.0]))
        np.testing.assert_array_equal(result, [[0, 0], [1, 1], [0, 0], [-1, -1]])


if __name__ == "__main__":
    unittest.main()
