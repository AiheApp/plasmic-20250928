import { acceptsSamplingParams } from "@/wab/server/copilot/llms";

describe("acceptsSamplingParams", () => {
  it.each([
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5-1",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ])("rejects sampling params for %s", (model) => {
    expect(acceptsSamplingParams(model)).toBe(false);
  });

  it.each([
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-4-20250514",
    "claude-3-5-sonnet-20241022",
    "gpt-4o",
  ])("accepts sampling params for %s", (model) => {
    expect(acceptsSamplingParams(model)).toBe(true);
  });
});
