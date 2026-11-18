import { floorFromBot } from "../src/floor";

describe("live floor", () => {
  test("takes the bot's Tensor floor", () => {
    expect(floorFromBot({ floorSol: 0.5136, floorSource: "tensor", listing: { listSol: 0.48, listed: 98, at: 5 } })).toEqual({ floorSol: 0.5136, source: "tensor", listSol: 0.48, listed: 98, at: 5 });
  });
  test("ignores an old bot (no Tensor source) and junk", () => {
    expect(floorFromBot({ floorSol: 0.307 })).toBeNull();
    expect(floorFromBot({ floorSol: 0, floorSource: "tensor" })).toBeNull();
    expect(floorFromBot(null)).toBeNull();
  });
});
