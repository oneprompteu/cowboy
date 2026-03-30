import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveGlobalCowboyDir } from "../src/core/global-storage.js";

describe("resolveGlobalCowboyDir", () => {
  it("uses the macOS Application Support directory", () => {
    const home = "/Users/tester";
    expect(resolveGlobalCowboyDir({}, "darwin", home)).toBe(
      join(home, "Library", "Application Support", "Cowboy"),
    );
  });

  it("uses XDG data home on Linux when available", () => {
    expect(resolveGlobalCowboyDir({ XDG_DATA_HOME: "/tmp/xdg-data" }, "linux", "/home/tester")).toBe(
      join("/tmp/xdg-data", "cowboy"),
    );
  });

  it("falls back to ~/.local/share on Linux", () => {
    const home = "/home/tester";
    expect(resolveGlobalCowboyDir({}, "linux", home)).toBe(
      join(home, ".local", "share", "cowboy"),
    );
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveGlobalCowboyDir({ LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, "win32", "C:\\Users\\tester"),
    ).toBe(
      join("C:\\Users\\tester\\AppData\\Local", "Cowboy"),
    );
  });

  it("prefers the explicit COWBOY_DATA_DIR override", () => {
    expect(resolveGlobalCowboyDir({ COWBOY_DATA_DIR: "/tmp/custom-cowboy" }, "darwin", "/Users/tester")).toBe(
      "/tmp/custom-cowboy",
    );
  });
});
