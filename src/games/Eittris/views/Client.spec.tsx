import React from "react";
import { render, screen } from "@testing-library/react";
import { Provider } from "mobx-react";
import { TargetList } from "./Client";
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
