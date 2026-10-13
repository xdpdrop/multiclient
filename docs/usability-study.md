# Multiclient usability study

This is a recruitment and evaluation protocol, not a completed study. No participants have been contacted. The maintainer must recruit volunteers and record consent before running sessions. Keep application telemetry off.

## Participants and preparation

Recruit 12 Windows users: six who primarily use AI for everyday writing/research/document work and six who use coding assistants. Within each group, include at least two less experienced users and people who already use more than one AI product. Include Windows 10/11 where supported, a smaller laptop display, keyboard-only navigation and at least one participant using accessibility settings. Record these attributes voluntarily and use participant codes, not names, in findings.

Use the unsigned preview's exact version/checksum. Offer a disposable app profile and a small disposable Git project, a two-page text PDF, a scanned PDF, a PNG screenshot, CSV/Markdown files and seeded long history containing a known older decision. Prepare a deterministic keyless local endpoint for participants who cannot or do not want to use a paid API. Do not supply another person's account or collect participants' keys. They may use an existing eligible official CLI account or their own API setup; stop setup if purchasing access would be necessary.

Ask for consent to observation and separately for screen recording. Never record credential entry or personal conversations. Record task outcomes and anonymous notes locally; remove recordings after review under the agreed retention period. Participants may decline recording or stop at any time.

## Moderated session: 60 minutes

Start with five minutes describing their present workflow: which tools they use, how they find old answers, what they export, and where switching tools costs time. Ask them to think aloud, and avoid explaining interface controls before they attempt each task. If they cannot proceed after five minutes, record the blocker and offer help so later tasks can continue; assisted completion is a separate outcome.

| Task                      | Everyone / lane | Observable success                                                                                                                                                                                                                                    |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect and send          | Everyone        | Chooses an appropriate connection, understands API versus subscription billing, selects a model and receives a response without unnecessary CLI/project setup.                                                                                        |
| Supply real context       | Everyone        | Adds the screenshot and PDF, sees their previews/processing state, identifies unsupported model input and successfully submits compatible context.                                                                                                    |
| Correct and explore       | Everyone        | Edits/resends an earlier prompt and branches from a completed answer; finds both originals and understands that conversation branching does not undo file changes.                                                                                    |
| Find yesterday's decision | Everyone        | Finds the seeded older message without manually loading all history, then repeats through archive search and restores/pins the conversation.                                                                                                          |
| Interrupted work          | Everyone        | Saves an unsent draft, switches conversations/restarts, recovers the draft and recognizes an interrupted partial answer; uses an explicit recovery action without assuming replay occurred.                                                           |
| Export and restore        | Everyone        | Exports readable output and a portable conversation, checks the resulting files, makes a profile backup and restores the disposable profile; recognizes that credentials/native CLI state are separate.                                               |
| Document interpretation   | Everyday lane   | Selects page two of the PDF, explains what will be sent, notices text-only limitations, and recovers appropriately from a scanned document with no extracted text.                                                                                    |
| Switch tools              | Everyday lane   | Moves a conversation to another connection using the visible handoff and can explain which context travels.                                                                                                                                           |
| Review project work       | Developer lane  | Trusts the disposable project, reads instruction sources, finds a file, inspects staged/unstaged changes and attaches a relevant diff.                                                                                                                |
| Isolate a task            | Developer lane  | Creates/selects an isolated worktree, identifies its branch/location, and preserves changes while archiving it. Public write modes remain gated; test approvals only in an explicitly opted-in disposable development session with a certified setup. |

Leave ten minutes for comparison with their existing tools: what they would use tomorrow, which missing capability prevents that, and what they would remove from the interface. Do not ask only whether they “like” the product. Have them identify one real follow-up use case.

## Feature follow-up: 45 minutes

Schedule a separate consented session for the new features so the core session stays manageable. Use disposable notes/documents and a keyless local API. URL reading can use a public text page; Brave search requires the participant's own optional key and an explicit search. No task should require buying access.

| Task                    | Observable success                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse a workstream      | Creates a chat project without a directory, saves instructions and a document, uses the captured knowledge in two chats/providers, then understands the new-fork action for updated instructions. |
| Inspect research        | Explicitly reads a URL, selects a source, opens its saved citation paragraph and distinguishes captured evidence from a search snippet or unverified model link.                                  |
| Control memory          | Saves a scoped note, reviews what will be shared, excludes it, and starts a fresh chat while recognizing that old conversations retain earlier copies.                                            |
| Keep an editable output | Saves a completed output as an artifact, edits and previews a saved revision, reviews an AI proposal, returns to an older revision without losing history, and exports it.                        |
| Retrieve and reuse      | Tags a conversation, finds an older tagged answer, applies a prompt template without losing a draft attachment, and explains Append versus Replace.                                               |
| Choose a model response | Reviews identical comparison context and the additional-usage notice, starts two API targets, recognizes an independently failed lane, and continues from the chosen answer.                      |

Record where the participant expects automatic sharing, live updates, memory forgetting, runnable previews or free comparison requests. These misunderstandings count as concrete usability findings; correct explanations in documentation alone do not prove the interface is clear.

## Seven-day diary and evidence

Invite participants to a seven-day diary after the session. They manually record days used, main task, connection, whether they finished, any workaround, and whether they returned to another app. Accept a short local form/text file; no automatic event collection or prompt uploads. Ask them to exclude private content. Follow-up contact is performed by the maintainer through their consented channel, not automatically by an agent.

Report unassisted/assisted/failed tasks, time to first response, recovery mistakes, attachment misunderstandings and concrete blocking incidents. Show counts with denominators, such as “4 of 6 everyday participants,” rather than presenting a small convenience sample as market prevalence. Compare the two audiences separately before aggregating.

Proposed release criteria: at least five of six participants in each lane complete core send/search/draft-recovery tasks without help; neither lane has a repeatable data-loss or unintended-context-send incident; every discovered safety/integrity blocker is reproduced or explicitly resolved; and at least four participants per lane choose a second real task during the diary. Assess the new feature tasks separately and resolve blocking usability issues before advertising them as ready. These are targets for the study, not achieved results or statistical proof of product-market fit.

Maintain a findings table with participant code, task, observed behavior, severity, reproduction steps, proposed change and verification. Prioritize failed core workflows and integrity defects before extra features. Repeat the affected tasks with fresh participants after fixes; do not claim a change helped merely because the implementation was completed.
