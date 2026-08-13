import unittest

import numpy as np

from training.reliability import ccc, icc_3_1


class ReliabilityTest(unittest.TestCase):
    def test_identical_ratings_have_perfect_agreement(self):
        ratings = np.array([-1.0, -0.25, 0.5, 1.0])
        self.assertAlmostEqual(ccc(ratings, ratings), 1.0)
        self.assertAlmostEqual(icc_3_1(np.column_stack([ratings, ratings])), 1.0)


if __name__ == "__main__":
    unittest.main()
