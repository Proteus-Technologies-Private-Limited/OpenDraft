# I Vibe-Coded a Screenplay Editor for Myself. Then Real Users Made It Better Than the Paid Ones.

*What one weekend-project-turned-product says about where commercial off-the-shelf software is going.*

<!-- Medium: subtitle above. Suggested tags: Software Development, AI, Open Source, Vibe Coding, Future of Work -->
<!-- Suggested hero image: images/macos/editor.png (editor) or the comparison table as a screenshot -->

---

I did not set out to build a product.

I wanted to write screenplays, and I did not want to pay $250 for the privilege or hand my scripts to a cloud service. So I did what a lot of people are doing now: I opened an AI coding assistant, described what I wanted, and kept going until it worked. Scene headings that format themselves. Character name autocomplete. A page that looks like a real screenplay page. It was basic and it was for me.

That project is [OpenDraft](https://proteus-technologies-private-limited.github.io/OpenDraft/) ([source on GitHub](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft)). Today it has a beat board, real-time collaboration, version history with diffs, a table read that speaks your script aloud, Final Draft import, desktop apps on three operating systems, and iOS and Android apps. It is free, MIT-licensed, and it keeps your script on your machine.

I want to be careful about how I tell this story, because the lazy version is "AI built an app, the end." That is not what happened. And what *did* happen is the more interesting signal about where software is going.

## Phase one: vibe coding gets you to "works for me"

Vibe coding is real, and it is genuinely new. For the first time, someone with a clear problem and decent taste can get from idea to working software in hours, not months. The cost of a first draft of an application has collapsed.

But a first draft that works for its author is not a product. My version handled the happy path for exactly one user, on one machine, writing the kind of scripts I write. It was a very good answer to a very small question.

If the story ended there, vibe coding would be a toy: a way to make personal tools that nobody else needs. For a lot of software, that is a perfectly fine outcome. It is also a big deal on its own. Millions of "I'll just make one for myself" tools will exist that would never have justified a development budget.

## Phase two: real users are the actual feature factory

The part that changed OpenDraft was not the AI. It was other people.

I never promoted it. No launch post, no ads. Even so, the repository has picked up 80 GitHub stars and the Android app has passed 500 installs on the Play Store. Those are not viral numbers, but screenwriting software is a niche, and for something nobody was told about, that is decent traction. People went looking for a free screenplay editor and found it.

Once the project was public, writers showed up with problems I would never have invented:

- Someone needed to move off Final Draft without retyping a feature-length script, so import had to be dependable, not demo-grade.
- Someone on Linux told me the AppImage opened to a blank white window. The cause turned out to be a bundled Wayland library clashing with the host's graphics stack. I would never have hit that on my own machine.
- Writers who work in the Fountain plain-text format wanted it supported both ways.
- Production people wanted sides, watermarked PDFs, and reports, which are the unglamorous features that decide whether a tool is usable on a real project.
- Contributors started sending fixes and ideas that I would not have prioritized, or even thought of.

None of this came from a product roadmap. It came from the one thing a commercial vendor can only approximate with surveys and support tickets: **people who use the thing every day and can read the source.**

AI made the *writing of code* cheap. It did not make *knowing what to build* cheap. That knowledge still lives with users, and open source is the shortest pipe between their frustration and a merged fix.

## Feature by feature, honestly

Here is the comparison table from the OpenDraft README, against three well-known commercial screenwriting tools:

| Feature | OpenDraft | Final Draft | WriterDuet | Fade In |
|---------|:---------:|:-----------:|:----------:|:-------:|
| Price | Free | $250 | Free / $12 per month | $80 |
| Open source | Yes (MIT) | No | No | No |
| Real-time collaboration | Yes | Yes | Yes | Yes |
| Beat board / index cards | Yes | Yes | Yes | Yes |
| Version history with diff | Yes | Limited | Limited | Limited |
| Self-hostable | Yes | No | No | No |
| Linux support | Yes | No | Yes (paid) | Yes |
| No account required | Yes | No | No | Yes |
| Plugin architecture | Yes | No | No | No |

(Based on public product information as of 2026; the full table is in the repo, and I will happily fix anything that is out of date.)

Do I think OpenDraft beats every commercial tool on every axis? No. Mature products have decades of polish, edge cases, industry relationships and support teams, and "feature parity on a checklist" is not the same as "equally good in every writer's hands." Some of those gaps are real and I would rather say so than pretend otherwise.

What I *will* say is that on the checklist that most working writers care about, a free tool built by one person with an AI assistant and a growing group of contributors now sits level with, and in places ahead of, software that costs real money. Two years ago that sentence would have been absurd. The interesting question is not whether it is *fully* true yet. It is how fast the remaining gap is closing, and what happens to a market when that gap is measured in months.

## Where this goes: the future of commercial off-the-shelf software

COTS, commercial off-the-shelf software, rests on a simple trade: building software is expensive and specialized, so many customers share the cost of one vendor's product and pay for it in subscriptions. Vibe coding plus open source attacks both halves of that bargain. Here is where I think it leads.

### 1. The feature checklist stops being a moat

For decades a long feature list was defensible because replicating it took a team and years. When one motivated person plus AI can reproduce a mid-sized product's core surface in months, "we have more checkboxes" is no longer a reason to buy. Vendors will need to compete on things that do not clone easily.

### 2. What survives: trust, data, network effects, and service

The durable value in commercial software moves to what a repo cannot copy:

- **Network effects.** The industry standard file format, the tool your collaborators already use, the integrations with the next step in the pipeline.
- **Proprietary data and models.** Anything that gets better because of data only the vendor holds.
- **Accountability.** Someone to call, an SLA, compliance paperwork, a company that will be around in five years. Enterprises pay for this, rightly.
- **Distribution and brand.** Being the default.

Notice what is not on the list: the code.

### 3. The mid-market squeeze

The most exposed products are the ones in the middle: niche vertical tools, single-purpose utilities, "it's like X but for Y" subscriptions. Their customers are small enough that a motivated community can out-iterate them, and the price is high enough that "free and good enough" is tempting. These markets get compressed first.

The giants with deep integration, regulation, and massive data gravity (ERP, EDA, banking cores) are far safer in the short term. But "safer" is not "safe," and the layer around them, the reports, the dashboards, the glue, is already being rebuilt by the people who use it.

### 4. Software becomes personal, disposable, and forkable

When building is cheap, software shifts from "something you buy" to "something you shape." Many people will not adopt a product at all; they will generate their own variant. The unit of distribution moves from the finished app to the **open base that is easy to extend**, which is why OpenDraft has a plugin architecture. Core stays free and open. Specialized capabilities can be layered on without forking the world.

### 5. Open core becomes the default business model, not the exception

If the code is a commodity, the way to fund a project is to be the trusted steward of it: hosting, support, commercial add-ons for teams that need them, certification. This is already how a large share of infrastructure software works. I expect it to spread to end-user applications, from word processors to design tools to, yes, screenwriting software.

### 6. The new risks are real

I do not want to write a victory lap. Vibe-coded software has costs:

- **Quality and security debt.** Code nobody fully understands is a liability. Review, tests, and a real release process matter *more*, not less, when the first draft is machine-written.
- **Maintainer burnout.** Free software with real users generates real work. "Free" is not free for the person on call.
- **Sustainability.** A community can sustain a project, or a project can quietly die when its one champion gets busy. Commercial vendors at least have revenue to keep the lights on.
- **Trust.** Users handing over their life's work need to know the tool is stable and not about to disappear. That has to be earned with a track record, not claimed.

The projects that win will be the ones that treat vibe coding as the *start* of engineering, not a substitute for it.

## What I would tell someone building their own thing

1. **Start with your own itch.** The first user is you. That is enough to get going and it keeps you honest.
2. **Ship it in the open.** The jump from "works for me" to "works for people" happens when strangers use it and tell you what is broken.
3. **Listen more than you generate.** The AI will happily build anything you describe. The hard part is deciding what is worth describing, and users are better at that than you are.
4. **Put the boring work first.** Imports, exports, file formats, accessibility, offline behavior, release automation. Boring features are what make a tool trustworthy.
5. **Design for extension.** A plugin system lets the community, and your own future self, add things without pulling the core apart.
6. **Be honest about the gaps.** Credibility is the one thing a free project cannot buy.

## The bottom line

The question used to be *"Who can afford to build this?"* Now it is *"Who understands the problem well enough to know what to build, and who can be trusted to keep it running?"*

That is a much more democratic question. It is also a much harder one for incumbents to answer with a price tag.

I vibe-coded OpenDraft for myself. Real writers and real contributors turned it into something better than I could have built alone. I do not think that is a fluke. I think it is a preview: the commercial software market will keep its giants and its specialists, but a growing share of everyday tools will be free, open, community-shaped, and good enough that the subscription has to justify itself.

If you write screenplays, try it: it is free, needs no account, and your scripts stay on your machine. If you build software, I would love to hear where you think the line falls between what gets commoditized and what stays worth paying for.

---

**Website:** [proteus-technologies-private-limited.github.io/OpenDraft](https://proteus-technologies-private-limited.github.io/OpenDraft/) · **Try it in your browser:** [open-draft.com](https://open-draft.com) · **Source:** [github.com/Proteus-Technologies-Private-Limited/OpenDraft](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft) · **Contribute:** issues and pull requests are welcome.

<!--
REVIEW NOTES (delete before publishing):
- Traction figures (80 stars, 500+ Play Store users, no promotion) are in "Phase two". A real user quote there would still strengthen it.
- The Wayland/AppImage story is from issue #113 in the repo; reword if you want it less technical for Medium readers.
- The comparison table is trimmed from README.md; the footnote date there is April 2026 (some rows October 2026).
- Medium does not render Markdown tables well. Either paste the table as an image/screenshot or use a GitHub Gist embed.
- Word count is roughly 1,800 (about an 8-minute read).
-->
