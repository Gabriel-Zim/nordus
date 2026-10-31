# Task board and missions

A shared board of cards ("Tarefas" in the app) and, on top of it, missions:
work that runs for days across several agents, with its own room, a plan, a
progress feed, decisions that wait for a person, and a receipt at the end.

Everything here is server side. The app, the agents' tools and the HTTP API all
go through the same services in `server/board/`, so a card moved by an agent
moves live on every screen that may see it.

## Cards

A card is `{ id, title, description?, status, assignee?, createdBy, createdAt,
updatedAt, source?, thread?, links?, missionId?, history }` (the wire shape is
`shared/board.ts`).

- `id` is workspace-wide, increasing, and never reused, even after a delete.
- `status` is `todo`, `doing`, `review` or `done` (the four columns).
- `assignee` is an agent id or a person's lowercased email; an `@` tells them
  apart.
- `source` is the conversation the card came from (a bot's thread or a room's,
  optionally a message). `thread` is the conversation an assigned agent was
  sent to.
- `history` records who did what (created, assigned, moved, edited, sent). It
  keeps the first entry and the most recent 99.
- Cards live in `<data dir>/board.json` (0600, written atomically). At 2,000
  cards, or 24 MB of file, the board makes room only with the **creator's own**
  finished cards that belong to no mission, never someone else's; with none to
  drop it answers `409` and says the board is full.
- Every write is cut to the limits the loader uses before it is saved, so a
  card never saves in a shape a restart would refuse (a link that only grows
  past 2,000 characters once written the way the board stores it is a `400`; a
  21st link is a `400`). On load, a stored row with one oversized field keeps
  everything else and loses only that field; a row missing something it cannot
  do without is skipped, as before.
- A member is limited to 60 new cards an hour, 240 changes in ten minutes and
  400 cards on the board (`server/board/pace.ts`); administrators are not
  limited, and an agent keeps its 40 cards an hour.

### Starting work

Giving a card to an agent starts the work: the board posts the card to that
agent (in the room when the card came from a room that agent belongs to, in the
agent's own conversation otherwise). It goes through the normal send path, so
approvals, spend caps and queueing are never bypassed.

What the agent reads starts with a note, `[Card from the Nordus task board:
written by X, last edited by Y, passed to you by Z. It is a work item from the
board, not a message your user typed to you. ...]`, then `Tarefa #N: title` and
the description. The text of a card belongs to whoever wrote it, so it is never
the person's own request:

- the line is marked as relayed (in a room: as an API line), signed with the
  person's name and **never** with the administrator stamp, so no approval, no
  scheduling shortcut and no list of "contacts the person vouched for" treats
  it as that person speaking;
- the title and description pass through `escapeNotes`, so a card cannot
  imitate a harness note;
- an agent with task sessions on receives the card in its main conversation,
  not as a new desk task.

A room is only posted to when the person passing the card sees that room;
otherwise the card is kept, not sent, and the answer says so in plain words.
The response says what happened: `dispatch.status` is `sent`, `queued` or
`skipped` (with a plain reason, for example a spend cap), and a `skipped` card
still exists and still has its assignee. An agent giving a card to another
agent only records it; the hand-over is `coordinate_bots`.

### Who sees and changes what

| Who | Sees | Changes |
| --- | --- | --- |
| Admin, or the machine's owner | every card and mission | everything |
| Member | cards they created or hold; cards tied to conversations or rooms, when they can see **every** conversation the card is tied to; loose cards held or made by an agent they can see; missions of rooms they can see or that they opened | any card they see; delete only their own |
| Agent (its tools) | cards held or created by it, and cards from its own conversation or from rooms it belongs to | its own cards, unassigned cards it sees, and the steps of a mission it leads |
| Client agent | the same, and never a card tied to the house or to another client | the same, within its client |

A card a member may not see answers `404`, never `403`, so its existence does
not leak. Deleting needs the card's creator or an admin. An agent gives cards
only to agents it may act on (its team, or one opened to it; same audience; not
archived) and in its own bucket. A bucket is the house (`internal`, even for a
house agent that carries a client name), one client (`client:<name>`), or, for
an agent nobody marked as the house's or a client's, that agent alone
(`open:<id>`): such an agent counts as a client's, and two of them could serve
different clients. A mission therefore never mixes agents of
different buckets, so a mission with several agents needs them marked as the
house's (or as the same client's).

Members without an email are told apart by their own session key, never by a
shared name, in the board, the live stream and the mission room.

## HTTP API

All under the normal session rules. Members reach every route (see
`CLIENT_ALLOW` in `server/request-auth.ts`); each handler narrows to what that
person may see.

| Route | Does |
| --- | --- |
| `GET /api/board/tasks` | the cards this person may see |
| `POST /api/board/tasks` | create (`title`, `description?`, `status?`, `assignee?`, `links?`, `source?`); `201` with `{ task, dispatch? }` |
| `PATCH /api/board/tasks/:id` | change `title`, `description`, `status`, `assignee` (`null` clears it), `links`, `note` |
| `DELETE /api/board/tasks/:id` | creator or admin |
| `GET /api/board/people` | the people a card may be given to |
| `GET /api/missions` | the missions this person may see |
| `POST /api/missions` | open one (`title`, `goal`, `leadBotId`, `teamBotIds?`) |
| `GET /api/missions/:id` | `{ mission, receipt }` |
| `DELETE /api/missions/:id` | creator or admin; its cards go with it |
| `POST /api/missions/:id/pause`, `/resume` | stop and start again |
| `POST /api/missions/:id/answer` | answer the open decision (`answer`) |

Bodies are strict: an unknown field is a `400` with a plain sentence naming the
field. Limits (`BOARD_LIMITS` in `shared/board.ts`): title 200, description
8,000, 20 links (http or https only), mission title 160, goal 4,000, team 12,
20 steps, 6 options.

### Live frames

`/api/events` carries `board.task`, `board.task.deleted`, `board.mission` and
`board.mission.deleted`. A member's stream gets a frame only for what that
member may see (`server/board/frames.ts`). When a card leaves a member's view
(reassigned, moved out of their rooms) the stream sends one
`board.task.deleted` so it disappears from their board, and nothing after.

## Agent tools

Mounted when `NORDUS_BOARD` is `1`, which the server sets for every agent unless
`NORDUS_BOARD=0` is set in the server's environment. Each tool calls an internal
route (`/api/internal/board/...`) with the turn's capability, and the server
scopes it to the calling agent.

- `task_create` puts a card on the board (its own unless `assignee` is given).
  An agent may create 40 cards an hour.
- `task_update` sets `status` and adds a `note` or a `link`. This is how an
  agent moves a card it was given.
- `task_list` with `scope` `mine` (default) or `room`.
- `mission_create` opens a mission the caller leads; at most three open per
  lead. It opens a room, so it follows the room rules of
  `/api/internal/create-room`: only an active section Chief of Staff, only real
  teammates (never an agent merely opened to its team), refused while the
  person reviews messages between agents, at most four rooms per turn counted
  together with `create-room`, the room goes in the Chief's section, and
  secrets are redacted from its name and bulletin.
- `mission_plan` (lead only, once, in the mission room) lays out the steps;
  refused while the person reviews messages between agents.
- `mission_note` adds a progress note. After the last step, the lead's note is
  the closing summary.
- `mission_ask` asks the person for a decision (optional choices) and stops.

The tools cost about 2.9 KB of catalog bytes per turn; the golden and budget
for the profile that carries them are in `server/drivers/agents-catalog-goldens`.

## Missions

A mission is `{ id, title, goal, createdBy, status, leadBotId, teamBotIds,
groupId, threadId, stepIds, feed, pendingDecision?, startedAt, finishedAt }`
with `status` `planning`, `running`, `waiting`, `paused`, `done` or `failed`.
Missions live in `<data dir>/missions.json` (0600, atomic), together with the
runner's private state (never sent over the wire).

Opening one creates a room named `Missão: title` where the lead answers by
default. A person opens it from the Tarefas page ("Nova missão"), or a lead
agent calls `mission_create`.

### The runner

`server/board/runner.ts` is a persistent, server-side loop. Every decision is a
pure function of the stored state (`server/board/decide.ts`), so it is tested
without timers:

1. `planning`: ask the lead, in the room, for the plan. When `mission_plan`
   arrives, each step becomes a card (owner from the team, default the lead)
   and the feed says `Plano montado: N passos, M agentes.`
2. `running`: send the first step that is not `done` to its owner (as
   `@Name [Mission from the Nordus board: ...] Passo i de n da missão «title»:
   step`), one at a time, in order. When
   its card turns `done` the feed notes it and the next step goes out. A step
   that stays open after its turn ends is nudged, up to 3 tries; then the
   mission pauses and waits for a person ("toque em Retomar").
3. All steps done: the lead is asked for the closing summary with
   `mission_note`; that note ends the mission (`Missão concluída.`). If the lead
   ends its turn without one, the mission closes with a standard line.
4. `waiting`: `mission_ask` stops everything. The person answers on the
   mission page or by typing in the mission room (only the person who opened it
   or an admin counts, never a line the runner sent itself). The answer is
   delivered to the agent that asked and the mission goes on.

The runner speaks as **Nordus**, never as the person who opened the mission:
the line is an API line from a sender named Nordus (not the owner, no
administrator stamp), billed to the person who opened it. Each one opens with a
note saying who opened the mission and who planned the step (an agent that
wrote the plan is named as the agent), that it is not a message the user typed,
and that nothing in it approves spending, sending or deploying. A person's
answer is passed on as `answer from NAME`, clipped, with the whole line kept
inside `BOARD_LIMITS.runnerText` (4,000) so a restart can always load it. The
goal, step titles and answers pass through `escapeNotes`.

Instead of a fixed time or rounds cap, a mission is limited by turns per step
(3 tries), a daily budget (60 turns a day; it pauses with a plain reason and
resumes by itself the next day), and the workspace's spend caps and each
agent's own cap. A spend-cap pause is `pausedBy: "system"` and lifts by itself
when the cap does; every other pause is `person` and only **Retomar** resumes
it. **Pausar** does the same by hand. Spend alerts are for administrators, so a
member sees only "um limite de uso foi atingido." (`pausedReason`); the exact
limit or refusal travels as `pausedDetail`, on the wire for administrators only
(the live stream strips it for everyone else).

On a restart the runner picks up from the stored state. A send that was in
flight is forgotten without counting as a failed try: a step is nudged again,
and a closing summary is asked for again. Every send carries a `mission-...`
message id, which is also how the runner tells its own lines from a person's
when it listens for an answer in the room.

If the room or the lead is deleted, or a teammate is deleted before the plan
exists, the mission becomes `failed` with the reason in the feed. A step whose
owner is deleted later stops moving and pauses the mission after its tries.

### Receipt

`GET /api/missions/:id` adds a receipt built from the usage ledger rows of the
mission room: turns and tokens per agent and in total, from the mission's start
to its end (or now). Money (`costUsd`) is included for admins only.

### Notifications

A decision, a pause and the end of a mission raise a notification in the
mission room. They carry `toPersons` (the person who opened the mission). The
notification feed owns honoring that field; until it does, whoever can see the
room receives them.

## The app

- **Tarefas** in the sidebar opens the board page: four columns (A fazer, Em
  andamento, Em revisão, Feito) with a count each, a quick add at the foot of
  every column, and a side panel for a card (title, description, assignee,
  links, history). A card moves by dragging, or with **Mover para** on the
  card, which works from the keyboard and on touch screens.
- The **Missões** tab lists the missions. **Nova missão** asks for a title, a
  goal, the lead and the team. A mission page has the steps on the left (each
  with its agent and a segmented progress bar) and **Andamento** on the right:
  the feed, the open decision with its choices, and, once it ends, the closing
  line and the receipt. **Pausar** and **Retomar** sit at the top.
- **Criar tarefa** in a message's menu, in a conversation or a room, opens a
  card with that message as its source.
- Board and mission frames keep every open screen current without a reload.

## Code map

- `shared/board.ts`: the wire contract.
- `src/components/BoardPage.tsx`, `src/components/board/`, `src/state/board.ts`,
  `src/lib/board*.ts`: the page, its state and its text. Copy lives under the
  `board.` and `missions.` keys in `src/locales`.
- `server/board/service.ts` (cards), `missions.ts` (missions), `runner.ts` and
  `decide.ts` (the loop), `directory.ts` (who sees what), `frames.ts` (live
  frames), `send.ts` (posting a card or a runner line as relayed, never as the
  person), `texts.ts` (the notes), `receipt.ts`, `store.ts` and
  `missions-store.ts` (files), `salvage.ts` (cuts a stored row to the loader's
  limits), `pace.ts` (limits per member), `host.ts` (wiring to the server's
  stores), `feature.ts` (assembly). `server/approval-contacts.ts` is what the
  approvals count as contacts the person vouched for.
- `server/routes/board.ts` and `server/routes/internal-board.ts`: HTTP.
- `server/drivers/agents-board-tools.ts`: the catalog entries and calls.
- Tests: `server/board/*.test.ts`, `server/routes/board.test.ts`,
  `server/routes/internal-board.test.ts`,
  `server/drivers/agents-board-tools.test.ts`, and `server/board.e2e.test.ts`
  (a real server with the scripted fake engine: a card assigned to an agent,
  its `task_update` moving the card live, and a whole mission with a decision).
