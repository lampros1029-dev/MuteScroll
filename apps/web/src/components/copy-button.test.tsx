// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
  it("copies the value to the clipboard and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<CopyButton label="Copy as Markdown" value="# Title" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("# Title");
    expect(screen.getByRole("status").textContent).toBe("Copy as Markdown copied to the clipboard.");
  });
});
