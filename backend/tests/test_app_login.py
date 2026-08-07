import unittest
from unittest.mock import AsyncMock, patch

import bcrypt
from fastapi import FastAPI, Request

from backend import app as app_module
from backend.schemas import LoginRequest


def _test_hash(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt(rounds=4)
    ).decode("utf-8")


class LifespanPasswordHashTests(unittest.IsolatedAsyncioTestCase):
    async def test_lifespan_stores_validated_configured_hashes_in_app_state(self):
        validated_hashes = {
            "csc": _test_hash("csc-password"),
            "bookstore": _test_hash("bookstore-password"),
        }
        fake_db = object()

        async def fake_get_db():
            yield fake_db

        test_app = FastAPI()
        with patch.object(app_module, "require_jwt_secret"), patch.object(
            app_module, "run_migrations", new_callable=AsyncMock
        ) as run_migrations, patch.object(
            app_module,
            "seed_database",
            new_callable=AsyncMock,
            return_value=validated_hashes,
        ) as seed_database, patch.object(app_module, "get_db", fake_get_db):
            async with app_module.lifespan(test_app):
                self.assertIs(
                    test_app.state.location_password_hashes,
                    validated_hashes,
                )

        run_migrations.assert_awaited_once_with()
        seed_database.assert_awaited_once_with(fake_db)


class LoginPasswordHashTests(unittest.IsolatedAsyncioTestCase):
    async def test_app_state_hash_selects_location_without_database(self):
        test_app = FastAPI()
        test_app.state.location_password_hashes = {
            "csc": _test_hash("csc-password"),
            "bookstore": _test_hash("bookstore-password"),
        }
        request = Request({"type": "http", "app": test_app})

        with patch.object(
            app_module, "create_token", return_value="bookstore-token"
        ) as create_token, patch.object(app_module, "get_db") as get_db:
            response = await app_module.login(
                LoginRequest(password="bookstore-password"),
                request,
            )

        self.assertEqual(response.location_id, "bookstore")
        self.assertEqual(response.token, "bookstore-token")
        create_token.assert_called_once_with("bookstore")
        get_db.assert_not_called()

    def test_login_route_declares_no_database_dependency(self):
        login_route = next(
            route
            for route in app_module.app.routes
            if getattr(route, "path", None) == "/api/auth/login"
        )

        self.assertEqual(login_route.dependant.dependencies, [])


if __name__ == "__main__":
    unittest.main()
