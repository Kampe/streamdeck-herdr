import { describe, expect, it } from "vitest";

import { FavoritesStore } from "./favorites.js";

describe("FavoritesStore", () => {
  it("toggles persistent session IDs", () => {
    const store = new FavoritesStore(["a"]);
    expect(store.has("a")).toBe(true);
    expect(store.toggle("a")).toBe(false);
    expect(store.toggle("b")).toBe(true);
    expect([...store.ids]).toEqual(["b"]);
  });
});

