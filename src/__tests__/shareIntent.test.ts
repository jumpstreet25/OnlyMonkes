import { toSharedItem } from "@/lib/shareIntent";

describe("toSharedItem", () => {
  it("takes shared links/text and local images", () => {
    expect(toSharedItem({ type: "text", text: "  https://x.com/monke/status/1  " })).toEqual({ type: "text", text: "https://x.com/monke/status/1" });
    expect(toSharedItem({ type: "image", uri: "content://media/external/images/9", text: "look" })).toEqual({ type: "image", uri: "content://media/external/images/9", text: "look" });
  });
  it("ignores empty or unsafe shares", () => {
    expect(toSharedItem(null)).toBeNull();
    expect(toSharedItem({ type: "text", text: "   " })).toBeNull();
    expect(toSharedItem({ type: "image", uri: "https://evil.example/x.jpg" })).toBeNull();
    expect(toSharedItem({ type: "video", uri: "content://x" })).toBeNull();
  });
});
