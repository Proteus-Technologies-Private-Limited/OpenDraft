#!/usr/bin/env python3
"""The screenplay shown in the App Store screenshots, as an editor document.

    demo_script.py            -> prints the JavaScript that loads it into the editor
    demo_script.py --json     -> prints the TipTap document JSON

"The Last Reel" is written for these screenshots: original text, no real
people, and enough scenes and speakers for the Navigator, index cards and
Table Read to have something to show.
"""
import json
import sys

TITLE = "The Last Reel"

# (heading, synopsis, colour, [elements]) — elements are (type, text) pairs.
SCENES = [
    ("INT. ORPHEUM THEATER - PROJECTION BOOTH - NIGHT",
     "Maya counts the audience. Eli has a letter he won't talk about.", "#2563eb", [
        ("action", "Dust drifts through the beam of a 35mm projector. MAYA OKAFOR (30s, a pencil behind one ear) threads film with the ease of long habit."),
        ("action", "Below, the auditorium is nearly empty. Nine people. Maybe ten."),
        ("character", "ELI (O.S.)"),
        ("dialogue", "You counting again?"),
        ("action", "ELI BRANDT (70s, cardigan, owner since before the carpet) leans in the doorway with two paper cups."),
        ("character", "MAYA"),
        ("dialogue", "Eleven. The couple in row F came back from the lobby."),
        ("character", "ELI"),
        ("dialogue", "Eleven. We're practically a multiplex."),
        ("action", "He holds out a cup. She doesn't take it."),
        ("character", "MAYA"),
        ("parenthetical", "(quietly)"),
        ("dialogue", "You got the letter, didn't you."),
        ("character", "ELI"),
        ("dialogue", "I got a letter."),
        ("transition", "CUT TO:"),
     ]),
    ("INT. ORPHEUM THEATER - LOBBY - LATER",
     "Ruth gives them until Friday. Maya buys one weekend.", "#ef4444", [
        ("action", "Faded one-sheets line the walls. RUTH CALLOWAY (40s, blazer, tablet under one arm) studies the ceiling like she's pricing it."),
        ("character", "RUTH"),
        ("dialogue", "The offer stands until Friday. After that, the bank stops being polite."),
        ("character", "ELI"),
        ("dialogue", "This building has shown a picture every night since 1938."),
        ("character", "RUTH"),
        ("dialogue", "And it can show apartments every night after."),
        ("action", "Maya steps between them."),
        ("character", "MAYA"),
        ("dialogue", "Give us the weekend."),
        ("character", "RUTH"),
        ("parenthetical", "(checking her tablet)"),
        ("dialogue", "One weekend. What changes in one weekend?"),
        ("character", "MAYA"),
        ("dialogue", "Everything. It's the movies."),
     ]),
    ("EXT. ORPHEUM THEATER - MARQUEE - DAWN",
     "One night only. Maya is still writing the rest.", "#eab308", [
        ("action", "Maya on a ladder, swapping letters on the marquee. DESMOND (19, usher's vest two sizes too big) steadies it from below."),
        ("character", "DESMOND"),
        ("dialogue", "What are we spelling?"),
        ("character", "MAYA"),
        ("dialogue", "\"One night only.\""),
        ("character", "DESMOND"),
        ("dialogue", "One night only what?"),
        ("character", "MAYA"),
        ("dialogue", "I'm still writing that part."),
     ]),
    ("INT. ORPHEUM THEATER - BASEMENT ARCHIVE - DAY",
     "An unlabeled reel, wrapped in a newspaper from opening night.", "#059669", [
        ("action", "Shelves of rusted film cans. Maya pries one open. Inside, a reel with no label, wrapped in a newspaper dated 1938."),
        ("character", "DESMOND"),
        ("dialogue", "Is it supposed to smell like that?"),
        ("character", "MAYA"),
        ("dialogue", "That's vinegar. It means we don't have long."),
        ("action", "She lifts the reel to the bare bulb. Frame after frame: this lobby, packed, the night it opened."),
        ("character", "MAYA"),
        ("parenthetical", "(calling up the stairs)"),
        ("dialogue", "Eli. You need to see this."),
     ]),
    ("INT. ORPHEUM THEATER - PROJECTION BOOTH - NIGHT",
     "They run the reel. Eli sees his mother at the ticket window.", "#8b5cf6", [
        ("action", "The old projector clatters awake. On the screen below: a crowd in hats and winter coats, breath fogging, waving at the camera."),
        ("action", "Eli stands very still."),
        ("character", "ELI"),
        ("dialogue", "That's the ticket window. That's my mother in the ticket window."),
        ("character", "MAYA"),
        ("dialogue", "Then that's what we're showing."),
        ("character", "ELI"),
        ("parenthetical", "(not looking away)"),
        ("dialogue", "Nobody comes out for a home movie."),
        ("character", "MAYA"),
        ("dialogue", "They do when they're in it."),
     ]),
    ("EXT. MAIN STREET - DAY",
     "Desmond and Maya paper the town with eighty-year-old faces.", "#f97316", [
        ("action", "Desmond staples flyers to a telephone pole: a blown-up frame from the reel, a girl on her father's shoulders. \"IS THIS YOUR GRANDMOTHER?\""),
        ("action", "Across the street, Maya tapes one to a bakery window. The BAKER comes out, wiping her hands, and stares at it."),
        ("character", "DESMOND"),
        ("dialogue", "How many of these did we print?"),
        ("character", "MAYA"),
        ("dialogue", "All of them."),
     ]),
    ("INT. RUTH'S CAR - NIGHT",
     "Ruth finds a flyer on her own windshield.", "#4f46e5", [
        ("action", "Rain. Ruth peels a wet flyer off her windshield and gets in. She's about to crumple it. She doesn't."),
        ("action", "The face on the flyer: a boy of six in an usher's cap, grinning. Her father's grin."),
        ("character", "RUTH"),
        ("parenthetical", "(into her phone)"),
        ("dialogue", "Move my Friday. No. All of it."),
     ]),
    ("INT. ORPHEUM THEATER - AUDITORIUM - NIGHT",
     "Every seat taken. The town watches itself.", "#2563eb", [
        ("action", "Every seat taken. People stand along the walls. The house lights fall and the reel begins."),
        ("action", "A gasp. Someone laughs. Someone says a name out loud, then another. The whole room is pointing at the screen."),
        ("action", "In the back row, Ruth sits with the flyer folded in her lap."),
        ("character", "DESMOND"),
        ("parenthetical", "(whispering)"),
        ("dialogue", "I counted. Four hundred and twelve."),
        ("character", "MAYA"),
        ("dialogue", "Count again. You missed Eli."),
        ("action", "In the aisle, Eli watches his mother sell a ticket, eighty-eight years ago, to a line that reaches the door."),
        ("transition", "FADE OUT."),
     ]),
]


def build_document() -> dict:
    content = []
    for heading, synopsis, colour, elements in SCENES:
        content.append({
            "type": "sceneHeading",
            "attrs": {"synopsis": synopsis, "sceneColor": colour},
            "content": [{"type": "text", "text": heading}],
        })
        for kind, text in elements:
            content.append({"type": kind, "content": [{"type": "text", "text": text}]})
    return {"type": "doc", "content": content}


def load_expression() -> str:
    """JavaScript for sim.py: replace the open script and park the caret at the top."""
    document = json.dumps(build_document())
    return (
        # emitUpdate=true: without it the Navigator, index cards and scene list never hear of the new script.
        f"(od.editor().commands.setContent({document}, true), "
        "od.editor().commands.setTextSelection(1), "
        "document.querySelectorAll('.ProseMirror > *').length + ' blocks')"
    )


if __name__ == "__main__":
    try:
        print(json.dumps(build_document(), indent=1) if "--json" in sys.argv else load_expression())
    except (TypeError, ValueError) as error:
        sys.exit(f"Could not build the demo script: {error}")
