"""NurtureHUB load-test scenarios (Locust).

Two user classes, selected with the standard locust class picker
(`locust ... JourneyUser` / `ExamHerdUser`) or run together with weights:

* JourneyUser  — the full learner lifecycle, request-for-request identical to
  the React frontend: login -> /users/me -> dashboard -> stages -> per-tutorial
  progress beats/complete/quiz -> tests+results -> instructions -> start ->
  proctoring WebSocket event stream -> bulk submit -> result detail -> mother
  + child registration. Plus the 15s notification poll that every authenticated
  page runs. Timing compressed by NH_TIME_SCALE, request counts unchanged.

* ExamHerdUser — the thundering-herd profile: a cohort of NH_HERD_SIZE users
  (tutorials pre-completed via seed_accounts.py --complete-tutorials) all start
  the same exam, stream proctoring events, then fire their submits at the SAME
  instant through a synchronization barrier.

Accounts are pre-seeded by seed_accounts.py as loadtest_{n}@nhload.org.
"""
import itertools
import os
import random
import time

import gevent
import jwt as pyjwt
from locust import FastHttpUser, events, task

import config
from ws_client import CandidateSocket

# ---------------------------------------------------------------------------
# account allocation — each VU takes a unique pre-seeded account
# ---------------------------------------------------------------------------
_counter = itertools.count(start=1)


def _worker_offset(environment) -> int:
    runner = getattr(environment, "runner", None)
    idx = getattr(runner, "worker_index", None)
    if idx is None:
        idx = int(os.environ.get("NH_WORKER_INDEX", "0"))
    return idx * config.ACCOUNTS_PER_WORKER


def next_account(environment) -> str:
    n = _worker_offset(environment) + next(_counter)
    if n > config.ACCOUNT_COUNT:
        n = ((n - 1) % config.ACCOUNT_COUNT) + 1
    return config.ACCOUNT_EMAIL_FMT.format(n=n)


def scaled(seconds: float) -> float:
    return max(seconds * config.TIME_SCALE, 0.005)


def think(lo: float, hi: float | None = None):
    gevent.sleep(scaled(random.uniform(lo, hi if hi is not None else lo)))


# ---------------------------------------------------------------------------
# herd barrier — align cohort submits to one instant (in-process)
# ---------------------------------------------------------------------------
class Barrier:
    def __init__(self, size: int, max_wait: float, lead: float):
        self.size, self.max_wait, self.lead = size, max_wait, lead
        self._event = gevent.event.Event()
        self._arrivals = 0
        self._first_arrival = None
        self._release_at = None

    def wait(self):
        self._arrivals += 1
        if self._first_arrival is None:
            self._first_arrival = time.monotonic()
            gevent.spawn(self._timeout_release)
        if self._arrivals >= self.size:
            self._release()
        self._event.wait()
        # absolute-time release => all waiters wake and sleep to the same instant
        gevent.sleep(max(0.0, self._release_at - time.monotonic()))

    def _timeout_release(self):
        gevent.sleep(self.max_wait)
        self._release()

    def _release(self):
        if not self._event.is_set():
            self._release_at = time.monotonic() + self.lead
            self._event.set()


HERD_BARRIER = Barrier(config.HERD_SIZE, config.HERD_MAX_WAIT, config.HERD_LEAD)


# ---------------------------------------------------------------------------
# shared client behavior
# ---------------------------------------------------------------------------
class NurtureHubUser(FastHttpUser):
    abstract = True
    host = config.HOST
    network_timeout = 60.0
    connection_timeout = 60.0

    email: str = ""
    token: str = ""
    socket: CandidateSocket | None = None
    _pollers: list

    def on_start(self):
        self._pollers = []
        self.email = next_account(self.environment)
        if not self.authenticate():
            raise Exception(f"auth failed for {self.email}")
        if config.NOTIF_POLL_ENABLED:
            self._pollers.append(gevent.spawn(self._notification_poll))

    def on_stop(self):
        if self.socket is not None:
            self.socket.close()
        for g in self._pollers:
            g.kill(block=False)

    # -- auth ----------------------------------------------------------------
    def authenticate(self) -> bool:
        if config.PREMINT_TOKENS:
            self.token = pyjwt.encode(
                {"sub": self.email, "exp": int(time.time()) + 24 * 3600},
                config.DEV_JWT_SECRET, algorithm="HS256",
            )
        else:
            with self.rest("POST", "/api/auth/login",
                           json={"email": self.email, "password": config.ACCOUNT_PASSWORD},
                           name="/api/auth/login") as resp:
                if resp.js is None or "access_token" not in (resp.js or {}):
                    return False
                self.token = resp.js["access_token"]
        # AuthContext.refreshUser fires immediately after login
        self.get("/api/users/me")
        return True

    @property
    def auth(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    # -- tiny helpers ----------------------------------------------------------
    def get(self, path: str, name: str | None = None, params: dict | None = None):
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            path_q = f"{path}?{qs}"
        else:
            path_q = path
        with self.client.get(path_q, headers=self.auth,
                             name=name or path, catch_response=True) as resp:
            if resp.status_code >= 400:
                resp.failure(f"HTTP {resp.status_code}")
                return None
            try:
                return resp.json()
            except ValueError:
                return None

    def post(self, path: str, body=None, name: str | None = None, ok=(200, 201)):
        with self.client.post(path, json=body, headers=self.auth,
                              name=name or path, catch_response=True) as resp:
            if resp.status_code not in ok:
                resp.failure(f"HTTP {resp.status_code}: {resp.text[:120]}")
                return None
            try:
                return resp.json()
            except ValueError:
                return {}

    # -- background notification poll (every authenticated page does this) ----
    def _notification_poll(self):
        while True:
            gevent.sleep(scaled(config.NOTIF_POLL_SECONDS))
            self.get("/api/notifications", name="/api/notifications [15s poll]")

    # -- shared journey fragments ----------------------------------------------
    def take_test(self, test_id: int) -> bool:
        """instructions -> start -> WS events -> barrier(optional) -> submit -> results"""
        self.get(f"/api/tests/{test_id}", name="/api/tests/{id}")
        think(3, 10)  # reading instructions
        started = self.post(f"/api/tests/{test_id}/start", body=None,
                            name="/api/tests/{id}/start")
        if not started or "attempt_id" not in started:
            return False
        attempt_id = started["attempt_id"]
        questions = started.get("questions", [])

        sock = None
        if config.WS_ENABLED:
            sock = CandidateSocket(self.environment, config.WS_BASE, attempt_id, self.token)
            if sock.connect(heartbeat_interval=scaled(config.WS_HEARTBEAT_SECONDS)):
                self.socket = sock
            else:
                sock = None  # proctoring is optional; REST flow continues

        answers = []
        clock_start = time.monotonic()
        for i, q in enumerate(questions, start=1):
            if sock:
                sock.send_event("QUESTION_VIEWED",
                                {"question_id": q["id"], "question_number": i})
            lo, hi = config.SECONDS_PER_QUESTION
            spent = random.uniform(lo, hi)
            gevent.sleep(scaled(spent))
            option = random.choice(q["options"])["id"] if q.get("options") else None
            if sock:
                sock.send_event("ANSWER_SELECTED", {
                    "question_id": q["id"],
                    "selected_option_id": option,
                    "time_on_question_ms": int(spent * 1000),
                })
                if random.random() < 0.10:
                    sock.send_event("TAB_SWITCH")
                    sock.send_event("WINDOW_FOCUS")
            answers.append({"question_id": q["id"],
                            "selected_option_id": option,
                            "is_marked_for_review": False})
            if sock and sock.force_submit_requested:
                break

        if sock:
            sock.send_event("TEST_SUBMITTED")

        if isinstance(self, ExamHerdUser):
            HERD_BARRIER.wait()  # << the thundering herd fires here

        result = self.post(f"/api/tests/attempts/{attempt_id}/submit",
                           body={"answers": answers,
                                 "time_used_seconds": int(time.monotonic() - clock_start)},
                           name="/api/tests/attempts/{id}/submit")
        if sock:
            sock.close()
            self.socket = None
        if result is None:
            return False
        think(2, 6)
        self.get("/api/results")
        self.get(f"/api/results/{attempt_id}", name="/api/results/{attempt_id}")
        return True


# ---------------------------------------------------------------------------
# scenario 1: the full learner journey (ramp profile)
# ---------------------------------------------------------------------------
class JourneyUser(NurtureHubUser):
    weight = 1

    @task
    def full_journey(self):
        # dashboard
        self.get("/api/dashboard")
        think(3, 8)

        # tutorials list
        stages = self.get("/api/stages") or []
        tutorial_stages = [s for s in stages if s.get("stage_type") == "tutorials"]

        for stage in tutorial_stages:
            for tut in stage.get("tutorials", []):
                if tut.get("is_completed"):
                    continue
                self._play_tutorial(tut)

        # tests page fires /tests and /results in parallel
        g1 = gevent.spawn(self.get, "/api/tests")
        g2 = gevent.spawn(self.get, "/api/results")
        gevent.joinall([g1, g2])
        tests = g1.value or []

        for t in tests:
            if not t.get("is_locked") and not t.get("is_passed") \
                    and t.get("attempts_count", 0) < t.get("max_attempts", 3):
                self.take_test(t["id"])
                think(5, 15)

        if config.DO_MOTHER_FORMS:
            self._register_mother_and_child()

        if not config.LOOP_JOURNEY:
            # journey done: settle into idle authenticated presence (notification
            # poll continues in the background), mirroring a logged-in dashboard tab
            while True:
                gevent.sleep(scaled(60))
                self.get("/api/dashboard", name="/api/dashboard [idle refresh]")

    # -- tutorial playback ----------------------------------------------------
    def _play_tutorial(self, tut: dict):
        tid = tut["id"]
        # player page mounts -> refetches the full stages payload
        self.get("/api/stages", name="/api/stages [player mount]")
        duration = config.VIDEO_SECONDS
        watched = 0.0
        while watched < duration * 0.92:
            gevent.sleep(scaled(config.BEAT_INTERVAL_SECONDS))
            watched += config.BEAT_INTERVAL_SECONDS
            beat = self.post(f"/api/tutorials/{tid}/progress",
                             body={"position_seconds": watched,
                                   "watched_delta_seconds": config.BEAT_INTERVAL_SECONDS,
                                   "duration_seconds": duration},
                             name="/api/tutorials/{id}/progress")
            if beat and beat.get("is_completed"):
                break
        # video ended
        self.post(f"/api/tutorials/{tid}/complete", body=None,
                  name="/api/tutorials/{id}/complete")
        self.get("/api/stages", name="/api/stages [refetch]")

        # quiz modal
        quiz = self.get(f"/api/tutorials/{tid}/quiz", name="/api/tutorials/{id}/quiz")
        if quiz and quiz.get("quiz_available") and quiz.get("questions"):
            think(5, 20)
            answers = [{"question_id": q["id"],
                        "selected_option_id": random.choice(q["options"])["id"]}
                       for q in quiz["questions"]]
            self.post(f"/api/tutorials/{tid}/quiz/submit", body={"answers": answers},
                      name="/api/tutorials/{id}/quiz/submit")
        self.get("/api/stages", name="/api/stages [quiz close]")

    # -- mothers module ---------------------------------------------------------
    def _register_mother_and_child(self):
        self.get("/api/mothers")
        # form mount: 3 parallel metadata fetches
        gs = [gevent.spawn(self.get, "/api/metadata/states"),
              gevent.spawn(self.get, "/api/metadata/education-levels"),
              gevent.spawn(self.get, "/api/metadata/education-fields")]
        gevent.joinall(gs)
        states = gs[0].value or []
        think(10, 30)  # filling step 1

        district_id = block_id = hwc_id = phc_id = None
        if states:
            state_id = states[0]["id"]
            districts = self.get("/api/metadata/districts",
                                 params={"state_id": state_id},
                                 name="/api/metadata/districts?state_id") or []
            if districts:
                district_id = districts[0]["id"]
                blocks = self.get("/api/metadata/blocks",
                                  params={"district_id": district_id},
                                  name="/api/metadata/blocks?district_id") or []
                if blocks:
                    block_id = blocks[0]["id"]
                    hwcs = self.get("/api/metadata/hwcs",
                                    params={"block_id": block_id},
                                    name="/api/metadata/hwcs?block_id") or []
                    if hwcs:
                        hwc_id = hwcs[0]["id"]
                        phcs = self.get("/api/metadata/phcs",
                                        params={"hwc_id": hwc_id},
                                        name="/api/metadata/phcs?hwc_id") or []
                        if phcs:
                            phc_id = phcs[0]["id"]
        else:
            state_id = None
        think(20, 60)  # filling the rest of the form

        n = random.randint(100000, 999999)
        mother = self.post("/api/mothers", body={
            "mother_name": f"LT Mother {n}",
            "mother_age": random.randint(19, 38),
            "mobile": f"9{random.randint(100000000, 999999999)}",
            "state_id": state_id, "district_id": district_id,
            "taluk_id": block_id, "hwc_id": hwc_id, "phc_id": phc_id,
            "village": "Loadtest Village",
            "social_category": "General",
            "nutrition_course": False,
            "source_ratings": [
                {"source": s, "trust": random.randint(1, 5),
                 "willingness": random.randint(1, 5)}
                for s in ["ASHA", "Anganwadi", "Doctor", "Family",
                          "Friends", "TV", "Internet"]
            ],
        })
        self.get("/api/mothers", name="/api/mothers [after create]")
        if not mother or "id" not in mother:
            return
        mid = mother["id"]
        g1 = gevent.spawn(self.get, f"/api/mothers/{mid}", "/api/mothers/{id}")
        g2 = gevent.spawn(self.get, f"/api/mothers/{mid}/children",
                          "/api/mothers/{id}/children")
        gevent.joinall([g1, g2])
        think(15, 40)  # filling the child form
        self.post(f"/api/mothers/{mid}/children", body={
            "child_name": f"LT Child {n}",
            "gender": random.choice(["male", "female"]),
            "birth_weight": round(random.uniform(2.2, 3.8), 1),
            "bf_within_one_hour": random.random() < 0.7,
            "birth_conditions": [],
        }, name="/api/mothers/{id}/children [create]")
        g1 = gevent.spawn(self.get, f"/api/mothers/{mid}", "/api/mothers/{id}")
        g2 = gevent.spawn(self.get, f"/api/mothers/{mid}/children",
                          "/api/mothers/{id}/children")
        gevent.joinall([g1, g2])


# ---------------------------------------------------------------------------
# scenario 2: thundering-herd exam submit
# ---------------------------------------------------------------------------
class ExamHerdUser(NurtureHubUser):
    # run.py always selects exactly one class by name, so weight only matters
    # if both classes are run together (don't — the herd barrier expects a
    # homogeneous cohort).
    weight = 1

    @task
    def herd_exam(self):
        # tests page (parallel pair like the real client)
        g1 = gevent.spawn(self.get, "/api/tests")
        g2 = gevent.spawn(self.get, "/api/results")
        gevent.joinall([g1, g2])
        if not self.take_test(config.HERD_TEST_ID):
            gevent.sleep(5)
            return
        # cohort member is done — stay connected, keep polling notifications
        while True:
            gevent.sleep(scaled(60))
            self.get("/api/dashboard", name="/api/dashboard [idle refresh]")


@events.quitting.add_listener
def _(environment, **kw):
    """Non-zero exit code if the run saw failures — used by run.py."""
    if environment.stats.total.fail_ratio > 0.5:
        environment.process_exit_code = 2
