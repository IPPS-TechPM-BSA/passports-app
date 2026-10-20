import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt

from backend import auth


class TokenTests(unittest.TestCase):
    def test_token_round_trip_carries_location_and_expiry(self):
        with patch.dict(os.environ, {"JWT_SECRET": "x" * 32}, clear=True):
            token = auth.create_token("csc")
            payload = auth.decode_token(token)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["location_id"], "csc")
        expected_expiry = datetime.now(timezone.utc) + timedelta(
            hours=auth.JWT_EXPIRY_HOURS
        )
        self.assertLessEqual(
            abs(payload["exp"] - expected_expiry.timestamp()), 5,
            "token expiry should match JWT_EXPIRY_HOURS",
        )

    def test_dashboard_sessions_outlast_a_full_workday(self):
        self.assertGreaterEqual(auth.JWT_EXPIRY_HOURS, 24)

    def test_decode_rejects_expired_token(self):
        with patch.dict(os.environ, {"JWT_SECRET": "x" * 32}, clear=True):
            payload = {
                "location_id": "csc",
                "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
                "iat": datetime.now(timezone.utc),
            }
            token = jwt.encode(
                payload, auth.get_jwt_secret(), algorithm=auth.JWT_ALGORITHM
            )

            self.assertIsNone(auth.decode_token(token))


if __name__ == "__main__":
    unittest.main()
