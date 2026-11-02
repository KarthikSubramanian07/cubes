import { act, fireEvent, render, screen } from "@testing-library/react";
import { THEME_KEY, readThemePref, resolveTheme, setThemePref } from "@/app/theme";
import { ThemeToggle } from "@/ui/ThemeToggle";

function mockSystemDark(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({
      matches: q.includes("dark") ? dark : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  mockSystemDark(false);
});

describe("theme", () => {
  test("defaults to the system preference", () => {
    expect(readThemePref()).toBe("system");
    expect(resolveTheme("system")).toBe("light");
    mockSystemDark(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  test("setThemePref persists and paints <html data-theme>", () => {
    setThemePref("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    setThemePref("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("ThemeToggle flips the theme, labels the next one, and remembers it", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: "Switch to dark theme" });
    act(() => fireEvent.click(btn));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" })));
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  test("ThemeToggle starts from the system theme when nothing is stored", () => {
    mockSystemDark(true);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });
});
