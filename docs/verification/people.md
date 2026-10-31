# Adding people to a hosted workspace

## Sub-features

- Settings → People: who may sign in with an emailed code, their role, when
  each person was last seen, what they spent this month, and an invite link
  per person that opens the sign-in page with the address filled in.
- The owner (or a bootstrap script on the box) names the first admin; from
  then on any admin invites, promotes, demotes and removes people from the
  card. Promotions apply at the next sign-in; removal and lost permissions
  revoke existing account sessions immediately.
- Removing someone also ends their open account streams and stream tickets.
  Independently paired devices remain under Remote access management.

- On a workspace whose members the organization's Admin manages
  (`NORDUS_ADMIN_MEMBERSHIP=portal`) the card is read-only: who has signed in,
  what they spent, and a **Manage people in Admin** link
  (`<NORDUS_ADMIN_URL>/people?workspace=<slug>`, from `GET /api/config`
  `membership.peopleUrl`). Remote access there lists signed-in devices and
  offers no pairing code, since a hosted workspace refuses them.
- Invite link: an admin creates (or rotates) one link for the whole team. A
  person who opens it enters their email and the emailed code, but gets no
  session: the request waits in the People card until an admin approves it
  (member or admin) or rejects it. Approval adds the address to the sign-in
  list; revoking the link stops it working at once, and requests already
  waiting stay waiting. At most 100 requests wait at a time. Not available on
  a hosted workspace, a Cloud home, or with Google sign-in on.
  Endpoints (admin only): `GET /api/people/join`, `POST`/`DELETE`
  `/api/people/join/link`, `POST /api/people/join/requests/:id/approve|reject`.
  Sign-in calls take an optional `joinToken`; verify answers 202
  `{pending: true, email}` instead of a session. State is kept in
  `join-requests.json` in the data folder.

## Roles, the person behind an agent, rooms for named people and direct messages

- Three roles: admin, member and guest (`signIn.admins`, `signIn.members`,
  `signIn.guests`; `NORDUS_SIGNIN_GUEST_EMAILS`; `nordus access add EMAIL
  --guest`). People shows all three with one plain line each, and approving a
  join request can make the person a guest. A guest sees only the rooms that
  list them and the agents in those rooms (name and face), cannot open an agent's
  own chat, create agents, rooms or routines, or invite, never sees "Geral", and
  can only decline an agent's request. A guest reaches an allowlist of routes
  (`GUEST_ALLOW`, `guestAllowed` in `server/request-auth.ts`) and nothing a later
  route adds; what a turn cost (`costUsd`) is removed from everything sent to a
  guest. A role change ends the person's open sessions, a session the hosted
  portal opened included.
- The person an agent answers to (`bot.owner`, "Responsável" in the bot's
  settings, shown on its profile). An admin sets it; an agent an admin creates
  starts with no owner, and an agent a member creates starts with that member.
  `ownsBot(person, bot)` in `server/people-roles.ts` is the one question asked
  everywhere and looks at the person's role now: a guest never owns anything.
  For that agent only, that person decides its approval, permission and question
  cards (in any conversation, and may create "always allow" for it), reads its use
  and sets its limit (limit, percent, tokens and runs, never the dollars spent),
  edits its look and instructions (`PATCH /api/bots/:id` and `/profile` alike),
  and is told about its requests and alerts together with the admins. Being the
  owner never makes an agent visible: visibility, audience, owner and client stay
  with the admins.
- A room can list the people who belong to it (`people`): only they and the
  admins see it; the person who opens it is kept in it and, with the admins,
  chooses who else (`PUT /api/people/rooms/:id/people`). "Geral" is for every
  member.
- Direct messages: sidebar block "Mensagens diretas", "Nova mensagem" picks a
  person from `GET /api/people/directory`. Two people, no agents, no agent turn,
  and visible only to the two: an admin gets the same "no such conversation" as a
  stranger, and no list, search, export, notification feed or live frame shows it
  to anyone else.
- @colleague: the Composer offers the room's people (or the directory) beside the
  agents and "todos"; naming someone notifies that person alone (push and app),
  never someone who cannot see the room; an agent's reply that names someone
  does the same. Agents are told the room's people by name and role in one line,
  each name cleaned of brackets and control characters. `Notification.toPersons`
  limits delivery by push, live stream and the logged feed. The workspace's spend
  alerts and the daily summary reach admins only.
- Limits: a person sends at most 30 direct lines a minute and 300 an hour (`429`),
  holds at most 100 conversations, the workspace 2,000 (`409`); a conversation
  keeps its newest lines up to a size and all of them together to another, the
  oldest going first; one notice for a burst of lines or tags to the same person in
  the same conversation every twenty seconds; a message is read for tags in its
  first 50,000 characters only. A direct message notice is live and by push but is
  not written to the notification feed; mention notices keep their newest hundred.
  The backup leaves `direct-messages.json` out.

## Driving it

```sh
pnpm exec vitest run server/people-invite.test.ts server/email-signin.test.ts src/components/PeopleSection.test.ts src/lib/session.test.ts
```

```sh
pnpm exec vitest run shared/person-mention.test.ts shared/person-mentions.test.ts server/bot-visibility.people.test.ts server/people-notify.test.ts server/direct-messages.test.ts server/people-directory.test.ts server/room-people.test.ts server/people-roles.test.ts server/people-prompt.test.ts server/people-runtime.test.ts server/people-limits.test.ts server/sender-label.test.ts server/person-identity.test.ts shared/person-identity.test.ts server/host/message-pages.test.ts server/host/room-transcript.test.ts server/notify-priority.test.ts server/account-signin-roles.test.ts server/sessions-guest.test.ts server/request-auth-people.test.ts server/config-guests.test.ts server/notification-log-persons.test.ts server/workspace-backup.test.ts server/routes/people-routes.test.ts
pnpm exec vitest run server/people.e2e.test.ts server/sender-identity.e2e.test.ts server/people-join.test.ts
pnpm exec vitest run src/components/RoleSelect.test.ts src/components/MentionMenu.people.test.ts src/components/SidebarFooterNav.guest.test.ts src/components/bot-settings/OwnerSettings.test.ts src/components/people/DirectMessageView.dom.test.ts src/components/people/DirectMessagesBlock.dom.test.ts src/components/people/RoomPeople.dom.test.ts src/components/people/RoomPeople.test.ts src/components/GroupView.test.ts src/components/GroupView.owner.test.ts src/components/RoomPerson.test.ts src/lib/message-author.test.ts src/lib/app-triggers.guest.test.ts src/lib/bot-owner.test.ts src/lib/mention-people.test.ts src/lib/room-people.test.ts src/lib/sign-in-lists.test.ts src/lib/viewer.test.ts src/state/direct-messages.test.ts src/state/people-directory.test.ts src/state/thread-navigation.direct.test.ts
```

`server/people.e2e.test.ts` boots the real server with one admin, three members
and one guest (sessions issued before boot, the fake ACP CLI asking permission on
every turn). It walks: the directory by role and what a guest is allowed to see
of it; rooms limited to named people seen only by those people and the admin,
and refused as not found for the rest (read, send, mark read, rename); a room
opener choosing the people, who is kept in, who is refused, and opening the room
again; a guest seeing only their room and its agent as a name and a face, and
refused rooms, agents, routines, invitations and other chats; a direct message
reaching only the two people's live streams, while the admin and a third member
get an empty list and "not found" on every route, and nothing about it in the
bot list, search or the notification feed; the owner of an agent changing its settings and limit (and not its
audience, owner, client or approvals mode), reading its use without the dollars,
and being refused for every other agent; the owner deciding its agent's card
while another member, and the owner of another agent, are refused; the approval
notice reaching the owner and the admin but not other members; @Bob in a room
notifying Bob and not Cal, who cannot see the room; and a guest declining but
never approving a card in their room.

`server/sender-identity.e2e.test.ts` boots the real server with sessions issued before boot: a device paired
with a code and holding the admin scope, one without it, the owner signed in with Google and a member signed in
with Google. It checks who each line of a room is stamped as (the paired admin device as the owner, with the profile's
name, address and photo; the other device under its label; the member under Google's name and photo), that a line
stored under a device's label is served as the owner once the profile has a name, what `GET /api/auth/session`
says each browser is, that a member can open the owner's photo, and that the agent reads the owner's name for the
owner's device. The cases are in `server/person-identity.test.ts`, `src/lib/message-author.test.ts` and
`src/components/GroupView.owner.test.ts`.

Each fix from the security review has a test that fails without it: an admin
session with no address of its own is nobody's in `server/people-runtime.test.ts`, the
feed, live stream and push of spend alerts in `server/people-notify.test.ts` and
`server/routes/people-routes.test.ts`, the owner check on `/profile` in `server/people-roles.test.ts`
and the e2e, a 330 KB message in `shared/person-mentions.test.ts` (under half a
second), the owner who loses a role and the owner of an admins-only agent in
`server/bot-visibility.people.test.ts` and the e2e, `costUsd` stripped for a guest in
`server/bot-visibility.people.test.ts`, names in the prompt in `server/people-prompt.test.ts` and
`server/sender-label.test.ts`, the guest allowlist in `server/request-auth-people.test.ts` and the e2e,
the limits in `server/people-limits.test.ts`, `server/direct-messages.test.ts`,
`server/routes/people-routes.test.ts` and `server/notification-log-persons.test.ts`, the
backup in `server/workspace-backup.test.ts`, the digest in `server/notify-priority.test.ts`, and
the portal session of a person who became a guest in `server/sessions-guest.test.ts`.

`server/people-join.test.ts` also approves a request as a guest and checks the
session is a guest, then that it is refused routines, new rooms and invitations.

`server/people-invite.test.ts` boots the real server with no sign-in list and a
stubbed control plane, then walks the card's own requests: the owner adds the
first admin, the admin signs in with the emailed code and invites a user,
the user's link serves the sign-in page, the user gets a chat-only cookie
session and cannot change the list, a promotion applies to the next sign-in
while the device already issued keeps its scopes, a removal refuses new
sign-ins and revokes all old account cookies and tickets, and a `@domain` entry
welcomes everyone there and nobody at a look-alike domain.

In the served UI, on a server with a public address: open Settings → People
(the profile menu at the bottom of the sidebar, then Settings), type an
address, pick a role, press Invite. The address appears in the table and the
invite link shows above it. Open that link in another browser: the sign-in
page has the address filled in and the address is gone from the address bar;
the code arrives by email; after it, the app opens as that person and the
People card (Refresh) shows their device and "Today". Remove them: they drop
from the table at once, a new sign-in for them is refused, and their current
account sessions end. Reinviting them requires a fresh sign-in; old cookies
do not regain access.

## Not proven here

The screens (the role picker, the "Responsável" picker and panel, the channel's
"Pessoas" section, the "Mensagens diretas" block and conversation, the @ list
with people) are covered by component and state tests, not by a run in a real
browser or app.

Direct messages are plain JSON in `direct-messages.json` in the data folder,
unencrypted: the server keeps them from every other person, administrators
included, but whoever can read the machine's disk can read them. A workspace
backup does not carry the file, so moving a workspace to another machine starts
with no direct messages. The notification feed keeps one read flag for the
workspace, not one for each person, and keeps no direct message notice, so after
a reload the unread mark on the conversation is the only trace.

The real emailed code comes from the control plane, so a live run needs an
address you can read. Removing the last admin is allowed and turns email
sign-in off until someone on the box, or an independently paired
administrator, adds an entry again.
