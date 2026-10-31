# Drive and Wiki

Two pages in the app, **Drive** and **Wiki**, where people and bots keep documents together. Both live on the server, in the browser as well as in the desktop app.

- **Drive** holds files. Saving to a path that already exists keeps the earlier content as a version, and restoring a version makes a new one. Each file shows who saved it (a person or a bot), when, its size and its type. Deleting moves a file to the trash for 30 days.
- **Wiki** holds Markdown pages with a title and a folder. Pages link to each other with `[[Page]]`, `[[Page|label]]` and `[[Page#section]]`, show the pages that link back to them, carry tags (`tags:` in the frontmatter and `#tags` in the text), keep a history, and can be seen as a link map. A link to a page that does not exist is shown as missing; clicking it starts that page.

Neither one is memory. "Team memory" and the private second brain are what the bots learn and recall by themselves. Drive and Wiki hold what someone chose to write down or save, and a bot reads them only by calling a tool. Nothing here is copied into memory or into a prompt.

## Spaces and isolation

Everything belongs to a space: `internal` (the company) or `client:<slug>` (one client). On disk each space has its own folder under `DATA_DIR/knowledge/` (`internal/` and `clients/<slug>/`), with its own files, versions, pages and trash. Nothing is shared between two spaces.

- A bot works in the space of its turn. A client's bot keeps its client. A company bot follows the clients of the conversation it is in: with none it works in `internal`; with one (the room's client, the client a chat named, or the client of whoever asked for a delegated task) it works in that client's space only; with more than one it has no space at all, every tool says so in plain words, and nothing is read or written. A bot with no client that is not an internal bot has no space. When in doubt, no space.
- A bot tool always works in the space of its turn. The space never comes from the arguments, so a bot in one client's room cannot read or write the company's files or pages, or another client's, and the next room of another client starts clean.
- An admin sees every space. The company's space is for admins alone until an admin names other people on the Drive page (**Company access**: whole email addresses, up to 200, kept in `DATA_DIR/knowledge/settings.json`; a domain or a wildcard is refused). Only an admin can read or change that list. A member sees the spaces of the clients whose bots they can see, and a space switcher appears only when there is more than one.
- Inside a space, what a person saved is visible to everyone who has the space. What a bot saved is visible only to the people who can see that bot, and a bot reads only what everyone who can see it could also see its author say.
- Deleting a file or a page needs an admin or the person who saved it. Deleting a folder needs the same for every file inside.
- What a person is not shown does not leak by name. A name held by a file, a folder or a page they cannot see is refused like any name that cannot be used, with no word about why; a folder that holds only things they cannot see answers "not found" like one that never existed; and the link counts of an import count only pages they can see.

## What a person can do

Drive: browse folders (breadcrumb), search by name, drag files in or use **Upload files**, create folders, rename or move, open a preview (image, PDF, Markdown, text, CSV as a table, audio, video), read the version history, restore a version, download any version, delete and bring back from the trash. In a chat, the **Save to Drive** button next to a file puts it in a folder for files from chats (named in the interface language). The browser sends only which conversation it is (`PUT /api/drive/file?conversation=<thread>`); the server decides the space with the same rule the bots use, and answers with it. A room for one client saves in that client's space (an admin can do it even before that client has anything saved), a chat about no client saves in the company's, and a chat about more than one client, a room that mixes company and client bots, or a conversation the server does not know has no Drive to save to. A person who may not use the space gets the same refusal as for any space that is not theirs.

Wiki: search, filter by folder or tag, read a page with clickable links and backlinks, write or edit with a Markdown preview, see the history and restore a version, see the link map, delete and bring back from the trash. Saving over someone else's newer edit is refused and the person can copy their text first.

**Import from Obsidian.** Choose the vault folder in the browser (a folder, not a zip: there is no zip reader in the app yet). Notes become pages and keep their folders and frontmatter; images and other files go to the Drive under `Wiki/anexos/<vault name>`; `[[links]]` are matched by page name. Hidden folders such as `.obsidian` are skipped. A summary shows what was created, updated or left unchanged, how many links were connected, and what was skipped and why.

## What a bot can do

| Tool | Does |
| --- | --- |
| `drive_save` | Saves text, or a file from the bot's working folder, to a Drive path. An existing path gets a new version. |
| `drive_list` | Lists a Drive folder: names, sizes, versions, who saved each file. |
| `drive_read` | Reads a text, Markdown or CSV file as text, or copies any file into the bot's working folder. |
| `wiki_search` | Searches pages by title, tags, folder or text. |
| `wiki_read` | Reads a page with its backlinks and links that lead nowhere yet. |
| `wiki_write` | Creates a page or saves a new version. The page shows the bot as the author. |

What the tools return was written by people and other bots, so it reaches the bot as data: every result puts names, authors and text inside a note that says it is data and never instructions, rewrites any look-alike of a harness note, and keeps stored text inside a JSON string. `drive_read` with `as: "file"` copies the file into the bot's working folder as one plain file named `drive-<8 hex of the Drive path>-<name>`, straight in that folder (no subfolder, never following a link planted at that name). The tools call `/api/internal/knowledge/*` with the bot's own capability token, and the conversation of that token decides the space. These are advertised to every bot in the agents catalog (about 3 KB of tool descriptions), and the route, not the list, decides what each bot may touch.

## Limits

| What | Default | Setting |
| --- | --- | --- |
| One file in the Drive | 100 MiB | `NORDUS_DRIVE_FILE_MAX_BYTES` |
| One space in total | 20 GiB | `NORDUS_DRIVE_SPACE_MAX_BYTES` |
| Files in a space | 20,000 | |
| Versions kept per file or page | 100 | |
| One Wiki page | 512 KiB | |
| Pages in a space | 5,000 | |
| Files in one Obsidian import | 5,000 | `NORDUS_WIKI_IMPORT_MAX_FILES` |
| Total size of one import | 500 MiB | `NORDUS_WIKI_IMPORT_MAX_BYTES` |
| Trash | 30 days | |

A save never writes past the room a space has left: a stream is written only while it fits, a refused one (no room, no free path, too big) is deleted at once, and a Drive upload with no declared size is checked as it arrives, not at the end. In an import, sending a path again replaces its staged copy, and cancelling, finishing or letting an import sit idle removes what it staged unless the space or another import holds those bytes. Page text is read with bounded patterns (a link or a picture is at most 300 characters, and the excerpt comes from the first 4 KiB), so a page written to stall the parser cannot.

Paths are names, never places on disk: `..`, backslashes, invisible and control characters are refused, and a path may have at most 12 levels. Content is stored by hash, so the same bytes are kept once. Downloads are served as attachments with `nosniff` and a sandboxing CSP; HTML and SVG are never rendered; a PDF opens in the browser's own viewer. Files a bot copies into its working folder are copied, never linked.

## Where it lives

- `shared/knowledge.ts`, `shared/knowledge-path.ts`, `shared/wiki-markdown.ts`: the wire types, path rules and link parsing the server and the app share.
- `server/knowledge/`: the stores (`drive-store`, `wiki-store`, `blob-store`), the spaces and who sees what (`service`, `space`, `audience`, `conversation-facts`), the import, the bot-side copy (`workspace-copy`) and the text bots receive (`tool-text`).
- `server/routes/drive.ts`, `wiki.ts`, `knowledge-internal.ts`: the HTTP routes. The tool definitions are in `server/drivers/catalog-knowledge.ts`.
- `src/components/knowledge/`: the Drive and Wiki pages. `src/components/SaveToDriveButton.tsx`: the chat action.

Tests: `npx vitest run --maxWorkers=2 server/knowledge server/routes/knowledge-routes.test.ts server/routes/knowledge-internal.test.ts shared/knowledge-path.test.ts shared/wiki-markdown.test.ts src/lib/knowledge-ui.test.ts src/lib/wiki-render.test.ts src/lib/wiki-graph-layout.test.ts src/lib/wiki-import.test.ts`. The end-to-end test `server/knowledge-drive-wiki.e2e.test.ts` starts the real server, which can take minutes to boot on a busy machine.
