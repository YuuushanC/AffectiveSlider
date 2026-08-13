import unittest

from training.loso_split import participant_folds


class LosoSplitTest(unittest.TestCase):
    def test_each_participant_is_held_out_once_without_leakage(self):
        folds = list(participant_folds(["003", "001", "002", "001"]))
        self.assertEqual({fold[2] for fold in folds}, {"001", "002", "003"})
        for train, validation, test in folds:
            self.assertFalse(set(train) & {validation, test})
            self.assertNotEqual(validation, test)

    def test_requires_independent_train_validation_and_test_subjects(self):
        with self.assertRaises(ValueError):
            list(participant_folds(["001", "002"]))


if __name__ == "__main__":
    unittest.main()
