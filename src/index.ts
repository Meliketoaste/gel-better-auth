import { BetterAuthError } from "better-auth";
import { getAuthTables } from "better-auth/db";
import type { Adapter, BetterAuthOptions, Where } from "better-auth/types";
import type { Client } from "gel";
import { withApplyDefault } from "./utils";
import { writeFile } from "fs/promises";
import { join } from "path";

const createTransform = (options: BetterAuthOptions) => {
  const schema = getAuthTables(options);

  function transformSelect(select: string[], model: string, e: any) {
    let selectClause =
      select.length > 0
        ? Object.fromEntries(select.map((field) => [field, true]))
        : e[model]["*"];
    const schemato = schema[schema[model].modelName].fields;
    const referenceField = Object.keys(schemato).find(
      (key) => schemato[key]?.references,
    );

    if (referenceField) {
      selectClause = {
        ...selectClause,
        [referenceField]: { ...e[model][referenceField]["*"] },
      };
    }
    return [selectClause, referenceField];
  }

  function getField(model: string, field: string) {
    return field === "id"
      ? field
      : (schema[model]?.fields[field]?.fieldName ?? field);
  }

  function getType(model: string, type: string) {
    if (type === "id") return "id";
    const f = schema[model]?.fields[type];
    if (!f) throw new Error(`Field "${type}" not found in model "${model}"`);
    return f.references?.field === "id" ? "reference" : f.type;
  }

  function getSchemaTypes(modelName: string) {
    const model = schema[modelName].modelName;
    return schema[model].fields;
  }

  // function getSchema(modelName: string) {
  //   const model = schema[modelName].modelName;
  //   return schema[model];
  // }

  return {
    transformInput(
      data: Record<string, any>,
      model: string,
      action: "update" | "create",
    ) {
      const transformedData: Record<string, any> = {}; // used to be for generateID funcs

      const fields = schema[model].fields;

      for (const field in fields) {
        // const woah = getType(model, field);
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
    convertWhereClause(where: Where[], model: string, e: any, obj: any) {
      return where.map((clause) => {
        const { field: _field, value, operator } = clause;
        const field = getField(model, _field);
        const type = getType(model, _field);
        switch (operator) {
          case "eq":
            if (type === "id") {
              return e.op(obj[field], "=", e.uuid(value));
            }
            if (type == "reference") {
              return e.op(obj[field].id, "=", e.uuid(value));
            }
            return e.op(obj, "=", value);
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
            return e.op(obj[field], "=", value);
        }
      });
    },
    transformSelect,
    getField,
    getSchemaTypes,
  };
};

export function gelAdapter(db: Client, e: any) {
  return (options: BetterAuthOptions = {}): Adapter => {
    const {
      transformInput,
      transformOutput,
      convertWhereClause,
      getSchemaTypes,
      transformSelect,
    } = createTransform(options);

    const adapter: Adapter = {
      id: "gel",
      async create({ model, data, select = [] }) {
        // console.log(select);
        const schema = getSchemaTypes(model);
        let transformed = transformInput(data, model, "create");
        let [selectClause, referenceField] = transformSelect(select, model, e);

        for (const key in transformed) {
          const field = schema[key];
          if (field?.references) {
            // console.log(referenceField);
            // console.log(field.references.model);
            // console.log(transformed[key]);
            transformed[key] = e.select(e[field.references.model], () => ({
              filter_single: { id: transformed[key] },
            }));

            // console.log(transformed[key]);
          }
        }

        const query = e.select(e.insert(e[model], transformed), (obj: any) => ({
          ...selectClause,
        }));

        const result = await query.run(db);

        if (referenceField) {
          result[referenceField] = result[referenceField]?.id;
        }
        return transformOutput(result, model, select);
      },

      async findOne({ model, where, select = [] }) {
        let [selectClause, referenceField] = transformSelect(select, model, e);

        const query = e.select(e[model], (obj: any) => ({
          ...selectClause,
          filter_single: where
            ? convertWhereClause(where ?? [], model, e, obj)[0]
            : undefined,
        }));
        const result = await query.run(db);
        if (referenceField) {
          result[referenceField] = result[referenceField]?.id;
        }
        return transformOutput(result, model, select);
      },

      async findMany({ model, where, limit, offset, sortBy }) {
        const query = e.select(e[model], (obj: any) => ({
          ...obj["*"],
          limit: limit,
          offset: offset,
          filter: where
            ? convertWhereClause(where, model, e, obj)[0]
            : undefined,
          order_by: sortBy?.field
            ? {
                expression: obj[sortBy.field],
                direction: e[sortBy.direction.toUpperCase()],
              }
            : undefined,
        }));
        const results = await query.run(db);
        return results.map((record: any) => transformOutput(record, model));
      },

      async delete({ model, where }) {
        const query = e.delete(e[model], (obj: any) => {
          const whereclause = convertWhereClause(where, model, e, obj);
          return {
            ...obj["*"],
            filter_single: where ? whereclause[0] : undefined,
          };
        });
        const results = await query.run(db);
        return transformOutput(results, model);
      },

      async deleteMany({ model, where }) {
        const query = e.delete(e[model], (obj: any) => {
          const whereclause = convertWhereClause(where ?? [], model, e, obj);
          return {
            ...obj["*"],
            filter: where ? whereclause[0] : undefined,
          };
        });
        const results = await query.run(db);

        return results.map((record: any) => transformOutput(record, model));
      },

      async count({ model, where }) {
        const query = e.count(
          e.select(e.user, (obj: any) => {
            const whereclause = convertWhereClause(where ?? [], model, e, obj);
            return {
              filter: where ? whereclause[0] : undefined,
            };
          }),
        );
        const results = await query.run(db);

        return results;
      },

      async update({ model, where, update }) {
        const query = e.select(
          e.update(e[model], (obj: any) => {
            const whereclause = convertWhereClause(where, model, e, obj);
            return {
              filter_single: where ? whereclause[0] : undefined,
              set: update,
            };
          }),
          (obj: any) => ({
            ...obj["*"],
          }),
        );
        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async updateMany({ model, where, update }) {
        const query = e.update(e[model], (obj: any) => {
          const whereclause = convertWhereClause(where, model, e, obj);
          return {
            filter: e.op(whereclause[0], "and", whereclause[1]),
            set: update,
          };
        });
        const result = await query.run(db);
        return transformOutput(result, model);
      },

      async createSchema(
        options: BetterAuthOptions,
        file: string = "./dbschema/generated.gelschema",
      ) {
        const typeMap: Record<string, string> = {
          string: "str",
          number: "int",
          boolean: "bool",
          date: "datetime",
        };

        const schemaString = Object.values(getAuthTables(options))
          .map(({ modelName, fields }) => {
            const fieldsString = Object.entries(fields)
              .map(([fieldName, { type, required, references }]) => {
                const fieldType = Array.isArray(type)
                  ? `array<${typeMap[type[0]]}>`
                  : typeMap[type];
                return `  ${required ? "required " : ""}${fieldName}: ${references?.model || fieldType};`;
              })
              .join("\n");
            return `type ${modelName} {\n${fieldsString}\n}`;
          })
          .join("\n\n");

        const filePath = join(process.cwd(), file);

        if (typeof Bun !== "undefined") {
          await Bun.write(filePath, schemaString);
        } else {
          await writeFile(filePath, schemaString);
        }

        return {
          code: schemaString,
          path: filePath,
          overwrite: true,
        };
      },
    };
    return adapter;
  };
}
