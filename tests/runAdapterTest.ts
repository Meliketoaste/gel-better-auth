import { generateId } from "better-auth";
import type { Adapter, BetterAuthOptions, User } from "better-auth/types";
import { expect, test } from "bun:test";
interface AdapterTestOptions {
  getAdapter: (
    customOptions?: Omit<BetterAuthOptions, "database">,
  ) => Promise<Adapter>;
  skipGenerateIdTest?: boolean;
}

let woah: any = "e";
export async function runAdapterTest(opts: AdapterTestOptions) {
  const adapter = await opts.getAdapter();
  //
  // const userwithid = {
  //   name: "user",
  //   email: "user@email.com",
  //   emailVerified: true,
  //   createdAt: new Date(),
  //   updatedAt: new Date(),
  // };
  //
  let user: any = {
    id: undefined,
    name: "user",
    email: "user@email.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test("create model", async () => {
    const res = await adapter.create({
      model: "user",
      data: user,
    });
    woah = res.id;

    expect({
      name: res.name,
      email: res.email,
    }).toEqual({
      // ee
      name: user.name,
      email: user.email,
    });
  });

  test("find model", async () => {
    const res = await adapter.findOne<User>({
      model: "user",
      where: [
        {
          field: "name",
          value: user.name,
        },
      ],
    });
    expect({
      name: res?.name,
      email: res?.email,
    }).toEqual({
      name: user.name,
      email: user.email,
    });
  });

  test("find model without id", async () => {
    const res = await adapter.findOne<User>({
      model: "user",
      where: [
        {
          field: "email",
          value: user.email,
        },
      ],
    });
    expect({
      name: res?.name,
      email: res?.email,
    }).toEqual({
      name: user.name,
      email: user.email,
    });
  });

  test("find model with select", async () => {
    const res = await adapter.findOne({
      model: "user",
      where: [
        {
          field: "name",
          value: user.name,
        },
      ],
      select: ["email"],
    });
    expect(res).toEqual({ email: user.email });
  });

  test("update model", async () => {
    // works but fucks up other tests.
    const newEmail = "updated@email.com";

    const res = await adapter.update<User>({
      model: "user",
      where: [
        {
          field: "email",
          value: user.email,
        },
      ],
      update: {
        email: newEmail,
      },
    });
    expect(res).toMatchObject({
      email: newEmail,
      name: user.name,
    });
  });

  test("should find many", async () => {
    const res = await adapter.findMany({
      model: "user",
    });
    expect(res.length).toBe(1);
  });

  test("should find many with where", async () => {
    const user = await adapter.create<Record<string, any>>({
      model: "user",
      data: {
        id: "2",
        name: "user2",
        email: "test@email.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const res = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "id",
          value: user.id,
        },
      ],
    });
    expect(res.length).toBe(1);
  });

  test("should find many with operators", async () => {
    const newUser = await adapter.create({
      model: "user",
      data: {
        name: "user",
        email: "test-email2@email.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const res = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "email",
          operator: "in",
          value: [user.email, newUser.email],
        },
      ],
    });
    expect(res.length).toBe(2);
  });

  test("should work with reference fields", async () => {
    const user = await adapter.create<Record<string, any>>({
      model: "user",
      data: {
        name: "user",
        email: "my-email@email.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const sessiono = await adapter.create({
      model: "session",
      data: {
        token: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: user.id,
        expiresAt: new Date(),
      },
    });
    const res = await adapter.findOne({
      model: "session",
      where: [
        {
          field: "userId",
          value: user.id,
        },
      ],
    });
    expect(res).toMatchObject({
      userId: user.id,
    });
  });

  test("should find many with sortBy", async () => {
    await adapter.create({
      model: "user",
      data: {
        id: "5",
        name: "a",
        email: "a@email.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const res = await adapter.findMany<User>({
      model: "user",
      sortBy: {
        field: "name",
        direction: "asc",
      },
    });
    expect(res[0].name).toBe("a");

    const res2 = await adapter.findMany<User>({
      model: "user",
      sortBy: {
        field: "name",
        direction: "desc",
      },
    });

    expect(res2[res2.length - 1].name).toBe("a");
  });

  test("should find many with limit", async () => {
    const res = await adapter.findMany({
      model: "user",
      limit: 1,
    });
    expect(res.length).toBe(1);
  });

  test("should find many with offset", async () => {
    const res = await adapter.findMany({
      model: "user",
      offset: 2,
    });
    expect(res.length).toBe(3);
  });

  test("should update with multiple where", async () => {
    await adapter.updateMany({
      model: "user",
      where: [
        {
          field: "name",
          value: user.name,
        },
        {
          field: "email",
          value: user.email,
        },
      ],
      update: {
        email: "updated@email.com",
      },
    });
    const updatedUser = await adapter.findOne<User>({
      model: "user",
      where: [
        {
          field: "email",
          value: "updated@email.com",
        },
      ],
    });
    expect(updatedUser).toMatchObject({
      name: user.name,
      email: "updated@email.com",
    });
  });

  test("delete model", async () => {
    await adapter.delete({
      model: "user",
      where: [
        {
          field: "email",
          value: "user@email.com",
        },
      ],
    });
    const findRes = await adapter.findOne({
      model: "user",
      where: [
        {
          field: "email",
          value: "user@email.com",
        },
      ],
    });
    expect(findRes).toBeNull();
  });

  test("should delete many", async () => {
    for (const id of ["to-be-delete1", "to-be-delete2", "to-be-delete3"]) {
      await adapter.create({
        model: "user",
        data: {
          id,
          name: "to-be-deleted",
          email: `email@test-${id}.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const findResFirst = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "name",
          value: "to-be-deleted",
        },
      ],
    });
    expect(findResFirst.length).toBe(3);
    await adapter.deleteMany({
      model: "user",
      where: [
        {
          field: "name",
          value: "to-be-deleted",
        },
      ],
    });
    const findRes = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "name",
          value: "to-be-deleted",
        },
      ],
    });
    expect(findRes.length).toBe(0);
  });

  test("shouldn't throw on delete record not found", async () => {
    await adapter.delete({
      model: "user",
      where: [
        {
          field: "id",
          value: "5",
        },
      ],
    });
  });

  test("shouldn't throw on record not found", async () => {
    const res = await adapter.findOne({
      model: "user",
      where: [
        {
          field: "id",
          value: "5",
        },
      ],
    });
    expect(res).toBeNull();
  });

  test("should find many with contains operator", async () => {
    const res = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "name",
          operator: "contains",
          value: "user2",
        },
      ],
    });
    expect(res.length).toBe(1);
  });

  test("should search users with startsWith", async () => {
    const res = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "name",
          operator: "starts_with",
          value: "us",
        },
      ],
    });
    expect(res.length).toBe(3);
  });

  test("should search users with endsWith", async () => {
    const res = await adapter.findMany({
      model: "user",
      where: [
        {
          field: "name",
          operator: "ends_with",
          value: "er2",
        },
      ],
    });
    expect(res.length).toBe(1);
  });

  test.skipIf(opts.skipGenerateIdTest || false)(
    "should prefer generateId if provided",
    async () => {
      const customAdapter = await opts.getAdapter({
        advanced: {
          generateId: () => "mocked-id",
        },
      });

      const res = await customAdapter.create({
        model: "user",
        data: {
          id: "1",
          name: "user4",
          email: "user4@email.com",
          emailVerified: true,
          createdAt: new Date(),

          updatedAt: new Date(),
        },
      });
      // expect(res.id).toBeInstanceOf(RecordId);
      // expect((res.id as unknown as RecordId).id).toBe("mocked-id");
    },
  );
}
