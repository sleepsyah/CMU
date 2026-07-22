import { describe, expect, it } from "vitest";
import { matchTopics } from "./topics";

describe("matchTopics", () => {
  it("matches keywords case-insensitively across multiple topics", () => {
    expect(matchTopics("Congress debates a new Medicaid expansion bill")).toContain("healthcare");
    expect(matchTopics("City council weighs a rent control and eviction moratorium")).toContain("housing");
    expect(matchTopics("STUDENT LOAN forgiveness plan announced")).toContain("education");
  });

  it("returns an empty array when nothing matches", () => {
    expect(matchTopics("Local bakery wins pastry award")).toEqual([]);
  });

  it("can return multiple matched topics for one article", () => {
    const topics = matchTopics("Veterans affairs bill also raises taxes on retirement benefits");
    expect(topics).toContain("veterans_affairs");
    expect(topics).toContain("taxation");
  });
});
