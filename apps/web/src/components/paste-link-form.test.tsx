// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasteLinkForm } from "./paste-link-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("PasteLinkForm", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("names the platform as the visitor types", () => {
    render(<PasteLinkForm />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "example.com/video/abcdefghijk" } });
    expect(screen.getByText(/MuteScroll reads a public video link when it can reach it/)).toBeTruthy();

    fireEvent.change(input, { target: { value: "not a link" } });
    expect(screen.getByText("This doesn't look like a link yet.")).toBeTruthy();
  });

  it("hands a valid link to /try", () => {
    render(<PasteLinkForm />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "example.com/video/abcdefghijk" } });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(push).toHaveBeenCalledWith("/try?url=https%3A%2F%2Fexample.com%2Fvideo%2Fabcdefghijk");
  });

  it("explains an invalid link instead of navigating", () => {
    render(<PasteLinkForm />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(screen.getByRole("alert").textContent).toContain("Paste a full public video link");
    expect(push).not.toHaveBeenCalled();
  });
});
