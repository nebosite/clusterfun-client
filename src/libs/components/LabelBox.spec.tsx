import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LabelBox } from "./LabelBox";

// LabelBox is a click-to-edit label used in the lobby. It starts as read-only
// text, becomes an input when clicked, and submits the edited value on Enter or
// blur.

function clickToEdit(text: string) {
    const label = screen.getByText(text);
    fireEvent.mouseDown(label);
    fireEvent.mouseUp(label);
}

describe("LabelBox", () => {

    it("shows the label text as read-only initially", () => {
        render(<LabelBox text="Hello" onSubmit={() => { }} />);
        expect(screen.getByText("Hello")).toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("switches to an editable input seeded with the current text when clicked", () => {
        render(<LabelBox text="Hello" onSubmit={() => { }} />);
        clickToEdit("Hello");
        expect(screen.getByRole("textbox")).toHaveValue("Hello");
    });

    it("submits the edited value when Enter is pressed", () => {
        const onSubmit = jest.fn();
        render(<LabelBox text="Hello" onSubmit={onSubmit} />);
        clickToEdit("Hello");

        const input = screen.getByRole("textbox");
        fireEvent.change(input, { target: { value: "World" } });
        fireEvent.keyDown(input, { keyCode: 13 });

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith("World");
    });

    it("submits the edited value when the input loses focus", () => {
        const onSubmit = jest.fn();
        render(<LabelBox text="Hi" onSubmit={onSubmit} />);
        clickToEdit("Hi");

        const input = screen.getByRole("textbox");
        fireEvent.change(input, { target: { value: "Bye" } });
        fireEvent.blur(input);

        expect(onSubmit).toHaveBeenCalledWith("Bye");
    });

    it("returns to read-only text after submitting", () => {
        render(<LabelBox text="Hello" onSubmit={() => { }} />);
        clickToEdit("Hello");
        fireEvent.keyDown(screen.getByRole("textbox"), { keyCode: 13 });
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
});
