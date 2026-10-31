# Conversational first run

In simple mode the first run is a guided conversation: company, what the
company does, bring your agents, agents and AI, tools, team (only where a link
to this server can reach a coworker), then a closing summary. A rail on the
left shows each step as done with a short answer, skipped, or waiting, with
"N steps left" and a progress bar. Each step offers suggested answers as chips,
free text, Continue and Skip this step.

Hosted workspaces, advanced mode and the replay from Settings keep the
existing beat-by-beat `WelcomeFlow` (see [Welcome flow](onboarding.md)).
`chatOnboardingDue` in `src/lib/onboarding-chat.ts` makes that decision, and
`WelcomeGate` is the only place that calls it.

What a person can do in it:

- Name the company. It is saved as `profile.company` in `config.json` and can
  be changed later in Settings, Profile.
- Say what the company does. The text is added to the General team's shared
  instructions as a small section, replaced (not repeated) when written again,
  and never cuts what the person already wrote.
- Bring skills and tools from another assistant (the existing import flow).
- Get a starter team proposed from the business, rename or uncheck agents, and
  build the checked ones. When no AI is connected the step asks for one first.
- Connect apps from the catalog with the same call the Apps screen makes.
- Leave at any step ("Skip all" or Escape). Progress survives a reload.

## Checks

```sh
pnpm exec vitest run src/lib/onboarding-chat.test.ts src/lib/onboarding-chat-actions.test.ts src/components/onboarding/chat/ChatOnboarding.test.ts src/components/CompanyField.test.ts src/components/ProfileSettings.test.ts src/components/onboarding/WelcomeGate.test.ts src/lib/starter-team.test.ts server/config.test.ts server/profile-company.e2e.test.ts
pnpm exec vitest run src/components/onboarding
pnpm i18n:check
node --experimental-strip-types scripts/verify-onboarding-chat.mjs
```

The last command is the real-renderer check. It starts a disposable fake-engine
server with a temporary home, mounts the full app on a Vite preview of
`scripts/testing/threads-preview.tsx`, and drives it in one hidden Electron
window by visible text: company name, a suggested answer, a reload that resumes
on the open step, skipping the import, building the proposed team, the tools
step, the summary, and the closing button. It prints a PASS line per step and
keeps one screenshot per step in the evidence directory it names. No provider
login, user workspace or network beyond loopback is involved.

| Behavior | Checked by |
|---|---|
| Step order, start on the first unanswered step, "N left", short answers, caps, broken or missing storage | `src/lib/onboarding-chat.test.ts` |
| Company read from a work address and never from a personal mailbox, business guesses, suggested agents and apps, the instructions section | `src/lib/onboarding-chat.test.ts` |
| Profile write, shared-instructions edit (add, replace, no room), member building, starter-team hand-off, welcome recorded | `src/lib/onboarding-chat-actions.test.ts` |
| Every step of the conversation in the real component with fake API calls: save failure stays on the question, skip, resume, import, agent build failing halfway, AI missing, apps catalog, team step offered or not, finish opens General, Skip all, Escape, Portuguese labels | `src/components/onboarding/chat/ChatOnboarding.test.ts` |
| `profile.company` trimmed, capped, stored beside the rest of the profile | `server/config.test.ts` |
| `profile.company` saved, reported back by `/api/config`, kept when another profile field changes, refused over 120 characters and cleared, against a disposable server | `server/profile-company.e2e.test.ts` |
| Company field in Settings saves on blur, only when changed, and reverts on failure | `src/components/CompanyField.test.ts` |
| The gate picks the conversation in simple mode and keeps `WelcomeFlow` for hosted, advanced and replay | `src/components/onboarding/WelcomeGate.test.ts` |
| The whole conversation in the real renderer against a disposable server, including reload and the agents it creates | `scripts/verify-onboarding-chat.mjs` |

## Not checked

- [`scripts/verify-onboarding-ui.ts`](onboarding.md) still drives the
  beat-by-beat flow from a first run. In simple mode the first run is now the
  conversation, so its first-run part no longer matches; its replay part (Settings,
  Replay welcome tour) still opens `WelcomeFlow`. It needs `control-nordus ui launch`
  (a browser download), so it was neither run nor changed here.
- The apps step was only seen in its "not available on this computer" state,
  because the disposable server has no app catalog. Listing and connecting apps
  is covered by `src/components/onboarding/chat/ChatOnboarding.test.ts` with fake calls, not by the real renderer.
- The import step was only seen with nothing to bring (the fixture's home is empty),
  so the "bring skills and tools found on this computer" path is covered by unit tests only.
- Progress is kept in the browser's `localStorage` (`nordus.onboarding.chat.v1`).
  A second browser or device on the same workspace starts from the top.
- Real provider sign-in and real app OAuth are not exercised.
