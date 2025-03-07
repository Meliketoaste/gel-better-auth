import { beforeAll, describe, expect, it } from "bun:test";
import { gelAdapter } from "../src";
import { runAdapterTest } from "./runAdapterTest";
import { getTestInstance } from "./testInstance";

import { createClient } from "gel";

describe("adapter test", async () => {
  const db = createClient();

  async function setupDB() {
    await db.execute("delete session;");
    await db.execute("delete account;");
    await db.execute("delete user;");
  }

  beforeAll(async () => {
    await setupDB();
  });

  const adapter = gelAdapter(db);
  await runAdapterTest({
    getAdapter: async (customOptions = {}) => {
      return adapter({
        user: {
          // fields: {
          //   email: "email_address",
          // },
          // additionalFields: {
          //   test: {
          //     type: "string",
          //     defaultValue: "test",
          //   },
          // },
        },
        // session: {
        //   modelName: "sessions",
        // },
        ...customOptions,
      });
    },
    skipGenerateIdTest: true,
  });
});

describe("simple-flow", async () => {
  const { auth, client, sessionSetter } = await getTestInstance(
    {},
    {
      disableTestUser: true,
      testWith: "surreal",
    },
  );
  const testUser = {
    email: "test-eamil@email.com",
    password: "password",
    name: "Test Name",
  };

  it("should sign up", async () => {
    const user = await auth.api.signUpEmail({
      body: testUser,
    });
    expect(user).toBeDefined();
  });

  it("should sign in", async () => {
    const user = await auth.api.signInEmail({
      body: testUser,
    });
    expect(user).toBeDefined();
  });

  it("should get session", async () => {
    const headers = new Headers();
    await client.signIn.email(
      {
        email: testUser.email,
        password: testUser.password,
      },
      {
        onSuccess: sessionSetter(headers),
      },
    );
    const { data: session } = await client.getSession({
      fetchOptions: { headers },
    });
    expect(session?.user).toBeDefined();
  });
});
