import { afterEach, describe, expect, it } from "vitest";
import { setDepsForTests } from "@/lib/deps";
import { handleTutorial, type TutorialAccount } from "@/lib/http/tutorial";
import { createMemoryStore } from "@/lib/memory-store";

function signedIn(email: string | null = "owner@example.com") {
  setDepsForTests({ store: createMemoryStore(), pluggy: null, now: () => new Date(), userEmail: email, sendEmail: async () => {} });
}

function account(initial = false): TutorialAccount & { value: boolean } {
  const box = {
    value: initial,
    read: async () => box.value,
    write: async (seen: boolean) => {
      box.value = seen;
    },
  };
  return box;
}

const get = () => new Request("http://localhost/api/tutorial");
const post = (body: unknown) =>
  new Request("http://localhost/api/tutorial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => setDepsForTests(null));

describe("welcome tour flag", () => {
  it("a new account has not seen the tour", async () => {
    signedIn();
    const response = await handleTutorial(get(), account(false));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seen: false });
  });

  it("finishing or skipping saves it on the account", async () => {
    signedIn();
    const store = account(false);
    const response = await handleTutorial(post({ seen: true }), store);
    expect(response.status).toBe(200);
    expect(store.value).toBe(true);
    expect(await (await handleTutorial(get(), store)).json()).toEqual({ seen: true });
  });

  it("rejects a body without a yes or no", async () => {
    signedIn();
    const store = account(false);
    expect((await handleTutorial(post({ seen: "yes" }), store)).status).toBe(400);
    expect(store.value).toBe(false);
  });

  it("needs a signed in user", async () => {
    signedIn(null);
    const store = account(false);
    expect((await handleTutorial(post({ seen: true }), store)).status).toBe(401);
    expect(store.value).toBe(false);
  });

  it("a failing account answers 500 instead of throwing", async () => {
    signedIn();
    const broken: TutorialAccount = {
      read: async () => {
        throw new Error("down");
      },
      write: async () => {},
    };
    expect((await handleTutorial(get(), broken)).status).toBe(500);
  });
});
