# Jev Ultrafast: upstream provenance

`server/browser-goal/` is a TypeScript port of the agent loop of
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) at
commit `1231850a` (`jev_ultrafast/agent.py`, `browser.py`, `model.py`,
`questions.py` and `snapshot.js`), MIT licensed; the license is in `LICENSE`.

Changes from upstream: the loop drives the bot's own agent-browser Chrome
through its daemon relay instead of a Browser Harness CDP session; fields that
look like passwords, card numbers, security codes or keys are never offered for
typing; clicks on controls that pay, book, send, publish, accept terms or delete
end the run and go back to the bot; cookie banners are answered with the most
restrictive option; and each action is written to the bot's browser step log.
