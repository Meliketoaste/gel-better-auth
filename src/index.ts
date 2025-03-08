import { betterAuth, BetterAuthError, generateId } from "better-auth";
import { getAuthTables } from "better-auth/db";
import type { Adapter, BetterAuthOptions, Where } from "better-auth/types";
import { type $infer } from "../dbschema/edgeql-js";
import type { Client } from "gel";
import { withApplyDefault } from "./utils";
// import { jsonify, RecordId, Surreal } from "surrealdb";
// import { withApplyDefault } from "./utils";

// import { createClient } from "gel";

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

  function getType(model: string, type: string) {
    if (type === "id") {
      return type;
    }

    const f = schema[model]?.fields[type];

    if (!f) {
      throw new Error(`Field "${type}" not found in model "${model}"`);
    }

    // If the field has a reference and its type is "id", return "id"
    if (f.references && f.references.field === "id") {
      return "reference";
    }

    return f.type;
  }
  function getSchemaTypes(modelName: string) {
    if (!schema) {
      throw new BetterAuthError(
        "Gel adapter failed to initialize. Schema not found. Please provide a schema object in the adapter options object.",
      );
    }
    const model = getModelName(modelName);
    const schemaModel = schema[model];
    // console.log(schemaModel.fields);
    return schemaModel.fields;
  }

  function getSchema(modelName: string) {
    if (!schema) {
      throw new BetterAuthError(
        "Gel adapter failed to initialize. Schema not found. Please provide a schema object in the adapter options object.",
      );
    }
    const model = getModelName(modelName);
    const schemaModel = schema[model];
    if (!schemaModel) {
      throw new BetterAuthError(
        `[# Gel Adapter]: The model "${model}" was not found in the schema object. Please pass the schema directly to the adapter options.`,
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
          const type = getType(model, _field);
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
              if (type == "id") {
                return `.${field} = <uuid>${JSON.stringify(value)}`;
              }
              if (type == "reference") {
                return `.${field}.id = <uuid>${JSON.stringify(value)}`;
              }
              return field === "id" || value
                ? `.${field} = ${JSON.stringify(value)}`
                : `.${field} = '${JSON.stringify(value)}'`;
          }
        })
        .join(" AND ");
    },
    transformSelect,
    getField,
    getSchema,
    getSchemaTypes,
  };
};

export function gelAdaptero(db: Client, e: any) {
  if (!db) {
    throw new Error("Gel adapter requires a gel client");
  }

  return (options: BetterAuthOptions = {}): Adapter => {
    const {
      transformInput,
      getSchema,
      transformOutput,
      convertWhereClause,
      getField,
      getSchemaTypes,
    } = createTransform(options);

    const adapter: Adapter = {
      id: "gel",

      async create({ model, data }) {
        const schema = getSchemaTypes(model);

        let transformed = transformInput(data, model, "create");

        Object.keys(transformed).forEach((key) => {
          const field = schema[key];

          if (field?.references) {
            const refModel = field.references.model;

            transformed[key] = e.select(e[refModel], () => ({
              filter_single: { id: transformed[key] },
            }));
          }
        });

        const insertQuery = e.insert(e[model], transformed);

        const query = e.select(insertQuery, () => ({
          ...e[model]["*"],
        }));

        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async findOne({ model, where, select = [] }) {
        const schema = getSchemaTypes(model);
        let query;

        let selectClause =
          select.length > 0
            ? Object.fromEntries(select.map((field) => [field, true]))
            : e[model]["*"];

        query = e.select(e[model], (obj: any) => {
          let filterCondition;
          Object.keys(schema).forEach((key) => {
            const val = schema[key];

            if (val?.references) {
              selectClause = {
                userId: {
                  id: true,
                },
              };
              filterCondition = e.op(
                obj.userId.id,
                "=",
                e.cast(e.uuid, where[0].value),
              );
            }
          });
          if (filterCondition == undefined) {
            filterCondition = e.op(obj[where[0].field], "=", where[0].value);
          }

          return {
            ...selectClause,
            filter_single: filterCondition,
          };
        });

        const result = await query.run(db);

        if (model === "session") {
          if (result.userId && result.userId.id) {
            // should be handled by transformoutput
            result.userId = result.userId.id;
          }
        }

        return transformOutput(result, model, select);
      },

      async findMany({ model, where, limit, offset, sortBy }) {
        const query = e.select(e[model], (obj: any) => {
          if (where) {
            return {
              ...obj["*"],
              filter: e.op(obj[where[0].field], "=", where[0].value),
              limit: limit,
            };
          }

          return {
            ...obj["*"],
            limit: limit,
          };
        });
        const results = await query.run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async delete({ model, where }) {
        // e[model][where[0].field],
        // "=",
        // where[0].value,
        const query = e.delete(e[model], () => ({
          filter_single: { id: where[0].value }, // this is stopid
        }));
        const results = await query.run(db);
      },
      async deleteMany({ model, where }) {
        return "unimplemented" as any;
      },

      async count({ model, where }) {
        return "unimplemented" as any;
      },

      async update({ model, where, update }) {
        return "unimplemented" as any;
      },
      async updateMany({ model, where, update }) {
        return "unimplemented" as any;
      },
      // async createSchema(schema) {
      //   return "unimplemented" as any;
      // },
    };
    return adapter;
  };
}

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
select(insert ${model} {
  ${queryFields}
}) {*}`;

        const result = await db.querySingle<any>(query, transformed);

        return transformOutput(result, model);
      },
      findOne: async ({ model, where, select = [] }) => {
        const whereClause = convertWhereClause(where, model);
        const selectClause = select.length > 0 ? `${select.join(", ")}` : "*";
        const query = `select ${model} {${selectClause}} filter ${whereClause} limit 1`; // select
        const result = await db.querySingle<any>(query);
        return transformOutput(result, model);
      },
      findMany: async ({ model, where, sortBy, limit, offset }) => {
        const schema = getSchema(model);

        let query = `
select ${model} {*}
`;

        if (where) {
          const whereClause = convertWhereClause(where, model);

          query += ` filter ${whereClause}`;
        }

        const results = await db.query<any[]>(query);

        return results.map((record) => transformOutput(record, model));
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
//
// export const gel = createClient({
//   tlsSecurity: "insecure",
// });
//
// export const auth = betterAuth({
//   database: gelAdapter(gel),
//   emailAndPassword: {
//     enabled: true,
//     autoSignIn: false,
//   },
// });
//
// auth.api.signUpEmail({
//   body: {
//     name: "john",
//     email: "example@example.com",
//     password: "passworrd",
//   },
// });
