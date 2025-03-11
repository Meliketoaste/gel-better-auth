import { betterAuth, BetterAuthError, generateId } from "better-auth";
import { getAuthTables } from "better-auth/db";
import type { Adapter, BetterAuthOptions, Where } from "better-auth/types";
import { type $infer } from "../dbschema/edgeql-js";
import type { Client } from "gel";
import { withApplyDefault } from "./utils";

// const edgeDBTypeMap: Record<string, string> = {
//   string: "str",
//   date: "datetime",
//   boolean: "bool",
//   number: "int64",
//   bigint: "bigint",
//   json: "json",
//   uuid: "uuid",
//   array: "array<anytype>",
// };

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
    convertWhereClause(where: Where[], model: string, e: any) {
      return where.map((clause) => {
        const { field: _field, value, operator } = clause;
        const field = getField(model, _field);
        const type = getType(model, _field);
        switch (operator) {
          case "eq":
            return e.op(e[model][field].id, "=", value);
          case "in":
            if (type === "id") {
              return e.op(e[model][field], "in", e.uuid(value));
            }
            if (Array.isArray(value)) {
              return (
                e[model][field],
                "in",
                e.array_unpack(e.literal(e.array(e.str), value))
              );
            }
            return e.op(e[model][field].id, "in", value);
          case "contains":
            return `${field} CONTAINS '${JSON.stringify(value)}'`;
          case "starts_with":
            return `string::starts_with(${field},'${value}')`;
          case "ends_with":
            return `string::ends_with(${field},'${value}')`;
          default:
            if (type == "id") {
              return e.op(e[model].id, "=", e.uuid(value));
            }
            if (type == "reference") {
              return e.op(e[model][field].id, "=", e.uuid(value));
            }
            if (value) {
              return e.op(e[model][field], "=", value);
            } else {
              return e.op(e[model][field], "=", value);
            }
        }
      });
    },
    filtero(where: Where[], model: string, e: any, obj: any) {
      return where.map((clause) => {
        const { field: _field, value, operator } = clause;
        const field = getField(model, _field);
        const type = getType(model, _field);
        switch (operator) {
          case "eq":
            return e.op(obj.id, "=", value);
          case "in":
            if (type === "id") {
              return e.op(obj[field], "in", e.uuid(value));
            }
            if (Array.isArray(value)) {
              return e.op(
                obj[field],
                "in",
                e.array_unpack(e.literal(e.array(e.str), value)),
              );
            }
            return e.op(obj[field], "in", value);
          case "contains":
            if (type === "id") {
              return e.op(obj[field], "ilike", e.uuid(value));
            }
            if (Array.isArray(value)) {
              return e.op(
                obj[field],
                "ilike",
                e.array_unpack(e.literal(e.array(e.str), value)),
              );
            }
            return e.op(obj[field], "ilike", value);
          case "starts_with":
            return e.op(obj[field], "ilike", `${value}%`);
          case "ends_with":
            return e.op(obj[field], "ilike", `%${value}`);
          default:
            if (type == "id") {
              return e.op(obj.id, "=", e.uuid(value));
            }
            if (type == "reference") {
              return e.op(obj[field].id, "=", e.uuid(value));
            }
            if (value) {
              return e.op(obj[field], "=", value);
            } else {
              return e.op(obj[field], "=", value);
            }
        }
      });
    },
    transformSelect,
    getField,
    getSchema,
    getSchemaTypes,
  };
};

export function gelAdapter(db: Client, e: any) {
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
      filtero,
      getSchemaTypes,
    } = createTransform(options);

    const adapter: Adapter = {
      id: "gel",

      async create({ model, data, select }) {
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
        // TODO: refactor convertWhereClause, obj
        const whereclause = convertWhereClause(where, model, e);
        const schema = getSchemaTypes(model);

        let selectClause =
          select.length > 0
            ? Object.fromEntries(select.map((field) => [field, true]))
            : e[model]["*"];

        const referenceField = Object.keys(schema).find(
          (key) => schema[key]?.references,
        );

        if (referenceField) {
          selectClause = {
            ...selectClause,
            [referenceField]: { ...e[model][referenceField]["*"] },
          };
        }
        const query = e.select(e[model], (obj: any) => {
          return {
            ...selectClause,
            filter_single: whereclause[0],
          };
        });

        const result = await query.run(db);

        if (referenceField) {
          result[referenceField] = result[referenceField]?.id;
        }

        return transformOutput(result, model, select);
      },

      async findMany({ model, where, limit, offset, sortBy }) {
        const query = e.select(e[model], (obj: any) => {
          const whereclause = filtero(where ?? [], model, e, obj);
          return {
            ...obj["*"],
            limit: limit,
            offset: offset,
            filter: where ? whereclause[0] : undefined,

            order_by: sortBy?.field
              ? {
                  expression: obj[sortBy.field],
                  direction: e[sortBy.direction.toUpperCase()],
                }
              : undefined,
          };
        });
        const results = await query.run(db);

        return results.map((record: any) => transformOutput(record, model));
      },

      async delete({ model, where }) {
        const query = e.delete(e[model], (obj: any) => {
          const whereclause = filtero(where, model, e, obj);
          return {
            ...obj["*"],
            filter_single: where ? whereclause[0] : undefined,
          };
        });
        const results = await query.run(db);
        return transformOutput(results, model);
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
