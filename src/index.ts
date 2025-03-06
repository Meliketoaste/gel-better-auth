import { betterAuth, BetterAuthError, generateId } from "better-auth";
import { getAuthTables } from "better-auth/db";
import type { Adapter, BetterAuthOptions, Where } from "better-auth/types";

import type { Client } from "gel";
import { withApplyDefault } from "./utils";
// import { jsonify, RecordId, Surreal } from "surrealdb";
// import { withApplyDefault } from "./utils";

import { createClient } from "gel";

const edgeDBTypeMap: Record<string, string> = {
  string: "str",
  date: "datetime",
  boolean: "bool",
  number: "int64",
  bigint: "bigint",
  json: "json",
  uuid: "uuid",
  array: "array<anytype>",
};

const createTransform = (options: BetterAuthOptions) => {
  const schema = getAuthTables(options);

  function transformSelect(select: string[], model: string): string[] {
    if (!select || select.length === 0) return [];
    return select.map((field) => getField(model, field));
  }

  function getField(model: string, field: string) {
    if (field === "id") {
      return field;
    }
    const f = schema[model].fields[field];
    return f.fieldName || field;
  }

  function getSchema(modelName: string) {
    if (!schema) {
      throw new BetterAuthError(
        "Drizzle adapter failed to initialize. Schema not found. Please provide a schema object in the adapter options object.",
      );
    }
    const model = getModelName(modelName);
    const schemaModel = schema[model];
    if (!schemaModel) {
      throw new BetterAuthError(
        `[# Drizzle Adapter]: The model "${model}" was not found in the schema object. Please pass the schema directly to the adapter options.`,
      );
    }
    return schemaModel;
  }

  const getModelName = (model: string) => {
    return schema[model].modelName !== model
      ? schema[model].modelName
      : false
        ? `${model}s`
        : model;
  };

  return {
    transformInput(
      data: Record<string, any>,
      model: string,
      action: "update" | "create",
    ) {
      const transformedData: Record<string, any> =
        action === "update"
          ? {}
          : {
              // id: options.advanced?.generateId // Edgedb Id's have to be generated.
              //   ? options.advanced.generateId({ model })
              //   : data.id || generateId(),
            };

      const fields = schema[model].fields;
      for (const field in fields) {
        const value = data[field];
        if (value === undefined && !fields[field].defaultValue) {
          continue;
        }
        transformedData[fields[field].fieldName || field] = withApplyDefault(
          value,
          fields[field],
          action,
        );
      }
      return transformedData;
    },
    transformOutput(
      data: Record<string, any>,
      model: string,
      select: string[] = [],
    ) {
      if (!data) return null;
      const transformedData: Record<string, any> =
        data.id && (select.length === 0 || select.includes("id"))
          ? { id: data.id }
          : {};

      const tableSchema = schema[model].fields;

      for (const key in tableSchema) {
        if (select.length && !select.includes(key)) {
          continue;
        }
        const field = tableSchema[key];
        if (field) {
          transformedData[key] = data[field.fieldName || key];
        }
      }
      return transformedData as any;
    },
    convertWhereClause(where: Where[], model: string) {
      return where
        .map((clause) => {
          const { field: _field, value, operator } = clause;
          const field = getField(model, _field);
          switch (operator) {
            case "eq":
              return field === "id" || value
                ? `${field} = ${JSON.stringify(value)}`
                : `${field} = '${JSON.stringify(value)}'`;
            case "in":
              return `${field} IN [${JSON.stringify(value)}]`;
            case "contains":
              return `${field} CONTAINS '${JSON.stringify(value)}'`;
            case "starts_with":
              return `string::starts_with(${field},'${value}')`;
            case "ends_with":
              return `string::ends_with(${field},'${value}')`;
            default:
              return field === "id" || value
                ? `${field} = ${JSON.stringify(value)}`
                : `${field} = '${JSON.stringify(value)}'`;
          }
        })
        .join(" AND ");
    },
    transformSelect,
    getField,
    getSchema,
  };
};

export const gelAdapter =
  (db: Client) => async (options: BetterAuthOptions) => {
    if (!db) {
      throw new Error("Gel adapter requires a gel client");
    }

    const {
      transformInput,
      getSchema,
      transformOutput,
      convertWhereClause,
      getField,
    } = createTransform(options);

    return {
      id: "gel",

      create: async ({ model, data }) => {
        const schema = getSchema(model);
        const transformed = transformInput(data, model, "create");
        const queryFields = Object.entries(schema.fields)
          .filter(([fieldName]) => transformed[fieldName] !== undefined)
          .map(([fieldName, { type, references }]) => {
            if (references) {
              return `${fieldName} := (select ${references.model} filter .${references.field} = <uuid>$${fieldName})`;
            } else {
              const fieldType =
                edgeDBTypeMap[type as keyof typeof edgeDBTypeMap] || "str";
              return `${fieldName} := <${fieldType}>$${fieldName}`;
            }
          })
          .join(",\n");

        const query = `
insert ${model} {
  ${queryFields}
}`;

        console.log(model, transformed);
        const result = await db.querySingle<any>(query, transformed);

        return transformOutput(result, model);
      },
      findOne: async ({ model, where, select = [] }) => {
        const whereClause = convertWhereClause(where, model);
        const selectClause =
          (select.length > 0 && select.map((f) => getField(model, f))) || [];
        const query = `SELECT user`;
        const result = await db.query<[any[]]>(query);
        // console.log(result);

        return undefined as any;
      },
      findMany: async ({ model, where, sortBy, limit, offset }) => {
        return "unimplemented" as any;
      },
      update: async ({ model, where, update }) => {
        return "unimplemented" as any;
      },
      count: async ({ model, where }) => {
        return "unimplemented" as any;
      },
      delete: async ({ model, where }) => {
        return "unimplemented" as any;
      },
      deleteMany: async ({ model, where }) => {
        return 0;
      },
      updateMany: async ({ model, where, update }) => {
        return "unimplemented" as any;
      },
    } satisfies Adapter;
  };

export const gel = createClient({
  tlsSecurity: "insecure",
});

export const auth = betterAuth({
  database: gelAdapter(gel),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
});

auth.api.signUpEmail({
  body: {
    name: "john",
    email: "example@example.com",
    password: "passworrd",
  },
});
