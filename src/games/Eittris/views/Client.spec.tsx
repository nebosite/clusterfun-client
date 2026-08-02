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
  it("describes something for every way to play", () => {
    expect(EITTRIS_CONTROL_GUIDE.map((s) => s.id)).toEqual(["touch", "keyboard", "pad"]);
    for (const section of EITTRIS_CONTROL_GUIDE) {
      expect(section.entries.length).toBeGreaterThan(0);
      expect(section.summary.length).toBeGreaterThan(0);
    }
  });

  it("says how to use an antidote wherever an antidote can be used", () => {
    // Every binding table has an antidote key; a guide that forgot it would send people
    // into a game holding a cure they cannot fire.
    for (const id of ["keyboard", "pad"]) {
      const section = EITTRIS_CONTROL_GUIDE.find((s) => s.id === id)!;
      expect(section.entries.some((e) => /antidote/i.test(e.detail))).toBe(true);
    }
  });
});
