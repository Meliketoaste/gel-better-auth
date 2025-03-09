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

        let selectClause =
          select.length > 0
            ? Object.fromEntries(select.map((field) => [field, true]))
            : e[model]["*"];

        const referenceField = Object.keys(schema).find(
          (key) => schema[key]?.references,
        );

        let query;

        if (referenceField) {
          selectClause = {
            ...selectClause,
            [referenceField]: { id: true },
          };
          query = e.params({ userId: e.uuid }, (params: any) =>
            e.select(e[model], (obj: any) => ({
              ...selectClause,
              filter_single: e.op(obj.userId.id, "=", params.userId),
            })),
          );
        } else {
          const fieldType =
            typeof where[0].value === "number" ? e.int64 : e.str;

          query = e.params({ value: fieldType }, (params: any) =>
            e.select(e[model], (obj: any) => ({
              ...selectClause,
              filter_single: e.op(obj[where[0].field], "=", params.value),
            })),
          );
        }

        const params = referenceField
          ? { userId: where[0].value }
          : { value: where[0].value };

        const result = await query.run(db, params);

        if (referenceField) {
          result[referenceField] = result[referenceField]?.id;
        }

        return transformOutput(result, model, select);
      },

      async findMany({ model, where, limit, offset, sortBy }) {
        const query = e.select(e[model], (obj: any) => {
          if (where) {
            const filters = where.map((condition) =>
              e.op(obj[condition.field], "=", condition.value),
            );

            return {
              ...obj["*"],
              filter: e.all(e.set(...filters)),
              limit: limit,
              offset: offset,
            };
          }
          if (sortBy) {
            return {
              ...obj["*"],
              limit: limit,
              offset: offset,
              order_by: sortBy?.field
                ? {
                    expression: obj[sortBy.field],
                    direction: e[sortBy.direction.toUpperCase()],
                  }
                : undefined,
            };
          }
          return {
            ...obj["*"],
            limit: limit,
            offset: offset,
          };
        });
        const results = await query.run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async delete({ model, where }) {
        // e[model][where[0].field],
        // "=",
        // where[0].value,
        // const query = e.delete(e[model], () => ({
        //   filter_single: { id: where[0].value }, // this is stopid
        // }));
        // const results = await query.run(db);
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
