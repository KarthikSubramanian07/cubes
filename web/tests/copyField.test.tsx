import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyField, copyText } from "@/ui/CopyField";

const URL = "https://playcubes.pages.dev/r/K7QXM";

function mockClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}

afterEach(() => {
  vi.restoreAllMocks();
  mockClipboard(undefined);
});

describe("CopyField", () => {
  test("renders the value in a labelled read-only input", () => {
    render(<CopyField label="Invite link" value={URL} />);
    const input = screen.getByLabelText("Invite link") as HTMLInputElement;
    expect(input.value).toBe(URL);
    expect(input.readOnly).toBe(true);
  });

  test("copies with the async clipboard API and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const onCopied = vi.fn();
    render(<CopyField label="Invite link" value={URL} onCopied={onCopied} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /copy link/i })));
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(onCopied).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText(/copied to your clipboard/i)).toBeInTheDocument();
  });

  test("falls back to execCommand when the clipboard API rejects", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    render(<CopyField label="Invite link" value={URL} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /copy link/i })));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  test("asks for a manual copy when every method fails", async () => {
    mockClipboard(undefined);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    render(<CopyField label="Invite link" value={URL} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /copy link/i })));
    expect(screen.getByText(/press (⌘|Ctrl)\+C/)).toBeInTheDocument();
  });

  test("copyText resolves false with nothing to fall back on", async () => {
    mockClipboard(undefined);
    Object.defineProperty(document, "execCommand", { configurable: true, value: undefined });
    expect(await copyText("x", null)).toBe(false);
  });
});
