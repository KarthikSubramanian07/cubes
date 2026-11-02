import "@testing-library/jest-dom/vitest";

// Component tests render real SVG trees; give slow CI machines room before calling it a hang.
vi.setConfig({ testTimeout: 20_000 });
