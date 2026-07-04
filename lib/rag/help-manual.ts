// THE ANSWERSDOC MANUAL — the knowledge behind the in-app "?" expert bot.
//
// SANITIZED BY DESIGN: this file documents WHAT the product does and HOW to
// use it — never how it is built. No vendor names, no orchestration details,
// no environment variables, no keys, no infrastructure. Update this file
// whenever a feature ships; the help bot knows exactly what's written here.

export const HELP_MANUAL = `
# What answersDoc is

answersDoc is a knowledge-base workspace. You bring your sources — documents,
PDFs, YouTube videos, websites, audio, images — and it indexes them so you can
ask questions and get answers grounded ONLY in what you added, with citations
back to the exact source. Think of it as building a library, then hiring
experts who have read every book in it.

Core promise: answers come from YOUR sources, not the open internet. Every
answer can show where it came from.

# The main tabs (left sidebar)

- **Board** — the visual canvas where you build "machines" out of your
  knowledge: pieces, boxes, and DataBanks wired together.
- **Boardroom** — a meeting room where one question goes to ALL your experts
  at once.
- **Library** — every source in your account: search, filter by type, select
  many at once, add them to the current project, or send a selection to a box
  on the Board.
- **Projects** — the directory of all your projects: open, rename, delete
  (guarded), manage which files each project can see, and create a box from
  here. Files are NEVER deleted from this page — removing a file from a
  project only un-points it; the file stays in the Library.
- **Agents** — reusable answering personas (name + icon/image + system
  prompt). Wire one into a DataBank to steer HOW it answers.
- **Team** — invite members; an organization shares one workspace.
- **API Keys** — for developers connecting other apps.

# Projects

A project keeps its own sources, board, conversations, and notes. The switcher
at the top of the sidebar changes projects; "View all projects…" (or the
Projects tab) opens the full directory. A project is a POINTER LIST over the
shared Library: adding/removing a file to a project never copies or deletes
the file itself.

Deleting a project removes the grouping, its chats, and its notes — never any
files. You must type the project's name to confirm.

# The Library & adding sources

Upload from the Board's dock (the Upload button) or the Library. Supported:
documents (PDF, DOCX, TXT and more, with an OCR option for scanned PDFs),
YouTube links (many at once — one per line), websites, audio (transcribed),
images (understood visually), and voice memos recorded right in the app.

Each source becomes a "piece" (a chip) once indexed. Import progress shows
per-link status: indexed / pending / failed / skipped-duplicate. Failed items
can be retried; duplicates are detected automatically so the same video or
page never imports twice.

# The Board (the canvas)

The Board is a desk where knowledge is physical:

- **Pieces (chips)** — individual sources. Same-type pieces stack; a stack
  wires as one.
- **Boxes** — named clusters of pieces (a sub-project like "SEO" or "Interviews").
  Create from the dock, from a Library selection ("Send to box"), or from the
  Projects page. Drag pieces in/out. A box can wear a FACE — a portrait image
  (preset or uploaded) so an "Einstein box" looks like Einstein; portraits
  render at one uniform compact size. The Box pill flips back to box view.
- **DataBanks** — the query nodes (the bank icon). Wire sources or boxes into
  a DataBank and ask it questions; it answers ONLY from what's connected,
  with citations. Add one from the dock. Each DataBank has its own chat,
  Fast/Normal modes, a cited-only toggle, and can run in full-screen Research
  Mode.
- **Wiring** — drag from a piece/box to a DataBank. Cut a wire with the
  scissors that appear on it. Pieces can also string-connect to each other
  (top handle) so a family of pieces travels together.
- **Agents / personas** — a persona node wired into a DataBank changes HOW it
  answers (tone, role, format). Edit its face (emoji spread, any typed emoji,
  or an uploaded image with optional background removal), name, and system
  prompt.
- **Examples** — sample documents that steer style/judgment ("make it like
  this"); never indexed, never cited.
- **Drafts (artifacts)** — YOUR working document, carried whole. Wire it to a
  DataBank along with a library and the bank opines ON your draft — critique,
  rewrite, grade — using the library as its expertise.
- **Annotations** — free-floating labels; purely visual.
- **Everything hub** — one shortcut that wires every indexed source in the
  project into a DataBank.
- **Clean desk** — auto-arranges pieces around each DataBank so no wires cross.
- **Minimize** — boxes can be minimized to the dock's 📦 menu and brought back.

## Saving on the Board

Everything you do is kept safe on your device instantly. A full save also runs
automatically every few minutes, immediately when you close or switch away
from the tab, shortly after any chat answer, and any time you press the 💾
Save button in the dock. The little indicator shows saving/saved status.

# Expertise (per-DataBank judgment)

Each published DataBank can carry an "Expertise" — a short teaching note that
AMENDS ITS JUDGMENT (how to weigh things, what to prioritize) without changing
its knowledge. Open it from the Bank's ⋮ menu. "Refine against sources" has
the bank self-review its Expertise against its own corpus. Versioned, with a
changelog.

# The Boardroom

The Boardroom seats every DataBank in the project as an expert at one table.
Ask one question → every seated expert answers in PARALLEL, each attributed,
each grounded in its own sources. You can excuse seats, retry an individual
expert, ask for sources on demand, and choose Fast or Detailed depth.

"Table a document" puts YOUR document on the table — every expert critiques
it through their own lens. Disagreement between experts is shown, never
averaged away. Export the meeting as minutes (a markdown file).

# Embedding (put your experts in another app)

Two embeds, both a single iframe paste — no code in the host app:

- **Single expert chat** — publish a DataBank (Bank ⋮ → Connect), lock it to
  your domains, paste the iframe. Visitors chat with that one expert.
- **Boardroom room** — bundle several PUBLISHED DataBanks into a "room"
  (Boardroom → Embed): pick the experts, name the room, set allowed domains,
  copy the iframe. One question fans out to every expert. Optionally allow
  visitors to table a document.

Both are locked to the domains you allow. Experts must be published before
they can join a room.

# Notes

Notes live on the Board in a side drawer (the 🗒 Notes button in the bottom
dock). Two kinds: general sticky notes for the project, and notes attached to
a specific piece — right-click any piece, box or DataBank and choose "Add
note". A note's label chip jumps the canvas to its piece, and the 📌 pin
button drops the note onto the canvas as a sticky. Deleting a note never
touches the piece it was about.

# Where do I just chat?

Every DataBank on the Board IS a chat — wire in sources (or use the
Everything hub to wire in the whole project at once) and ask. Conversations
are saved per DataBank. There is no separate Chat tab.

# Team & roles

Organizations share the workspace. Some tabs (like Health) are admin-only.

# Tips & troubleshooting

- If an answer says grounding is weak, wire in more/better sources — the
  system prefers honesty over guessing.
- A source stuck importing can be retried from the import list; duplicates
  are skipped automatically and listed.
- If the app ever loads looking empty on a flaky connection, don't panic and
  don't re-add anything: your work is saved server-side; a banner will keep
  retrying and everything reappears when the connection recovers.
- Removing a file from a project does not remove its chip from that
  project's board — cut the chip on the Board too if you want it gone
  visually.
- The version stamp (top-right of the Board) tells support exactly which
  build you're on.

# What the helper should NOT discuss

Internal implementation, vendors, infrastructure, API keys, or anything not
in this manual. If asked, say the product team keeps implementation private,
and pivot to what the user is trying to accomplish.
`;
