# Runs INSIDE the home_gateway container (fed on stdin by run.sh).
# Prints a 15-minute session JWT for the first active user to stdout.
# run.sh redirects it straight into a private temp file; never print it anywhere else.
import asyncio
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from core.security import ALGORITHM, SECRET_KEY
from shared.database.core import AsyncSessionLocal
from shared.database.models import User


async def main() -> None:
    async with AsyncSessionLocal() as s:
        uid = (await s.execute(select(User.id).where(User.is_active == True).limit(1))).scalar_one()  # noqa: E712
    exp = datetime.now(timezone.utc) + timedelta(minutes=15)
    print(jwt.encode({"sub": str(uid), "exp": exp}, SECRET_KEY, algorithm=ALGORITHM), end="")


asyncio.run(main())
