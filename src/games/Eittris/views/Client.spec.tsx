import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "mobx-react";
import { TargetList, ControlsHelp } from "./Client";
import { EITTRIS_CONTROL_GUIDE } from "../models/eittrisInput";
import { EittrisClientModel } from "../models/ClientModel";
import { encodeThumbnail, BOARD_HEIGHT, BOARD_WIDTH } from "../models/eittrisLogic";

// -------------------------------------------------------------------
// The target list is the only way to pick who you are attacking, and it is
// injected rather than passed props - so losing its @inject makes it render
// nothing at all, silently.  These tests exist to make that loud.
// -------------------------------------------------------------------

const blankThumb = encodeThumbnail(
  Array.from({ length: BOARD_HEIGHT }, () => new Array(BOARD_WIDTH).fill(-1)),
);

function fakeModel(overrides: Partial<EittrisClientModel> = {}): EittrisClientModel {
  return {
    playerId: "ME",
    targetId: "B",
    pickTarget: () => {},
    hitPulses: new Map(),
    roster: [
      { playerId: "ME", name: "Me", alive: true, thumb: blankThumb, avatarId: 1, avatarColor: 0 },
      { playerId: "B", name: "Bob", alive: true, thumb: blankThumb, avatarId: 2, avatarColor: 1 },
      { playerId: "C", name: "Cass", alive: false, thumb: blankThumb, avatarId: 3, avatarColor: 2 },
    ],
    ...overrides,
  } as unknown as EittrisClientModel;
}

function renderList(model: EittrisClientModel) {
  return render(
    <Provider appModel={model}>
      <TargetList />
    </Provider>,
  );
}

describe("EITtris TargetList", () => {
  it("shows the other players, and never yourself", () => {
    renderList(fakeModel());
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Cass")).toBeInTheDocument();
    expect(screen.queryByText("Me")).not.toBeInTheDocument();
  });

  it("marks the current target and flags the dead", () => {
    renderList(fakeModel());
    expect(screen.getByText("TARGET")).toBeInTheDocument();
    expect(screen.getByText("OUT")).toBeInTheDocument();
  });

  it("renders nothing when there is nobody else to attack", () => {
    const { container } = renderList(
      fakeModel({
        roster: [
          {
            playerId: "ME",
            name: "Me",
            alive: true,
            thumb: blankThumb,
            avatarId: 1,
            avatarColor: 0,
          },
        ],
      } as any),
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EITtris ControlsHelp", () => {
  // Three ways to play and, until now, nobody was told about two of them.  The chips are
  // the whole point: a player has to be able to SEE that a keyboard works before they go
  // looking for one.
  it("names every way to play, closed", () => {
    render(<ControlsHelp />);
    expect(screen.getByRole("button", { name: "Touch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keyboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Controller" })).toBeInTheDocument();
    // Nothing is opened for you - the detail is there when asked for
    expect(screen.queryByText(/Hard drop/)).not.toBeInTheDocument();
  });

  it("lays out the mapping when a control type is tapped", () => {
    render(<ControlsHelp />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard" }));
    expect(screen.getByText(/Rotate clockwise/)).toBeInTheDocument();
    expect(screen.getByText(/Space/)).toBeInTheDocument();
  });

  it("closes again when the same chip is tapped twice", () => {
    render(<ControlsHelp />);
    const chip = screen.getByRole("button", { name: "Touch" });
    fireEvent.click(chip);
    expect(screen.getByText(/follows your finger/)).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByText(/follows your finger/)).not.toBeInTheDocument();
  });

  it("shows one at a time, so it stays a short read", () => {
    render(<ControlsHelp />);
    fireEvent.click(screen.getByRole("button", { name: "Touch" }));
    fireEvent.click(screen.getByRole("button", { name: "Controller" }));
    expect(screen.queryByText(/follows your finger/)).not.toBeInTheDocument();
    expect(screen.getByText(/D-pad/)).toBeInTheDocument();
  });
});

describe("EITtris control guide data", () => {
  /** Everything a section describes, whether it has seats to choose between or not. */
  const allEntries = (section: (typeof EITTRIS_CONTROL_GUIDE)[number]) =>
    section.layouts && section.layouts.length > 0
      ? section.layouts.flatMap((l) => l.entries)
      : section.entries;

  it("describes something for every way to play", () => {
    expect(EITTRIS_CONTROL_GUIDE.map((s) => s.id)).toEqual(["touch", "keyboard", "pad"]);
    for (const section of EITTRIS_CONTROL_GUIDE) {
      expect(allEntries(section).length).toBeGreaterThan(0);
      expect(section.summary.length).toBeGreaterThan(0);
    }
  });

  it("says how to use an antidote wherever an antidote can be used", () => {
    // Every binding table has an antidote key; a guide that forgot it would send people
    // into a game holding a cure they cannot fire.
    for (const id of ["keyboard", "pad"]) {
      const section = EITTRIS_CONTROL_GUIDE.find((s) => s.id === id)!;
      expect(allEntries(section).some((e) => /antidote/i.test(e.detail))).toBe(true);
    }
  });

  it("gives every keyboard seat the whole game, not a subset of it", () => {
    // A seat missing an action is a player who cannot fire an antidote all evening and has
    // no way to find out why.
    const keyboard = EITTRIS_CONTROL_GUIDE.find((s) => s.id === "keyboard")!;
    expect(keyboard.layouts!.length).toBe(4);
    const wanted = [
      /move left and right/i,
      /down one row/i,
      /rotate clockwise/i,
      /counter-clockwise/i,
      /hard drop/i,
      /aim at/i,
      /antidote/i,
      /earthquake/i,
    ];
    for (const layout of keyboard.layouts!) {
      for (const want of wanted) {
        expect(layout.entries.some((e) => want.test(e.detail))).toBe(true);
      }
      // ...and every one of them names a key
      for (const entry of layout.entries) expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe("EITtris TargetList - showing a hit", () => {
  it("flares the entry of whoever just took one", () => {
    const { container } = renderList(
      fakeModel({ hitPulses: new Map([["B", { seq: 3, repelled: false }]]) } as any),
    );
    expect(container.querySelectorAll('[class*="hitFlash"]').length).toBe(1);
  });

  it("marks a shielded hit apart from one that landed", () => {
    const { container } = renderList(
      fakeModel({ hitPulses: new Map([["B", { seq: 4, repelled: true }]]) } as any),
    );
    expect(container.querySelectorAll('[class*="hitFlashRepelled"]').length).toBe(1);
  });

  it("shows nothing when nobody has been hit", () => {
    const { container } = renderList(fakeModel());
    expect(container.querySelectorAll('[class*="hitFlash"]').length).toBe(0);
  });
});

describe("EITtris ControlsHelp - picking a keyboard seat", () => {
  const openKeyboard = () => {
    render(<ControlsHelp />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard" }));
  };

  it("offers the four seats", () => {
    openKeyboard();
    for (const seat of ["Arrows", "WASD", "IJKL", "Numpad"]) {
      expect(screen.getByRole("button", { name: seat })).toBeInTheDocument();
    }
  });

  it("shows one seat's keys at a time", () => {
    openKeyboard();
    // Arrows first, so the list is never empty
    expect(screen.getByText("← →")).toBeInTheDocument();
    expect(screen.queryByText("A D")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "WASD" }));
    expect(screen.getByText("A D")).toBeInTheDocument();
    expect(screen.queryByText("← →")).not.toBeInTheDocument();
  });

  it("swaps every key, not just the arrows", () => {
    openKeyboard();
    fireEvent.click(screen.getByRole("button", { name: "Numpad" }));
    expect(screen.getByText("4 6")).toBeInTheDocument();
    expect(screen.getByText("- / +")).toBeInTheDocument();
    expect(screen.queryByText("Space")).not.toBeInTheDocument(); // the numpad has its own drop
  });

  it("forgets the seat when another kind of control is opened", () => {
    openKeyboard();
    fireEvent.click(screen.getByRole("button", { name: "IJKL" }));
    expect(screen.getByText("J L")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keyboard" })); // closed
    expect(screen.queryByText("J L")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard" })); // and open again
    expect(screen.getByText("← →")).toBeInTheDocument();
  });

  it("leaves a control type with no seats alone", () => {
    render(<ControlsHelp />);
    fireEvent.click(screen.getByRole("button", { name: "Controller" }));
    expect(screen.queryByRole("button", { name: "WASD" })).not.toBeInTheDocument();
    expect(screen.getByText(/D-pad/)).toBeInTheDocument();
  });
});
