"""Dependency-free participant-level LOSO split policy."""


def participant_folds(ids):
    unique = sorted(set(str(value) for value in ids))
    if len(unique) < 3:
        raise ValueError("LOSO requires at least three participants (train, validation, test)")
    for test_id in unique:
        remaining = [value for value in unique if value != test_id]
        yield remaining[:-1], remaining[-1], test_id
