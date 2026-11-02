/** Routes owned by the renderer. The site shell wires these into the app router. */
export const labRoute = { path: "/lab", lazy: async () => ({ Component: (await import("./Lab")).Lab }) };
